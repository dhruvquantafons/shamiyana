-- ============================================================================
-- Module 2 — Front Desk Operations
--
--   • Registration cards with the guest's e-signature.
--   • Identity document scans in a private storage bucket, readable only with
--     guests.view_id and purged after the retention period.
--   • Guest requests and messages (wake-up calls, towels, messages).
--   • Key card events — the hook an electronic lock system plugs into.
--   • Night audit runs, each keeping the day's report.
--   • A notification outbox recording every confirmation and bill sent.
--
-- Run after 0007_reservations.sql.
-- ============================================================================

create table if not exists registration_cards (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null unique references bookings on delete cascade,
  guest_name        text not null,
  address           text not null default '',
  nationality       text not null default '',
  phone             text not null default '',
  email             text not null default '',
  arriving_from     text not null default '',
  next_destination  text not null default '',
  purpose_of_visit  text not null default '',
  -- Other guests sharing the room, one per line.
  accompanying      text not null default '',
  terms_accepted    boolean not null default false,
  signature_path    text,
  signed_at         timestamptz,
  created_by        uuid references staff on delete set null,
  created_at        timestamptz not null default now()
);

create table if not exists guest_documents (
  id            uuid primary key default gen_random_uuid(),
  guest_id      uuid not null references guests on delete cascade,
  booking_id    uuid references bookings on delete set null,
  kind          text not null check (kind in ('id_front', 'id_back', 'photo', 'visa', 'signature', 'other')),
  storage_path  text not null unique,
  uploaded_by   uuid references staff on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists guest_documents_guest_idx on guest_documents (guest_id, uploaded_at desc);

create table if not exists guest_requests (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references bookings on delete cascade,
  room_id       uuid references rooms on delete set null,
  kind          text not null default 'request'
                check (kind in ('wake_up_call', 'housekeeping', 'maintenance', 'message', 'request', 'complaint')),
  description   text not null check (length(trim(description)) > 0),
  due_at        timestamptz,
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by    uuid references staff on delete set null,
  created_at    timestamptz not null default now(),
  completed_by  uuid references staff on delete set null,
  completed_at  timestamptz
);

create index if not exists guest_requests_open_idx on guest_requests (status, due_at);
create index if not exists guest_requests_booking_idx on guest_requests (booking_id);

create table if not exists key_card_events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings on delete cascade,
  room_id     uuid references rooms on delete set null,
  action      text not null check (action in ('issue', 'revoke')),
  cards       int not null default 1 check (cards between 1 and 10),
  provider    text not null default 'none',
  status      text not null check (status in ('sent', 'skipped', 'failed')),
  response    text not null default '',
  created_by  uuid references staff on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists night_audits (
  business_date  date primary key,
  status         text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_by     uuid references staff on delete set null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  report         jsonb not null default '{}',
  error          text not null default ''
);

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references bookings on delete cascade,
  channel       text not null check (channel in ('email', 'sms')),
  template      text not null,
  recipient     text not null,
  subject       text not null default '',
  body          text not null default '',
  status        text not null check (status in ('sent', 'skipped', 'failed')),
  provider_id   text not null default '',
  error         text not null default '',
  created_by    uuid references staff on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_booking_idx on notifications (booking_id, created_at desc);

-- ── Private bucket for identity scans and signatures ───────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-documents', 'guest-documents', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "guest documents readable with view_id" on storage.objects;
drop policy if exists "guest documents uploaded at check-in"  on storage.objects;
drop policy if exists "guest documents removed with view_id"  on storage.objects;

create policy "guest documents readable with view_id" on storage.objects
  for select using (bucket_id = 'guest-documents' and public.has_permission('guests.view_id'));
create policy "guest documents uploaded at check-in" on storage.objects
  for insert with check (
    bucket_id = 'guest-documents'
    and (public.has_permission('frontdesk.checkin') or public.has_permission('guests.view_id'))
  );
create policy "guest documents removed with view_id" on storage.objects
  for delete using (bucket_id = 'guest-documents' and public.has_permission('guests.view_id'));

-- ── Row level security ──────────────────────────────────────────────────────

alter table registration_cards enable row level security;
alter table guest_documents    enable row level security;
alter table guest_requests     enable row level security;
alter table key_card_events    enable row level security;
alter table night_audits       enable row level security;
alter table notifications      enable row level security;

drop policy if exists registration_cards_select on registration_cards;
drop policy if exists registration_cards_write  on registration_cards;
create policy registration_cards_select on registration_cards for select
  using (has_permission('frontdesk.view') or has_permission('bookings.view'));
create policy registration_cards_write on registration_cards for all
  using (has_permission('frontdesk.checkin')) with check (has_permission('frontdesk.checkin'));

drop policy if exists guest_documents_select on guest_documents;
drop policy if exists guest_documents_insert on guest_documents;
drop policy if exists guest_documents_delete on guest_documents;
create policy guest_documents_select on guest_documents for select using (has_permission('guests.view_id'));
create policy guest_documents_insert on guest_documents for insert
  with check (has_permission('frontdesk.checkin') or has_permission('guests.view_id'));
create policy guest_documents_delete on guest_documents for delete using (has_permission('guests.view_id'));

drop policy if exists guest_requests_select on guest_requests;
drop policy if exists guest_requests_write  on guest_requests;
create policy guest_requests_select on guest_requests for select
  using (has_permission('frontdesk.requests') or has_permission('frontdesk.view'));
create policy guest_requests_write on guest_requests for all
  using (has_permission('frontdesk.requests')) with check (has_permission('frontdesk.requests'));

drop policy if exists key_card_events_select on key_card_events;
drop policy if exists key_card_events_insert on key_card_events;
create policy key_card_events_select on key_card_events for select using (has_permission('frontdesk.view'));
create policy key_card_events_insert on key_card_events for insert
  with check (has_permission('frontdesk.checkin') or has_permission('frontdesk.checkout'));

drop policy if exists night_audits_select on night_audits;
drop policy if exists night_audits_write  on night_audits;
create policy night_audits_select on night_audits for select
  using (has_permission('frontdesk.night_audit') or has_permission('folio.view'));
create policy night_audits_write on night_audits for all
  using (has_permission('frontdesk.night_audit')) with check (has_permission('frontdesk.night_audit'));

drop policy if exists notifications_select on notifications;
drop policy if exists notifications_insert on notifications;
create policy notifications_select on notifications for select
  using (has_permission('bookings.view') or has_permission('frontdesk.view'));
create policy notifications_insert on notifications for insert with check (is_staff());

-- Night audit rolls the business date forward. Everyone else only reads it.
create or replace function advance_business_date(p_closed date)
returns date language plpgsql volatile security definer set search_path = public as $$
declare
  v_next date;
begin
  if not has_permission('frontdesk.night_audit') then
    raise exception 'not permitted';
  end if;

  update property_settings
     set business_date = p_closed + 1
   where business_date = p_closed
  returning business_date into v_next;

  if v_next is null then
    raise exception 'BUSINESS_DATE_MOVED: the business date is no longer %', p_closed;
  end if;
  return v_next;
end;
$$;

-- Night audit closes the day: every open folio entry is stamped with the
-- business date, which is what "closing the cashier shifts" means here —
-- later reports group payments by that stamp.
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
     and created_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('registration_cards', 'frontdesk'), ('guest_requests', 'frontdesk'),
    ('key_card_events', 'frontdesk'), ('night_audits', 'frontdesk'),
    ('guest_documents', 'guests')
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
      alter publication supabase_realtime add table guest_requests;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
