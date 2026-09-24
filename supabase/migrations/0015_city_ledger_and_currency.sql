-- ============================================================================
-- Module 7 — Billing (completion): city ledger and multi-currency
--
--   • City ledger / accounts receivable, for corporate clients who pay after
--     the stay (SOW Module 7 "City ledger / accounts receivable for corporate
--     clients who pay later"). A folio billed to a company is transferred to
--     that company's account at check-out: the folio is settled by a
--     corporate-billing credit, and the debt moves to the ledger with a due
--     date taken from the company's payment terms. The company's credit limit
--     is enforced at the moment of transfer.
--   • Multi-currency (SOW Module 7 "Currency conversion support for
--     international guests"). The property keeps one base currency and all
--     accounting stays in it; a foreign currency is a *presentation and
--     settlement* layer. When a guest pays in another currency the folio
--     records what they handed over, in which currency, and at which rate, so
--     the base-currency ledger and the guest's receipt agree for ever.
--
-- Run after 0014_billing.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'folio.city_ledger'),
  ('finance', 'folio.city_ledger'),
  ('front_office_manager', 'folio.city_ledger')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- Shows foreign-currency prices and lets the desk settle in another currency.
-- Off by default: a single-currency property should not have to think about it.
alter table property_settings add column if not exists multi_currency_enabled boolean not null default false;
-- Statements chase anything past due by this many days.
alter table property_settings add column if not exists ar_reminder_days int not null default 7
  check (ar_reminder_days between 0 and 180);

-- ── Currencies and exchange rates ───────────────────────────────────────────

-- One row per currency the property quotes or accepts. `rate_to_base` is how
-- many units of the base currency one unit of this currency buys, so
--     base_amount = foreign_amount * rate_to_base
-- The base currency itself is held at exactly 1 by a trigger below.
create table if not exists currencies (
  code         text primary key check (code ~ '^[A-Z]{3}$'),
  name         text not null check (length(trim(name)) > 0),
  symbol       text not null default '',
  rate_to_base numeric(14,6) not null check (rate_to_base > 0),
  -- Rounding used when a price is shown in this currency: 2 for most, 0 for
  -- currencies without minor units (JPY), so displays never show "¥1,240.00".
  decimals     smallint not null default 2 check (decimals between 0 and 4),
  is_active    boolean not null default true,
  updated_by   uuid references staff on delete set null,
  updated_at   timestamptz not null default now()
);

-- The base currency is the property's own and is always worth exactly itself.
create or replace function currencies_base_is_one()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_base text;
begin
  select currency into v_base from property_settings limit 1;
  if v_base is not null and new.code = v_base and new.rate_to_base <> 1 then
    raise exception 'CURRENCY_BASE_RATE'
      using hint = 'The property''s own currency is always held at a rate of 1.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists currencies_base_is_one_trg on currencies;
create trigger currencies_base_is_one_trg before insert or update on currencies
  for each row execute function currencies_base_is_one();

-- Seed the base currency plus the ones a Srinagar property is most often
-- asked for. Rates are indicative and must be maintained by finance.
insert into currencies (code, name, symbol, rate_to_base, decimals) values
  ('INR', 'Indian Rupee',      '₹',  1,       2),
  ('USD', 'US Dollar',         '$',  88.000000, 2),
  ('EUR', 'Euro',              '€',  95.000000, 2),
  ('GBP', 'Pound Sterling',    '£', 112.000000, 2),
  ('AED', 'UAE Dirham',        'AED', 24.000000, 2),
  ('SAR', 'Saudi Riyal',       'SAR', 23.500000, 2),
  ('JPY', 'Japanese Yen',      '¥',   0.580000, 0)
on conflict (code) do nothing;

-- ── Foreign-currency settlement on the folio ────────────────────────────────

-- What the guest actually handed over, when it was not in the base currency.
-- The `amount` column stays in the base currency, so every existing report,
-- balance and invoice keeps working untouched.
alter table folio_entries add column if not exists fx_currency text references currencies on delete set null;
alter table folio_entries add column if not exists fx_amount   numeric(14,2) check (fx_amount > 0);
alter table folio_entries add column if not exists fx_rate     numeric(14,6) check (fx_rate > 0);

-- All three travel together or none of them do.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'folio_entries_fx_complete') then
    alter table folio_entries add constraint folio_entries_fx_complete check (
      (fx_currency is null and fx_amount is null and fx_rate is null)
      or (fx_currency is not null and fx_amount is not null and fx_rate is not null)
    );
  end if;
end;
$$;

-- The rate an invoice was issued at, so a foreign-currency copy of a tax
-- document always reprints with the same numbers.
alter table invoices add column if not exists fx_currency text references currencies on delete set null;
alter table invoices add column if not exists fx_rate     numeric(14,6) check (fx_rate > 0);

-- ── City ledger ─────────────────────────────────────────────────────────────

-- The corporate accounts receivable book. One row per movement on a company's
-- account: a charge transferred from a stay, a payment received, a correction
-- or a write-off. Nothing is ever edited — a mistake is voided with a reason,
-- which keeps the account auditable.
create table if not exists city_ledger_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete restrict,
  -- charge:     the company now owes this.
  -- payment:    money received from the company.
  -- adjustment: a credit note or agreed reduction.
  -- writeoff:   given up as uncollectable, with a reason.
  kind        text not null check (kind in ('charge', 'payment', 'adjustment', 'writeoff')),
  amount      numeric(12,2) not null check (amount > 0),
  description text not null default '',
  -- Where a charge came from. Kept for the statement and for the auditor.
  booking_id  uuid references bookings on delete set null,
  folio_id    uuid references folios on delete set null,
  invoice_id  uuid references invoices on delete set null,
  -- The folio credit that settled the stay when the charge was transferred,
  -- so the two sides of the transfer can always be tied together.
  folio_entry_id uuid references folio_entries on delete set null,
  -- Charges fall due on this date; the aging report counts from it.
  due_date    date,
  -- How a payment arrived.
  method      payment_method,
  reference   text not null default '',
  voided_at   timestamptz,
  voided_by   uuid references staff on delete set null,
  void_reason text not null default '',
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now(),
  constraint city_ledger_charge_has_due   check (kind <> 'charge'  or due_date is not null),
  constraint city_ledger_payment_has_method check (kind <> 'payment' or method is not null)
);

create index if not exists city_ledger_company_idx on city_ledger_entries (company_id, created_at desc);
create index if not exists city_ledger_open_idx on city_ledger_entries (company_id, due_date)
  where kind = 'charge' and voided_at is null;
create index if not exists city_ledger_booking_idx on city_ledger_entries (booking_id);

-- One transfer per folio: a stay cannot be pushed onto a company's account
-- twice. A voided transfer frees the folio to be transferred again.
create unique index if not exists city_ledger_folio_once_idx
  on city_ledger_entries (folio_id)
  where kind = 'charge' and voided_at is null and folio_id is not null;

-- What a company still owes: charges, less payments, credits and write-offs.
create or replace function company_balance(p_company uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind = 'charge' then amount else -amount end), 0)
    from city_ledger_entries
   where company_id = p_company and voided_at is null;
$$;

-- Moves an unpaid folio onto a company's account (SOW Module 7). Both sides
-- happen in one transaction: the folio is credited so the stay reads as
-- settled, and the company is charged so the money is still chased.
--
-- Raises CITY_LEDGER_* on anything that should stop the desk.
create or replace function city_ledger_transfer(
  p_folio   uuid,
  p_company uuid,
  p_date    date,
  p_note    text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_folio    record;
  v_company  record;
  v_balance  numeric;
  v_owing    numeric;
  v_terms    int;
  v_invoice  uuid;
  v_entry    uuid;
  v_ledger   uuid;
  v_staff    uuid := auth.uid();
begin
  if not has_permission('folio.city_ledger') then
    raise exception 'not permitted';
  end if;

  select f.*, b.reference as booking_reference
    into v_folio
    from folios f join bookings b on b.id = f.booking_id
   where f.id = p_folio;
  if v_folio is null then
    raise exception 'CITY_LEDGER_NO_FOLIO' using hint = 'That folio no longer exists.';
  end if;

  select * into v_company from companies where id = p_company;
  if v_company is null then
    raise exception 'CITY_LEDGER_NO_COMPANY' using hint = 'Choose a company to bill.';
  end if;
  if not v_company.is_active then
    raise exception 'CITY_LEDGER_INACTIVE'
      using hint = 'That company account is closed. Reactivate it under Companies first.';
  end if;

  -- One transfer per folio. Once a bill has been pushed onto a company's
  -- account it is closed; a charge that arrives afterwards belongs on a new
  -- folio, which keeps the two books in step. The partial unique index below
  -- is the hard backstop; this check exists to say so in plain words.
  if exists (
    select 1 from city_ledger_entries
     where folio_id = p_folio and kind = 'charge' and voided_at is null
  ) then
    raise exception 'CITY_LEDGER_ALREADY_TRANSFERRED'
      using hint = 'This bill is already on a company account. Open a new folio for anything charged since.';
  end if;

  v_owing := folio_balance_of(p_folio);
  if v_owing <= 0 then
    raise exception 'CITY_LEDGER_NOTHING_OWED'
      using hint = 'There is nothing left to bill on this folio.';
  end if;

  -- Credit limit, counted against what the company already owes.
  v_balance := company_balance(p_company);
  if v_company.credit_limit is not null and v_balance + v_owing > v_company.credit_limit then
    raise exception 'CITY_LEDGER_CREDIT_LIMIT: % owes % of a % limit; this stay adds %',
      v_company.name, v_balance, v_company.credit_limit, v_owing;
  end if;

  v_terms := coalesce(v_company.payment_terms_days, 30);
  select id into v_invoice
    from invoices
   where folio_id = p_folio and status = 'issued'
   order by issued_at desc
   limit 1;

  -- Settle the stay: the money is now owed by the company, not the guest.
  insert into folio_entries (booking_id, folio_id, kind, description, amount, method, reference, created_by)
  values (
    v_folio.booking_id,
    p_folio,
    'payment',
    concat_ws(' — ', 'Transferred to city ledger', v_company.name, nullif(p_note, '')),
    v_owing,
    'corporate_billing',
    coalesce((select number from invoices where id = v_invoice), ''),
    v_staff
  )
  returning id into v_entry;

  -- Open the receivable.
  insert into city_ledger_entries (
    company_id, kind, amount, description, booking_id, folio_id, invoice_id,
    folio_entry_id, due_date, created_by
  ) values (
    p_company,
    'charge',
    v_owing,
    concat_ws(' — ',
      'Stay ' || v_folio.booking_reference,
      nullif(v_folio.label, ''),
      nullif(p_note, '')),
    v_folio.booking_id,
    p_folio,
    v_invoice,
    v_entry,
    p_date + v_terms,
    v_staff
  )
  returning id into v_ledger;

  -- Tie the folio credit back to the ledger row.
  update folio_entries set reference = concat_ws(' ', nullif(reference, ''), '#' || left(v_ledger::text, 8))
   where id = v_entry;

  -- The folio is now billed to this company even if it was not before.
  update folios set company_id = p_company where id = p_folio and company_id is null;

  return v_ledger;
end;
$$;

-- Voiding a transfer has to undo both sides, or the folio and the account
-- would disagree.
create or replace function city_ledger_void(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_entry record;
  v_staff uuid := auth.uid();
begin
  if not has_permission('folio.city_ledger') then
    raise exception 'not permitted';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'CITY_LEDGER_VOID_REASON' using hint = 'Give a reason for voiding this entry.';
  end if;

  select * into v_entry from city_ledger_entries where id = p_entry;
  if v_entry is null then
    raise exception 'CITY_LEDGER_NO_ENTRY' using hint = 'That entry no longer exists.';
  end if;
  if v_entry.voided_at is not null then
    raise exception 'CITY_LEDGER_ALREADY_VOID' using hint = 'That entry is already voided.';
  end if;
  if v_entry.invoice_id is not null and v_entry.kind = 'charge'
     and exists (select 1 from invoices where id = v_entry.invoice_id and status = 'issued') then
    raise exception 'CITY_LEDGER_INVOICED'
      using hint = 'This charge has been invoiced. Cancel the invoice before voiding the transfer.';
  end if;

  update city_ledger_entries
     set voided_at = now(), voided_by = v_staff, void_reason = p_reason
   where id = p_entry;

  -- Put the balance back on the guest's folio.
  if v_entry.folio_entry_id is not null then
    update folio_entries
       set voided_at = now(), voided_by = v_staff,
           void_reason = 'City ledger transfer voided: ' || p_reason
     where id = v_entry.folio_entry_id and voided_at is null;
  end if;
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table currencies          enable row level security;
alter table city_ledger_entries enable row level security;

drop policy if exists currencies_select on currencies;
drop policy if exists currencies_write  on currencies;
-- Everyone who can take a payment or quote a price needs to read rates.
create policy currencies_select on currencies for select using (is_staff());
create policy currencies_write on currencies for all
  using (has_permission('settings.manage') or has_permission('folio.city_ledger'))
  with check (has_permission('settings.manage') or has_permission('folio.city_ledger'));

drop policy if exists city_ledger_select on city_ledger_entries;
drop policy if exists city_ledger_write  on city_ledger_entries;
create policy city_ledger_select on city_ledger_entries for select
  using (has_permission('folio.view') or has_permission('folio.city_ledger') or has_permission('companies.manage'));
-- Transfers and voids go through the functions above; this covers payments,
-- adjustments and write-offs entered by finance.
create policy city_ledger_write on city_ledger_entries for all
  using (has_permission('folio.city_ledger')) with check (has_permission('folio.city_ledger'));

-- ── Audit ───────────────────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select * from (values
    ('city_ledger_entries', 'folio'), ('currencies', 'settings')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
