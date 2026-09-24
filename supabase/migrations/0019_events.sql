-- ============================================================================
-- Module 10 — Banquet, Conference & Event Management
--
--   • The hotel markets one hall, sold in several seating layouts. The space
--     is a row rather than a constant so its rates, capacities and layouts can
--     be changed by the hotel, and a second hall needs no migration.
--   • Catering is quoted per head, which is how banquet business is actually
--     priced. The billed head count is the guaranteed number or the actual
--     number, whichever is higher — the industry's "guarantee", so a client
--     who guarantees 100 and brings 60 still pays for 100.
--   • Venue rental, catering, equipment and extras are taxed at their own
--     rates, because in India hall rental and food do not share a GST rate.
--     event_tax_bands() is the single definition of the rate-wise split, used
--     by the quotation, the invoice and the tax summary report alike.
--   • Billing is the main billing module, not a second one: an event either
--     posts to a resident guest's folio, goes to a company's city ledger, or
--     is invoiced from the property's own GST invoice series. There is one
--     invoice series for the whole property, which is what the tax law wants.
--   • A quotation at or above a configurable value has to be approved by
--     someone other than the person who prepared it, mirroring the refund
--     approval workflow built in Module 7.
--
-- Only a confirmed event holds the hall. Two enquiries for the same Saturday
-- are ordinary business and the hotel picks one, so they are allowed to
-- overlap and the diary shows them side by side.
--
-- Run after 0018_reports.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'events.view'), ('manager', 'events.book'), ('manager', 'events.quote'),
  ('manager', 'events.approve'), ('manager', 'events.bill'), ('manager', 'events.manage'),
  ('front_office_manager', 'events.view'), ('front_office_manager', 'events.book'),
  ('front_office_manager', 'events.quote'), ('front_office_manager', 'events.bill'),
  ('front_desk', 'events.view'), ('front_desk', 'events.book'),
  ('finance', 'events.view'), ('finance', 'events.bill'),
  ('pos_cashier', 'events.view'),
  -- The SOW puts quotation approval with the sales manager, and this property
  -- already has that role: banquet business is sold, not taken at the desk.
  ('sales_marketing', 'events.view'), ('sales_marketing', 'events.book'),
  ('sales_marketing', 'events.quote'), ('sales_marketing', 'events.approve'),
  ('sales_marketing', 'events.manage')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- A quotation at or above this value needs a second person's approval before
-- it may be sent (SOW Module 10 "approval workflow for quotations above a
-- configured value"). Zero means every quotation is approved.
alter table property_settings add column if not exists event_quote_approval_threshold numeric(12,2)
  not null default 100000 check (event_quote_approval_threshold >= 0);

-- Added to every event as a taxable line, at the space's own tax rate.
alter table property_settings add column if not exists event_service_charge_percent numeric(5,2)
  not null default 0 check (event_service_charge_percent between 0 and 100);

-- The deposit normally asked for before an event is held as confirmed. Shown
-- on the quotation and the contract; it is advice to the desk, not a rule.
alter table property_settings add column if not exists event_advance_percent numeric(5,2)
  not null default 25 check (event_advance_percent between 0 and 100);

-- Printed on the contract. The hotel's own words: cancellation terms, the
-- head-count deadline, what damage is charged for.
alter table property_settings add column if not exists event_terms text not null default '';

-- ── Spaces, layouts, packages and equipment ─────────────────────────────────

create table if not exists event_spaces (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  name            text not null check (length(trim(name)) > 0),
  description     text not null default '',
  -- Which floor it is on, the way a room carries one: a client with elderly
  -- guests or a piano to move asks before anything else.
  floor           int,
  area_sqft       int check (area_sqft is null or area_sqft > 0),
  -- Hall rental. Which one applies is chosen per event.
  rental_full_day numeric(12,2) not null default 0 check (rental_full_day >= 0),
  rental_half_day numeric(12,2) not null default 0 check (rental_half_day >= 0),
  rental_per_hour numeric(12,2) not null default 0 check (rental_per_hour >= 0),
  -- The least the hall is let for, whatever the basis works out to.
  min_charge      numeric(12,2) not null default 0 check (min_charge >= 0),
  -- Hall rental is taxed at 18% in India; food is not. Confirm with the
  -- hotel's accountant before the first quotation.
  tax_rate        numeric(5,2) not null default 18 check (tax_rate between 0 and 100),
  -- How long the hall is held either side of the event, so the diary does not
  -- promise it to someone else while it is being dressed or cleared.
  setup_minutes   int not null default 60 check (setup_minutes between 0 and 1440),
  teardown_minutes int not null default 60 check (teardown_minutes between 0 and 1440),
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The hotel markets one hall, used for conferences, residential conferences
-- and banquets. Rates are placeholders the hotel must set before quoting.
insert into event_spaces (code, name, description, area_sqft, tax_rate, sort_order)
values ('HALL', 'Shamiyana Conference Hall',
        'Conference and banquet hall, laid out to suit the function.', null, 18, 1)
on conflict (code) do nothing;

-- One hall sold in several seating plans, which is what the capacity of an
-- event really depends on.
create table if not exists event_layouts (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references event_spaces on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  capacity   int not null check (capacity > 0),
  notes      text not null default '',
  is_active  boolean not null default true,
  sort_order int not null default 0
);

create index if not exists event_layouts_space_idx on event_layouts (space_id, sort_order);
create unique index if not exists event_layouts_name_idx on event_layouts (space_id, lower(name));

-- The layouts the hotel photographs and sells. Capacities are indicative and
-- must be confirmed against the hall before a quotation goes out.
insert into event_layouts (space_id, name, capacity, notes, sort_order)
select s.id, v.name, v.capacity, v.notes, v.sort_order
  from event_spaces s
  join (values
    ('Theatre',       200, 'Rows of chairs facing the stage. The most seats.', 1),
    ('Banquet (round tables)', 150, 'Rounds of ten, for a dinner or reception.', 2),
    ('Classroom',      90, 'Tables and chairs facing front, for training.', 3),
    ('U-shape',        60, 'Open horseshoe, for a discussion everyone joins.', 4),
    ('Boardroom',      40, 'One table, for a meeting of the whole room.', 5),
    ('Cluster',        60, 'Small tables, for workshops and break-outs.', 6)
  ) as v (name, capacity, notes, sort_order) on true
 where s.code = 'HALL'
on conflict do nothing;

-- Catering is quoted per head, per the hotel's instruction. Prices here are
-- placeholders: the hotel sets them before the first quotation.
create table if not exists event_packages (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9-]{2,12}$'),
  name           text not null check (length(trim(name)) > 0),
  description    text not null default '',
  meal_period    text not null default 'custom'
                 check (meal_period in ('breakfast', 'lunch', 'hi_tea', 'dinner', 'full_day', 'custom')),
  price_per_head numeric(12,2) not null default 0 check (price_per_head >= 0),
  -- Outdoor and banquet catering is taxed at its own rate, not the hall's.
  tax_rate       numeric(5,2) not null default 5 check (tax_rate between 0 and 100),
  min_pax        int not null default 0 check (min_pax >= 0),
  -- What the per-head price includes, one line each, printed on the quotation.
  inclusions     text[] not null default '{}',
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into event_packages (code, name, description, meal_period, min_pax, inclusions, sort_order) values
  ('CONF-FD', 'Conference full day', 'Morning tea, working lunch and afternoon tea.', 'full_day', 20,
   array['Morning tea and biscuits', 'Buffet lunch', 'Afternoon tea with snacks', 'Table water and stationery'], 1),
  ('CONF-HD', 'Conference half day', 'One tea break and lunch.', 'lunch', 20,
   array['Tea break with snacks', 'Buffet lunch', 'Table water'], 2),
  ('HI-TEA',  'Hi-tea',              'Afternoon tea with hot and cold snacks.', 'hi_tea', 20,
   array['Assorted snacks', 'Tea, coffee and soft drinks'], 3),
  ('LUNCH-V', 'Vegetarian lunch buffet', 'Vegetarian buffet lunch.', 'lunch', 25,
   array['Soup and salad', 'Three main courses', 'Rice and breads', 'Dessert'], 4),
  ('DINNER',  'Dinner buffet',       'Buffet dinner, vegetarian and non-vegetarian.', 'dinner', 25,
   array['Soup and salad', 'Four main courses', 'Rice and breads', 'Dessert'], 5),
  ('WAZWAN',  'Kashmiri Wazwan',     'Traditional Wazwan served in trami.', 'dinner', 40,
   array['Seven-course Wazwan', 'Kashmiri pulao', 'Phirni'], 6)
on conflict (code) do nothing;

create table if not exists event_equipment (
  id            uuid primary key default gen_random_uuid(),
  -- The space this equipment belongs to. Null means it travels: one projector
  -- serves whichever room needs it, which is how a small hotel actually works.
  space_id      uuid references event_spaces on delete set null,
  name          text not null check (length(trim(name)) > 0),
  description   text not null default '',
  unit          text not null default 'unit',
  rental_price  numeric(12,2) not null default 0 check (rental_price >= 0),
  tax_rate      numeric(5,2) not null default 18 check (tax_rate between 0 and 100),
  -- How many the hotel owns, shown to whoever is quoting so the hall is not
  -- promised three projectors when there is one.
  qty_available int not null default 1 check (qty_available >= 0),
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists event_equipment_name_idx on event_equipment (lower(name));

insert into event_equipment (name, description, unit, qty_available, sort_order) values
  ('Projector and screen', 'LCD projector with tripod screen.', 'set', 1, 1),
  ('Public address system', 'Amplifier, speakers and two cordless microphones.', 'set', 1, 2),
  ('Additional microphone', 'Extra cordless or collar microphone.', 'unit', 4, 3),
  ('Podium',              'Lectern with reading light.', 'unit', 1, 4),
  ('Stage riser',         'Modular stage section.', 'section', 6, 5),
  ('Flipchart and whiteboard', 'With markers and paper.', 'unit', 2, 6),
  ('Laptop',              'Presentation laptop.', 'unit', 1, 7),
  ('Stage backdrop',      'Printed backdrop, priced by the hotel per event.', 'unit', 1, 8)
on conflict do nothing;

-- ── Numbering ───────────────────────────────────────────────────────────────

-- One counter per financial year, advanced only by next_event_number(), so
-- two people taking an enquiry at the same moment cannot take one number.
create table if not exists event_series (
  financial_year text primary key,
  last_seq       int not null default 0 check (last_seq >= 0)
);

create or replace function next_event_number(p_fy text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_seq int;
begin
  insert into event_series (financial_year, last_seq)
  values (p_fy, 1)
  on conflict (financial_year) do update set last_seq = event_series.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

-- ── Events ──────────────────────────────────────────────────────────────────

create table if not exists event_bookings (
  id             uuid primary key default gen_random_uuid(),
  -- The printed reference, e.g. EVT/2026-27/0001.
  number         text not null unique,
  financial_year text not null,
  seq            int not null,

  space_id  uuid not null references event_spaces on delete restrict,
  layout_id uuid references event_layouts on delete set null,

  title      text not null check (length(trim(title)) > 0),
  event_type text not null default 'conference' check (event_type in (
               'conference', 'residential_conference', 'corporate_meeting', 'training',
               'wedding', 'reception', 'banquet', 'birthday', 'exhibition', 'other')),

  -- Who the event is for. A guest, a company, or a walk-in contact.
  guest_id      uuid references guests on delete set null,
  company_id    uuid references companies on delete set null,
  contact_name  text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  -- What was agreed about paying: "50% on signing, balance seven days before".
  -- Defaulted from the company's standard terms where there is a company, and
  -- printed on the quotation and the contract.
  payment_terms text not null default '',
  -- Set when the function belongs to a stay, as a residential conference
  -- does; it is what makes posting the event to the guest's folio possible.
  booking_id    uuid references bookings on delete set null,

  event_date  date not null,
  start_time  time not null,
  end_time    time not null,
  -- When the hall is actually held, defaulted from the space's own setup and
  -- teardown allowances when the event is created.
  setup_from  time not null,
  teardown_to time not null,

  -- Expected is what the enquiry said; guaranteed is what the client has
  -- committed to pay for; actual is what turned up on the day.
  pax_expected   int not null check (pax_expected > 0),
  pax_guaranteed int not null default 0 check (pax_guaranteed >= 0),
  pax_actual     int check (pax_actual is null or pax_actual >= 0),

  -- Catering: one per-head package, plus any extras as lines.
  package_id uuid references event_packages on delete set null,
  menu_notes text not null default '',

  -- Hall rental. 'custom' uses rental_override; 'waived' charges nothing.
  rental_basis    text not null default 'full_day'
                  check (rental_basis in ('full_day', 'half_day', 'hourly', 'custom', 'waived')),
  rental_hours    numeric(5,2) not null default 0 check (rental_hours >= 0),
  rental_override numeric(12,2) check (rental_override is null or rental_override >= 0),

  -- A single discount, applied across every band so the taxable value on the
  -- invoice falls with it. Kept as a percentage because that is how a banquet
  -- discount is actually negotiated.
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),

  -- Frozen totals, rewritten by event_recalc() whenever anything priced
  -- changes, so the diary and the reports do not re-add every line.
  rental_net    numeric(12,2) not null default 0,
  rental_tax    numeric(12,2) not null default 0,
  catering_net  numeric(12,2) not null default 0,
  catering_tax  numeric(12,2) not null default 0,
  equipment_net numeric(12,2) not null default 0,
  equipment_tax numeric(12,2) not null default 0,
  other_net     numeric(12,2) not null default 0,
  other_tax     numeric(12,2) not null default 0,
  service_net   numeric(12,2) not null default 0,
  service_tax   numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  net_total     numeric(12,2) not null default 0,
  tax_total     numeric(12,2) not null default 0,
  grand_total   numeric(12,2) not null default 0,
  -- The rate-wise split, frozen alongside the totals.
  tax_breakdown jsonb not null default '[]',

  status text not null default 'enquiry'
         check (status in ('enquiry', 'quoted', 'confirmed', 'completed', 'cancelled')),

  -- The quotation and its approval (SOW: above a configured value, a second
  -- person has to approve).
  quoted_at         timestamptz,
  quoted_by         uuid references staff on delete set null,
  approval_required boolean not null default false,
  approved_at       timestamptz,
  approved_by       uuid references staff on delete set null,

  confirmed_at timestamptz,
  confirmed_by uuid references staff on delete set null,
  -- The contract, once the client has signed and returned it.
  contract_signed_on   date,
  contract_signed_name text not null default '',

  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references staff on delete set null,
  cancel_reason text not null default '',

  -- The banquet event order: what the kitchen, the stewards and the
  -- technicians each need to know on the day.
  beo_setup_notes   text not null default '',
  beo_service_notes text not null default '',
  beo_av_notes      text not null default '',
  notes             text not null default '',

  created_by uuid references staff on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_times_ordered check (end_time > start_time),
  constraint event_hold_covers_event check (setup_from <= start_time and teardown_to >= end_time),
  constraint event_has_a_client check (
    guest_id is not null or company_id is not null or length(trim(contact_name)) > 0),
  constraint event_custom_rental_has_amount check (
    rental_basis <> 'custom' or rental_override is not null),
  constraint event_hourly_rental_has_hours check (
    rental_basis <> 'hourly' or rental_hours > 0),
  constraint event_cancel_has_reason check (
    status <> 'cancelled' or length(trim(cancel_reason)) > 0)
);

create index if not exists event_bookings_date_idx    on event_bookings (event_date, start_time);
create index if not exists event_bookings_space_idx   on event_bookings (space_id, event_date);
create index if not exists event_bookings_status_idx  on event_bookings (status, event_date);
create index if not exists event_bookings_company_idx on event_bookings (company_id) where company_id is not null;
create index if not exists event_bookings_guest_idx   on event_bookings (guest_id) where guest_id is not null;
create index if not exists event_bookings_booking_idx on event_bookings (booking_id) where booking_id is not null;

-- Everything on the bill that is not the hall or the per-head catering:
-- equipment hire, food beyond the package, flowers, a band.
create table if not exists event_lines (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references event_bookings on delete cascade,
  kind         text not null default 'other'
               check (kind in ('equipment', 'food_extra', 'decor', 'other')),
  equipment_id uuid references event_equipment on delete set null,
  description  text not null check (length(trim(description)) > 0),
  qty          numeric(10,2) not null default 1 check (qty > 0),
  unit_price   numeric(12,2) not null default 0 check (unit_price >= 0),
  tax_rate     numeric(5,2) not null default 18 check (tax_rate between 0 and 100),
  -- Frozen by the trigger below, so a line always says what it cost.
  net_amount   numeric(12,2) not null default 0,
  tax_amount   numeric(12,2) not null default 0,
  sort_order   int not null default 0,
  created_by   uuid references staff on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists event_lines_event_idx on event_lines (event_id, sort_order, created_at);

create table if not exists event_payments (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references event_bookings on delete cascade,
  -- advance:         the deposit taken to hold the date.
  -- payment:         money received against the event.
  -- refund:          money returned, e.g. a deposit on cancellation.
  -- room_charge:     posted to a resident guest's folio.
  -- company_account: billed to a company on the city ledger.
  kind      text not null check (kind in ('advance', 'payment', 'refund', 'room_charge', 'company_account')),
  amount    numeric(12,2) not null check (amount > 0),
  method    payment_method,
  reference text not null default '',
  notes     text not null default '',
  -- Where a transfer landed, so both sides can always be tied together.
  booking_id            uuid references bookings on delete set null,
  folio_id              uuid references folios on delete set null,
  city_ledger_entry_id  uuid references city_ledger_entries on delete set null,
  voided_at   timestamptz,
  voided_by   uuid references staff on delete set null,
  void_reason text not null default '',
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now(),
  constraint event_payment_has_method check (
    kind in ('room_charge', 'company_account') or method is not null)
);

create index if not exists event_payments_event_idx on event_payments (event_id, created_at);

-- An event may only be transferred to a room or a company once.
create unique index if not exists event_payments_transfer_once_idx
  on event_payments (event_id, kind)
  where kind in ('room_charge', 'company_account') and voided_at is null;

-- These three columns were added after the first cut of this migration. The
-- create statements above carry them for a fresh database; these alters carry
-- them for one where an earlier version of this file has already run.
alter table event_spaces    add column if not exists floor int;
alter table event_equipment add column if not exists space_id uuid references event_spaces on delete set null;
alter table event_bookings  add column if not exists payment_terms text not null default '';

-- ── Billing links into Module 7 ─────────────────────────────────────────────

-- One invoice series for the whole property: an event invoice is a GST
-- invoice from the same run of numbers as a room invoice, which is what the
-- tax law expects. An invoice therefore belongs either to a folio or to an
-- event, never to both and never to neither.
alter table invoices alter column booking_id drop not null;
alter table invoices alter column folio_id   drop not null;
alter table invoices add column if not exists event_id uuid references event_bookings on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_folio_or_event') then
    alter table invoices add constraint invoices_folio_or_event check (
      (folio_id is not null and booking_id is not null and event_id is null)
      or (event_id is not null and folio_id is null and booking_id is null)
    );
  end if;
end;
$$;

create index if not exists invoices_event_idx on invoices (event_id) where event_id is not null;

-- Corporate event debt is ordinary corporate debt: it ages and is chased on
-- the same city ledger as a corporate stay.
alter table city_ledger_entries add column if not exists event_id uuid references event_bookings on delete set null;

-- ── Pricing ─────────────────────────────────────────────────────────────────

-- The head count an event is billed for: the guarantee or the actual number,
-- whichever is higher, falling back to the expected number before either has
-- been set. This is the banquet trade's own rule and it is the whole point of
-- taking a guarantee.
create or replace function event_billable_pax(p_event uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
           when greatest(e.pax_guaranteed, coalesce(e.pax_actual, 0)) > 0
             then greatest(e.pax_guaranteed, coalesce(e.pax_actual, 0))
           else e.pax_expected
         end
    from event_bookings e where e.id = p_event;
$$;

-- The hall rental before discount, from the chosen basis.
create or replace function event_rental_net(p_event uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_e     record;
  v_s     record;
  v_gross numeric(12,2);
begin
  select * into v_e from event_bookings where id = p_event;
  if v_e is null then return 0; end if;
  select * into v_s from event_spaces where id = v_e.space_id;

  v_gross := case v_e.rental_basis
               when 'waived'   then 0
               when 'custom'   then coalesce(v_e.rental_override, 0)
               when 'hourly'   then round(coalesce(v_s.rental_per_hour, 0) * v_e.rental_hours, 2)
               when 'half_day' then coalesce(v_s.rental_half_day, 0)
               else                 coalesce(v_s.rental_full_day, 0)
             end;

  -- The minimum applies to a hall that is actually let, not to a waived one.
  if v_e.rental_basis <> 'waived' then
    v_gross := greatest(v_gross, coalesce(v_s.min_charge, 0));
  end if;

  return v_gross;
end;
$$;

-- The rate-wise split of an event, after discount. This is the single
-- definition used by the quotation, the invoice and the tax summary report,
-- so those three can never disagree about what was taxed at what rate.
create or replace function event_tax_bands(p_event uuid)
returns table (rate numeric, net numeric, tax numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_e       record;
  v_space   record;
  v_pkg     record;
  v_keep    numeric;
  v_rental  numeric(12,2);
  v_cater   numeric(12,2) := 0;
  v_lines   numeric(12,2);
  v_svc_pct numeric(5,2);
  v_svc     numeric(12,2) := 0;
begin
  select * into v_e from event_bookings where id = p_event;
  if v_e is null then return; end if;

  select * into v_space from event_spaces   where id = v_e.space_id;
  select * into v_pkg   from event_packages where id = v_e.package_id;
  select coalesce(event_service_charge_percent, 0) into v_svc_pct from property_settings limit 1;

  v_keep   := 1 - v_e.discount_percent / 100.0;
  v_rental := event_rental_net(p_event);
  if v_pkg.id is not null then
    v_cater := round(v_pkg.price_per_head * event_billable_pax(p_event), 2);
  end if;
  select coalesce(sum(l.net_amount), 0) into v_lines from event_lines l where l.event_id = p_event;

  -- Service charge is taken on what the client actually pays, and is taxed at
  -- the hall's own rate, the way the outlets tax theirs.
  if coalesce(v_svc_pct, 0) > 0 then
    v_svc := round((v_rental + v_cater + v_lines) * v_keep * v_svc_pct / 100.0, 2);
  end if;

  return query
  with parts as (
    select coalesce(v_space.tax_rate, 0) as r, round(v_rental * v_keep, 2) as n
    union all
    select coalesce(v_pkg.tax_rate, 0), round(v_cater * v_keep, 2)
    union all
    select l.tax_rate, round(l.net_amount * v_keep, 2) from event_lines l where l.event_id = p_event
    union all
    select coalesce(v_space.tax_rate, 0), v_svc
  )
  select p.r,
         round(sum(p.n), 2),
         round(sum(p.n) * p.r / 100.0, 2)
    from parts p
   group by p.r
  having sum(p.n) <> 0
   order by p.r;
end;
$$;

-- Rewrites an event's frozen totals. Called whenever anything priced changes.
create or replace function event_recalc(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e       record;
  v_space   record;
  v_pkg     record;
  v_keep    numeric;
  v_rental  numeric(12,2);
  v_cater   numeric(12,2) := 0;
  v_equip   numeric(12,2) := 0;
  v_equip_t numeric(12,2) := 0;
  v_other   numeric(12,2) := 0;
  v_other_t numeric(12,2) := 0;
  v_lines   numeric(12,2);
  v_svc_pct numeric(5,2);
  v_svc     numeric(12,2) := 0;
  v_bands   jsonb;
  v_net     numeric(12,2);
  v_tax     numeric(12,2);
begin
  select * into v_e from event_bookings where id = p_event;
  if v_e is null then return; end if;

  select * into v_space from event_spaces   where id = v_e.space_id;
  select * into v_pkg   from event_packages where id = v_e.package_id;
  select coalesce(event_service_charge_percent, 0) into v_svc_pct from property_settings limit 1;

  v_keep   := 1 - v_e.discount_percent / 100.0;
  v_rental := event_rental_net(p_event);
  if v_pkg.id is not null then
    v_cater := round(v_pkg.price_per_head * event_billable_pax(p_event), 2);
  end if;

  select coalesce(sum(case when l.kind = 'equipment' then l.net_amount else 0 end), 0),
         coalesce(sum(case when l.kind = 'equipment' then l.tax_amount else 0 end), 0),
         coalesce(sum(case when l.kind <> 'equipment' then l.net_amount else 0 end), 0),
         coalesce(sum(case when l.kind <> 'equipment' then l.tax_amount else 0 end), 0),
         coalesce(sum(l.net_amount), 0)
    into v_equip, v_equip_t, v_other, v_other_t, v_lines
    from event_lines l where l.event_id = p_event;

  if coalesce(v_svc_pct, 0) > 0 then
    v_svc := round((v_rental + v_cater + v_lines) * v_keep * v_svc_pct / 100.0, 2);
  end if;

  -- The totals come from the bands, so the summary can never disagree with
  -- the rate-wise split printed on the invoice.
  select coalesce(jsonb_agg(jsonb_build_object('rate', b.rate, 'net', b.net, 'tax', b.tax) order by b.rate), '[]'),
         coalesce(sum(b.net), 0),
         coalesce(sum(b.tax), 0)
    into v_bands, v_net, v_tax
    from event_tax_bands(p_event) b;

  update event_bookings set
    rental_net      = round(v_rental * v_keep, 2),
    rental_tax      = round(v_rental * v_keep * coalesce(v_space.tax_rate, 0) / 100.0, 2),
    catering_net    = round(v_cater * v_keep, 2),
    catering_tax    = round(v_cater * v_keep * coalesce(v_pkg.tax_rate, 0) / 100.0, 2),
    equipment_net   = round(v_equip * v_keep, 2),
    equipment_tax   = round(v_equip_t * v_keep, 2),
    other_net       = round(v_other * v_keep, 2),
    other_tax       = round(v_other_t * v_keep, 2),
    service_net     = v_svc,
    service_tax     = round(v_svc * coalesce(v_space.tax_rate, 0) / 100.0, 2),
    discount_amount = round((v_rental + v_cater + v_lines) * v_e.discount_percent / 100.0, 2),
    net_total       = v_net,
    tax_total       = v_tax,
    grand_total     = round(v_net + v_tax, 2),
    tax_breakdown   = v_bands,
    updated_at      = now()
  where id = p_event;
end;
$$;

-- A line always carries its own frozen value.
create or replace function event_lines_freeze()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.net_amount := round(new.qty * new.unit_price, 2);
  new.tax_amount := round(new.net_amount * new.tax_rate / 100.0, 2);
  return new;
end;
$$;

drop trigger if exists event_lines_freeze on event_lines;
create trigger event_lines_freeze before insert or update on event_lines
  for each row execute function event_lines_freeze();

create or replace function event_lines_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform event_recalc(coalesce(new.event_id, old.event_id));
  return null;
end;
$$;

drop trigger if exists event_lines_recalc on event_lines;
create trigger event_lines_recalc after insert or update or delete on event_lines
  for each row execute function event_lines_recalc();

-- Changing the package, the head count, the rental or the discount reprices
-- the event, so the desk never has to remember to.
create or replace function event_bookings_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform event_recalc(new.id);
  return null;
end;
$$;

drop trigger if exists event_bookings_recalc on event_bookings;
create trigger event_bookings_recalc after insert or update of
    package_id, pax_expected, pax_guaranteed, pax_actual, discount_percent,
    rental_basis, rental_hours, rental_override, space_id
  on event_bookings
  for each row execute function event_bookings_recalc();

-- What is still owed on an event.
create or replace function event_balance(p_event uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(
    coalesce((select e.grand_total from event_bookings e where e.id = p_event), 0)
    - coalesce((select sum(case when p.kind = 'refund' then -p.amount else p.amount end)
                  from event_payments p
                 where p.event_id = p_event and p.voided_at is null), 0), 2);
$$;

-- ── An event that has been billed is priced ─────────────────────────────────

-- Once an event has been invoiced, posted to a folio or charged to a company,
-- the money has left the building: a bill has been given to somebody. From
-- that moment its price may not change, for the same reason an issued invoice
-- may not be edited. Cancel the bill first if something really was wrong.
create or replace function event_is_billed(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from invoices where event_id = p_event and status = 'issued')
      or exists (select 1 from event_payments
                  where event_id = p_event and voided_at is null
                    and kind in ('room_charge', 'company_account'));
$$;

create or replace function event_priced_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- event_recalc() writes only the frozen totals, which is not a repricing.
  if new.space_id         is distinct from old.space_id
     or new.package_id       is distinct from old.package_id
     or new.pax_expected     is distinct from old.pax_expected
     or new.pax_guaranteed   is distinct from old.pax_guaranteed
     or new.pax_actual       is distinct from old.pax_actual
     or new.discount_percent is distinct from old.discount_percent
     or new.rental_basis     is distinct from old.rental_basis
     or new.rental_hours     is distinct from old.rental_hours
     or new.rental_override  is distinct from old.rental_override
  then
    if event_is_billed(new.id) then
      raise exception 'EVENT_ALREADY_BILLED'
        using hint = 'This event has already been billed, so its price cannot change. Cancel the bill first.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists event_priced_immutable on event_bookings;
create trigger event_priced_immutable before update on event_bookings
  for each row execute function event_priced_immutable();

create or replace function event_lines_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if event_is_billed(coalesce(new.event_id, old.event_id)) then
    raise exception 'EVENT_ALREADY_BILLED'
      using hint = 'This event has already been billed, so its charges cannot change. Cancel the bill first.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists event_lines_immutable on event_lines;
create trigger event_lines_immutable before insert or update or delete on event_lines
  for each row execute function event_lines_immutable();

-- ── The hall may not be promised twice ──────────────────────────────────────

-- Only a confirmed or completed event holds the hall. Enquiries and
-- quotations for the same date are ordinary business — the hotel quotes
-- several and wins one — so they are allowed to overlap, and the diary shows
-- them together with a warning rather than refusing them.
create or replace function enforce_event_space_availability()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_holding constant text[] := array['confirmed', 'completed'];
  v_clash   record;
begin
  if not (new.status = any (v_holding)) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = any (v_holding)
     and new.space_id  = old.space_id
     and new.event_date = old.event_date
     and new.setup_from = old.setup_from
     and new.teardown_to = old.teardown_to then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_space:' || new.space_id::text || ':' || new.event_date::text, 0));

  select e.number, e.title, e.setup_from, e.teardown_to
    into v_clash
    from event_bookings e
   where e.space_id = new.space_id
     and e.event_date = new.event_date
     and e.id <> new.id
     and e.status = any (v_holding)
     and e.setup_from < new.teardown_to
     and e.teardown_to > new.setup_from
   limit 1;

  if v_clash is not null then
    raise exception 'EVENT_SPACE_CLASH: % (%) already holds it from % to %',
      v_clash.number, v_clash.title,
      to_char(v_clash.setup_from, 'HH24:MI'), to_char(v_clash.teardown_to, 'HH24:MI')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists event_space_availability on event_bookings;
create trigger event_space_availability before insert or update on event_bookings
  for each row execute function enforce_event_space_availability();

-- ── Quotation, approval and confirmation ────────────────────────────────────

-- Prepares the quotation. Whether it needs a second person's approval is
-- decided here, from the total and the property's threshold, and frozen onto
-- the event — so raising the threshold later cannot retrospectively approve a
-- quotation that was already sent for approval.
create or replace function event_submit_quote(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e         record;
  v_threshold numeric(12,2);
  v_staff     uuid := auth.uid();
begin
  if not has_permission('events.quote') then
    raise exception 'not permitted';
  end if;

  perform event_recalc(p_event);
  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status not in ('enquiry', 'quoted') then
    raise exception 'EVENT_ALREADY_CONFIRMED'
      using hint = 'This event is past the quotation stage. Change the quotation on a new event, or cancel this one.';
  end if;
  if v_e.grand_total <= 0 then
    raise exception 'EVENT_NOTHING_QUOTED'
      using hint = 'Price the hall, catering or equipment before sending a quotation.';
  end if;

  select coalesce(event_quote_approval_threshold, 0) into v_threshold from property_settings limit 1;

  update event_bookings set
    status            = 'quoted',
    quoted_at         = now(),
    quoted_by         = v_staff,
    approval_required = v_e.grand_total >= coalesce(v_threshold, 0),
    -- A repriced quotation has to be approved again.
    approved_at       = null,
    approved_by       = null,
    updated_at        = now()
  where id = p_event;
end;
$$;

-- Approves a quotation. Whoever prepared it may not approve it, which is the
-- same rule the refund workflow uses and the reason the workflow exists.
create or replace function event_approve_quote(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e     record;
  v_staff uuid := auth.uid();
begin
  if not has_permission('events.approve') then
    raise exception 'not permitted';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status <> 'quoted' then
    raise exception 'EVENT_NOT_QUOTED' using hint = 'Send the quotation before approving it.';
  end if;
  if not v_e.approval_required then
    raise exception 'EVENT_NO_APPROVAL_NEEDED'
      using hint = 'This quotation is below the approval threshold and may be confirmed as it stands.';
  end if;
  if v_e.approved_at is not null then
    raise exception 'EVENT_ALREADY_APPROVED' using hint = 'This quotation is already approved.';
  end if;
  if v_e.quoted_by is not null and v_e.quoted_by = v_staff then
    raise exception 'EVENT_SELF_APPROVAL'
      using hint = 'A quotation must be approved by someone other than the person who prepared it.';
  end if;

  update event_bookings
     set approved_at = now(), approved_by = v_staff, updated_at = now()
   where id = p_event;
end;
$$;

-- Confirms the event, which is the moment the hall is actually held.
create or replace function event_confirm(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e     record;
  v_staff uuid := auth.uid();
begin
  if not has_permission('events.book') then
    raise exception 'not permitted';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status = 'confirmed' then
    raise exception 'EVENT_ALREADY_CONFIRMED' using hint = 'This event is already confirmed.';
  end if;
  if v_e.status <> 'quoted' then
    raise exception 'EVENT_NOT_QUOTED'
      using hint = 'Send a quotation before confirming, so there is a price both sides have agreed.';
  end if;
  if v_e.approval_required and v_e.approved_at is null then
    raise exception 'EVENT_NEEDS_APPROVAL'
      using hint = 'This quotation is above the approval threshold and needs approval before the date can be held.';
  end if;

  -- The availability trigger fires on this update and is what refuses a
  -- second confirmed event in the same hall at the same time.
  update event_bookings
     set status = 'confirmed', confirmed_at = now(), confirmed_by = v_staff, updated_at = now()
   where id = p_event;
end;
$$;

create or replace function event_cancel(p_event uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e record;
begin
  if not (has_permission('events.book') or has_permission('events.manage')) then
    raise exception 'not permitted';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'EVENT_CANCEL_REASON' using hint = 'Give a reason for cancelling.';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status = 'cancelled' then
    raise exception 'EVENT_ALREADY_CANCELLED' using hint = 'This event is already cancelled.';
  end if;
  if exists (select 1 from invoices where event_id = p_event and status = 'issued') then
    raise exception 'EVENT_INVOICED'
      using hint = 'This event has been invoiced. Cancel the invoice before cancelling the event.';
  end if;

  update event_bookings set
    status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = trim(p_reason), updated_at = now()
  where id = p_event;
end;
$$;

-- Closes the event after it has happened, at which point the actual head
-- count is what it is billed on if it exceeded the guarantee.
create or replace function event_complete(p_event uuid, p_pax_actual int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e record;
begin
  if not (has_permission('events.book') or has_permission('events.manage')) then
    raise exception 'not permitted';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status <> 'confirmed' then
    raise exception 'EVENT_NOT_CONFIRMED'
      using hint = 'Only a confirmed event can be closed off.';
  end if;
  if p_pax_actual is null or p_pax_actual < 0 then
    raise exception 'EVENT_PAX_INVALID' using hint = 'Enter how many people actually attended.';
  end if;
  if event_is_billed(p_event) then
    raise exception 'EVENT_ALREADY_BILLED'
      using hint = 'This event has already been billed, so the head count can no longer change. Cancel the bill first.';
  end if;

  update event_bookings set
    status = 'completed', pax_actual = p_pax_actual, completed_at = now(), updated_at = now()
  where id = p_event;

  perform event_recalc(p_event);
end;
$$;

-- ── Taking money and billing ────────────────────────────────────────────────

create or replace function event_take_payment(
  p_event uuid, p_kind text, p_method payment_method, p_amount numeric,
  p_reference text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_owing numeric(12,2);
  v_id    uuid;
begin
  if not has_permission('events.bill') then
    raise exception 'not permitted';
  end if;
  if p_kind not in ('advance', 'payment', 'refund') then
    raise exception 'EVENT_PAYMENT_KIND' using hint = 'Choose a deposit, a payment or a refund.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'EVENT_PAYMENT_AMOUNT' using hint = 'Enter an amount greater than zero.';
  end if;
  if not exists (select 1 from event_bookings where id = p_event) then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if exists (select 1 from event_bookings where id = p_event and status = 'cancelled')
     and p_kind <> 'refund' then
    raise exception 'EVENT_CANCELLED'
      using hint = 'This event is cancelled. Only a refund can be recorded against it.';
  end if;

  if p_kind <> 'refund' then
    v_owing := event_balance(p_event);
    if p_amount > v_owing then
      raise exception 'EVENT_OVERPAYMENT: % is owed but % was entered', v_owing, p_amount;
    end if;
  end if;

  insert into event_payments (event_id, kind, amount, method, reference, notes, created_by)
  values (p_event, p_kind, round(p_amount, 2), p_method, coalesce(p_reference, ''), coalesce(p_notes, ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Posts an event onto a resident guest's folio — how a residential conference
-- is billed, on one bill with the rooms. One folio entry per tax rate, because
-- a folio entry carries a single rate and a GST invoice has to show what was
-- charged at each.
create or replace function event_post_to_folio(p_event uuid, p_booking uuid, p_folio uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_e       record;
  v_booking record;
  v_folio   uuid := p_folio;
  v_company uuid;
  v_owing   numeric(12,2);
  v_band    record;
  v_label   text;
  v_payment uuid;
  v_staff   uuid := auth.uid();
begin
  if not has_permission('events.bill') then
    raise exception 'not permitted';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status not in ('confirmed', 'completed') then
    raise exception 'EVENT_NOT_CONFIRMED'
      using hint = 'Confirm the event before billing it.';
  end if;
  if exists (select 1 from invoices where event_id = p_event and status = 'issued') then
    raise exception 'EVENT_INVOICED'
      using hint = 'This event already has its own invoice. Cancel it before billing the event to a room.';
  end if;

  v_owing := event_balance(p_event);
  if v_owing <= 0 then
    raise exception 'EVENT_NOTHING_OWED' using hint = 'This event is already settled.';
  end if;

  select b.*, g.full_name as guest_full_name
    into v_booking
    from bookings b left join guests g on g.id = b.guest_id
   where b.id = p_booking;
  if v_booking is null then
    raise exception 'EVENT_NO_BOOKING' using hint = 'Choose the stay to bill this event to.';
  end if;
  if v_booking.status not in ('checked_in', 'checked_out') then
    raise exception 'EVENT_BOOKING_NOT_RESIDENT'
      using hint = 'An event can only be billed to a stay the guest has actually checked into.';
  end if;

  if v_folio is null then
    v_folio := master_folio(p_booking);
  end if;
  if not exists (select 1 from folios where id = v_folio and booking_id = p_booking) then
    raise exception 'FOLIO_BOOKING_MISMATCH' using hint = 'That folio belongs to a different booking.';
  end if;

  -- A folio billed to a company is the company's debt, so its limit applies.
  select company_id into v_company from folios where id = v_folio;
  if v_company is not null then
    if exists (
      select 1 from companies
       where id = v_company and credit_limit is not null
         and company_balance(v_company) + v_owing > credit_limit
    ) then
      raise exception 'CITY_LEDGER_CREDIT_LIMIT: this event of % would take the company past its credit limit',
        v_owing;
    end if;
  end if;

  v_label := v_e.title || ' — ' || v_e.number;

  for v_band in select * from event_tax_bands(p_event) loop
    insert into folio_entries (booking_id, folio_id, kind, description, stay_date,
                               amount, tax_amount, tax_rate, reference, created_by)
    values (p_booking, v_folio, 'extra', v_label, v_e.event_date,
            v_band.net, v_band.tax, v_band.rate, v_e.number, v_staff);
  end loop;

  -- Anything already paid directly to the event is credited back on the folio,
  -- so the guest is not asked for it twice.
  if v_e.grand_total - v_owing > 0 then
    insert into folio_entries (booking_id, folio_id, kind, description, stay_date,
                               amount, tax_amount, tax_rate, reference, created_by)
    values (p_booking, v_folio, 'adjustment', v_label || ' — deposit already paid', v_e.event_date,
            round(v_e.grand_total - v_owing, 2), 0, 0, v_e.number, v_staff);
  end if;

  insert into event_payments (event_id, kind, amount, booking_id, folio_id, reference, created_by)
  values (p_event, 'room_charge', v_owing, p_booking, v_folio, coalesce(v_booking.reference, ''), v_staff)
  returning id into v_payment;

  update event_bookings
     set booking_id = coalesce(booking_id, p_booking), updated_at = now()
   where id = p_event;

  return v_payment;
end;
$$;

-- Bills an event to a company on the city ledger — how corporate conference
-- business is actually settled, thirty days after the invoice. The charge
-- ages and is chased with every other corporate debt.
create or replace function event_to_city_ledger(p_event uuid, p_company uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_e       record;
  v_company uuid;
  v_co      record;
  v_owing   numeric(12,2);
  v_entry   uuid;
  v_staff   uuid := auth.uid();
begin
  if not (has_permission('events.bill') and has_permission('folio.city_ledger')) then
    raise exception 'not permitted';
  end if;

  select * into v_e from event_bookings where id = p_event;
  if v_e is null then
    raise exception 'EVENT_NOT_FOUND' using hint = 'That event no longer exists.';
  end if;
  if v_e.status not in ('confirmed', 'completed') then
    raise exception 'EVENT_NOT_CONFIRMED' using hint = 'Confirm the event before billing it.';
  end if;

  v_company := coalesce(p_company, v_e.company_id);
  if v_company is null then
    raise exception 'CITY_LEDGER_NO_COMPANY' using hint = 'Choose a company to bill.';
  end if;

  select * into v_co from companies where id = v_company;
  if v_co is null then
    raise exception 'CITY_LEDGER_NO_COMPANY' using hint = 'Choose a company to bill.';
  end if;
  if not v_co.is_active then
    raise exception 'CITY_LEDGER_INACTIVE'
      using hint = 'That company account is closed. Reactivate it under Companies first.';
  end if;

  v_owing := event_balance(p_event);
  if v_owing <= 0 then
    raise exception 'EVENT_NOTHING_OWED' using hint = 'This event is already settled.';
  end if;

  if v_co.credit_limit is not null and company_balance(v_company) + v_owing > v_co.credit_limit then
    raise exception 'CITY_LEDGER_CREDIT_LIMIT: this event of % would take % past its credit limit',
      v_owing, v_co.name;
  end if;

  insert into city_ledger_entries (company_id, kind, amount, description, event_id, due_date, created_by)
  values (v_company, 'charge', v_owing,
          v_e.title || ' — ' || v_e.number || ' on ' || to_char(v_e.event_date, 'DD Mon YYYY'),
          p_event, current_date + coalesce(v_co.payment_terms_days, 30), v_staff)
  returning id into v_entry;

  insert into event_payments (event_id, kind, amount, city_ledger_entry_id, reference, created_by)
  values (p_event, 'company_account', v_owing, v_entry, v_co.name, v_staff);

  update event_bookings
     set company_id = coalesce(company_id, v_company), updated_at = now()
   where id = p_event;

  return v_entry;
end;
$$;

-- ── Reporting ───────────────────────────────────────────────────────────────

-- Event revenue by type of function (SOW Module 13 reporting, Module 10
-- billing). Room revenue reports are unaffected: an event is not a room night
-- and mixing the two would spoil ADR and RevPAR.
create or replace function report_events(p_from date, p_to date)
returns table (
  event_type text,
  events     int,
  pax        int,
  rental     numeric,
  catering   numeric,
  equipment  numeric,
  other      numeric,
  service    numeric,
  tax        numeric,
  total      numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select e.event_type,
         count(*)::int,
         sum(event_billable_pax(e.id))::int,
         sum(e.rental_net),
         sum(e.catering_net),
         sum(e.equipment_net),
         sum(e.other_net),
         sum(e.service_net),
         sum(e.tax_total),
         sum(e.grand_total)
    from event_bookings e
   where e.status in ('confirmed', 'completed')
     and e.event_date between p_from and p_to
   group by e.event_type
   order by sum(e.grand_total) desc;
end;
$$;

-- The GST return has to include event tax. An event billed onto a folio is
-- already counted there, so only events that carry their own bill are added.
create or replace function report_tax_summary(p_from date, p_to date)
returns table (rate numeric, net numeric, tax numeric, entries int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  with folio as (
    select f.tax_rate as rate, f.amount as net, f.tax_amount as tax
      from folio_entries f
     where f.voided_at is null
       and f.kind in ('room', 'fee', 'extra', 'penalty')
       and coalesce(f.stay_date, local_day(f.created_at)) between p_from and p_to
  ),
  events as (
    select (b ->> 'rate')::numeric as rate,
           (b ->> 'net')::numeric  as net,
           (b ->> 'tax')::numeric  as tax
      from event_bookings e
      cross join lateral jsonb_array_elements(e.tax_breakdown) b
     where e.status in ('confirmed', 'completed')
       and e.event_date between p_from and p_to
       and not exists (
         select 1 from event_payments p
          where p.event_id = e.id and p.kind = 'room_charge' and p.voided_at is null)
  ),
  all_rows as (select * from folio union all select * from events)
  select r.rate, sum(r.net), sum(r.tax), count(*)::int
    from all_rows r
   group by r.rate
   order by r.rate;
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table event_spaces    enable row level security;
alter table event_layouts   enable row level security;
alter table event_packages  enable row level security;
alter table event_equipment enable row level security;
alter table event_bookings  enable row level security;
alter table event_lines     enable row level security;
alter table event_payments  enable row level security;
alter table event_series    enable row level security;

-- The hall, its layouts, the packages and the equipment list are readable by
-- any member of staff: the front desk is asked about them all day.
do $$
declare
  t text;
begin
  foreach t in array array['event_spaces', 'event_layouts', 'event_packages', 'event_equipment']
  loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_staff())', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for all using (has_permission(''events.manage'')) with check (has_permission(''events.manage''))',
      t || '_write', t);
  end loop;
end;
$$;

drop policy if exists event_bookings_select on event_bookings;
drop policy if exists event_bookings_write  on event_bookings;
create policy event_bookings_select on event_bookings for select
  using (has_permission('events.view') or has_permission('folio.view'));
create policy event_bookings_write on event_bookings for all
  using (has_permission('events.book') or has_permission('events.manage'))
  with check (has_permission('events.book') or has_permission('events.manage'));

drop policy if exists event_lines_select on event_lines;
drop policy if exists event_lines_write  on event_lines;
create policy event_lines_select on event_lines for select
  using (has_permission('events.view') or has_permission('folio.view'));
create policy event_lines_write on event_lines for all
  using (has_permission('events.book') or has_permission('events.manage'))
  with check (has_permission('events.book') or has_permission('events.manage'));

drop policy if exists event_payments_select on event_payments;
drop policy if exists event_payments_write  on event_payments;
create policy event_payments_select on event_payments for select
  using (has_permission('events.view') or has_permission('folio.view'));
create policy event_payments_write on event_payments for all
  using (has_permission('events.bill')) with check (has_permission('events.bill'));

-- Counters move only through next_event_number(), which is definer.
drop policy if exists event_series_select on event_series;
create policy event_series_select on event_series for select using (has_permission('events.view'));

-- ── Audit ───────────────────────────────────────────────────────────────────

do $$
declare
  t record;
begin
  for t in select * from (values
    ('event_spaces', 'events'), ('event_layouts', 'events'), ('event_packages', 'events'),
    ('event_equipment', 'events'), ('event_bookings', 'events'), ('event_lines', 'events'),
    ('event_payments', 'events')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
