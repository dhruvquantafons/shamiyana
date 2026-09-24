-- ============================================================================
-- Module 14 — Multi-Property / Multi-Brand Management
--
-- Turns a system that runs one hotel into one that runs a group, without
-- changing how the one hotel already in it behaves.
--
-- The shape of it:
--
--   1. property_settings stops being a single row and becomes the `properties`
--      table. A view keeps the old name pointing at "the property this request
--      is about", so the ~24 functions written as `from property_settings
--      limit 1` keep working and keep meaning the right thing.
--   2. Every operational and financial table gains property_id, defaulting to
--      the property the caller is working in.
--   3. One RESTRICTIVE policy per table ANDs a property check onto whatever
--      policies that table already had. This is the part that makes the
--      separation real, and it is deliberately additive: not one of the 166
--      existing policies is rewritten, so none of them can be broken by this
--      migration.
--   4. Group-level settings that head office can push down to properties.
--   5. Cross-property reporting.
--
-- A note on why RESTRICTIVE. Postgres ORs permissive policies together, so
-- adding "and it must be your property" as another permissive policy would
-- have *widened* access rather than narrowed it. Restrictive policies are
-- ANDed with the rest, which is exactly the "logically separated" requirement
-- in the SOW's Data Isolation row.
--
-- Run after 0023_guest_password_login.sql.
-- ============================================================================

-- ── 1. property_settings becomes a table of properties ──────────────────────

alter table property_settings rename to properties;

-- The old primary key was `id boolean default true check (id)` — a singleton
-- by construction. Dropping the column takes the key and the check with it.
alter table properties drop column id;

alter table properties add column id uuid primary key default gen_random_uuid();

-- What tells one property from another in the group.
alter table properties add column if not exists code text;
alter table properties add column if not exists brand text not null default '';
alter table properties add column if not exists is_active boolean not null default true;
-- Exactly one property answers the public website and any request with no
-- staff session behind it.
alter table properties add column if not exists is_default boolean not null default false;
alter table properties add column if not exists sort_order int not null default 0;
alter table properties add column if not exists created_at timestamptz not null default now();

update properties set code = 'SR' where code is null;
update properties set is_default = true
 where id = (select id from properties order by created_at, name limit 1)
   and not exists (select 1 from properties where is_default);

alter table properties alter column code set not null;
create unique index if not exists properties_code_idx on properties (lower(code));
-- At most one default, enforced rather than trusted.
create unique index if not exists properties_one_default_idx on properties ((is_default)) where is_default;

comment on table properties is
  'One row per hotel in the group (SOW Module 14). Was property_settings, a single row, until 0024.';

-- ── 2. Who may work where ───────────────────────────────────────────────────

-- A staff member belongs to one property and may be lent to others. Group
-- owners and head-office roles get all_properties instead, which is the
-- SOW''s "a General Manager only sees their property, while group owners see
-- all".
alter table staff add column if not exists property_id uuid references properties on delete restrict;
alter table staff add column if not exists all_properties boolean not null default false;
-- Which property the person is currently looking at. Held on the row rather
-- than in a cookie so that a server action, a background job and a page render
-- all agree, and so the database can answer "which property" on its own.
alter table staff add column if not exists active_property_id uuid references properties on delete set null;

update staff set property_id = (select id from properties where is_default limit 1)
 where property_id is null;

-- Set after the backfill, and only once current_property() exists further
-- down, so a colleague created by an administrator joins the property that
-- administrator is working in rather than landing nowhere. A staff row with no
-- property can see nothing at all, which is the right default for a mistake
-- but a poor one for the ordinary case.

-- The first administrator runs the group; everybody else is assigned.
update staff set all_properties = true
 where all_properties = false
   and role in (select key from roles where is_superuser);

create table if not exists staff_properties (
  staff_id    uuid not null references staff on delete cascade,
  property_id uuid not null references properties on delete cascade,
  primary key (staff_id, property_id)
);

alter table staff_properties enable row level security;
drop policy if exists staff_properties_select on staff_properties;
drop policy if exists staff_properties_write  on staff_properties;
create policy staff_properties_select on staff_properties for select using (is_staff());
create policy staff_properties_write  on staff_properties for all
  using (has_permission('staff.manage')) with check (has_permission('staff.manage'));

-- ── 3. Which property is this request about? ────────────────────────────────

/*
 * The property the caller is working in.
 *
 * For staff, whichever they have selected, falling back to the one they
 * belong to. For everything else — the public website, the payment webhook,
 * a cron job, a guest — the default property, because those all speak for the
 * hotel the website sells.
 *
 * Every property_id column defaults to this, which is why almost no insert
 * anywhere in the application had to change.
 */
create or replace function current_property()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(s.active_property_id, s.property_id) from staff s where s.id = auth.uid()),
    (select p.id from properties p where p.is_default and p.is_active limit 1),
    (select p.id from properties p where p.is_active order by p.sort_order, p.name limit 1)
  );
$$;

/* Every property the caller may see. Empty for anyone who is not staff. */
create or replace function staff_property_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
    from properties p
   where exists (
     select 1 from staff s
      where s.id = auth.uid() and s.is_active and s.all_properties
   )
  union
  select s.property_id from staff s where s.id = auth.uid() and s.is_active and s.property_id is not null
  union
  select sp.property_id
    from staff_properties sp
    join staff s on s.id = sp.staff_id
   where s.id = auth.uid() and s.is_active;
$$;

/*
 * The predicate behind every restrictive policy added below.
 *
 * Reads as: staff are held to the properties they work at; nobody else is
 * held by *this* check at all, because nobody else is granted rows by a
 * property in the first place. A guest reaches their booking through
 * bookings_own_select, which matches on guest_id; the public reaches room
 * types through a policy that matches on is_active. Returning true for them
 * here leaves those policies to do the scoping they already do, rather than
 * quietly revoking the guest portal and the website.
 *
 * A null property_id means a row that belongs to the group rather than to any
 * one hotel — a message template every property inherits, for instance.
 */
create or replace function can_access_property(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p is null then true
    -- The property they are *working in*, not every property they may work
    -- at. A group owner who could see both hotels at once would get an
    -- arrivals list, a room board and a tape chart with two hotels
    -- interleaved, which is unreadable and dangerous to act on. Seeing all
    -- of them is what the group dashboard is for; working in one at a time
    -- is what the switcher is for.
    when is_staff() then p = current_property()
    -- A signed-in guest is scoped by ownership, not by property: their own
    -- booking is theirs whichever hotel they made it at.
    when current_guest() is not null then true
    -- Everyone else is the public website, which sells one hotel. Without
    -- this the tariff page would list every hotel in the group's rooms
    -- side by side, because the public-read policies match on is_active
    -- rather than on property.
    else p = (select pr.id from properties pr where pr.is_default and pr.is_active limit 1)
  end;
$$;

-- Now that current_property() exists (see the note at the backfill above).
alter table staff alter column property_id set default current_property();

/* The property switcher. Refuses a property the person does not work at. */
create or replace function set_active_property(p_property uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'not permitted';
  end if;
  if p_property is not null and p_property not in (select staff_property_ids()) then
    raise exception 'PROPERTY_NOT_YOURS' using hint = 'You do not have access to that property.';
  end if;
  update staff set active_property_id = p_property where id = auth.uid();
end;
$$;

-- ── 4. The old name, still meaning "this property" ──────────────────────────

/*
 * Everything written before this migration says `from property_settings limit
 * 1` and means "the hotel". This view makes that keep being true: it shows
 * exactly one row, the property the request is about.
 *
 * security_invoker so the caller's own row level security still applies rather
 * than the view owner's — without it the view would be a way around every
 * policy on properties.
 *
 * Simple enough for Postgres to make it updatable, so `update property_settings
 * set business_date = ...` in the night audit still works and still touches
 * one property.
 */
create or replace view property_settings with (security_invoker = true) as
  select * from properties where id = current_property();

-- ── 5. Row level security on properties themselves ──────────────────────────

alter table properties enable row level security;

drop policy if exists settings_select on properties;
drop policy if exists settings_update on properties;
drop policy if exists properties_select on properties;
drop policy if exists properties_update on properties;
drop policy if exists properties_insert on properties;

-- Staff see the properties they work at; adding and removing hotels is a
-- group-level act and sits with settings.manage.
-- Deliberately staff_property_ids() rather than can_access_property(): the
-- switcher must list every hotel this person may move to, while everything
-- else is held to the one they are in.
create policy properties_select on properties for select
  using (is_staff() and id in (select staff_property_ids()));
create policy properties_update on properties for update
  using (has_permission('settings.manage') and id in (select staff_property_ids()))
  with check (has_permission('settings.manage') and id in (select staff_property_ids()));
create policy properties_insert on properties for insert
  with check (has_permission('properties.manage'));

-- ── 6. Group-level settings, pushed down to properties ──────────────────────

/*
 * SOW Module 14: "Brand standards, loyalty program rules, tax templates can be
 * pushed from head office to all properties."
 *
 * Head office holds one copy of each. Pushing copies it into the properties
 * named, rather than making properties read through to the group: a property
 * that has been pushed to can still be adjusted locally afterwards, which is
 * what "standards" means in practice as opposed to "locked".
 */
create table if not exists group_settings (
  id                        boolean primary key default true check (id),
  group_name                text not null default 'Shamiyana Hotels',
  -- Brand standards
  best_rate_message         text not null default '',
  invoice_terms             text not null default '',
  event_terms               text not null default '',
  default_language          text not null default 'en',
  languages                 text[] not null default '{en}',
  -- Loyalty programme rules
  loyalty_enabled           boolean not null default false,
  loyalty_program_name      text not null default 'Shamiyana Rewards',
  loyalty_expiry_months     int not null default 24,
  loyalty_min_redeem_points int not null default 500,
  -- Tax template
  tax_inclusive             boolean not null default true,
  tax_slabs                 jsonb not null default '[{"up_to": 7500, "rate": 5}, {"up_to": null, "rate": 18}]',
  tax_label                 text not null default 'GST',
  updated_at                timestamptz not null default now()
);

-- Seeded from the property that exists today, so a push before anything is
-- edited is a no-op rather than a surprise.
insert into group_settings (
  id, best_rate_message, invoice_terms, event_terms, default_language, languages,
  loyalty_enabled, loyalty_program_name, loyalty_expiry_months, loyalty_min_redeem_points,
  tax_inclusive, tax_slabs, tax_label
)
select true, p.best_rate_message, p.invoice_terms, p.event_terms, p.default_language, p.languages,
       p.loyalty_enabled, p.loyalty_program_name, p.loyalty_expiry_months, p.loyalty_min_redeem_points,
       p.tax_inclusive, p.tax_slabs, p.tax_label
  from properties p where p.is_default
on conflict (id) do nothing;

alter table group_settings enable row level security;
drop policy if exists group_settings_select on group_settings;
drop policy if exists group_settings_update on group_settings;
create policy group_settings_select on group_settings for select using (is_staff());
create policy group_settings_update on group_settings for update
  using (has_permission('properties.manage')) with check (has_permission('properties.manage'));

drop trigger if exists group_settings_touch on group_settings;
create trigger group_settings_touch before update on group_settings
  for each row execute function touch_updated_at();

/*
 * Copies the named groups of central settings into the named properties.
 *
 * p_items is any of 'brand', 'loyalty', 'tax'. A null p_properties means every
 * active property, which is the "to all properties" the SOW asks for.
 * Returns how many properties were written.
 */
create or replace function push_central_config(p_items text[], p_properties uuid[] default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_g group_settings;
  v_n int := 0;
begin
  if not has_permission('properties.manage') then
    raise exception 'not permitted';
  end if;
  if p_items is null or cardinality(p_items) = 0 then
    raise exception 'PUSH_NOTHING_CHOSEN' using hint = 'Choose at least one thing to push.';
  end if;
  if exists (select 1 from unnest(p_items) i where i not in ('brand', 'loyalty', 'tax')) then
    raise exception 'PUSH_UNKNOWN_ITEM' using hint = 'Only brand, loyalty and tax can be pushed.';
  end if;

  select * into v_g from group_settings limit 1;

  update properties p
     set best_rate_message = case when 'brand' = any(p_items) then v_g.best_rate_message else p.best_rate_message end,
         invoice_terms     = case when 'brand' = any(p_items) then v_g.invoice_terms else p.invoice_terms end,
         event_terms       = case when 'brand' = any(p_items) then v_g.event_terms else p.event_terms end,
         default_language  = case when 'brand' = any(p_items) then v_g.default_language else p.default_language end,
         languages         = case when 'brand' = any(p_items) then v_g.languages else p.languages end,
         loyalty_enabled           = case when 'loyalty' = any(p_items) then v_g.loyalty_enabled else p.loyalty_enabled end,
         loyalty_program_name      = case when 'loyalty' = any(p_items) then v_g.loyalty_program_name else p.loyalty_program_name end,
         loyalty_expiry_months     = case when 'loyalty' = any(p_items) then v_g.loyalty_expiry_months else p.loyalty_expiry_months end,
         loyalty_min_redeem_points = case when 'loyalty' = any(p_items) then v_g.loyalty_min_redeem_points else p.loyalty_min_redeem_points end,
         tax_inclusive = case when 'tax' = any(p_items) then v_g.tax_inclusive else p.tax_inclusive end,
         tax_slabs     = case when 'tax' = any(p_items) then v_g.tax_slabs else p.tax_slabs end,
         tax_label     = case when 'tax' = any(p_items) then v_g.tax_label else p.tax_label end,
         updated_at = now()
   where p.is_active
     and (p_properties is null or p.id = any(p_properties));

  get diagnostics v_n = row_count;

  perform log_event('properties', 'push_config', null,
                    format('Pushed %s to %s propert%s',
                           array_to_string(p_items, ', '), v_n, case when v_n = 1 then 'y' else 'ies' end),
                    jsonb_build_object('items', to_jsonb(p_items), 'properties', v_n));
  return v_n;
end;
$$;

-- ── 7. property_id on every operational and financial table ─────────────────

/*
 * Root tables: a row is created *at* a property, so the column simply defaults
 * to the property the caller is working in. That default is why almost no
 * insert in the application had to be touched.
 *
 * Everything already in the database belongs to the one hotel that existed
 * before this migration, so the backfill is unambiguous.
 */
do $$
declare
  t text;
  v_default uuid := (select id from properties where is_default limit 1);
begin
  foreach t in array array[
    'assets', 'attendance', 'audit_log', 'booking_groups', 'bookings', 'city_ledger_entries',
    'companies', 'competitor_properties', 'departments', 'event_bookings', 'event_packages',
    'event_series', 'event_spaces', 'extra_charges', 'folios', 'guest_feedback',
    'guest_identities', 'guest_requests', 'guests', 'hk_checklist_items', 'housekeeping_tasks',
    'housekeeping_zones', 'invoice_series', 'invoices', 'key_card_events', 'leave_requests',
    'lost_found_items', 'loyalty_transactions', 'maintenance_schedules', 'maintenance_tickets',
    'message_templates', 'night_audits', 'notifications', 'payment_transactions',
    'pos_order_series', 'pos_orders', 'pos_outlets', 'pricing_adjustments', 'pricing_rules',
    'promo_codes', 'rate_plans', 'rate_seasons', 'refund_requests', 'registration_cards',
    'report_schedules', 'room_types', 'rooms', 'shift_types', 'staff_feedback', 'staff_shifts'
  ] loop
    execute format(
      'alter table %I add column if not exists property_id uuid references properties on delete restrict', t);
    execute format('update %I set property_id = %L where property_id is null', t, v_default);
    execute format('alter table %I alter column property_id set default current_property()', t);
    execute format('alter table %I alter column property_id set not null', t);
    execute format('create index if not exists %I on %I (property_id)', t || '_property_idx', t);
  end loop;
end;
$$;

/*
 * Child tables take their property from their parent rather than from whoever
 * happens to be inserting. This matters for a group owner: with the active
 * property set to one hotel, posting a charge to a booking at another would
 * otherwise file the charge under the wrong hotel and quietly corrupt both
 * hotels' revenue.
 */
create or replace function inherit_property()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent uuid;
  v_prop   uuid;
  i        int := 0;
begin
  -- tg_argv is (column, table) pairs, tried in order; the first that resolves
  -- wins, so a folio entry attached to a booking follows the booking and one
  -- attached only to a folio follows the folio.
  while i < array_length(tg_argv, 1) loop
    execute format('select ($1).%I', tg_argv[i]) into v_parent using new;
    if v_parent is not null then
      execute format('select property_id from %I where id = $1', tg_argv[i + 1])
        into v_prop using v_parent;
      if v_prop is not null then
        new.property_id := v_prop;
        return new;
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;

do $$
declare
  r record;
  v_default uuid := (select id from properties where is_default limit 1);
begin
  for r in select * from (values
    ('booking_notes',        array['booking_id', 'bookings']),
    ('channel_allocations',  array['room_type_id', 'room_types']),
    ('competitor_rates',     array['competitor_id', 'competitor_properties']),
    ('event_equipment',      array['space_id', 'event_spaces']),
    ('event_layouts',        array['space_id', 'event_spaces']),
    ('event_lines',          array['event_id', 'event_bookings']),
    ('event_payments',       array['event_id', 'event_bookings']),
    ('folio_entries',        array['booking_id', 'bookings', 'folio_id', 'folios']),
    ('guest_documents',      array['guest_id', 'guests']),
    ('loyalty_tier_history', array['guest_id', 'guests']),
    ('maintenance_photos',   array['ticket_id', 'maintenance_tickets']),
    ('package_components',   array['rate_plan_id', 'rate_plans']),
    ('pos_categories',       array['outlet_id', 'pos_outlets']),
    ('pos_item_modifiers',   array['item_id', 'pos_items']),
    ('pos_items',            array['outlet_id', 'pos_outlets']),
    ('pos_modifiers',        array['outlet_id', 'pos_outlets']),
    ('pos_order_lines',      array['order_id', 'pos_orders']),
    ('pos_payments',         array['order_id', 'pos_orders']),
    ('promo_redemptions',    array['promo_code_id', 'promo_codes']),
    ('rate_restrictions',    array['rate_plan_id', 'rate_plans', 'room_type_id', 'room_types']),
    ('room_blocks',          array['room_id', 'rooms']),
    ('room_moves',           array['booking_id', 'bookings'])
  ) as x (tbl, args) loop
    execute format(
      'alter table %I add column if not exists property_id uuid references properties on delete restrict', r.tbl);
    execute format('update %I set property_id = %L where property_id is null', r.tbl, v_default);
    execute format('alter table %I alter column property_id set default current_property()', r.tbl);
    execute format('alter table %I alter column property_id set not null', r.tbl);
    execute format('create index if not exists %I on %I (property_id)', r.tbl || '_property_idx', r.tbl);

    execute format('drop trigger if exists %I on %I', r.tbl || '_inherit_property', r.tbl);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function inherit_property(%s)',
      r.tbl || '_inherit_property', r.tbl,
      (select string_agg(quote_literal(a), ', ') from unnest(r.args) a));
  end loop;
end;
$$;

-- ── 8. The separation itself ────────────────────────────────────────────────

/*
 * One RESTRICTIVE policy per table, ANDed with whatever that table already
 * allowed. Nothing that was permitted before is permitted now unless the row
 * belongs to a property the caller works at.
 *
 * Written as a loop over every table that now carries property_id so that a
 * table cannot be forgotten: if it has the column, it has the policy.
 */
do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
     where a.attname = 'property_id'
       and c.relkind = 'r'
       and c.relnamespace = 'public'::regnamespace
       and not a.attisdropped
       and c.relname <> 'staff'
     order by c.relname
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_property', t);
    execute format(
      'create policy %I on %I as restrictive for all
         using (can_access_property(property_id))
         with check (can_access_property(property_id))',
      t || '_property', t);
  end loop;
end;
$$;

-- Staff are property-scoped too (the SOW separates staff data alongside guest
-- and financial data), but their own row must stay readable whatever property
-- is selected, or getSession() would sign them out of their own account.
drop policy if exists staff_property on staff;
create policy staff_property on staff as restrictive for all
  using (id = auth.uid() or property_id is null or can_access_property(property_id))
  with check (id = auth.uid() or property_id is null or can_access_property(property_id));

-- ── 9. Functions that scan whole tables ─────────────────────────────────────

/*
 * A SECURITY DEFINER function runs as its owner, and an owner is not subject
 * to row level security. That is what makes the definer functions in this
 * codebase able to do privileged work — and it is also why the restrictive
 * policies above do not reach inside them.
 *
 * For the great majority that is harmless: they act on a record you name, so
 * they can only touch what you already had the id of. The ones that matter are
 * those that scan a whole table, because without a property filter they would
 * quietly aggregate — or worse, *write to* — every hotel in the group. A night
 * audit run at one property posting room charges for another is not a
 * reporting inconvenience; it is two sets of wrong books.
 *
 * Each one below is the function as it was, with the property filter added.
 * Per-property reports stay per-property; comparing properties is a separate
 * job, done by the group functions in section 10.
 */

create or replace function sellable_rooms()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from rooms
   where status <> 'out_of_service' and property_id = current_property();
$$;

create or replace function report_daily(p_from date, p_to date)
returns table (
  day             date,
  source          text,
  rooms_available int,
  rooms_sold      int,
  room_revenue    numeric,
  other_revenue   numeric,
  tax_total       numeric,
  total_revenue   numeric
) language plpgsql stable security definer set search_path = public as $$
declare v_property uuid := current_property();
begin
  if not (has_permission('reports.financial') or has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  audited as (
    select na.business_date, na.report
      from night_audits na
     where na.status = 'completed'
       and na.business_date between p_from and p_to
       and na.property_id = v_property
       and na.report ? 'rooms'
  )
  select
    days.day,
    case when a.report is not null then 'audit' else 'live' end as source,
    coalesce((a.report -> 'rooms' ->> 'available')::int, sellable_rooms()) as rooms_available,
    coalesce(
      (a.report -> 'rooms' ->> 'sold')::int,
      (select coalesce(sum(b.rooms_count), 0)::int
         from bookings b
        where b.check_in <= days.day and b.check_out > days.day
          and b.property_id = v_property
          and b.status in ('checked_in', 'checked_out'))
    ) as rooms_sold,
    coalesce(
      (a.report -> 'revenue' ->> 'room')::numeric,
      (select coalesce(sum(f.amount), 0)
         from folio_entries f
        where f.voided_at is null and f.kind = 'room' and f.stay_date = days.day
          and f.property_id = v_property)
    ) as room_revenue,
    coalesce(
      (a.report -> 'revenue' ->> 'fees')::numeric
        + (a.report -> 'revenue' ->> 'extras')::numeric
        + (a.report -> 'revenue' ->> 'penalties')::numeric,
      (select coalesce(sum(f.amount), 0)
         from folio_entries f
        where f.voided_at is null and f.kind in ('fee', 'extra', 'penalty')
          and f.property_id = v_property
          and local_day(f.created_at) = days.day)
    ) as other_revenue,
    coalesce(
      (a.report -> 'revenue' ->> 'tax')::numeric,
      (select coalesce(sum(f.tax_amount), 0)
         from folio_entries f
        where f.voided_at is null
          and f.kind in ('room', 'fee', 'extra', 'penalty')
          and f.property_id = v_property
          and coalesce(f.stay_date, local_day(f.created_at)) = days.day)
    ) as tax_total,
    coalesce(
      (a.report -> 'revenue' ->> 'total')::numeric,
      (select coalesce(sum(f.amount + f.tax_amount), 0)
         from folio_entries f
        where f.voided_at is null
          and f.kind in ('room', 'fee', 'extra', 'penalty')
          and f.property_id = v_property
          and coalesce(f.stay_date, local_day(f.created_at)) = days.day)
    ) as total_revenue
  from days
  left join audited a on a.business_date = days.day
  order by days.day;
end;
$$;

create or replace function report_tax_summary(p_from date, p_to date)
returns table (rate numeric, net numeric, tax numeric, entries int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select f.tax_rate, sum(f.amount) as net, sum(f.tax_amount) as tax, count(*)::int as entries
    from folio_entries f
   where f.voided_at is null
     and f.property_id = current_property()
     and f.kind in ('room', 'fee', 'extra', 'penalty')
     and coalesce(f.stay_date, local_day(f.created_at)) between p_from and p_to
   group by f.tax_rate
   order by f.tax_rate;
end;
$$;

create or replace function report_payments(p_from date, p_to date)
returns table (method text, taken numeric, refunded numeric, count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select coalesce(f.method::text, 'unspecified') as method,
         sum(case when f.kind = 'payment' then f.amount else 0 end)                as taken,
         sum(case when f.kind = 'refund'  then f.amount + f.tax_amount else 0 end) as refunded,
         count(*)::int
    from folio_entries f
   where f.voided_at is null
     and f.property_id = current_property()
     and f.kind in ('payment', 'refund')
     and local_day(f.created_at) between p_from and p_to
   group by 1
   order by 2 desc;
end;
$$;

create or replace function report_outlet_sales(p_from date, p_to date)
returns table (
  outlet text, kind text, bills int, covers int,
  net numeric, tax numeric, service numeric, tips numeric, total numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select o.name, o.kind,
         count(*)::int                                  as bills,
         coalesce(sum(po.covers), 0)::int               as covers,
         coalesce(sum(po.net_total), 0)                 as net,
         coalesce(sum(po.tax_total + po.service_tax), 0) as tax,
         coalesce(sum(po.service_net), 0)               as service,
         coalesce(sum(po.tip_amount), 0)                as tips,
         coalesce(sum(po.grand_total), 0)               as total
    from pos_orders po
    join pos_outlets o on o.id = po.outlet_id
   where po.status = 'settled'
     and po.property_id = current_property()
     and local_day(coalesce(po.closed_at, po.opened_at)) between p_from and p_to
   group by o.name, o.kind, o.sort_order
   order by o.sort_order;
end;
$$;

create or replace function report_outlet_payments(p_from date, p_to date)
returns table (kind text, amount numeric, count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select p.kind, sum(p.amount), count(*)::int
    from pos_payments p
   where p.voided_at is null
     and p.property_id = current_property()
     and local_day(p.created_at) between p_from and p_to
   group by p.kind
   order by 2 desc;
end;
$$;

create or replace function report_outstanding()
returns table (
  source text, reference text, who text, status text, due_date date, amount numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select case when b.status = 'checked_in' then 'in_house' else 'departed' end,
         b.reference, b.contact_name, b.status::text, b.check_out, folio_balance(b.id)
    from bookings b
   where b.status in ('checked_in', 'checked_out')
     and b.property_id = current_property()
     and folio_balance(b.id) > 0
   order by 6 desc;
end;
$$;

create or replace function report_bookings(p_from date, p_to date)
returns table (
  source text, bookings int, room_nights int, cancelled int, no_shows int, revenue numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select b.source::text,
         count(*)::int,
         coalesce(sum((b.check_out - b.check_in) * b.rooms_count), 0)::int,
         count(*) filter (where b.status = 'cancelled')::int,
         count(*) filter (where b.status = 'no_show')::int,
         coalesce(sum(b.total_amount) filter (where b.status in ('checked_in', 'checked_out')), 0)
    from bookings b
   where b.check_in between p_from and p_to
     and b.property_id = current_property()
   group by b.source
   order by 2 desc;
end;
$$;

create or replace function report_housekeeping(p_from date, p_to date)
returns table (staff_name text, tasks int, inspected int, failed int, avg_minutes numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select coalesce(s.full_name, 'Unassigned'),
         count(*)::int,
         count(*) filter (where t.status = 'inspected')::int,
         coalesce(sum(t.failed_count), 0)::int,
         round(avg(
           case when t.started_at is not null and t.completed_at is not null
                then extract(epoch from (t.completed_at - t.started_at)) / 60
           end
         ), 1)
    from housekeeping_tasks t
    left join staff s on s.id = t.completed_by
   where t.task_date between p_from and p_to
     and t.property_id = current_property()
     and t.status <> 'cancelled'
   group by 1
   order by 2 desc;
end;
$$;

create or replace function report_maintenance(p_from date, p_to date)
returns table (priority text, raised int, resolved int, breached int, avg_hours numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select t.priority::text,
         count(*)::int,
         count(*) filter (where t.status = 'resolved')::int,
         count(*) filter (where t.resolved_at is not null and t.due_at is not null and t.resolved_at > t.due_at)::int,
         round(avg(
           case when t.resolved_at is not null
                then extract(epoch from (t.resolved_at - t.created_at)) / 3600
           end
         ), 1)
    from maintenance_tickets t
   where local_day(t.created_at) between p_from and p_to
     and t.property_id = current_property()
   group by t.priority
   order by 2 desc;
end;
$$;

create or replace function report_guests(p_from date, p_to date)
returns table (
  stays int, distinct_guests int, repeat_guests int, feedback_count int,
  avg_overall numeric, loyalty_members int, points_earned int, points_redeemed int
) language plpgsql stable security definer set search_path = public as $$
declare v_property uuid := current_property();
begin
  if not (has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select
    (select count(*)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')
        and b.property_id = v_property),
    (select count(distinct b.guest_id)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')
        and b.property_id = v_property and b.guest_id is not null),
    -- A repeat guest is one who had already stayed before this stay began.
    -- "Before" means at this property: a first visit to a sister hotel is not
    -- a repeat stay here, and counting it as one would flatter the number.
    (select count(distinct b.guest_id)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')
        and b.property_id = v_property and b.guest_id is not null
        and exists (select 1 from bookings prior
                     where prior.guest_id = b.guest_id
                       and prior.property_id = v_property
                       and prior.status in ('checked_in', 'checked_out')
                       and prior.check_in < b.check_in)),
    (select count(*)::int from guest_feedback gf
      where gf.submitted_at is not null and gf.property_id = v_property
        and local_day(gf.submitted_at) between p_from and p_to),
    (select round(avg(gf.overall), 2) from guest_feedback gf
      where gf.submitted_at is not null and gf.overall is not null
        and gf.property_id = v_property
        and local_day(gf.submitted_at) between p_from and p_to),
    (select count(*)::int from guests g
      where g.loyalty_opt_in and g.erased_at is null and g.property_id = v_property),
    (select coalesce(sum(lt.points), 0)::int from loyalty_transactions lt
      where lt.kind = 'earn' and lt.property_id = v_property
        and local_day(lt.created_at) between p_from and p_to),
    (select coalesce(sum(-lt.points), 0)::int from loyalty_transactions lt
      where lt.kind = 'redeem' and lt.property_id = v_property
        and local_day(lt.created_at) between p_from and p_to);
end;
$$;

create or replace function report_attendance(p_from date, p_to date)
returns table (
  staff_name text, department text, present int, absent int, leave_days int, hours numeric
) language plpgsql stable security definer set search_path = public as $$
declare v_property uuid := current_property();
begin
  if not (has_permission('reports.view') or has_permission('hr.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select s.full_name,
         coalesce(d.name, ''),
         count(a.id) filter (where a.clock_in is not null)::int,
         count(sh.id) filter (where a.id is null)::int,
         (select count(*)::int from leave_requests lr
           where lr.staff_id = s.id and lr.status = 'approved'
             and lr.property_id = v_property
             and lr.start_date <= p_to and lr.end_date >= p_from),
         round(coalesce(sum(
           case when a.clock_in is not null and a.clock_out is not null
                then extract(epoch from (a.clock_out - a.clock_in)) / 3600
           end
         ), 0), 1)
    from staff s
    left join departments d on d.id = s.department_id
    left join attendance a on a.staff_id = s.id and a.work_date between p_from and p_to
                          and a.property_id = v_property
    left join staff_shifts sh on sh.staff_id = s.id and sh.shift_date between p_from and p_to
                             and sh.property_id = v_property
   where s.is_active
     and (s.property_id = v_property
          or exists (select 1 from staff_properties sp
                      where sp.staff_id = s.id and sp.property_id = v_property))
   group by s.id, s.full_name, d.name
   order by s.full_name;
end;
$$;

-- The nightly jobs. These write, so an unscoped scan here does not merely
-- report the wrong number — it raises another hotel's tickets and cleans
-- another hotel's rooms.

create or replace function close_folio_day(p_date date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_count int;
begin
  if not has_permission('frontdesk.night_audit') then
    raise exception 'not permitted';
  end if;
  update folio_entries
     set night_audit_date = p_date
   where night_audit_date is null
     and property_id = current_property()
     and created_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function hk_generate_tasks(p_date date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_count int := 0;
  v_room  record;
  v_days  int := coalesce((select hk_deep_clean_days from property_settings limit 1), 30);
begin
  if not (has_permission('housekeeping.assign') or has_permission('frontdesk.night_audit')) then
    raise exception 'not permitted';
  end if;

  for v_room in
    select r.id from rooms r
     where r.status not in ('out_of_order', 'out_of_service')
       and r.property_id = current_property()
       and (r.last_deep_clean_on is null or r.last_deep_clean_on + v_days <= p_date)
       and not exists (select 1 from housekeeping_tasks t where t.room_id = r.id and t.kind = 'deep_clean'
                        and t.status in ('pending', 'in_progress', 'cleaned'))
  loop
    if hk_create_task(v_room.id, 'deep_clean', p_date, 'Scheduled deep clean') is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

create or replace function mt_escalate_overdue()
returns setof maintenance_tickets language plpgsql volatile security definer set search_path = public as $$
begin
  if not (has_permission('maintenance.report') or mt_is_system()) then
    raise exception 'not permitted';
  end if;
  return query
    with escalated as (
      update maintenance_tickets
         set escalated_at = now()
       where status in ('open', 'in_progress', 'on_hold')
         and property_id = current_property()
         and due_at < now()
         and escalated_at is null
      returning *
    )
    select * from escalated;
end;
$$;

create or replace function mt_generate_preventive(p_date date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_count int := 0;
  s record;
  v_next date;
begin
  if not (has_permission('maintenance.manage') or has_permission('frontdesk.night_audit') or mt_is_system()) then
    raise exception 'not permitted';
  end if;

  for s in
    select * from maintenance_schedules ms
     where ms.is_active and ms.next_due_on <= p_date
       and ms.property_id = current_property()
       and not exists (select 1 from maintenance_tickets t
                        where t.schedule_id = ms.id and t.status in ('open', 'in_progress', 'on_hold'))
     for update
  loop
    insert into maintenance_tickets (title, description, room_id, asset_id, location, priority, source,
                                     schedule_id, assigned_to, assigned_at, reported_by, property_id)
    values (s.title, s.description, s.room_id, s.asset_id, s.location, s.priority, 'preventive',
            s.id, s.assigned_to, case when s.assigned_to is not null then now() end, auth.uid(), s.property_id);

    v_next := s.next_due_on;
    while v_next <= p_date loop
      v_next := v_next + s.interval_days;
    end loop;
    update maintenance_schedules set next_due_on = v_next, last_generated_on = p_date where id = s.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function loyalty_evaluate_all(p_date date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_guest uuid;
  v_count int := 0;
begin
  for v_guest in
    select distinct g.id
      from guests g
     where g.loyalty_opt_in and g.erased_at is null
       and g.property_id = current_property()
  loop
    if loyalty_evaluate_tier(v_guest, p_date) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function report_events(p_from date, p_to date)
returns table (
  event_type text, events int, pax int, rental numeric, catering numeric,
  equipment numeric, other numeric, service numeric, tax numeric, total numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select e.event_type,
         count(*)::int,
         sum(event_billable_pax(e.id))::int,
         sum(e.rental_net), sum(e.catering_net), sum(e.equipment_net), sum(e.other_net),
         sum(e.service_net), sum(e.tax_total), sum(e.grand_total)
    from event_bookings e
   where e.status in ('confirmed', 'completed')
     and e.property_id = current_property()
     and e.event_date between p_from and p_to
   group by e.event_type
   order by sum(e.grand_total) desc;
end;
$$;

create or replace function revenue_forecast(p_from date, p_to date)
returns table (
  stay_date date, room_type_id uuid, capacity int, rooms_sold int, revenue_on_books numeric
) language plpgsql stable security definer set search_path = public as $$
declare v_property uuid := current_property();
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
       and b.property_id = v_property
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
   where rt.property_id = v_property
   order by n.stay_date, rt.sort_order, rt.name;
end;
$$;

-- ── 10. Running the group ───────────────────────────────────────────────────

-- SOW Module 14 puts group-level control in its own hands: seeing every
-- property, adding one, and pushing head office's standards down.
insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'properties.view'),
  ('finance', 'properties.view'),
  ('front_office_manager', 'properties.view')
) as seed (r, p)
on conflict do nothing;

/*
 * Every property the caller may see, with the numbers to compare them.
 *
 * SOW Module 14: "Central dashboard showing all properties' performance side
 * by side" and "Ability to compare occupancy/revenue across properties in one
 * report". One row per property, so the caller can sort by whichever column
 * they care about rather than being given a ranking.
 *
 * Scoped to staff_property_ids(), which is what makes the same screen honest
 * for a general manager (their hotel) and for an owner (all of them).
 */
create or replace function group_dashboard(p_from date, p_to date)
returns table (
  property_id     uuid,
  code            text,
  name            text,
  brand           text,
  nights          int,
  rooms_available int,
  rooms_sold      int,
  occupancy       numeric,
  room_revenue    numeric,
  total_revenue   numeric,
  adr             numeric,
  revpar          numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('properties.view') or has_permission('reports.view')
          or has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;
  if p_to < p_from then
    raise exception 'GROUP_BAD_RANGE' using hint = 'The end of the range comes before its start.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'GROUP_RANGE_TOO_LONG' using hint = 'Ask for at most 400 nights at a time.';
  end if;

  return query
  with mine as (
    select pr.* from properties pr
     where pr.id in (select staff_property_ids()) or is_service_role()
  ),
  nights as (
    select d::date as stay_date from generate_series(p_from, p_to, interval '1 day') d
  ),
  capacity as (
    select m.id as pid,
           (select count(*) from rooms r
             where r.property_id = m.id and r.status <> 'out_of_service')::int as sellable
      from mine m
  ),
  sold as (
    select b.property_id as pid, coalesce(sum(b.rooms_count), 0)::int as rooms_sold
      from bookings b
      join nights n on b.check_in <= n.stay_date and b.check_out > n.stay_date
     where b.status in ('checked_in', 'checked_out')
     group by b.property_id
  ),
  revenue as (
    select f.property_id as pid,
           coalesce(sum(f.amount) filter (where f.kind = 'room'), 0) as room_revenue,
           coalesce(sum(f.amount + f.tax_amount), 0)                 as total_revenue
      from folio_entries f
     where f.voided_at is null
       and f.kind in ('room', 'fee', 'extra', 'penalty')
       and coalesce(f.stay_date, local_day(f.created_at)) between p_from and p_to
     group by f.property_id
  )
  select m.id, m.code, m.name, m.brand,
         (p_to - p_from + 1)::int                                       as nights,
         (c.sellable * (p_to - p_from + 1))::int                        as rooms_available,
         coalesce(s.rooms_sold, 0)                                      as rooms_sold,
         case when c.sellable > 0
              then round(coalesce(s.rooms_sold, 0)::numeric
                         / (c.sellable * (p_to - p_from + 1)) * 100, 1)
              else 0 end                                                as occupancy,
         coalesce(r.room_revenue, 0)                                    as room_revenue,
         coalesce(r.total_revenue, 0)                                   as total_revenue,
         -- Average Daily Rate: room revenue over rooms actually sold.
         case when coalesce(s.rooms_sold, 0) > 0
              then round(coalesce(r.room_revenue, 0) / s.rooms_sold, 2)
              else 0 end                                                as adr,
         -- Revenue Per Available Room: over every room the hotel could sell,
         -- sold or not, which is what makes two hotels of different sizes
         -- comparable at all.
         case when c.sellable > 0
              then round(coalesce(r.room_revenue, 0)
                         / (c.sellable * (p_to - p_from + 1)), 2)
              else 0 end                                                as revpar
    from mine m
    join capacity c on c.pid = m.id
    left join sold s on s.pid = m.id
    left join revenue r on r.pid = m.id
   order by m.sort_order, m.name;
end;
$$;

/*
 * Rooms free per property per night, for taking a reservation at whichever
 * hotel in the group has space (SOW Module 14: "Central reservation option —
 * book any property from one screen").
 *
 * Deliberately a summary rather than a second booking engine: the desk picks
 * the property here, and the reservation itself is then made by the same
 * availability rules, rate plans and overbooking checks as any other. One
 * booking engine, asked about several hotels.
 */
create or replace function group_availability(p_check_in date, p_check_out date)
returns table (
  property_id  uuid,
  code         text,
  name         text,
  room_type_id uuid,
  room_type    text,
  free         int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('bookings.view') or has_permission('bookings.create') or is_service_role()) then
    raise exception 'not permitted';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'GROUP_BAD_RANGE' using hint = 'Check-out must be after check-in.';
  end if;
  if p_check_out - p_check_in > 90 then
    raise exception 'GROUP_RANGE_TOO_LONG' using hint = 'Ask for at most 90 nights at a time.';
  end if;

  return query
  with mine as (
    select pr.* from properties pr
     where pr.is_active and (pr.id in (select staff_property_ids()) or is_service_role())
  ),
  nights as (
    select d::date as stay_date from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  ),
  per_night as (
    select rt.property_id as pid, rt.id as rtid, n.stay_date,
           room_type_capacity(rt.id, n.stay_date)
             - coalesce((select sum(b.rooms_count)::int from bookings b
                          where b.room_type_id = rt.id
                            and b.status in ('tentative', 'confirmed', 'checked_in')
                            and b.check_in <= n.stay_date and b.check_out > n.stay_date), 0) as free
      from room_types rt
      join mine m on m.id = rt.property_id
      cross join nights n
     where rt.is_active
  )
  select m.id, m.code, m.name, rt.id, rt.name,
         -- The whole stay is only bookable if every night of it is, so the
         -- tightest night is the answer.
         greatest(0, min(pn.free))::int
    from per_night pn
    join room_types rt on rt.id = pn.rtid
    join mine m on m.id = pn.pid
   group by m.id, m.code, m.name, m.sort_order, rt.id, rt.name, rt.sort_order
   order by m.sort_order, m.name, rt.sort_order, rt.name;
end;
$$;

/*
 * Adds a hotel to the group, with the reference data a hotel cannot open
 * without.
 *
 * Copied from an existing property rather than invented, because the things
 * being copied — message templates, shift patterns, departments, cleaning
 * checklists — are exactly the "brand standards" a group wants consistent on
 * day one. Rooms, rates and staff are not copied: those are what make the new
 * hotel a different hotel.
 */
create or replace function create_property(
  p_code text,
  p_name text,
  p_brand text default '',
  p_copy_from uuid default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id     uuid;
  v_source uuid;
begin
  if not has_permission('properties.manage') then
    raise exception 'not permitted';
  end if;
  if length(trim(coalesce(p_code, ''))) = 0 or length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'PROPERTY_NAME_REQUIRED' using hint = 'A property needs a short code and a name.';
  end if;
  if exists (select 1 from properties where lower(code) = lower(trim(p_code))) then
    raise exception 'PROPERTY_CODE_TAKEN' using hint = 'Another property already uses that code.';
  end if;

  v_source := coalesce(p_copy_from, (select id from properties where is_default limit 1));

  -- Everything not named here keeps the column default, which is how a new
  -- property starts on the group's tax and security settings rather than on
  -- nothing at all.
  insert into properties (code, name, brand, is_active, is_default)
  values (upper(trim(p_code)), trim(p_name), coalesce(trim(p_brand), ''), true, false)
  returning id into v_id;

  -- The group's standards, applied at birth.
  perform push_central_config(array['brand', 'loyalty', 'tax'], array[v_id]);

  if v_source is not null then
    insert into message_templates (property_id, template, language, subject, body, footer, sms)
    select v_id, t.template, t.language, t.subject, t.body, t.footer, t.sms
      from message_templates t where t.property_id = v_source
    on conflict do nothing;

    insert into departments (property_id, name, sort_order)
    select v_id, d.name, d.sort_order from departments d where d.property_id = v_source
    on conflict do nothing;

    insert into shift_types (property_id, name, start_time, end_time, start_time_2, end_time_2,
                             color, sort_order, is_active)
    select v_id, s.name, s.start_time, s.end_time, s.start_time_2, s.end_time_2,
           s.color, s.sort_order, s.is_active
      from shift_types s where s.property_id = v_source
    on conflict do nothing;

    insert into hk_checklist_items (property_id, category, label, par_qty, sort_order, is_active)
    select v_id, i.category, i.label, i.par_qty, i.sort_order, i.is_active
      from hk_checklist_items i where i.property_id = v_source
    on conflict do nothing;
  end if;

  perform log_event('properties', 'create', v_id::text,
                    format('Added property %s (%s)', trim(p_name), upper(trim(p_code))));
  return v_id;
end;
$$;

/* Moves which property answers the public website and unattributed requests. */
create or replace function set_default_property(p_property uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not has_permission('properties.manage') then
    raise exception 'not permitted';
  end if;
  if not exists (select 1 from properties where id = p_property and is_active) then
    raise exception 'PROPERTY_NOT_FOUND' using hint = 'That property does not exist or is closed.';
  end if;
  update properties set is_default = false where is_default and id <> p_property;
  update properties set is_default = true where id = p_property;
  perform log_event('properties', 'set_default', p_property::text, 'Changed the public website property');
end;
$$;

-- ── 11. Natural keys become per-property ────────────────────────────────────

/*
 * A unique constraint written for one hotel quietly becomes a rule for the
 * whole group the moment there are two. Both hotels have a room 101, both call
 * a rate plan BAR, both run a financial year — and both must be able to.
 *
 * Surrogate keys are left alone: a uuid is unique everywhere by construction,
 * and a booking reference that identifies one booking across the group is
 * useful rather than a nuisance. What changes here is the *natural* keys —
 * the codes, numbers, slugs and names people choose — plus the per-year
 * numbering series, which must restart at each property or two hotels would
 * hand out the same invoice number.
 */
do $$
declare
  r record;
begin
  for r in select * from (values
    ('rooms',                  'rooms_room_number_key',                    'room_number'),
    ('room_types',             'room_types_slug_key',                      'slug'),
    ('rate_plans',             'rate_plans_code_key',                      'code'),
    ('promo_codes',            'promo_codes_code_key',                     'code'),
    ('pos_outlets',            'pos_outlets_code_key',                     'code'),
    ('pos_orders',             'pos_orders_number_key',                    'number'),
    ('event_spaces',           'event_spaces_code_key',                    'code'),
    ('event_packages',         'event_packages_code_key',                  'code'),
    ('housekeeping_zones',     'housekeeping_zones_name_key',              'name'),
    ('departments',            'departments_name_key',                     'name'),
    ('shift_types',            'shift_types_name_key',                     'name'),
    ('assets',                 'assets_code_key',                          'code'),
    ('lost_found_items',       'lost_found_items_reference_key',           'reference'),
    ('invoices',               'invoices_number_key',                      'number')
  ) as x (tbl, con, col) loop
    execute format('alter table %I drop constraint if exists %I', r.tbl, r.con);
    execute format('drop index if exists %I', r.con);
    execute format('create unique index if not exists %I on %I (property_id, %I)',
                   r.tbl || '_' || r.col || '_property_idx', r.tbl, r.col);
  end loop;
end;
$$;

-- Case-insensitive names, which were expression indexes rather than
-- constraints, so they are simply rebuilt with the property in front.
drop index if exists companies_name_idx;
create unique index if not exists companies_name_idx on companies (property_id, lower(name));
drop index if exists competitor_properties_name_idx;
create unique index if not exists competitor_properties_name_idx
  on competitor_properties (property_id, lower(name));
drop index if exists event_equipment_name_idx;
create unique index if not exists event_equipment_name_idx
  on event_equipment (property_id, lower(name));

-- Primary keys made of business data. Each is replaced rather than widened,
-- because a primary key cannot be altered in place.
alter table message_templates drop constraint if exists message_templates_pkey;
alter table message_templates add primary key (property_id, template, language);

alter table night_audits drop constraint if exists night_audits_pkey;
alter table night_audits add primary key (property_id, business_date);

alter table invoice_series drop constraint if exists invoice_series_pkey;
alter table invoice_series add primary key (property_id, series, financial_year);

alter table event_series drop constraint if exists event_series_pkey;
alter table event_series add primary key (property_id, financial_year);

-- The invoice sequence itself: series and year restart per property, so the
-- seq within them must too.
alter table invoices drop constraint if exists invoices_series_financial_year_seq_key;
drop index if exists invoices_series_financial_year_seq_key;
create unique index if not exists invoices_series_seq_property_idx
  on invoices (property_id, series, financial_year, seq);

-- Event references are printed as EVT/2026-27/0001 and restart each financial
-- year, so two hotels would hand out the same one on the same day.
alter table event_bookings drop constraint if exists event_bookings_number_key;
drop index if exists event_bookings_number_key;
create unique index if not exists event_bookings_number_property_idx
  on event_bookings (property_id, number);

-- ── 12. The numbering that follows from those keys ──────────────────────────

/*
 * Both of these claim the next number in a per-year series, and both did it
 * with an upsert whose conflict target was the old primary key. Widening those
 * keys in section 11 leaves the upserts pointing at an index that no longer
 * exists — so they are restated here against the new one.
 *
 * Worth being plain about what would happen otherwise: the upsert is what
 * makes concurrent callers queue for a number rather than share one. A broken
 * conflict target does not silently duplicate invoice numbers; it raises, and
 * no invoice can be issued at all. Loud, but still a hotel that cannot bill.
 */
create or replace function next_invoice_number(p_series text, p_fy text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
begin
  insert into invoice_series (property_id, series, financial_year, last_seq)
  values (current_property(), p_series, p_fy, 1)
  on conflict (property_id, series, financial_year)
    do update set last_seq = invoice_series.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

create or replace function next_event_number(p_fy text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
begin
  insert into event_series (property_id, financial_year, last_seq)
  values (current_property(), p_fy, 1)
  on conflict (property_id, financial_year) do update set last_seq = event_series.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

-- ── 13. The nightly jobs, for a group ───────────────────────────────────────

/*
 * Section 9 scoped these to current_property(), which is right when a person
 * runs them: the night audit closes the hotel you are standing in.
 *
 * It is wrong for the scheduler. A cron request carries no staff session, so
 * current_property() answers "the property the website sells" — and every
 * other hotel in the group would silently stop escalating overdue tickets and
 * stop raising preventive work. Nothing would fail; the work would just never
 * happen, which is the worst kind of wrong.
 *
 * So both take an optional property. Passing none keeps the old meaning for
 * the night audit and the maintenance board; the cron endpoint passes each
 * property in turn.
 *
 * The old single-argument forms are dropped rather than left alongside, or
 * calling them with one argument would be ambiguous between the two.
 */
drop function if exists mt_generate_preventive(date);
create or replace function mt_generate_preventive(p_date date, p_property uuid default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_count int := 0;
  v_prop uuid := coalesce(p_property, current_property());
  s record;
  v_next date;
begin
  if not (has_permission('maintenance.manage') or has_permission('frontdesk.night_audit') or mt_is_system()) then
    raise exception 'not permitted';
  end if;
  -- A person may only run this for a property they work at; the scheduler,
  -- which has no session, may run it for any.
  if p_property is not null and is_staff() and not can_access_property(p_property) then
    raise exception 'PROPERTY_NOT_YOURS' using hint = 'You do not have access to that property.';
  end if;

  for s in
    select * from maintenance_schedules ms
     where ms.is_active and ms.next_due_on <= p_date
       and ms.property_id = v_prop
       and not exists (select 1 from maintenance_tickets t
                        where t.schedule_id = ms.id and t.status in ('open', 'in_progress', 'on_hold'))
     for update
  loop
    insert into maintenance_tickets (title, description, room_id, asset_id, location, priority, source,
                                     schedule_id, assigned_to, assigned_at, reported_by, property_id)
    values (s.title, s.description, s.room_id, s.asset_id, s.location, s.priority, 'preventive',
            s.id, s.assigned_to, case when s.assigned_to is not null then now() end, auth.uid(), s.property_id);

    v_next := s.next_due_on;
    while v_next <= p_date loop
      v_next := v_next + s.interval_days;
    end loop;
    update maintenance_schedules set next_due_on = v_next, last_generated_on = p_date where id = s.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

drop function if exists mt_escalate_overdue();
create or replace function mt_escalate_overdue(p_property uuid default null)
returns setof maintenance_tickets language plpgsql volatile security definer set search_path = public as $$
declare v_prop uuid := coalesce(p_property, current_property());
begin
  if not (has_permission('maintenance.report') or mt_is_system()) then
    raise exception 'not permitted';
  end if;
  if p_property is not null and is_staff() and not can_access_property(p_property) then
    raise exception 'PROPERTY_NOT_YOURS' using hint = 'You do not have access to that property.';
  end if;

  return query
    with escalated as (
      update maintenance_tickets
         set escalated_at = now()
       where status in ('open', 'in_progress', 'on_hold')
         and property_id = v_prop
         and due_at < now()
         and escalated_at is null
      returning *
    )
    select * from escalated;
end;
$$;

/* The properties a scheduled job should walk. */
create or replace function active_property_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from properties where is_active order by sort_order, name;
$$;

-- ── 14. Audit ───────────────────────────────────────────────────────────────

/*
 * §6.6 asks for every important change to be logged. Adding a hotel, changing
 * the group's standards, and moving somebody between hotels are all changes of
 * access, which makes them exactly the kind the trail is for.
 *
 * The trigger on property_settings from 0005 followed the table through the
 * rename, so it is restated under the new name and module.
 */
do $$
declare
  t record;
begin
  for t in select * from (values
    ('properties', 'properties'),
    ('group_settings', 'properties'),
    ('staff_properties', 'staff')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format('drop trigger if exists %I on %I', 'property_settings_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
