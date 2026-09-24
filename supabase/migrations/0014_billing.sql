-- ============================================================================
-- Module 7 — Billing, Invoicing, Folio & Payments (core)
--
--   • Split folios: a stay can carry more than one bill, so room charges can
--     go to a company while incidentals stay on the guest's own card. Every
--     folio entry belongs to a folio; bookings that never split keep a single
--     master folio, created for them automatically.
--   • Tax invoices with sequential, non-repeating numbers per financial year
--     (SOW Module 7 "Invoice Numbering"). Issued invoices are immutable: a
--     mistake is cancelled, never edited, and the number is never reused.
--   • Online payments through Razorpay, recorded as gateway transactions and
--     posted to the folio only once the payment is captured.
--   • Refunds above a configurable value need approval before they are paid
--     (SOW Module 7 "Refund Rules").
--
-- City ledger (corporate accounts receivable) and multi-currency are the
-- remaining parts of Module 7 and come in a later migration.
--
-- Run after 0013_guest_crm_and_admin.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'folio.invoice'),              ('manager', 'folio.refund_approve'),
  ('front_office_manager', 'folio.invoice'),
  ('finance', 'folio.invoice'),              ('finance', 'folio.refund_approve'),
  ('front_desk', 'folio.invoice')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- Invoice numbers read <prefix>/<financial year>/<sequence>, e.g. INV/2026-27/0001.
alter table property_settings add column if not exists invoice_prefix text not null default 'INV';
alter table property_settings add column if not exists invoice_terms  text not null default '';
-- Refunds at or above this value need a second person to approve them.
-- Zero means every refund needs approval.
alter table property_settings add column if not exists refund_approval_threshold numeric(12,2) not null default 5000
  check (refund_approval_threshold >= 0);
-- Turns the guest-facing payment link on. Needs RAZORPAY_* keys as well.
alter table property_settings add column if not exists online_payments_enabled boolean not null default false;

-- ── Folios ──────────────────────────────────────────────────────────────────

create table if not exists folios (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings on delete cascade,
  -- 'master' is the bill every booking starts with. 'split' folios are opened
  -- by the desk to separate, say, company-paid room charges from extras.
  kind        text not null default 'split' check (kind in ('master', 'split')),
  label       text not null default '' check (length(label) <= 60),
  -- Set when this folio is billed to a corporate account rather than the guest.
  company_id  uuid references companies on delete set null,
  closed_at   timestamptz,
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now()
);

-- One master folio per booking; the app relies on this to find it.
create unique index if not exists folios_master_idx on folios (booking_id) where kind = 'master';
create index if not exists folios_booking_idx on folios (booking_id, created_at);

alter table folio_entries add column if not exists folio_id uuid references folios on delete cascade;

-- Returns the booking's master folio, creating it the first time it is needed.
create or replace function master_folio(p_booking uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from folios where booking_id = p_booking and kind = 'master';
  if v_id is null then
    insert into folios (booking_id, kind, label)
    values (p_booking, 'master', 'Master')
    on conflict do nothing
    returning id into v_id;
    -- Another transaction may have won the race.
    if v_id is null then
      select id into v_id from folios where booking_id = p_booking and kind = 'master';
    end if;
  end if;
  return v_id;
end;
$$;

-- Existing folio entries belong to their booking's master folio.
do $$
declare
  b record;
begin
  for b in select distinct booking_id from folio_entries where folio_id is null loop
    update folio_entries set folio_id = master_folio(b.booking_id)
     where booking_id = b.booking_id and folio_id is null;
  end loop;
end;
$$;

-- Any charge posted without naming a folio lands on the master folio, so
-- night audit, check-in and the POS never have to know about splitting.
create or replace function folio_entry_default_folio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.folio_id is null then
    new.folio_id := master_folio(new.booking_id);
  end if;
  return new;
end;
$$;

drop trigger if exists folio_entries_default_folio on folio_entries;
create trigger folio_entries_default_folio before insert on folio_entries
  for each row execute function folio_entry_default_folio();

create index if not exists folio_entries_folio_idx on folio_entries (folio_id, created_at);

-- A folio entry must stay with its own booking's folio.
create or replace function folio_entry_matches_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.folio_id is not null
     and not exists (select 1 from folios where id = new.folio_id and booking_id = new.booking_id) then
    raise exception 'FOLIO_BOOKING_MISMATCH' using hint = 'That folio belongs to a different booking.';
  end if;
  return new;
end;
$$;

drop trigger if exists folio_entries_check_folio on folio_entries;
create trigger folio_entries_check_folio before insert or update of folio_id, booking_id on folio_entries
  for each row execute function folio_entry_matches_booking();

-- Balance owed on one folio, rather than the whole booking.
create or replace function folio_balance_of(p_folio uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    case
      when kind in ('room', 'fee', 'penalty', 'extra', 'refund') then amount + tax_amount
      else -amount
    end
  ), 0)
  from folio_entries
  where folio_id = p_folio and voided_at is null;
$$;

-- ── Invoice numbering ───────────────────────────────────────────────────────

-- One counter per series and financial year. Numbers are handed out by
-- next_invoice_number() only, which makes them sequential and non-repeating
-- even when two people issue an invoice at the same moment.
create table if not exists invoice_series (
  series    text not null,
  financial_year text not null,
  last_seq  int not null default 0 check (last_seq >= 0),
  primary key (series, financial_year)
);

-- Indian financial year: 1 April to 31 March, written "2026-27".
create or replace function financial_year_of(p_date date)
returns text language sql immutable as $$
  select case
    when extract(month from p_date) >= 4
      then to_char(p_date, 'YYYY') || '-' || to_char(p_date + interval '1 year', 'YY')
    else to_char(p_date - interval '1 year', 'YYYY') || '-' || to_char(p_date, 'YY')
  end;
$$;

-- Atomically claims the next number. The row lock held by the upsert makes
-- concurrent callers queue, so no two invoices can take the same sequence.
create or replace function next_invoice_number(p_series text, p_fy text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
begin
  insert into invoice_series (series, financial_year, last_seq)
  values (p_series, p_fy, 1)
  on conflict (series, financial_year)
    do update set last_seq = invoice_series.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

-- ── Invoices ────────────────────────────────────────────────────────────────

create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  -- The printed number, e.g. INV/2026-27/0001. Never reused, never edited.
  number          text not null unique,
  series          text not null default 'INV',
  financial_year  text not null,
  seq             int  not null,
  booking_id      uuid not null references bookings on delete restrict,
  folio_id        uuid not null references folios on delete restrict,
  -- Who the invoice is made out to, copied at the moment of issue so that a
  -- later change to the guest or company record cannot alter a tax document.
  bill_to_name    text not null,
  bill_to_address text not null default '',
  bill_to_gstin   text not null default '',
  company_id      uuid references companies on delete set null,
  place_of_supply text not null default '',
  currency        text not null default 'INR',
  net_total       numeric(12,2) not null check (net_total >= 0),
  tax_total       numeric(12,2) not null check (tax_total >= 0),
  grand_total     numeric(12,2) not null check (grand_total >= 0),
  -- [{ "rate": 5, "net": 1000, "tax": 50 }, ...] — the rate-wise summary a
  -- GST invoice has to show.
  tax_breakdown   jsonb not null default '[]',
  -- The folio lines as they stood when the invoice was issued.
  lines           jsonb not null default '[]',
  status          text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_at    timestamptz,
  cancelled_by    uuid references staff on delete set null,
  cancel_reason   text not null default '',
  issued_at       timestamptz not null default now(),
  issued_by       uuid references staff on delete set null,
  unique (series, financial_year, seq)
);

create index if not exists invoices_booking_idx on invoices (booking_id, issued_at desc);
create index if not exists invoices_issued_idx  on invoices (issued_at desc);

-- An issued invoice is a tax document: only its cancellation fields may
-- change, and it can never be deleted.
create or replace function invoices_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'INVOICE_IMMUTABLE' using hint = 'Invoices cannot be deleted. Cancel the invoice instead.';
  end if;
  if new.number <> old.number or new.booking_id <> old.booking_id or new.folio_id <> old.folio_id
     or new.net_total <> old.net_total or new.tax_total <> old.tax_total
     or new.grand_total <> old.grand_total or new.seq <> old.seq
     or new.financial_year <> old.financial_year or new.series <> old.series
     or new.bill_to_name <> old.bill_to_name or new.bill_to_gstin <> old.bill_to_gstin
     or new.tax_breakdown <> old.tax_breakdown or new.lines <> old.lines
     or new.issued_at <> old.issued_at then
    raise exception 'INVOICE_IMMUTABLE' using hint = 'An issued invoice cannot be changed. Cancel it and issue a new one.';
  end if;
  if old.status = 'cancelled' then
    raise exception 'INVOICE_CANCELLED' using hint = 'This invoice is already cancelled.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_immutable_trg on invoices;
create trigger invoices_immutable_trg before update or delete on invoices
  for each row execute function invoices_immutable();

-- ── Gateway payments ────────────────────────────────────────────────────────

-- One row per attempt to take money online. The folio is only credited when
-- the gateway confirms capture, and the unique provider ids make the webhook
-- safe to receive more than once.
create table if not exists payment_transactions (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings on delete cascade,
  folio_id         uuid references folios on delete set null,
  provider         text not null default 'razorpay' check (provider in ('razorpay')),
  -- Razorpay payment link id (plink_…) and, once paid, the payment id (pay_…).
  provider_link_id text unique,
  provider_ref     text unique,
  short_url        text not null default '',
  purpose          text not null default 'settlement' check (purpose in ('deposit', 'settlement')),
  amount           numeric(12,2) not null check (amount > 0),
  currency         text not null default 'INR',
  status           text not null default 'created'
                   check (status in ('created', 'paid', 'cancelled', 'expired', 'failed', 'refunded')),
  -- The folio credit this payment produced, so it is never posted twice.
  folio_entry_id   uuid references folio_entries on delete set null,
  paid_at          timestamptz,
  expires_at       timestamptz,
  last_event       text not null default '',
  created_by       uuid references staff on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists payment_tx_booking_idx on payment_transactions (booking_id, created_at desc);
create index if not exists payment_tx_status_idx  on payment_transactions (status) where status = 'created';

-- ── Refund approval ─────────────────────────────────────────────────────────

create table if not exists refund_requests (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references bookings on delete cascade,
  folio_id       uuid references folios on delete set null,
  amount         numeric(12,2) not null check (amount > 0),
  reason         text not null check (length(trim(reason)) > 0),
  method         payment_method not null,
  -- Set when the money goes back through the gateway rather than by hand.
  payment_tx_id  uuid references payment_transactions on delete set null,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'processed', 'failed')),
  requested_by   uuid references staff on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references staff on delete set null,
  decided_at     timestamptz,
  decision_note  text not null default '',
  -- The folio entry created once the refund is actually paid out.
  folio_entry_id uuid references folio_entries on delete set null,
  processed_at   timestamptz,
  error          text not null default ''
);

create index if not exists refund_requests_status_idx on refund_requests (status, requested_at desc);
create index if not exists refund_requests_booking_idx on refund_requests (booking_id, requested_at desc);

-- The person who asks for a refund cannot be the person who approves it.
create or replace function refund_separate_approver()
returns trigger language plpgsql as $$
begin
  if new.status in ('approved', 'rejected') and old.status = 'pending'
     and new.decided_by is not null and new.decided_by = old.requested_by then
    raise exception 'REFUND_SELF_APPROVAL'
      using hint = 'A refund must be approved by someone other than the person who requested it.';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_separate_approver_trg on refund_requests;
create trigger refund_separate_approver_trg before update on refund_requests
  for each row execute function refund_separate_approver();

-- ── Row level security ──────────────────────────────────────────────────────

alter table folios               enable row level security;
alter table invoices             enable row level security;
alter table invoice_series       enable row level security;
alter table payment_transactions enable row level security;
alter table refund_requests      enable row level security;

drop policy if exists folios_select on folios;
drop policy if exists folios_write  on folios;
create policy folios_select on folios for select
  using (has_permission('folio.view') or has_permission('bookings.view'));
create policy folios_write on folios for all
  using (has_permission('folio.adjust') or has_permission('folio.payment'))
  with check (has_permission('folio.adjust') or has_permission('folio.payment'));

drop policy if exists invoices_select on invoices;
drop policy if exists invoices_insert on invoices;
drop policy if exists invoices_update on invoices;
create policy invoices_select on invoices for select
  using (has_permission('folio.view') or has_permission('bookings.view'));
create policy invoices_insert on invoices for insert
  with check (has_permission('folio.invoice'));
-- Cancellation only; the immutability trigger guards everything else.
create policy invoices_update on invoices for update
  using (has_permission('folio.invoice')) with check (has_permission('folio.invoice'));

-- Counters are read and advanced through next_invoice_number(), which is
-- security definer; nobody edits them directly.
drop policy if exists invoice_series_select on invoice_series;
create policy invoice_series_select on invoice_series for select using (has_permission('folio.view'));

drop policy if exists payment_tx_select on payment_transactions;
drop policy if exists payment_tx_write  on payment_transactions;
create policy payment_tx_select on payment_transactions for select
  using (has_permission('folio.view') or has_permission('bookings.view'));
create policy payment_tx_write on payment_transactions for all
  using (has_permission('folio.payment')) with check (has_permission('folio.payment'));

drop policy if exists refunds_select  on refund_requests;
drop policy if exists refunds_insert  on refund_requests;
drop policy if exists refunds_decide  on refund_requests;
create policy refunds_select on refund_requests for select
  using (has_permission('folio.view') or has_permission('folio.refund_approve'));
create policy refunds_insert on refund_requests for insert
  with check (has_permission('folio.payment'));
create policy refunds_decide on refund_requests for update
  using (has_permission('folio.refund_approve') or has_permission('folio.payment'))
  with check (has_permission('folio.refund_approve') or has_permission('folio.payment'));

-- ── Audit ───────────────────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select * from (values
    ('folios', 'folio'), ('invoices', 'folio'),
    ('payment_transactions', 'folio'), ('refund_requests', 'folio')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
