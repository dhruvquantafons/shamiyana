-- ============================================================================
-- Module 1 — Reservation & Booking Engine
--
--   • Statuses per the SOW: Tentative, Confirmed, Checked-In, Checked-Out,
--     Cancelled, No-Show, Waitlisted. "new" is renamed to "tentative".
--   • Sources: adds Travel Agent, Corporate and Mobile App.
--   • Bookings carry a rate plan, per-night price breakdown, payment method,
--     deposit, hold expiry, cancellation and penalty details.
--   • Group (master) bookings with a rooming list; split bookings; room moves.
--   • A folio ledger for deposits, payments, room charges, fees and penalties
--     — the minimum Module 2's night audit and check-out need. Module 7 builds
--     invoicing on top of it.
--   • Guest identity documents kept apart from the guest record, readable only
--     with guests.view_id.
--   • Overbooking and double-assignment are refused by the database itself,
--     under a lock, so two desks (or the website) cannot both take the last
--     room.
--
-- Run after 0006_rooms_and_rates.sql.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'booking_status' and e.enumlabel = 'new') then
    alter type booking_status rename value 'new' to 'tentative';
  end if;
end;
$$;

-- New enum values cannot be used in the transaction that adds them, so
-- everything below compares status as text.
alter type booking_status add value if not exists 'waitlisted';
alter type booking_source add value if not exists 'travel_agent';
alter type booking_source add value if not exists 'corporate';
alter type booking_source add value if not exists 'mobile_app';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum (
      'cash', 'card', 'upi', 'bank_transfer', 'online_gateway',
      'corporate_billing', 'ota_prepaid', 'wallet', 'other'
    );
  end if;
end;
$$;

alter table bookings alter column status set default 'tentative';

-- ── Guests ──────────────────────────────────────────────────────────────────

alter table guests add column if not exists nationality     text not null default 'Indian';
alter table guests add column if not exists date_of_birth   date;
alter table guests add column if not exists company_id      uuid references companies on delete set null;
alter table guests add column if not exists preferences     text not null default '';

-- Identity documents are regulated data (and Form C for foreign nationals),
-- so they sit in their own table readable only with guests.view_id.
create table if not exists guest_identities (
  guest_id        uuid primary key references guests on delete cascade,
  id_type         text not null check (id_type in ('passport', 'aadhaar', 'driving_licence', 'voter_id', 'pan', 'other')),
  id_number       text not null check (length(trim(id_number)) > 0),
  issuing_country text not null default 'India',
  expiry_date     date,
  visa_number     text not null default '',
  updated_by      uuid references staff on delete set null,
  updated_at      timestamptz not null default now()
);

-- ── Groups ──────────────────────────────────────────────────────────────────

create sequence if not exists booking_group_reference_seq start 101;

create table if not exists booking_groups (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique default ('GR-' || nextval('booking_group_reference_seq')),
  name             text not null check (length(trim(name)) > 0),
  company_id       uuid references companies on delete set null,
  rate_plan_id     uuid references rate_plans on delete set null,
  organiser_name   text not null default '',
  organiser_phone  text not null default '',
  organiser_email  text not null default '',
  check_in         date not null,
  check_out        date not null,
  notes            text not null default '',
  created_by       uuid references staff on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint group_dates check (check_out > check_in)
);

-- ── Bookings ────────────────────────────────────────────────────────────────

alter table bookings add column if not exists rate_plan_id      uuid references rate_plans on delete set null;
alter table bookings add column if not exists company_id        uuid references companies on delete set null;
alter table bookings add column if not exists group_id          uuid references booking_groups on delete set null;
alter table bookings add column if not exists split_from_id     uuid references bookings on delete set null;
alter table bookings add column if not exists payment_method    payment_method;
-- [{"date": "2026-10-01", "rate": 9499}, …] — the price agreed per night, per room.
alter table bookings add column if not exists rate_breakdown    jsonb not null default '[]';
alter table bookings add column if not exists deposit_required  numeric(10,2) not null default 0 check (deposit_required >= 0);
alter table bookings add column if not exists hold_until        timestamptz;
alter table bookings add column if not exists preferred_floor   int;
alter table bookings add column if not exists preferred_view    text not null default '';
alter table bookings add column if not exists is_vip            boolean not null default false;
alter table bookings add column if not exists eta               time;
alter table bookings add column if not exists cancelled_at      timestamptz;
alter table bookings add column if not exists cancelled_by      uuid references staff on delete set null;
alter table bookings add column if not exists cancellation_reason text not null default '';
alter table bookings add column if not exists penalty_amount    numeric(10,2) check (penalty_amount >= 0);
alter table bookings add column if not exists penalty_waived    boolean not null default false;
-- Set when a manager deliberately sells beyond capacity.
alter table bookings add column if not exists overbook_reason   text not null default '';
alter table bookings add column if not exists overbooked_by     uuid references staff on delete set null;
alter table bookings add column if not exists confirmation_sent_at timestamptz;
alter table bookings add column if not exists checked_in_at     timestamptz;
alter table bookings add column if not exists checked_in_by     uuid references staff on delete set null;
alter table bookings add column if not exists checked_out_at    timestamptz;
alter table bookings add column if not exists checked_out_by    uuid references staff on delete set null;

create index if not exists bookings_group_idx   on bookings (group_id);
create index if not exists bookings_room_idx    on bookings (room_id, check_in);
create index if not exists bookings_company_idx on bookings (company_id);
create index if not exists bookings_type_dates_idx on bookings (room_type_id, check_in, check_out);

-- Existing bookings priced before rate plans existed: record their flat rate
-- per night so night audit and penalties have something to work from.
update bookings b
   set rate_breakdown = (
     select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'rate', b.quoted_rate) order by d), '[]')
       from generate_series(b.check_in, b.check_out - 1, interval '1 day') d
   )
 where b.rate_breakdown = '[]'::jsonb and b.quoted_rate is not null;

-- ── Room moves ──────────────────────────────────────────────────────────────

create table if not exists room_moves (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings on delete cascade,
  from_room_id  uuid references rooms on delete set null,
  to_room_id    uuid references rooms on delete set null,
  reason        text not null default '',
  moved_by      uuid references staff on delete set null,
  moved_at      timestamptz not null default now()
);

create index if not exists room_moves_booking_idx on room_moves (booking_id, moved_at desc);

-- ── Folio ───────────────────────────────────────────────────────────────────

create table if not exists folio_entries (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings on delete cascade,
  -- Charges: room, fee, penalty, extra. Credits: payment, adjustment.
  -- A refund pays money back out, so it raises the balance again.
  kind              text not null check (kind in ('room', 'fee', 'penalty', 'extra', 'payment', 'refund', 'adjustment')),
  description       text not null default '',
  stay_date         date,
  -- Always positive; kind decides the direction. Charges hold the net
  -- amount and their tax separately.
  amount            numeric(12,2) not null check (amount >= 0),
  tax_amount        numeric(12,2) not null default 0 check (tax_amount >= 0),
  tax_rate          numeric(5,2) not null default 0,
  method            payment_method,
  reference         text not null default '',
  is_deposit        boolean not null default false,
  night_audit_date  date,
  voided_at         timestamptz,
  voided_by         uuid references staff on delete set null,
  void_reason       text not null default '',
  created_by        uuid references staff on delete set null,
  created_at        timestamptz not null default now(),
  constraint payment_has_method check (kind not in ('payment', 'refund') or method is not null)
);

create index if not exists folio_booking_idx on folio_entries (booking_id, created_at);
-- Night audit may be re-run safely: one room charge per booking per night.
create unique index if not exists folio_room_night_idx
  on folio_entries (booking_id, stay_date)
  where kind = 'room' and voided_at is null;

-- Balance owed on a booking: charges and tax, less payments and credits.
create or replace function folio_balance(p_booking uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    case
      when kind in ('room', 'fee', 'penalty', 'extra', 'refund') then amount + tax_amount
      else -amount
    end
  ), 0)
  from folio_entries
  where booking_id = p_booking and voided_at is null;
$$;

-- ── Availability guard ──────────────────────────────────────────────────────

create or replace function enforce_booking_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_occupying constant text[] := array['tentative', 'confirmed', 'checked_in'];
  v_night     date;
  v_capacity  int;
  v_used      int;
  v_inventory int;
  v_clash     text;
begin
  if not (new.status::text = any (v_occupying)) then
    return new;
  end if;

  -- ── A physical room cannot hold two stays at once ──
  if new.room_id is not null and (
       tg_op = 'INSERT'
       or new.room_id is distinct from old.room_id
       or new.check_in <> old.check_in or new.check_out <> old.check_out
       or not (old.status::text = any (v_occupying))
     ) then
    perform pg_advisory_xact_lock(hashtextextended('room:' || new.room_id::text, 0));

    select reference into v_clash
      from bookings
     where room_id = new.room_id
       and id <> new.id
       and status::text = any (v_occupying)
       and check_in < new.check_out
       and check_out > new.check_in
     limit 1;

    if v_clash is not null then
      raise exception 'ROOM_CONFLICT: that room is already assigned to %', v_clash
        using errcode = 'P0001';
    end if;

    if exists (
      select 1 from room_blocks
       where room_id = new.room_id and released_at is null
         and start_date < new.check_out
         and (end_date is null or end_date >= new.check_in)
    ) then
      raise exception 'ROOM_BLOCKED: that room is out of order or out of service for part of the stay'
        using errcode = 'P0001';
    end if;
  end if;

  -- ── The room type must have capacity every night ──
  if new.room_type_id is null then
    return new;
  end if;

  -- Only re-check when the booking asks for more inventory than before.
  if tg_op = 'UPDATE'
     and old.status::text = any (v_occupying)
     and old.room_type_id is not distinct from new.room_type_id
     and old.check_in <= new.check_in
     and old.check_out >= new.check_out
     and old.rooms_count >= new.rooms_count then
    return new;
  end if;

  select count(*) into v_inventory from rooms where room_type_id = new.room_type_id;
  -- Until a type has rooms in inventory there is nothing to count against.
  if v_inventory = 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('room_type:' || new.room_type_id::text, 0));

  for v_night in select generate_series(new.check_in, new.check_out - 1, interval '1 day')::date loop
    v_capacity := room_type_capacity(new.room_type_id, v_night);

    select coalesce(sum(rooms_count), 0) into v_used
      from bookings
     where room_type_id = new.room_type_id
       and id <> new.id
       and status::text = any (v_occupying)
       and check_in <= v_night
       and check_out > v_night;

    if v_used + new.rooms_count > v_capacity then
      -- A manager may knowingly oversell; the reason is kept and audited.
      if length(trim(new.overbook_reason)) > 0 and has_permission('bookings.overbook') then
        new.overbooked_by := auth.uid();
        return new;
      end if;

      raise exception 'OVERBOOKED: % of % room(s) free on %',
        greatest(v_capacity - v_used, 0), v_capacity, v_night
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_inventory on bookings;
create trigger bookings_enforce_inventory
  before insert or update of status, room_id, room_type_id, check_in, check_out, rooms_count, overbook_reason
  on bookings
  for each row execute function enforce_booking_inventory();

-- ── Group creation ──────────────────────────────────────────────────────────

-- Creates the master record and every room booking in one transaction, so a
-- group is never left half-made when the inventory runs out. Runs with the
-- caller's rights: RLS and the inventory guard apply to every row.
create or replace function create_booking_group(p_group jsonb, p_rooms jsonb)
returns uuid
language plpgsql
security invoker set search_path = public
as $$
declare
  v_group uuid;
begin
  insert into booking_groups (name, company_id, rate_plan_id, organiser_name, organiser_phone,
                              organiser_email, check_in, check_out, notes, created_by)
  values (p_group->>'name', nullif(p_group->>'company_id', '')::uuid,
          nullif(p_group->>'rate_plan_id', '')::uuid,
          coalesce(p_group->>'organiser_name', ''), coalesce(p_group->>'organiser_phone', ''),
          coalesce(p_group->>'organiser_email', ''), (p_group->>'check_in')::date,
          (p_group->>'check_out')::date, coalesce(p_group->>'notes', ''), auth.uid())
  returning id into v_group;

  insert into bookings (group_id, company_id, rate_plan_id, room_type_id, check_in, check_out,
                        adults, children, rooms_count, status, source, payment_method,
                        quoted_rate, total_amount, rate_breakdown, deposit_required, hold_until,
                        contact_name, contact_email, contact_phone, overbook_reason, created_by)
  select v_group, nullif(r->>'company_id', '')::uuid, nullif(r->>'rate_plan_id', '')::uuid,
         (r->>'room_type_id')::uuid, (r->>'check_in')::date, (r->>'check_out')::date,
         coalesce((r->>'adults')::int, 2), coalesce((r->>'children')::int, 0), 1,
         (r->>'status')::booking_status, (r->>'source')::booking_source,
         nullif(r->>'payment_method', '')::payment_method,
         (r->>'quoted_rate')::numeric, (r->>'total_amount')::numeric,
         coalesce(r->'rate_breakdown', '[]'::jsonb), coalesce((r->>'deposit_required')::numeric, 0),
         nullif(r->>'hold_until', '')::timestamptz,
         coalesce(r->>'contact_name', ''), coalesce(r->>'contact_email', ''),
         coalesce(r->>'contact_phone', ''), coalesce(r->>'overbook_reason', ''), auth.uid()
    from jsonb_array_elements(p_rooms) r;

  return v_group;
end;
$$;

-- ── Identity helpers ────────────────────────────────────────────────────────

-- Reservation staff record an ID without being able to read one back.
create or replace function set_guest_identity(
  p_guest uuid, p_type text, p_number text, p_country text default 'India',
  p_expiry date default null, p_visa text default ''
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (has_permission('bookings.create') or has_permission('frontdesk.checkin')
          or has_permission('guests.edit')) then
    raise exception 'not permitted';
  end if;

  insert into guest_identities (guest_id, id_type, id_number, issuing_country, expiry_date, visa_number, updated_by, updated_at)
  values (p_guest, p_type, trim(p_number), coalesce(nullif(trim(p_country), ''), 'India'), p_expiry, coalesce(p_visa, ''), auth.uid(), now())
  on conflict (guest_id) do update
     set id_type = excluded.id_type, id_number = excluded.id_number,
         issuing_country = excluded.issuing_country, expiry_date = excluded.expiry_date,
         visa_number = excluded.visa_number, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
end;
$$;

-- What anyone handling the booking may see: the type and the last four.
create or replace function guest_identity_masked(p_guest uuid)
returns table (id_type text, id_last4 text)
language sql stable security definer set search_path = public as $$
  select gi.id_type, right(gi.id_number, 4)
    from guest_identities gi
   where gi.guest_id = p_guest and is_staff();
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table guest_identities enable row level security;
alter table booking_groups   enable row level security;
alter table room_moves       enable row level security;
alter table folio_entries    enable row level security;

drop policy if exists guest_identities_select on guest_identities;
drop policy if exists guest_identities_write  on guest_identities;
create policy guest_identities_select on guest_identities for select using (has_permission('guests.view_id'));
create policy guest_identities_write  on guest_identities for all
  using (has_permission('guests.view_id')) with check (has_permission('guests.view_id'));

drop policy if exists booking_groups_select on booking_groups;
drop policy if exists booking_groups_write  on booking_groups;
create policy booking_groups_select on booking_groups for select using (has_permission('bookings.view'));
create policy booking_groups_write  on booking_groups for all
  using (has_permission('bookings.groups')) with check (has_permission('bookings.groups'));

drop policy if exists room_moves_select on room_moves;
drop policy if exists room_moves_insert on room_moves;
create policy room_moves_select on room_moves for select using (has_permission('bookings.view'));
create policy room_moves_insert on room_moves for insert
  with check (has_permission('bookings.edit') or has_permission('frontdesk.checkin'));

drop policy if exists folio_select on folio_entries;
drop policy if exists folio_insert on folio_entries;
drop policy if exists folio_void   on folio_entries;
create policy folio_select on folio_entries for select
  using (has_permission('folio.view') or has_permission('bookings.view'));
create policy folio_insert on folio_entries for insert
  with check (
    (kind in ('payment', 'refund') and has_permission('folio.payment'))
    or (kind = 'adjustment' and has_permission('folio.adjust'))
    or (kind in ('room', 'fee', 'penalty', 'extra')
        and (has_permission('folio.post') or has_permission('frontdesk.checkin')
             or has_permission('frontdesk.checkout') or has_permission('bookings.cancel')
             or has_permission('frontdesk.night_audit')))
  );
-- Entries are never edited or deleted, only voided.
create policy folio_void on folio_entries for update
  using (has_permission('folio.adjust')) with check (has_permission('folio.adjust'));

-- Bookings: reading needs bookings.view; writing needs one of the
-- permissions that legitimately change a booking. Which specific change is
-- allowed is decided by the server action.
drop policy if exists bookings_all    on bookings;
drop policy if exists bookings_select on bookings;
drop policy if exists bookings_insert on bookings;
drop policy if exists bookings_update on bookings;
drop policy if exists bookings_delete on bookings;
create policy bookings_select on bookings for select
  using (has_permission('bookings.view') or has_permission('frontdesk.view'));
create policy bookings_insert on bookings for insert
  with check (has_permission('bookings.create') or has_permission('bookings.groups'));
create policy bookings_update on bookings for update
  using (has_permission('bookings.edit') or has_permission('bookings.cancel')
         or has_permission('frontdesk.checkin') or has_permission('frontdesk.checkout')
         or has_permission('frontdesk.night_audit') or has_permission('bookings.groups'))
  with check (true);
-- Bookings are cancelled, never deleted.
create policy bookings_delete on bookings for delete using (has_permission('staff.manage'));

drop policy if exists guests_all    on guests;
drop policy if exists guests_select on guests;
drop policy if exists guests_write  on guests;
create policy guests_select on guests for select
  using (has_permission('guests.view') or has_permission('bookings.view') or has_permission('frontdesk.view'));
create policy guests_write on guests for all
  using (has_permission('guests.edit') or has_permission('bookings.create') or has_permission('frontdesk.checkin'))
  with check (has_permission('guests.edit') or has_permission('bookings.create') or has_permission('frontdesk.checkin'));

drop policy if exists booking_notes_all on booking_notes;
create policy booking_notes_all on booking_notes for all
  using (has_permission('bookings.view') or has_permission('frontdesk.view'))
  with check (has_permission('bookings.view') or has_permission('frontdesk.view'));

drop trigger if exists booking_groups_touch on booking_groups;
create trigger booking_groups_touch before update on booking_groups for each row execute function touch_updated_at();

do $$
declare
  t record;
begin
  for t in select * from (values
    ('booking_groups', 'bookings'), ('room_moves', 'bookings'), ('folio_entries', 'folio'),
    ('guest_identities', 'guests')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;

-- The identity audit must not copy the ID number into a table more people
-- can read. Record only that it changed.
create or replace function audit_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, actor_name, module, table_name, record_id, action, summary)
  values (auth.uid(), current_actor_name(), 'guests', 'guest_identities',
          coalesce(new.guest_id, old.guest_id)::text, lower(tg_op), 'Identity document recorded');
  return coalesce(new, old);
end;
$$;
drop trigger if exists guest_identities_audit on guest_identities;
create trigger guest_identities_audit after insert or update or delete on guest_identities
  for each row execute function audit_identity();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table folio_entries;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
