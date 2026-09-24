-- ============================================================================
-- Module 8 — Guest CRM (loyalty points and tiers come with the payments phase)
--
--   • Guest profile fields: preferred language, room type and floor, dietary
--     needs, anniversary, marketing consent, blacklist reason.
--   • Stay statistics per guest (stays, nights, spend, last stay) — tags such
--     as Repeat Guest and Corporate are derived from them.
--   • Feedback after check-out: a private link for the guest, or entered by
--     the desk.
--   • Merge duplicate profiles; export and erase a guest's personal data.
--
-- Module 15 — System administration
--
--   • Guest message templates editable per language, with placeholders.
--   • Enabled languages and the default language.
--   • Ending a staff member's sessions from the activity page.
--
-- Run after 0012_hr.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'guests.privacy'), ('front_office_manager', 'guests.privacy'),
  ('sales_marketing', 'guests.edit')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Guest profile ───────────────────────────────────────────────────────────

alter table guests add column if not exists language               text not null default 'en';
alter table guests add column if not exists anniversary            date;
alter table guests add column if not exists dietary                text not null default '';
alter table guests add column if not exists preferred_room_type_id uuid references room_types on delete set null;
alter table guests add column if not exists preferred_floor        int;
alter table guests add column if not exists blacklist_reason       text not null default '';
alter table guests add column if not exists marketing_opt_in       boolean not null default false;
alter table guests add column if not exists erased_at              timestamptz;

create index if not exists guests_birthday_idx on guests (extract(month from date_of_birth), extract(day from date_of_birth));
create index if not exists guests_anniversary_idx on guests (extract(month from anniversary), extract(day from anniversary));

-- Stays, nights and spend per guest. Runs with the caller's rights, so spend
-- is only visible to roles that can read folios.
create or replace view guest_stats with (security_invoker = true) as
select g.id as guest_id,
       count(b.id) filter (where b.status in ('checked_in', 'checked_out'))                        as stays,
       coalesce(sum(b.check_out - b.check_in) filter (where b.status in ('checked_in', 'checked_out')), 0) as nights,
       max(b.check_in) filter (where b.status in ('checked_in', 'checked_out'))                    as last_stay,
       min(b.check_in) filter (where b.status in ('checked_in', 'checked_out'))                    as first_stay,
       min(b.check_in) filter (where b.status in ('tentative', 'confirmed') and b.check_in >= current_date) as next_arrival,
       count(b.id) filter (where b.status = 'cancelled')                                          as cancellations,
       count(b.id) filter (where b.status = 'no_show')                                            as no_shows,
       coalesce((select sum(f.amount + f.tax_amount)
                   from folio_entries f join bookings fb on fb.id = f.booking_id
                  where fb.guest_id = g.id and f.voided_at is null
                    and f.kind in ('room', 'fee', 'penalty', 'extra')), 0)                        as total_spend
  from guests g
  left join bookings b on b.guest_id = g.id
 group by g.id;

-- ── Feedback after check-out ────────────────────────────────────────────────

create table if not exists guest_feedback (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid unique references bookings on delete cascade,
  guest_id      uuid references guests on delete set null,
  -- The private link sent to the guest. Null once used or for desk entries.
  token         text unique,
  requested_at  timestamptz,
  submitted_at  timestamptz,
  overall       smallint check (overall between 1 and 5),
  room          smallint check (room between 1 and 5),
  service       smallint check (service between 1 and 5),
  cleanliness   smallint check (cleanliness between 1 and 5),
  food          smallint check (food between 1 and 5),
  comment       text not null default '',
  source        text not null default 'guest' check (source in ('guest', 'desk')),
  recorded_by   uuid references staff on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists guest_feedback_guest_idx on guest_feedback (guest_id, submitted_at desc);

-- ── Merge and erase ─────────────────────────────────────────────────────────

-- Moves everything from p_drop onto p_keep, fills p_keep's blanks from
-- p_drop, then deletes p_drop.
create or replace function merge_guests(p_keep uuid, p_drop uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  k guests;
  d guests;
begin
  if not has_permission('guests.privacy') then raise exception 'not permitted'; end if;
  if p_keep = p_drop then raise exception 'SAME_GUEST' using errcode = 'P0001'; end if;
  select * into k from guests where id = p_keep for update;
  select * into d from guests where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'GUEST_NOT_FOUND' using errcode = 'P0001'; end if;

  update bookings        set guest_id = p_keep where guest_id = p_drop;
  update guest_documents set guest_id = p_keep where guest_id = p_drop;
  update guest_feedback  set guest_id = p_keep where guest_id = p_drop;
  if exists (select 1 from guest_identities where guest_id = p_keep) then
    delete from guest_identities where guest_id = p_drop;
  else
    update guest_identities set guest_id = p_keep where guest_id = p_drop;
  end if;

  update guests set
    email                  = coalesce(nullif(k.email, ''), d.email),
    phone                  = coalesce(nullif(k.phone, ''), d.phone),
    address                = coalesce(nullif(k.address, ''), d.address),
    city                   = coalesce(nullif(k.city, ''), d.city),
    date_of_birth          = coalesce(k.date_of_birth, d.date_of_birth),
    anniversary            = coalesce(k.anniversary, d.anniversary),
    company_id             = coalesce(k.company_id, d.company_id),
    preferred_room_type_id = coalesce(k.preferred_room_type_id, d.preferred_room_type_id),
    preferred_floor        = coalesce(k.preferred_floor, d.preferred_floor),
    dietary                = concat_ws('; ', nullif(k.dietary, ''), nullif(d.dietary, '')),
    preferences            = concat_ws('; ', nullif(k.preferences, ''), nullif(d.preferences, '')),
    notes                  = concat_ws(E'\n', nullif(k.notes, ''), nullif(d.notes, '')),
    blacklist_reason       = concat_ws('; ', nullif(k.blacklist_reason, ''), nullif(d.blacklist_reason, '')),
    tags                   = array(select distinct unnest(k.tags || d.tags)),
    marketing_opt_in       = k.marketing_opt_in or d.marketing_opt_in,
    updated_at             = now()
  where id = p_keep;

  delete from guests where id = p_drop;
  perform log_event('guests', 'merge', p_keep::text,
                    format('Merged %s into %s', d.full_name, k.full_name));
end;
$$;

-- Removes a guest's personal data (right to erasure). Bookings and folio
-- amounts stay for tax records, without the name or contact details. Scans
-- in storage are removed by the app before this runs.
create or replace function erase_guest(p_guest uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text;
begin
  if not has_permission('guests.privacy') then raise exception 'not permitted'; end if;
  select full_name into v_name from guests where id = p_guest;
  if v_name is null then raise exception 'GUEST_NOT_FOUND' using errcode = 'P0001'; end if;

  delete from guest_identities where guest_id = p_guest;
  delete from guest_documents  where guest_id = p_guest;
  update guest_feedback set comment = '' where guest_id = p_guest;
  update registration_cards
     set guest_name = 'Erased guest', address = '', phone = '', email = '', accompanying = '',
         arriving_from = '', next_destination = '', signature_path = null
   where booking_id in (select id from bookings where guest_id = p_guest);
  update bookings
     set contact_name = 'Erased guest', contact_email = '', contact_phone = '', special_requests = ''
   where guest_id = p_guest;
  update guests set
    full_name = 'Erased guest', email = null, phone = null, address = '', city = '',
    date_of_birth = null, anniversary = null, dietary = '', preferences = '', notes = '',
    tags = '{}', blacklist_reason = '', marketing_opt_in = false, preferred_room_type_id = null,
    preferred_floor = null, erased_at = now(), updated_at = now()
  where id = p_guest;

  perform log_event('guests', 'erase', p_guest::text, 'Personal data erased on request');
end;
$$;

-- ── Message templates and languages ─────────────────────────────────────────

alter table property_settings add column if not exists default_language text not null default 'en';
alter table property_settings add column if not exists languages text[] not null default '{en}';

create table if not exists message_templates (
  template    text not null check (template in ('request_received', 'confirmation', 'cancellation', 'final_bill')),
  language    text not null check (language ~ '^[a-z]{2}$'),
  subject     text not null check (length(trim(subject)) > 0),
  -- Opening paragraph; the booking details table follows it automatically.
  body        text not null default '',
  -- Closing paragraph after the details.
  footer      text not null default '',
  sms         text not null default '',
  updated_by  uuid references staff on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (template, language)
);

insert into message_templates (template, language, subject, body, footer, sms) values
  ('request_received', 'en', 'We have your request — {Reference}',
   'Thank you for choosing {HotelName}. We have received your booking request and our front desk will confirm availability with you shortly. This is not yet a confirmation.',
   '', '{HotelName}: we have your request {Reference} for {StayDates}. We will confirm shortly.'),
  ('confirmation', 'en', 'Booking confirmed — {Reference}',
   'Your stay at {HotelName} is confirmed. Please quote reservation {Reference} in any correspondence.',
   'Please bring a government-issued photo ID for every adult. Foreign nationals need their passport and visa.',
   '{HotelName}: booking confirmed {Reference}. {StayDates}. Total {Total}.'),
  ('cancellation', 'en', 'Booking cancelled — {Reference}',
   'Your reservation {Reference} at {HotelName} has been cancelled.',
   '', '{HotelName}: booking {Reference} has been cancelled.'),
  ('final_bill', 'en', 'Your bill — {Reference}',
   'Thank you for staying at {HotelName}. Your final bill is below.',
   'We would love to hear about your stay: {FeedbackLink}',
   '{HotelName}: thank you for staying. Your bill for {Reference} is in your email. Balance {Balance}.')
on conflict do nothing;

-- ── Sessions ────────────────────────────────────────────────────────────────

-- Sessions started before this moment are signed out on their next request.
alter table staff add column if not exists sessions_revoked_at timestamptz;

-- ── Row level security ──────────────────────────────────────────────────────

alter table guest_feedback    enable row level security;
alter table message_templates enable row level security;

drop policy if exists guest_feedback_select on guest_feedback;
drop policy if exists guest_feedback_insert on guest_feedback;
drop policy if exists guest_feedback_update on guest_feedback;
create policy guest_feedback_select on guest_feedback for select
  using (has_permission('guests.view') or has_permission('hr.view'));
create policy guest_feedback_insert on guest_feedback for insert
  with check (has_permission('guests.edit') or has_permission('frontdesk.checkout'));
create policy guest_feedback_update on guest_feedback for update
  using (has_permission('guests.edit')) with check (has_permission('guests.edit'));

drop policy if exists templates_select on message_templates;
drop policy if exists templates_write  on message_templates;
create policy templates_select on message_templates for select using (is_staff());
create policy templates_write  on message_templates for all
  using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

do $$
declare
  t record;
begin
  for t in select * from (values ('guest_feedback', 'guests'), ('message_templates', 'settings')) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;
