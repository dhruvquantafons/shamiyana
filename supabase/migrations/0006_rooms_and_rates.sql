-- ============================================================================
-- Module 3 — Room, Rate & Inventory Management
--
--   • Room attributes: view, beds, smoking, accessibility, connecting rooms.
--   • Two independent room states: availability (status) and cleanliness
--     (housekeeping_status). "Vacant Dirty" is available + dirty.
--   • Date-ranged room blocks (out of order / out of service) with reasons.
--   • Rate plans (BAR, corporate, package, promotional, group) carrying their
--     cancellation, no-show and deposit policy.
--   • Seasonal and day-of-week pricing, stay restrictions (MinLOS, MaxLOS,
--     CTA, CTD, blackout), and per-channel allocations.
--   • Corporate accounts, which corporate rate plans and bookings refer to.
--
-- Run after 0005_foundation.sql.
-- ============================================================================

-- ── Rooms ───────────────────────────────────────────────────────────────────

-- "Maintenance" becomes the industry term. Renaming keeps existing rows.
do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'room_status' and e.enumlabel = 'maintenance') then
    alter type room_status rename value 'maintenance' to 'out_of_order';
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'housekeeping_status') then
    create type housekeeping_status as enum ('dirty', 'cleaning', 'clean', 'inspected');
  end if;
end;
$$;

alter table rooms add column if not exists housekeeping_status housekeeping_status not null default 'inspected';
alter table rooms add column if not exists view              text not null default '';
alter table rooms add column if not exists bed_configuration text not null default '';
alter table rooms add column if not exists max_adults        int check (max_adults between 1 and 20);
alter table rooms add column if not exists max_children      int check (max_children between 0 and 20);
alter table rooms add column if not exists is_smoking        boolean not null default false;
alter table rooms add column if not exists is_accessible     boolean not null default false;
alter table rooms add column if not exists connecting_room_id uuid references rooms on delete set null;
alter table rooms add column if not exists housekeeping_updated_at timestamptz;

-- Occupied rooms cannot be vouched for as clean.
update rooms set housekeeping_status = 'dirty' where status = 'occupied';

-- ── Room types ──────────────────────────────────────────────────────────────

alter table room_types add column if not exists max_adults     int not null default 2 check (max_adults between 1 and 20);
alter table room_types add column if not exists max_children   int not null default 1 check (max_children between 0 and 20);
-- Adults included in the rate; each one beyond pays the extra-adult charge.
alter table room_types add column if not exists base_occupancy int not null default 2 check (base_occupancy between 1 and 20);
-- Friday and Saturday nights. Null means the base rate applies every night.
alter table room_types add column if not exists weekend_rate   numeric(10,2) check (weekend_rate >= 0);
alter table room_types add column if not exists amenities      text[] not null default '{}';
alter table room_types add column if not exists gallery        text[] not null default '{}';

-- The seeded types were published as "Up to 2 / 3 guests".
update room_types set max_adults = 3 where slug = 'luxury-room' and max_adults = 2;

-- A stable key so pricing can find the extra-adult charge without matching
-- on its label, which staff are free to edit.
alter table extra_charges add column if not exists kind text not null default 'other'
  check (kind in ('extra_adult', 'child_no_bed', 'meal', 'child_meal', 'other'));
update extra_charges set kind = 'extra_adult'  where label ilike 'Extra Occupant%'   and kind = 'other';
update extra_charges set kind = 'child_no_bed' where label ilike 'Child Without Bed%' and kind = 'other';
update extra_charges set kind = 'meal'         where label ilike 'Buffet%'            and kind = 'other';
update extra_charges set kind = 'child_meal'   where label ilike 'Meal%Child%'        and kind = 'other';

-- ── Room blocks ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'block_kind') then
    create type block_kind as enum ('out_of_order', 'out_of_service');
  end if;
end;
$$;

create table if not exists room_blocks (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms on delete cascade,
  kind          block_kind not null default 'out_of_order',
  start_date    date not null,
  -- Inclusive. Null means until released.
  end_date      date,
  reason        text not null check (length(trim(reason)) > 0),
  created_by    uuid references staff on delete set null,
  created_at    timestamptz not null default now(),
  released_at   timestamptz,
  released_by   uuid references staff on delete set null,
  release_note  text not null default '',
  constraint block_dates check (end_date is null or end_date >= start_date)
);

-- Rooms already taken off sale by status become open-ended blocks, so the
-- capacity count agrees with the room board from the start.
insert into room_blocks (room_id, kind, start_date, reason)
select r.id,
       case when r.status::text = 'out_of_service' then 'out_of_service'::block_kind
            else 'out_of_order'::block_kind end,
       current_date,
       coalesce(nullif(trim(r.notes), ''), 'Carried over from the room status before blocks existed')
  from rooms r
 where r.status::text in ('out_of_order', 'out_of_service')
   and not exists (select 1 from room_blocks b where b.room_id = r.id and b.released_at is null);

create index if not exists room_blocks_room_idx   on room_blocks (room_id, start_date);
create index if not exists room_blocks_active_idx on room_blocks (start_date, end_date) where released_at is null;

-- ── Corporate accounts ──────────────────────────────────────────────────────

create table if not exists companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) > 0),
  gstin              text not null default '',
  contact_name       text not null default '',
  email              text not null default '',
  phone              text not null default '',
  billing_address    text not null default '',
  credit_limit       numeric(12,2) check (credit_limit >= 0),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  notes              text not null default '',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists companies_name_idx on companies (lower(name));

-- ── Rate plans ──────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rate_type') then
    create type rate_type as enum ('bar', 'corporate', 'package', 'promotional', 'group');
  end if;
  if not exists (select 1 from pg_type where typname = 'penalty_kind') then
    create type penalty_kind as enum ('none', 'first_night', 'full_stay', 'percent');
  end if;
end;
$$;

create table if not exists rate_plans (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
  name                      text not null,
  rate_type                 rate_type not null default 'bar',
  description               text not null default '',
  -- EP room only · CP breakfast · MAP + one meal · AP all meals
  meal_plan                 text not null default 'CP' check (meal_plan in ('EP', 'CP', 'MAP', 'AP')),
  -- Relative to the room rate: percent (-10 = 10% off) or an amount per night.
  adjustment_kind           text not null default 'percent' check (adjustment_kind in ('percent', 'amount')),
  adjustment_value          numeric(10,2) not null default 0,
  -- Empty means every room type.
  room_type_ids             uuid[] not null default '{}',
  company_id                uuid references companies on delete set null,
  inclusions                text[] not null default '{}',
  is_refundable             boolean not null default true,
  -- Free cancellation up to this many hours before arrival.
  free_cancellation_hours   int not null default 48 check (free_cancellation_hours between 0 and 8760),
  cancellation_penalty      penalty_kind not null default 'first_night',
  cancellation_penalty_percent numeric(5,2) not null default 0 check (cancellation_penalty_percent between 0 and 100),
  no_show_penalty           penalty_kind not null default 'first_night',
  no_show_penalty_percent   numeric(5,2) not null default 0 check (no_show_penalty_percent between 0 and 100),
  -- Share of the stay to collect when booking.
  deposit_percent           numeric(5,2) not null default 0 check (deposit_percent between 0 and 100),
  min_los                   int check (min_los between 1 and 365),
  max_los                   int check (max_los between 1 and 365),
  los_discount_min_nights   int check (los_discount_min_nights between 2 and 365),
  los_discount_percent      numeric(5,2) check (los_discount_percent between 0 and 100),
  valid_from                date,
  valid_to                  date,
  -- Offered on the public website.
  is_public                 boolean not null default true,
  is_active                 boolean not null default true,
  sort_order                int not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint rate_plan_los check (min_los is null or max_los is null or max_los >= min_los),
  constraint rate_plan_validity check (valid_from is null or valid_to is null or valid_to >= valid_from)
);

-- Published tariff: CPAI (breakfast), inclusive of taxes. Any other plan
-- involves a commercial decision, so staff create those themselves.
insert into rate_plans (code, name, rate_type, description, meal_plan, sort_order)
values ('BAR', 'Best Available Rate', 'bar',
        'Our published rate with breakfast. Free cancellation up to 48 hours before arrival.',
        'CP', 1)
on conflict (code) do nothing;

-- ── Seasons ─────────────────────────────────────────────────────────────────

create table if not exists rate_seasons (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  start_date        date not null,
  end_date          date not null,
  -- Null means every room type.
  room_type_id      uuid references room_types on delete cascade,
  -- 0 = Sunday … 6 = Saturday, matching Postgres extract(dow) and JS getDay().
  days_of_week      int[] not null default '{0,1,2,3,4,5,6}',
  adjustment_kind   text not null default 'percent' check (adjustment_kind in ('percent', 'amount', 'fixed')),
  adjustment_value  numeric(10,2) not null,
  -- When seasons overlap, the highest priority wins.
  priority          int not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint season_dates check (end_date >= start_date),
  constraint season_days check (days_of_week <@ '{0,1,2,3,4,5,6}' and cardinality(days_of_week) > 0)
);

create index if not exists rate_seasons_dates_idx on rate_seasons (start_date, end_date);

-- ── Stay restrictions ───────────────────────────────────────────────────────

create table if not exists rate_restrictions (
  id                  uuid primary key default gen_random_uuid(),
  start_date          date not null,
  end_date            date not null,
  room_type_id        uuid references room_types on delete cascade,
  rate_plan_id        uuid references rate_plans on delete cascade,
  min_los             int check (min_los between 1 and 365),
  max_los             int check (max_los between 1 and 365),
  closed_to_arrival   boolean not null default false,
  closed_to_departure boolean not null default false,
  -- Blackout: nothing may be sold for these nights.
  stop_sell           boolean not null default false,
  note                text not null default '',
  created_at          timestamptz not null default now(),
  constraint restriction_dates check (end_date >= start_date)
);

create index if not exists rate_restrictions_dates_idx on rate_restrictions (start_date, end_date);

-- ── Channel allocations ─────────────────────────────────────────────────────

-- The most rooms of a type a channel may hold on any one night. Channels with
-- no row are limited only by physical inventory.
create table if not exists channel_allocations (
  id            uuid primary key default gen_random_uuid(),
  room_type_id  uuid not null references room_types on delete cascade,
  source        booking_source not null,
  rooms         int not null check (rooms >= 0),
  updated_at    timestamptz not null default now(),
  unique (room_type_id, source)
);

-- ── Housekeeping follows the stay ───────────────────────────────────────────

-- Supersedes the 0003 version: a room a guest leaves is also marked dirty.
create or replace function sync_room_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.room_id is not null
     and old.status = 'checked_in'
     and (old.room_id is distinct from new.room_id or new.status <> 'checked_in')
  then
    update rooms
       set status = case when status = 'occupied' then 'available'::room_status else status end,
           housekeeping_status = 'dirty',
           housekeeping_updated_at = now()
     where id = old.room_id;
  end if;

  if new.status = 'checked_in' and new.room_id is not null then
    update rooms
       set status = 'occupied'
     where id = new.room_id
       and status in ('available', 'occupied');
  end if;

  return new;
end;
$$;

-- ── Room availability ───────────────────────────────────────────────────────

-- Whether a room is blocked on a given night.
create or replace function room_blocked_on(p_room uuid, p_night date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from room_blocks
     where room_id = p_room
       and released_at is null
       and start_date <= p_night
       and (end_date is null or end_date >= p_night)
  );
$$;

-- Sellable rooms of a type on a night: inventory less blocked rooms.
create or replace function room_type_capacity(p_type uuid, p_night date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from rooms r
   where r.room_type_id = p_type
     and not room_blocked_on(r.id, p_night);
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table room_blocks         enable row level security;
alter table companies           enable row level security;
alter table rate_plans          enable row level security;
alter table rate_seasons        enable row level security;
alter table rate_restrictions   enable row level security;
alter table channel_allocations enable row level security;

drop policy if exists room_blocks_select on room_blocks;
drop policy if exists room_blocks_write  on room_blocks;
create policy room_blocks_select on room_blocks for select using (has_permission('rooms.view'));
create policy room_blocks_write  on room_blocks for all
  using (has_permission('rooms.block')) with check (has_permission('rooms.block'));

drop policy if exists companies_select on companies;
drop policy if exists companies_write  on companies;
create policy companies_select on companies for select
  using (has_permission('bookings.view') or has_permission('companies.manage') or has_permission('rates.view'));
create policy companies_write on companies for all
  using (has_permission('companies.manage')) with check (has_permission('companies.manage'));

-- The website needs public, active plans to quote a price.
drop policy if exists rate_plans_select on rate_plans;
drop policy if exists rate_plans_write  on rate_plans;
create policy rate_plans_select on rate_plans for select
  using ((is_active and is_public) or is_staff());
create policy rate_plans_write on rate_plans for all
  using (has_permission('rates.manage')) with check (has_permission('rates.manage'));

drop policy if exists rate_seasons_select on rate_seasons;
drop policy if exists rate_seasons_write  on rate_seasons;
create policy rate_seasons_select on rate_seasons for select using (is_active or is_staff());
create policy rate_seasons_write  on rate_seasons for all
  using (has_permission('rates.manage')) with check (has_permission('rates.manage'));

drop policy if exists rate_restrictions_select on rate_restrictions;
drop policy if exists rate_restrictions_write  on rate_restrictions;
create policy rate_restrictions_select on rate_restrictions for select using (true);
create policy rate_restrictions_write  on rate_restrictions for all
  using (has_permission('rates.manage')) with check (has_permission('rates.manage'));

drop policy if exists channel_allocations_select on channel_allocations;
drop policy if exists channel_allocations_write  on channel_allocations;
create policy channel_allocations_select on channel_allocations for select using (is_staff());
create policy channel_allocations_write  on channel_allocations for all
  using (has_permission('rates.manage')) with check (has_permission('rates.manage'));

-- Rooms: anyone who can see the board reads them; status changes need
-- rooms.status; adding and removing rooms needs rooms.manage. The finer
-- column-level split is enforced in the server actions.
drop policy if exists rooms_all    on rooms;
drop policy if exists rooms_select on rooms;
drop policy if exists rooms_insert on rooms;
drop policy if exists rooms_update on rooms;
drop policy if exists rooms_delete on rooms;
create policy rooms_select on rooms for select using (is_staff());
create policy rooms_insert on rooms for insert with check (has_permission('rooms.manage'));
create policy rooms_update on rooms for update
  using (has_permission('rooms.status') or has_permission('rooms.block') or has_permission('rooms.manage'))
  with check (has_permission('rooms.status') or has_permission('rooms.block') or has_permission('rooms.manage'));
create policy rooms_delete on rooms for delete using (has_permission('rooms.manage'));

drop trigger if exists rate_plans_touch on rate_plans;
create trigger rate_plans_touch before update on rate_plans for each row execute function touch_updated_at();
drop trigger if exists companies_touch on companies;
create trigger companies_touch before update on companies for each row execute function touch_updated_at();
drop trigger if exists channel_allocations_touch on channel_allocations;
create trigger channel_allocations_touch before update on channel_allocations for each row execute function touch_updated_at();

do $$
declare
  t record;
begin
  for t in select * from (values
    ('room_blocks', 'rooms'), ('companies', 'companies'), ('rate_plans', 'rates'),
    ('rate_seasons', 'rates'), ('rate_restrictions', 'rates'), ('channel_allocations', 'rates')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table room_blocks;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
