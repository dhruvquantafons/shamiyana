-- ============================================================================
-- Module 8 — Guest CRM (completion): loyalty points and membership tiers
--
--   • Points are held as *lots*. Every earning creates a lot that carries its
--     own expiry date and how much of it is left. A redemption eats the
--     oldest lots first, and expiry retires whatever is still unused when a
--     lot's date passes. This is what makes the balance explainable: the desk
--     can always say which stay a point came from and when it dies, which a
--     single running total cannot do.
--   • Tiers are re-evaluated from nights stayed and amount spent in a rolling
--     twelve months (SOW Module 8 "Tier Upgrade Rules"), by a function the
--     night audit calls. Earn and redemption rates are per tier (SOW
--     "configurable earn-rate and redemption-rate per tier").
--   • Redeeming posts a payment to the guest's folio, so loyalty settles a
--     bill exactly like cash does and every report keeps adding up.
--
-- Run after 0015_city_ledger_and_currency.sql.
-- ============================================================================

-- ── Payment method ──────────────────────────────────────────────────────────

-- SOW Module 7 lists "Loyalty Points" as a payment method in its own right.
-- The value is only ever used at runtime by the functions below, never in
-- this migration, so adding it here is safe inside a single transaction.
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'payment_method' and e.enumlabel = 'loyalty_points'
  ) then
    alter type payment_method add value 'loyalty_points';
  end if;
end;
$$;

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'loyalty.manage'),              ('manager', 'loyalty.redeem'),
  ('front_office_manager', 'loyalty.manage'), ('front_office_manager', 'loyalty.redeem'),
  ('sales_marketing', 'loyalty.manage'),
  ('front_desk', 'loyalty.redeem'),
  ('finance', 'loyalty.redeem')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

alter table property_settings add column if not exists loyalty_enabled boolean not null default false;
alter table property_settings add column if not exists loyalty_program_name text not null default 'Shamiyana Rewards';
-- Points die this many months after they are earned. Zero means never.
alter table property_settings add column if not exists loyalty_expiry_months int not null default 24
  check (loyalty_expiry_months between 0 and 120);
-- The smallest redemption the desk may put through, so a bill is not settled
-- with a handful of points.
alter table property_settings add column if not exists loyalty_min_redeem_points int not null default 500
  check (loyalty_min_redeem_points >= 0);

-- ── Tiers ───────────────────────────────────────────────────────────────────

create table if not exists loyalty_tiers (
  key         text primary key check (key ~ '^[a-z_]{2,20}$'),
  name        text not null check (length(trim(name)) > 0),
  sort_order  int  not null default 0,
  -- A guest holds the highest tier whose thresholds they both meet, measured
  -- over a rolling twelve months.
  min_nights  int  not null default 0 check (min_nights >= 0),
  min_spend   numeric(12,2) not null default 0 check (min_spend >= 0),
  -- Points earned for each unit of base currency spent, e.g. 0.05 gives one
  -- point per ₹20.
  earn_rate   numeric(10,4) not null default 0 check (earn_rate >= 0),
  -- What one point is worth when redeemed, in base currency.
  redeem_rate numeric(10,4) not null default 0 check (redeem_rate >= 0),
  perks       text not null default '',
  colour      text not null default 'slate',
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- The entry tier must sit at zero so that every enrolled guest has a tier.
insert into loyalty_tiers (key, name, sort_order, min_nights, min_spend, earn_rate, redeem_rate, perks, colour) values
  ('silver',   'Silver',   1,  0,      0, 0.0500, 0.2500,
   'Welcome drink on arrival. Late check-out subject to availability.', 'slate'),
  ('gold',     'Gold',     2, 10,  75000, 0.0750, 0.2500,
   'Room upgrade subject to availability. Complimentary breakfast. 2 pm late check-out.', 'amber'),
  ('platinum', 'Platinum', 3, 25, 200000, 0.1000, 0.3000,
   'Guaranteed upgrade one category. Airport transfer. 4 pm late check-out. Dedicated desk.', 'violet')
on conflict (key) do nothing;

-- ── Membership on the guest record ──────────────────────────────────────────

alter table guests add column if not exists loyalty_opt_in    boolean not null default false;
alter table guests add column if not exists loyalty_member_no  text;
alter table guests add column if not exists loyalty_tier       text references loyalty_tiers on delete set null;
alter table guests add column if not exists loyalty_joined_on  date;

create unique index if not exists guests_loyalty_member_no_idx on guests (loyalty_member_no)
  where loyalty_member_no is not null;
create index if not exists guests_loyalty_tier_idx on guests (loyalty_tier) where loyalty_opt_in;

-- ── Points ──────────────────────────────────────────────────────────────────

-- One row per movement. Positive rows are lots that can be spent; negative
-- rows record spending, expiry or a correction.
create table if not exists loyalty_transactions (
  id          uuid primary key default gen_random_uuid(),
  guest_id    uuid not null references guests on delete cascade,
  kind        text not null check (kind in ('earn', 'redeem', 'expire', 'adjust')),
  -- Signed: what this row did to the balance. Never zero.
  points      int not null check (points <> 0),
  -- How much of this lot is still spendable. Only meaningful for positive
  -- rows; negative rows hold zero.
  remaining   int not null default 0 check (remaining >= 0),
  -- The money that earned the points, or the money a redemption paid off.
  base_amount numeric(12,2) not null default 0 check (base_amount >= 0),
  -- Where it came from.
  booking_id  uuid references bookings on delete set null,
  invoice_id  uuid references invoices on delete set null,
  folio_entry_id uuid references folio_entries on delete set null,
  -- For an 'expire' row, the lot that expired.
  source_id   uuid references loyalty_transactions on delete set null,
  tier        text references loyalty_tiers on delete set null,
  description text not null default '',
  -- Positive rows only: the day the unused remainder dies. Null never expires.
  expires_on  date,
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now(),
  constraint loyalty_remaining_only_on_credit check (points > 0 or remaining = 0),
  constraint loyalty_remaining_within_lot     check (points < 0 or remaining <= points)
);

create index if not exists loyalty_tx_guest_idx on loyalty_transactions (guest_id, created_at desc);
-- The lot queue: oldest spendable points first.
create index if not exists loyalty_tx_lots_idx on loyalty_transactions (guest_id, expires_on, created_at)
  where remaining > 0;
-- A stay earns points once, however many times an invoice is reprinted.
create unique index if not exists loyalty_tx_invoice_once_idx on loyalty_transactions (invoice_id)
  where kind = 'earn' and invoice_id is not null;

create table if not exists loyalty_tier_history (
  id         uuid primary key default gen_random_uuid(),
  guest_id   uuid not null references guests on delete cascade,
  from_tier  text,
  to_tier    text,
  reason     text not null default '',
  nights     int not null default 0,
  spend      numeric(12,2) not null default 0,
  changed_at timestamptz not null default now(),
  changed_by uuid references staff on delete set null
);

create index if not exists loyalty_tier_history_guest_idx on loyalty_tier_history (guest_id, changed_at desc);

-- Spendable balance: unused, unexpired lots.
create or replace function loyalty_balance(p_guest uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(remaining), 0)::int
    from loyalty_transactions
   where guest_id = p_guest
     and remaining > 0
     and (expires_on is null or expires_on >= current_date);
$$;

-- ── Enrolment ───────────────────────────────────────────────────────────────

create sequence if not exists loyalty_member_seq start 1001;

-- Enrols a guest and gives them a membership number and the entry tier.
create or replace function loyalty_enroll(p_guest uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_no    text;
  v_entry text;
begin
  if not (has_permission('loyalty.manage') or has_permission('guests.edit')) then
    raise exception 'not permitted';
  end if;

  select loyalty_member_no into v_no from guests where id = p_guest;
  if v_no is not null then
    update guests set loyalty_opt_in = true where id = p_guest;
    return v_no;
  end if;

  select key into v_entry from loyalty_tiers
   where is_active order by sort_order limit 1;
  if v_entry is null then
    raise exception 'LOYALTY_NO_TIERS'
      using hint = 'Set up at least one membership tier before enrolling guests.';
  end if;

  v_no := 'RR' || lpad(nextval('loyalty_member_seq')::text, 6, '0');

  update guests
     set loyalty_opt_in   = true,
         loyalty_member_no = v_no,
         loyalty_tier     = coalesce(loyalty_tier, v_entry),
         loyalty_joined_on = coalesce(loyalty_joined_on, current_date)
   where id = p_guest;

  insert into loyalty_tier_history (guest_id, from_tier, to_tier, reason, changed_by)
  values (p_guest, null, v_entry, 'Enrolled', auth.uid());

  return v_no;
end;
$$;

-- ── Earning ─────────────────────────────────────────────────────────────────

-- Awards points for an issued invoice. Points are earned on the taxable value
-- only — tax collected for the government is not the guest's spend with the
-- hotel. Idempotent: calling it twice for one invoice does nothing.
create or replace function loyalty_award_for_invoice(p_invoice uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_inv     record;
  v_guest   uuid;
  v_tier    record;
  v_months  int;
  v_points  int;
  v_enabled boolean;
begin
  select loyalty_enabled, loyalty_expiry_months
    into v_enabled, v_months
    from property_settings limit 1;
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  select * into v_inv from invoices where id = p_invoice and status = 'issued';
  if v_inv is null then
    return 0;
  end if;

  -- A company-billed invoice is the company's spend, not the guest's.
  if v_inv.company_id is not null then
    return 0;
  end if;

  select b.guest_id into v_guest from bookings b where b.id = v_inv.booking_id;
  if v_guest is null then
    return 0;
  end if;

  if not exists (select 1 from guests where id = v_guest and loyalty_opt_in) then
    return 0;
  end if;

  if exists (select 1 from loyalty_transactions where invoice_id = p_invoice and kind = 'earn') then
    return 0;
  end if;

  select t.* into v_tier
    from guests g join loyalty_tiers t on t.key = g.loyalty_tier
   where g.id = v_guest;
  if v_tier is null then
    select * into v_tier from loyalty_tiers where is_active order by sort_order limit 1;
  end if;
  if v_tier is null then
    return 0;
  end if;

  v_points := floor(v_inv.net_total * v_tier.earn_rate)::int;
  if v_points <= 0 then
    return 0;
  end if;

  insert into loyalty_transactions (
    guest_id, kind, points, remaining, base_amount, booking_id, invoice_id,
    tier, description, expires_on, created_by
  ) values (
    v_guest, 'earn', v_points, v_points, v_inv.net_total, v_inv.booking_id, p_invoice,
    v_tier.key,
    'Invoice ' || v_inv.number,
    case when coalesce(v_months, 0) > 0
         then (v_inv.issued_at::date + (v_months || ' months')::interval)::date
         else null end,
    auth.uid()
  );

  return v_points;
end;
$$;

-- Points land as soon as the invoice is issued, so the desk never has to
-- remember to award them.
create or replace function loyalty_invoice_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform loyalty_award_for_invoice(new.id);
  return new;
end;
$$;

drop trigger if exists invoices_loyalty_award on invoices;
create trigger invoices_loyalty_award after insert on invoices
  for each row when (new.status = 'issued') execute function loyalty_invoice_trigger();

-- ── Spending ────────────────────────────────────────────────────────────────

-- Takes points off the oldest unexpired lots first. Raises if the guest does
-- not have enough, so a redemption can never drive a balance negative.
create or replace function loyalty_consume(p_guest uuid, p_points int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_left int := p_points;
  v_lot  record;
  v_take int;
begin
  if p_points <= 0 then
    raise exception 'LOYALTY_POINTS_INVALID' using hint = 'Enter how many points to redeem.';
  end if;
  if loyalty_balance(p_guest) < p_points then
    raise exception 'LOYALTY_INSUFFICIENT: balance is %', loyalty_balance(p_guest);
  end if;

  for v_lot in
    select id, remaining from loyalty_transactions
     where guest_id = p_guest and remaining > 0
       and (expires_on is null or expires_on >= current_date)
     order by expires_on nulls last, created_at
     for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_lot.remaining);
    update loyalty_transactions set remaining = remaining - v_take where id = v_lot.id;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception 'LOYALTY_INSUFFICIENT: % points could not be taken', v_left;
  end if;
end;
$$;

-- Redeems points against a stay. The folio is credited in base currency at
-- the guest's tier redemption rate, so the bill settles exactly as it would
-- with any other payment method.
create or replace function loyalty_redeem(
  p_guest   uuid,
  p_booking uuid,
  p_folio   uuid,
  p_points  int,
  p_note    text default ''
)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_tier   record;
  v_min    int;
  v_value  numeric(12,2);
  v_owing  numeric(12,2);
  v_folio  uuid := p_folio;
  v_entry  uuid;
  v_staff  uuid := auth.uid();
begin
  if not has_permission('loyalty.redeem') then
    raise exception 'not permitted';
  end if;

  select loyalty_min_redeem_points into v_min from property_settings limit 1;
  if p_points < coalesce(v_min, 0) then
    raise exception 'LOYALTY_BELOW_MINIMUM: the smallest redemption is % points', coalesce(v_min, 0);
  end if;

  select t.* into v_tier
    from guests g join loyalty_tiers t on t.key = g.loyalty_tier
   where g.id = p_guest;
  if v_tier is null then
    raise exception 'LOYALTY_NOT_A_MEMBER'
      using hint = 'Enrol the guest in the loyalty programme first.';
  end if;
  if v_tier.redeem_rate <= 0 then
    raise exception 'LOYALTY_NO_REDEEM_RATE'
      using hint = 'This tier has no redemption rate set. Set one under Loyalty.';
  end if;

  v_value := round(p_points * v_tier.redeem_rate, 2);
  if v_value <= 0 then
    raise exception 'LOYALTY_POINTS_INVALID' using hint = 'That many points are worth nothing yet.';
  end if;

  if v_folio is null then
    v_folio := master_folio(p_booking);
  end if;

  -- Never pay out more than the bill: loyalty settles a debt, it is not cash.
  v_owing := folio_balance_of(v_folio);
  if v_owing <= 0 then
    raise exception 'LOYALTY_NOTHING_OWED'
      using hint = 'There is nothing left to settle on this folio.';
  end if;
  if v_value > v_owing then
    raise exception 'LOYALTY_OVER_BALANCE: % is worth % but only % is owed',
      p_points, v_value, v_owing;
  end if;

  perform loyalty_consume(p_guest, p_points);

  insert into folio_entries (booking_id, folio_id, kind, description, amount, method, reference, created_by)
  values (
    p_booking, v_folio, 'payment',
    concat_ws(' — ', p_points || ' loyalty points redeemed', nullif(p_note, '')),
    v_value, 'loyalty_points',
    (select loyalty_member_no from guests where id = p_guest),
    v_staff
  )
  returning id into v_entry;

  insert into loyalty_transactions (
    guest_id, kind, points, base_amount, booking_id, folio_entry_id, tier, description, created_by
  ) values (
    p_guest, 'redeem', -p_points, v_value, p_booking, v_entry, v_tier.key,
    concat_ws(' — ', 'Redeemed against the bill', nullif(p_note, '')),
    v_staff
  );

  return v_value;
end;
$$;

-- A manual correction by a manager: a goodwill award, or taking back points
-- given in error. Positive corrections become a lot of their own.
create or replace function loyalty_adjust(p_guest uuid, p_points int, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_months int;
begin
  if not has_permission('loyalty.manage') then
    raise exception 'not permitted';
  end if;
  if p_points = 0 then
    raise exception 'LOYALTY_POINTS_INVALID' using hint = 'Enter a number of points to add or take away.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'LOYALTY_REASON_REQUIRED' using hint = 'Give a reason for the correction.';
  end if;

  select loyalty_expiry_months into v_months from property_settings limit 1;

  if p_points > 0 then
    insert into loyalty_transactions (guest_id, kind, points, remaining, description, expires_on, created_by)
    values (
      p_guest, 'adjust', p_points, p_points, p_reason,
      case when coalesce(v_months, 0) > 0
           then (current_date + (v_months || ' months')::interval)::date
           else null end,
      auth.uid()
    );
  else
    perform loyalty_consume(p_guest, -p_points);
    insert into loyalty_transactions (guest_id, kind, points, description, created_by)
    values (p_guest, 'adjust', p_points, p_reason, auth.uid());
  end if;

  return loyalty_balance(p_guest);
end;
$$;

-- ── Expiry ──────────────────────────────────────────────────────────────────

-- Retires whatever is left in lots whose date has passed. Called by the night
-- audit; safe to run more than once a day.
create or replace function loyalty_expire_points(p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lot   record;
  v_total int := 0;
begin
  for v_lot in
    select id, guest_id, remaining, expires_on from loyalty_transactions
     where remaining > 0 and expires_on is not null and expires_on < p_date
     for update
  loop
    update loyalty_transactions set remaining = 0 where id = v_lot.id;
    insert into loyalty_transactions (guest_id, kind, points, source_id, description, created_at)
    values (
      v_lot.guest_id, 'expire', -v_lot.remaining, v_lot.id,
      'Expired on ' || to_char(v_lot.expires_on, 'DD Mon YYYY'),
      now()
    );
    v_total := v_total + v_lot.remaining;
  end loop;
  return v_total;
end;
$$;

-- ── Tiers, re-evaluated ─────────────────────────────────────────────────────

-- Nights stayed and money spent by one guest in the twelve months to p_date
-- (SOW Module 8: "within a rolling 12-month period").
create or replace function loyalty_rolling_activity(p_guest uuid, p_date date)
returns table (nights int, spend numeric) language sql stable security definer set search_path = public as $$
  with window_start as (
    select (p_date - interval '12 months')::date as from_date
  )
  select
    -- Only the nights that fall inside the window count, so a stay that
    -- straddles the twelve-month boundary is split rather than counted twice.
    coalesce((
      select sum(greatest(0, least(b.check_out, p_date) - greatest(b.check_in, w.from_date)))
        from bookings b, window_start w
       where b.guest_id = p_guest
         and b.status in ('checked_in', 'checked_out')
         and b.check_out >= w.from_date
         and b.check_in  <= p_date
    ), 0)::int as nights,
    coalesce((
      select sum(f.amount + f.tax_amount)
        from folio_entries f
        join bookings fb on fb.id = f.booking_id, window_start w
       where fb.guest_id = p_guest
         and f.voided_at is null
         and f.kind in ('room', 'fee', 'penalty', 'extra')
         and f.created_at >= w.from_date
    ), 0) as spend;
$$;

-- Moves a guest to the highest tier they qualify for, up or down, and records
-- why. Returns the tier they ended on.
create or replace function loyalty_evaluate_tier(p_guest uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_act    record;
  v_target text;
  v_now    text;
  v_entry  text;
begin
  select loyalty_tier into v_now from guests where id = p_guest and loyalty_opt_in;
  if not found then
    return null;
  end if;

  select * into v_act from loyalty_rolling_activity(p_guest, p_date);

  select key into v_entry from loyalty_tiers where is_active order by sort_order limit 1;
  select key into v_target
    from loyalty_tiers
   where is_active and min_nights <= v_act.nights and min_spend <= v_act.spend
   order by sort_order desc
   limit 1;
  v_target := coalesce(v_target, v_entry);

  if v_target is distinct from v_now then
    update guests set loyalty_tier = v_target where id = p_guest;
    insert into loyalty_tier_history (guest_id, from_tier, to_tier, reason, nights, spend)
    values (
      p_guest, v_now, v_target,
      case when v_now is null then 'Tier set' else
        (select case when t2.sort_order > t1.sort_order then 'Upgraded' else 'Downgraded' end
           from loyalty_tiers t1, loyalty_tiers t2
          where t1.key = v_now and t2.key = v_target)
      end || format(' — %s nights and %s spent in the last 12 months', v_act.nights, round(v_act.spend)),
      v_act.nights, v_act.spend
    );
  end if;

  return v_target;
end;
$$;

-- Re-evaluates everyone who has had activity, for the night audit.
create or replace function loyalty_evaluate_all(p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_guest uuid;
  v_count int := 0;
begin
  for v_guest in
    select distinct g.id
      from guests g
     where g.loyalty_opt_in and g.erased_at is null
  loop
    if loyalty_evaluate_tier(v_guest, p_date) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table loyalty_tiers         enable row level security;
alter table loyalty_transactions  enable row level security;
alter table loyalty_tier_history  enable row level security;

drop policy if exists loyalty_tiers_select on loyalty_tiers;
drop policy if exists loyalty_tiers_write  on loyalty_tiers;
-- Every desk that can quote a perk needs to read the tiers.
create policy loyalty_tiers_select on loyalty_tiers for select using (is_staff());
create policy loyalty_tiers_write on loyalty_tiers for all
  using (has_permission('loyalty.manage')) with check (has_permission('loyalty.manage'));

drop policy if exists loyalty_tx_select on loyalty_transactions;
drop policy if exists loyalty_tx_write  on loyalty_transactions;
create policy loyalty_tx_select on loyalty_transactions for select
  using (has_permission('guests.view') or has_permission('loyalty.manage') or has_permission('loyalty.redeem'));
-- Earning, redeeming and expiry all go through the functions above, which run
-- as definer. Direct writes are for corrections only.
create policy loyalty_tx_write on loyalty_transactions for all
  using (has_permission('loyalty.manage')) with check (has_permission('loyalty.manage'));

drop policy if exists loyalty_history_select on loyalty_tier_history;
create policy loyalty_history_select on loyalty_tier_history for select
  using (has_permission('guests.view') or has_permission('loyalty.manage'));

-- ── Privacy ─────────────────────────────────────────────────────────────────

-- A guest who exercises their right to erasure loses their membership with
-- everything else (Module 8 "Data Privacy"). Points history is financial
-- record, so the rows stay but are detached from the person by the cascade
-- already defined on guest deletion; erasure blanks the membership itself.
create or replace function loyalty_erase(p_guest uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('guests.privacy') then
    raise exception 'not permitted';
  end if;
  update guests
     set loyalty_opt_in = false, loyalty_member_no = null, loyalty_tier = null, loyalty_joined_on = null
   where id = p_guest;
  delete from loyalty_transactions where guest_id = p_guest;
  delete from loyalty_tier_history where guest_id = p_guest;
end;
$$;

-- ── Audit ───────────────────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select * from (values
    ('loyalty_tiers', 'guests'), ('loyalty_transactions', 'guests')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
