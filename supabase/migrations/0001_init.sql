-- ============================================================================
-- Hotel Shamiyana — admin panel schema
-- Run this in the Supabase SQL editor (or `supabase db push`) on a new project.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
create type staff_role      as enum ('admin', 'front_desk');
create type booking_status  as enum ('new', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
create type booking_source  as enum ('website', 'phone', 'walk_in', 'email', 'ota');
create type room_status     as enum ('available', 'occupied', 'maintenance', 'out_of_service');

-- ── Staff (mirrors auth.users) ──────────────────────────────────────────────
create table staff (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        staff_role not null default 'front_desk',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Every new auth user gets a staff row. The very first one becomes admin so
-- the project is never locked out; everyone after defaults to front desk.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.staff (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when (select count(*) from public.staff) = 0 then 'admin'::staff_role
         else 'front_desk'::staff_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helpers used by the policies below.
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and is_active);
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and is_active and role = 'admin');
$$;

-- ── Rates: room types shown on the public site ──────────────────────────────
create table room_types (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  category     text not null,
  tagline      text not null default '',
  description  text not null default '',
  size         text not null default '',
  occupancy    text not null default '',
  view         text not null default '',
  base_rate    numeric(10,2) not null check (base_rate >= 0),
  image        text not null default '',
  highlights   text[] not null default '{}',
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now()
);

-- Extra occupant / child / buffet charges from the published tariff.
create table extra_charges (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  amount      numeric(10,2) not null check (amount >= 0),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ── Inventory ───────────────────────────────────────────────────────────────
create table rooms (
  id            uuid primary key default gen_random_uuid(),
  room_number   text not null unique,
  room_type_id  uuid not null references room_types on delete restrict,
  floor         int,
  status        room_status not null default 'available',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ── CRM ─────────────────────────────────────────────────────────────────────
create table guests (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text,
  phone       text,
  address     text not null default '',
  city        text not null default '',
  country     text not null default 'India',
  tags        text[] not null default '{}',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index guests_name_idx  on guests using gin (to_tsvector('simple', full_name));
create index guests_email_idx on guests (lower(email));
create index guests_phone_idx on guests (phone);

-- ── Bookings ────────────────────────────────────────────────────────────────
create sequence booking_reference_seq start 1001;

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique default ('SR-' || nextval('booking_reference_seq')),
  guest_id         uuid references guests on delete set null,
  room_type_id     uuid references room_types on delete set null,
  room_id          uuid references rooms on delete set null,
  check_in         date not null,
  check_out        date not null,
  adults           int  not null default 2 check (adults  >= 1),
  children         int  not null default 0 check (children >= 0),
  rooms_count      int  not null default 1 check (rooms_count >= 1),
  status           booking_status  not null default 'new',
  source           booking_source  not null default 'website',
  promo_code       text not null default '',
  quoted_rate      numeric(10,2),
  total_amount     numeric(10,2),
  special_requests text not null default '',
  -- Denormalised contact details: a website enquiry arrives before we know
  -- whether this person already exists as a guest.
  contact_name     text not null default '',
  contact_email    text not null default '',
  contact_phone    text not null default '',
  created_by       uuid references staff on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint checkout_after_checkin check (check_out > check_in)
);

create index bookings_status_idx   on bookings (status);
create index bookings_checkin_idx  on bookings (check_in);
create index bookings_guest_idx    on bookings (guest_id);
create index bookings_dates_idx    on bookings (check_in, check_out);

-- Internal note timeline on a booking.
create table booking_notes (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings on delete cascade,
  author_id   uuid references staff on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index booking_notes_booking_idx on booking_notes (booking_id, created_at desc);

-- Keep updated_at honest.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bookings_touch    before update on bookings    for each row execute function touch_updated_at();
create trigger guests_touch      before update on guests      for each row execute function touch_updated_at();
create trigger room_types_touch  before update on room_types  for each row execute function touch_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
-- Nothing is readable by the anon key except active room types and charges,
-- which the public site needs to render its tariff.
alter table staff         enable row level security;
alter table room_types    enable row level security;
alter table extra_charges enable row level security;
alter table rooms         enable row level security;
alter table guests        enable row level security;
alter table bookings      enable row level security;
alter table booking_notes enable row level security;

-- Staff directory: everyone signed in can read it; only admins can change it.
create policy staff_select on staff for select using (is_staff());
create policy staff_update on staff for update using (is_admin()) with check (is_admin());
create policy staff_delete on staff for delete using (is_admin());

-- Public read of the tariff.
create policy room_types_public_read    on room_types    for select using (is_active or is_staff());
create policy extra_charges_public_read on extra_charges for select using (is_active or is_staff());

-- Only admins edit rates.
create policy room_types_write    on room_types    for all using (is_admin()) with check (is_admin());
create policy extra_charges_write on extra_charges for all using (is_admin()) with check (is_admin());

-- Inventory, guests, bookings and notes: any active staff member.
create policy rooms_all         on rooms         for all using (is_staff()) with check (is_staff());
create policy guests_all        on guests        for all using (is_staff()) with check (is_staff());
create policy bookings_all      on bookings      for all using (is_staff()) with check (is_staff());
create policy booking_notes_all on booking_notes for all using (is_staff()) with check (is_staff());

-- Website booking requests are inserted server-side with the service role key,
-- which bypasses RLS. The anon key deliberately cannot write bookings.

-- ── Seed: the hotel's published tariff ──────────────────────────────────────
insert into room_types (slug, name, category, tagline, description, size, occupancy, view, base_rate, image, highlights, sort_order) values
(
  'premier-room', 'Premier Room', 'premier',
  'Comfortable Kashmiri Elegance for the Discerning Traveller',
  'Our Premier Rooms offer warm, tastefully furnished spaces with modern amenities including LED TV, Mini Bar, Tea & Coffee Maker, Air Conditioning / Centralised Heating, and Electronic Locks — ideal for leisure and corporate travellers alike.',
  '300–350 sq. ft.', 'Up to 2 Guests', 'River & City View',
  9499, '/gallery/11.jpg',
  array['Plush King-Size Bed','LED TV & High-Speed Wi-Fi','Tea & Coffee Maker','Electronic Lock & Mini Bar'],
  1
),
(
  'luxury-room', 'Luxury Room', 'luxury',
  'Elevated Comfort with Panoramic Jhelum River Views',
  'Wake up to sweeping views of the historic Jhelum River from our Luxury Rooms. Featuring generous living space, bespoke Kashmiri woodwork, premium toiletries, and all modern conveniences for an unforgettable valley stay.',
  '400–550 sq. ft.', 'Up to 3 Guests', 'Panoramic River View',
  10799, '/gallery/12.jpg',
  array['River-Facing Windows','Spacious Lounge Seating','Premium Herbal Toiletries','24/7 In-Room Dining'],
  2
);

insert into extra_charges (label, amount, sort_order) values
  ('Extra Occupant (Above 10 Years)', 2200, 1),
  ('Child Without Bed',               1500, 2),
  ('Buffet Lunch / Dinner (per person)', 1470, 3),
  ('Meal – Child (Age 5–10 Years)',    750, 4);
