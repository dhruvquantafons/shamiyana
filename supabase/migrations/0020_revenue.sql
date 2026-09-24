-- ============================================================================
-- Module 4 — Revenue & Dynamic Pricing Management
--
--   • Dynamic pricing is a decision, not a formula run at quote time. A rule
--     proposes a rate for a night; a small change applies itself, a large one
--     waits for a manager. That is what the SOW's "Approval Levels" asks for,
--     and it is also the only version a hotel will trust: the desk can see
--     tomorrow's selling rate and who set it, rather than watching the price
--     move under them mid-conversation.
--   • A rule's conditions are ANDed, and each is optional. The SOW names four
--     triggers — occupancy, day of week, special events/holidays, booking lead
--     time — and real revenue rules combine them ("+15% above 80% full, but
--     only Fri/Sat"). One rule table with nullable conditions covers each
--     trigger alone and every combination, where a rule per trigger kind
--     could not.
--   • The rules are evaluated in TypeScript (app/lib/revenue.ts), not here,
--     because the nightly rate build-up already lives in app/lib/pricing.ts
--     and the booking form runs it in the browser. Re-implementing seasons and
--     weekend rates in SQL would give the property two answers to the same
--     question. This migration therefore supplies the raw forecast
--     (revenue_forecast) and stores the decisions (pricing_adjustments); it
--     does not price anything itself.
--   • Competitor rates are entered by hand. The SOW offers "manual entry or
--     integration with a rate-shopping tool"; the tool is the optional half
--     and is left out. What is built is the shelf the numbers sit on, beside
--     our own rate for the same night, which is the point of tracking them.
--   • A promo code is a discount on the stay, taken after the rate plan and
--     its length-of-stay discount, and recorded on redemption so usage limits
--     mean something. Bookings have carried a free-text promo_code since
--     0001; that column becomes the code as typed, with the code that was
--     actually honoured kept by id beside it.
--   • Packages are rate plans, not a second kind of product. A package plan
--     lists what is included and what each part would cost separately, and
--     rate_plans.adjustment_kind gains 'fixed' so the whole thing can be sold
--     at one price — which is what "bundled at one price" means.
--
-- Out of scope, and deliberately: the rate-shopping tool integration above.
--
-- Run after 0019_events.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'revenue.view'), ('manager', 'revenue.manage'), ('manager', 'revenue.approve'),
  -- Rate plans, packages and promotions are this role's existing job
  -- ("Rate plans, corporate accounts and group bookings"), so it prices and
  -- promotes. Approval is withheld: the SOW gives that to a manager, and the
  -- point of the threshold is that someone else looks.
  ('sales_marketing', 'revenue.view'), ('sales_marketing', 'revenue.manage'),
  -- Both read the forecast; neither sets rates.
  ('front_office_manager', 'revenue.view'),
  ('finance', 'revenue.view')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- A proposed rate change of at most this many percent, up or down, applies
-- itself; anything larger waits for someone holding 'revenue.approve' (SOW
-- Module 4 "Approval Levels"). Zero means every change is approved by hand.
alter table property_settings add column if not exists revenue_auto_approve_percent numeric(5,2)
  not null default 10 check (revenue_auto_approve_percent between 0 and 100);

-- How far ahead the forecast looks, and how far ahead the rules price.
alter table property_settings add column if not exists revenue_forecast_days int
  not null default 60 check (revenue_forecast_days between 7 and 365);

-- Floor and ceiling applied to every rule's output, whatever the rule says.
-- A misjudged rule can then embarrass the hotel by a little, not by a lot.
-- Zero means no limit.
alter table property_settings add column if not exists revenue_floor_rate numeric(12,2)
  not null default 0 check (revenue_floor_rate >= 0);
alter table property_settings add column if not exists revenue_ceiling_rate numeric(12,2)
  not null default 0 check (revenue_ceiling_rate >= 0);

-- ── Packages ────────────────────────────────────────────────────────────────

-- A package is sold at one price rather than as a percentage off the room, so
-- the plan's adjustment gains a third kind. 'fixed' means the value *is* the
-- nightly rate, exactly as a season's 'fixed' already does.
--
-- The old constraint was declared inline in 0006 and so carries whatever name
-- Postgres gave it. It is found by what it constrains rather than by a guessed
-- name, because dropping the wrong thing would leave the old two-value check
-- in place and quietly reject every package.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'rate_plans'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%adjustment_kind%'
  loop
    execute format('alter table rate_plans drop constraint %I', v_name);
  end loop;
end;
$$;

alter table rate_plans add constraint rate_plans_adjustment_kind_check
  check (adjustment_kind in ('percent', 'amount', 'fixed'));

-- What is inside a package, and what each part would cost if bought on its
-- own. The retail value is not billed — it is there so the guest can be shown
-- what the bundle saves, and so the hotel can tell a thin package from a fat
-- one. rate_plans.inclusions stays as the one-line list for the website;
-- these are the priced components behind it.
create table if not exists package_components (
  id           uuid primary key default gen_random_uuid(),
  rate_plan_id uuid not null references rate_plans on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  description  text not null default '',
  -- What this part would cost bought separately, per unit of its basis.
  retail_value numeric(12,2) not null default 0 check (retail_value >= 0),
  basis        text not null default 'per_stay'
                 check (basis in ('per_stay', 'per_night', 'per_person_per_stay', 'per_person_per_night')),
  quantity     int not null default 1 check (quantity between 1 and 99),
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists package_components_plan_idx
  on package_components (rate_plan_id, sort_order);

-- ── Pricing rules ───────────────────────────────────────────────────────────

-- Every condition below is optional and they are ANDed: a rule with no
-- condition at all applies to every night, which is a legitimate way to shift
-- the whole tariff for a while.
create table if not exists pricing_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  description    text not null default '',
  -- Null means every room type.
  room_type_id   uuid references room_types on delete cascade,

  -- Trigger: occupancy. Percent of sellable rooms already on the books for
  -- that night, counting the same held statuses the overbooking guard counts.
  min_occupancy  numeric(5,2) check (min_occupancy between 0 and 100),
  max_occupancy  numeric(5,2) check (max_occupancy between 0 and 100),

  -- Trigger: day of week. 0 = Sunday … 6 = Saturday, as elsewhere.
  days_of_week   int[] not null default '{0,1,2,3,4,5,6}',

  -- Trigger: special events and holidays. The occasion is the reason, and it
  -- is shown to whoever approves the change.
  start_date     date,
  end_date       date,
  occasion       text not null default '',

  -- Trigger: booking lead time — how many days ahead of the night we are
  -- now. A rule with max_lead_days 3 is a last-minute rule; one with
  -- min_lead_days 90 prices the early birds.
  min_lead_days  int check (min_lead_days >= 0),
  max_lead_days  int check (max_lead_days >= 0),

  -- What it does to the night's rate. 'fixed' sets it outright.
  adjustment_kind  text not null default 'percent'
                     check (adjustment_kind in ('percent', 'amount', 'fixed')),
  adjustment_value numeric(10,2) not null,

  -- Per-rule limits, tighter than the property-wide pair in settings.
  -- Zero means no limit.
  floor_rate     numeric(12,2) not null default 0 check (floor_rate >= 0),
  ceiling_rate   numeric(12,2) not null default 0 check (ceiling_rate >= 0),

  -- When two rules both match a night, the highest priority wins. Rates do
  -- not stack: a night has one selling rate, and stacked percentages are how
  -- a hotel ends up quoting nonsense.
  priority       int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pricing_rule_occupancy check (
    min_occupancy is null or max_occupancy is null or max_occupancy >= min_occupancy),
  constraint pricing_rule_dates check (
    start_date is null or end_date is null or end_date >= start_date),
  constraint pricing_rule_lead check (
    min_lead_days is null or max_lead_days is null or max_lead_days >= min_lead_days),
  constraint pricing_rule_days check (
    days_of_week <@ '{0,1,2,3,4,5,6}' and cardinality(days_of_week) > 0)
);

create index if not exists pricing_rules_active_idx on pricing_rules (is_active, priority desc);

drop trigger if exists pricing_rules_touch on pricing_rules;
create trigger pricing_rules_touch before update on pricing_rules
  for each row execute function touch_updated_at();

-- ── Pricing adjustments (the decisions) ─────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pricing_adjustment_status') then
    create type pricing_adjustment_status as enum ('pending', 'applied', 'rejected', 'expired');
  end if;
end;
$$;

-- One row per night per room type: the rate a rule proposed, what it replaced,
-- and whether it is live. 'applied' rows are what the quote engine reads;
-- 'pending' rows are waiting for a manager and sell nothing.
create table if not exists pricing_adjustments (
  id             uuid primary key default gen_random_uuid(),
  stay_date      date not null,
  room_type_id   uuid not null references room_types on delete cascade,
  rule_id        uuid references pricing_rules on delete set null,
  -- Kept as text so the record still reads plainly after the rule is renamed
  -- or deleted — an approval has to be explicable months later.
  rule_name      text not null default '',
  occasion       text not null default '',

  -- The rate the rule started from: base or weekend rate, season applied.
  base_rate      numeric(12,2) not null check (base_rate >= 0),
  -- The rate the rule asks for, after the floors and ceilings.
  proposed_rate  numeric(12,2) not null check (proposed_rate >= 0),
  -- Signed, relative to base_rate. Stored rather than derived so that the
  -- threshold it was judged against stays visible.
  change_percent numeric(7,2) not null,

  -- The forecast that triggered it, for the approver's benefit.
  occupancy_percent numeric(5,2),
  rooms_sold     int,
  capacity       int,

  status         pricing_adjustment_status not null default 'pending',
  -- The threshold in force when the rule ran, so raising it later cannot
  -- retrospectively excuse a change that needed approval — the same care
  -- 0019 takes with the event quotation threshold.
  threshold_percent numeric(5,2) not null default 0,
  note           text not null default '',

  created_at     timestamptz not null default now(),
  created_by     uuid references staff on delete set null,
  decided_at     timestamptz,
  decided_by     uuid references staff on delete set null
);

-- A night has at most one live or waiting rate per room type. Re-running the
-- rules replaces what it finds rather than piling proposals up.
create unique index if not exists pricing_adjustments_live_idx
  on pricing_adjustments (stay_date, room_type_id)
  where status in ('pending', 'applied');

create index if not exists pricing_adjustments_date_idx
  on pricing_adjustments (stay_date, room_type_id);
create index if not exists pricing_adjustments_status_idx
  on pricing_adjustments (status, stay_date);

-- ── Competitor rates ────────────────────────────────────────────────────────

create table if not exists competitor_properties (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  -- Where the number is read from: an OTA listing, the hotel's own site, a
  -- phone call. Kept because a rate is only comparable if the source is.
  source     text not null default '',
  notes      text not null default '',
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists competitor_properties_name_idx
  on competitor_properties (lower(name));

-- One observed rate, for one competitor, for one night. room_type_id is ours,
-- not theirs, and says which of our types the reading is comparable with;
-- null means the property as a whole, which is how a lead-in rate is quoted.
create table if not exists competitor_rates (
  id            uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitor_properties on delete cascade,
  stay_date     date not null,
  room_type_id  uuid references room_types on delete cascade,
  rate          numeric(12,2) not null check (rate >= 0),
  -- Whether their published number includes breakfast and tax changes what it
  -- is worth comparing against, so it is recorded rather than assumed.
  meal_plan     text not null default 'EP' check (meal_plan in ('EP', 'CP', 'MAP', 'AP')),
  tax_inclusive boolean not null default false,
  sold_out      boolean not null default false,
  note          text not null default '',
  observed_at   timestamptz not null default now(),
  observed_by   uuid references staff on delete set null
);

-- Re-reading the same night for the same competitor updates the reading.
-- NULLS NOT DISTINCT so that the property-wide reading (room_type_id null)
-- is also one row per night, rather than a new row every time it is entered.
alter table competitor_rates drop constraint if exists competitor_rates_unique;
alter table competitor_rates add constraint competitor_rates_unique
  unique nulls not distinct (competitor_id, stay_date, room_type_id);

create index if not exists competitor_rates_date_idx on competitor_rates (stay_date);

-- ── Promo codes ─────────────────────────────────────────────────────────────

create table if not exists promo_codes (
  id              uuid primary key default gen_random_uuid(),
  -- Typed by guests, so it is stored and compared in upper case.
  code            text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  name            text not null check (length(trim(name)) > 0),
  description     text not null default '',

  -- SOW: "Fixed amount or percentage discount".
  discount_kind   text not null default 'percent'
                    check (discount_kind in ('percent', 'amount')),
  discount_value  numeric(10,2) not null check (discount_value > 0),
  -- Caps a percentage discount in money terms. Zero means no cap.
  max_discount    numeric(12,2) not null default 0 check (max_discount >= 0),

  -- SOW: "applicable room types/rate plans". Empty means all.
  room_type_ids   uuid[] not null default '{}',
  rate_plan_ids   uuid[] not null default '{}',

  -- SOW: "expiry date". These bound when the booking may be *made*.
  valid_from      date,
  valid_to        date,
  -- These bound the nights it may be used for, which is a different question:
  -- a monsoon offer sold in March is booked now and stayed in July.
  stay_from       date,
  stay_to         date,

  min_nights      int check (min_nights between 1 and 365),
  min_amount      numeric(12,2) not null default 0 check (min_amount >= 0),

  -- SOW: "usage limits".
  max_redemptions int check (max_redemptions > 0),
  -- How many times one guest may use it; null means no per-guest limit.
  max_per_guest   int check (max_per_guest > 0),
  -- Maintained by the trigger below, not by the application.
  redemption_count int not null default 0 check (redemption_count >= 0),

  -- Whether guests may type it on the public booking portal, or whether it is
  -- a code the desk applies for them.
  is_public       boolean not null default true,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references staff on delete set null,
  constraint promo_validity check (valid_from is null or valid_to is null or valid_to >= valid_from),
  constraint promo_stay     check (stay_from is null or stay_to is null or stay_to >= stay_from),
  constraint promo_percent  check (discount_kind <> 'percent' or discount_value <= 100)
);

drop trigger if exists promo_codes_touch on promo_codes;
create trigger promo_codes_touch before update on promo_codes
  for each row execute function touch_updated_at();

-- A code honoured on a booking. One row per booking, so a cancelled booking
-- can give the use back rather than burning it.
create table if not exists promo_redemptions (
  id            uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes on delete cascade,
  booking_id    uuid not null references bookings on delete cascade,
  guest_id      uuid references guests on delete set null,
  -- Kept for bookings taken before a guest profile exists, which is most
  -- website requests: the per-guest limit has to work for them too.
  email         text not null default '',
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  redeemed_at   timestamptz not null default now(),
  unique (promo_code_id, booking_id)
);

create index if not exists promo_redemptions_code_idx on promo_redemptions (promo_code_id);
create index if not exists promo_redemptions_email_idx on promo_redemptions (promo_code_id, lower(email));

-- Bookings keep the code as typed (0001) and gain the code that was actually
-- honoured, plus the money taken off. The discount is part of the quote, so
-- it belongs on the booking and not only in the redemption row.
alter table bookings add column if not exists promo_code_id  uuid references promo_codes on delete set null;
alter table bookings add column if not exists promo_discount numeric(12,2) not null default 0
  check (promo_discount >= 0);

-- redemption_count is the number of live redemptions, maintained here so the
-- usage limit cannot be raced by two browsers at once.
create or replace function sync_promo_redemption_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update promo_codes p
     set redemption_count = (select count(*) from promo_redemptions r where r.promo_code_id = p.id)
   where p.id in (new.promo_code_id, old.promo_code_id);
  return null;
end;
$$;

drop trigger if exists promo_redemptions_count on promo_redemptions;
create trigger promo_redemptions_count
  after insert or update or delete on promo_redemptions
  for each row execute function sync_promo_redemption_count();

/*
 * A booking carrying a promo code *is* a redemption, so the redemption row
 * follows the booking rather than being written separately by whichever
 * screen took the booking.
 *
 * Doing it here rather than in the application matters twice over: the desk
 * and the website cannot each forget it in their own way, and a usage limit
 * counted from rows the application might fail to write is not a limit. It
 * also means the booking and the redemption move together in one
 * transaction, so a code can never be spent by a booking that was not saved.
 *
 * A cancelled or no-show booking releases its code: the guest never had the
 * stay, so the offer was not taken up.
 */
create or replace function sync_promo_redemption()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Changing which code a booking used releases the one it held before.
  delete from promo_redemptions
   where booking_id = new.id
     and (new.promo_code_id is null or promo_code_id <> new.promo_code_id);

  if new.promo_code_id is null or new.status in ('cancelled', 'no_show') then
    delete from promo_redemptions where booking_id = new.id;
    return new;
  end if;

  insert into promo_redemptions (promo_code_id, booking_id, guest_id, email, discount_amount)
  values (new.promo_code_id, new.id, new.guest_id,
          lower(coalesce(new.contact_email, '')), greatest(coalesce(new.promo_discount, 0), 0))
  on conflict (promo_code_id, booking_id) do update
     set guest_id        = excluded.guest_id,
         email           = excluded.email,
         discount_amount = excluded.discount_amount;

  return new;
end;
$$;

drop trigger if exists bookings_sync_promo on bookings;
create trigger bookings_sync_promo
  after insert or update of promo_code_id, promo_discount, status, guest_id, contact_email
  on bookings
  for each row execute function sync_promo_redemption();

-- ── The forecast ────────────────────────────────────────────────────────────

-- Rooms on the books per night per room type, against the rooms that could be
-- sold. The held statuses are the same three the overbooking guard counts in
-- 0007, so the forecast and the inventory rule cannot disagree.
--
-- This returns inventory only. The rate for the night is worked out in
-- app/lib/revenue.ts from the same seasons and plans the booking form uses;
-- see the header note.
create or replace function revenue_forecast(p_from date, p_to date)
returns table (
  stay_date    date,
  room_type_id uuid,
  capacity     int,
  rooms_sold   int,
  revenue_on_books numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('revenue.view') or has_permission('rates.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  if p_to < p_from then
    raise exception 'REVENUE_BAD_RANGE' using hint = 'The end of the range comes before its start.';
  end if;
  -- A year of nights across a handful of room types is a page of numbers; a
  -- decade is a denial of service.
  if p_to - p_from > 400 then
    raise exception 'REVENUE_RANGE_TOO_LONG' using hint = 'Ask for at most 400 nights at a time.';
  end if;

  return query
  with nights as (
    select d::date as stay_date from generate_series(p_from, p_to, interval '1 day') d
  ),
  held as (
    select b.room_type_id,
           n.stay_date,
           sum(b.rooms_count)::int as rooms_sold,
           -- The nightly rate from the stored breakdown where there is one,
           -- falling back to the quoted average, exactly as rateForNight does.
           sum(b.rooms_count * coalesce(
             (select (e ->> 'rate')::numeric
                from jsonb_array_elements(
                  case when jsonb_typeof(b.rate_breakdown) = 'array'
                       then b.rate_breakdown else '[]'::jsonb end) e
               where e ->> 'date' = n.stay_date::text
               limit 1),
             b.quoted_rate, 0)) as revenue_on_books
      from bookings b
      join nights n
        on b.check_in <= n.stay_date and b.check_out > n.stay_date
     where b.status in ('tentative', 'confirmed', 'checked_in')
       and b.room_type_id is not null
     group by b.room_type_id, n.stay_date
  )
  select n.stay_date,
         rt.id as room_type_id,
         room_type_capacity(rt.id, n.stay_date) as capacity,
         coalesce(h.rooms_sold, 0) as rooms_sold,
         round(coalesce(h.revenue_on_books, 0), 2) as revenue_on_books
    from nights n
    cross join room_types rt
    left join held h on h.room_type_id = rt.id and h.stay_date = n.stay_date
   order by n.stay_date, rt.sort_order, rt.name;
end;
$$;

-- ── Approving and rejecting ─────────────────────────────────────────────────

-- Approves a waiting rate change. Whoever ran the rules may still approve —
-- unlike an event quotation, the proposal is the machine's, not a
-- colleague's, so there is no second pair of eyes to insist on; the
-- permission is the control.
create or replace function pricing_adjustment_decide(
  p_ids uuid[],
  p_approve boolean,
  p_note text default ''
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid := auth.uid();
  v_count int;
begin
  if not has_permission('revenue.approve') then
    raise exception 'not permitted' using hint = 'Approving a rate change needs the revenue approval permission.';
  end if;

  with decided as (
    update pricing_adjustments
       set status     = case when p_approve then 'applied' else 'rejected' end::pricing_adjustment_status,
           decided_at = now(),
           decided_by = v_staff,
           note       = case when length(trim(p_note)) > 0 then p_note else note end
     where id = any (p_ids)
       and status = 'pending'
    returning 1
  )
  select count(*)::int into v_count from decided;

  return v_count;
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table package_components      enable row level security;
alter table pricing_rules           enable row level security;
alter table pricing_adjustments     enable row level security;
alter table competitor_properties   enable row level security;
alter table competitor_rates        enable row level security;
alter table promo_codes             enable row level security;
alter table promo_redemptions       enable row level security;

-- Package contents are part of the plan, so they follow the plan's
-- permissions and are readable by the public website like rate plans are.
drop policy if exists package_components_select on package_components;
drop policy if exists package_components_write  on package_components;
create policy package_components_select on package_components for select using (true);
create policy package_components_write  on package_components for all
  using (has_permission('rates.manage')) with check (has_permission('rates.manage'));

drop policy if exists pricing_rules_select on pricing_rules;
drop policy if exists pricing_rules_write  on pricing_rules;
create policy pricing_rules_select on pricing_rules for select
  using (has_permission('revenue.view') or has_permission('rates.view'));
create policy pricing_rules_write on pricing_rules for all
  using (has_permission('revenue.manage')) with check (has_permission('revenue.manage'));

-- Applied adjustments are the selling rate, so anyone who may quote a rate
-- may read them — including the public website, which has to show the price
-- it will honour. Pending and rejected rows are management's business.
drop policy if exists pricing_adjustments_select on pricing_adjustments;
drop policy if exists pricing_adjustments_public on pricing_adjustments;
drop policy if exists pricing_adjustments_write  on pricing_adjustments;
create policy pricing_adjustments_public on pricing_adjustments for select
  using (status = 'applied');
create policy pricing_adjustments_select on pricing_adjustments for select
  using (has_permission('revenue.view') or has_permission('rates.view'));
create policy pricing_adjustments_write on pricing_adjustments for all
  using (has_permission('revenue.manage')) with check (has_permission('revenue.manage'));

drop policy if exists competitor_properties_select on competitor_properties;
drop policy if exists competitor_properties_write  on competitor_properties;
create policy competitor_properties_select on competitor_properties for select
  using (has_permission('revenue.view'));
create policy competitor_properties_write on competitor_properties for all
  using (has_permission('revenue.manage')) with check (has_permission('revenue.manage'));

drop policy if exists competitor_rates_select on competitor_rates;
drop policy if exists competitor_rates_write  on competitor_rates;
create policy competitor_rates_select on competitor_rates for select
  using (has_permission('revenue.view'));
create policy competitor_rates_write on competitor_rates for all
  using (has_permission('revenue.manage')) with check (has_permission('revenue.manage'));

-- A guest typing a code on the booking portal has to be told whether it is
-- good, so public codes are readable. Private codes and the redemption log
-- are not: a readable list of codes is a discount for everybody.
drop policy if exists promo_codes_public on promo_codes;
drop policy if exists promo_codes_select on promo_codes;
drop policy if exists promo_codes_write  on promo_codes;
create policy promo_codes_public on promo_codes for select
  using (is_active and is_public);
create policy promo_codes_select on promo_codes for select
  using (has_permission('revenue.view'));
create policy promo_codes_write on promo_codes for all
  using (has_permission('revenue.manage')) with check (has_permission('revenue.manage'));

drop policy if exists promo_redemptions_select on promo_redemptions;
drop policy if exists promo_redemptions_write  on promo_redemptions;
create policy promo_redemptions_select on promo_redemptions for select
  using (has_permission('revenue.view') or has_permission('bookings.view'));
-- Written by the booking flow, which runs as the booker: taking a booking is
-- what spends a code.
create policy promo_redemptions_write on promo_redemptions for all
  using (has_permission('bookings.create') or has_permission('revenue.manage'))
  with check (has_permission('bookings.create') or has_permission('revenue.manage'));
