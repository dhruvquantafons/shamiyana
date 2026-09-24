-- ============================================================================
-- Module 11 — Maintenance / Engineering Management
--
--   • Tickets raised by any staff member, linked to a room, an asset or a
--     place; priority Low / Medium / High / Urgent; assigned to engineers.
--   • Status Open → In progress (→ On hold) → Resolved, with photos.
--   • A ticket that affects a room takes it out of order (a room block linked
--     to the ticket); resolving the ticket releases the block. A room blocked
--     from the Rooms page is flagged to maintenance as a ticket (Module 3).
--   • Guest requests of kind "maintenance" become tickets; resolving the
--     ticket completes the request.
--   • Asset register with each asset's ticket history.
--   • Preventive schedules (e.g. AC servicing every 90 days) raise tickets
--     when due.
--   • Resolution targets per priority; breached tickets are escalated once.
--
-- Run after 0010_housekeeping_sow_scope.sql.
-- ============================================================================

-- ── Roles and permissions ───────────────────────────────────────────────────

insert into roles (key, name, description, is_system, is_superuser, requires_2fa, sort_order) values
  ('maintenance_supervisor', 'Engineering Supervisor',
   'Assigns and prioritises maintenance tickets, assets and preventive schedules.', true, false, false, 11)
on conflict (key) do nothing;

update roles set description = 'Works maintenance tickets and takes rooms out of order for repairs.'
 where key = 'maintenance' and description = 'Room blocks for repairs.';

-- Any staff member may report a problem.
insert into role_permissions (role_key, permission)
select key, 'maintenance.report' from roles where not is_superuser
on conflict do nothing;

insert into role_permissions (role_key, permission)
select r, p from (values
  ('maintenance', 'maintenance.work'),
  ('maintenance_supervisor', 'dashboard.view'), ('maintenance_supervisor', 'rooms.view'),
  ('maintenance_supervisor', 'rooms.block'), ('maintenance_supervisor', 'frontdesk.requests'),
  ('maintenance_supervisor', 'maintenance.work'), ('maintenance_supervisor', 'maintenance.manage'),
  ('manager', 'maintenance.manage')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Resolution targets (hours) ──────────────────────────────────────────────

alter table property_settings add column if not exists mt_sla_low_hours int not null default 72
  check (mt_sla_low_hours between 1 and 2160);
alter table property_settings add column if not exists mt_sla_medium_hours int not null default 24
  check (mt_sla_medium_hours between 1 and 2160);
alter table property_settings add column if not exists mt_sla_high_hours int not null default 8
  check (mt_sla_high_hours between 1 and 2160);
alter table property_settings add column if not exists mt_sla_urgent_hours int not null default 2
  check (mt_sla_urgent_hours between 1 and 2160);

-- ── Asset register ──────────────────────────────────────────────────────────

create sequence if not exists asset_code_seq start 101;

create table if not exists assets (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default ('AS-' || nextval('asset_code_seq')),
  name            text not null check (length(trim(name)) > 0),
  category        text not null default 'other'
                  check (category in ('hvac', 'electrical', 'plumbing', 'elevator', 'boiler', 'kitchen',
                                      'laundry', 'furniture', 'it', 'safety', 'other')),
  room_id         uuid references rooms on delete set null,
  location        text not null default '',
  make            text not null default '',
  model           text not null default '',
  serial_number   text not null default '',
  installed_on    date,
  warranty_until  date,
  notes           text not null default '',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ── Preventive schedules ────────────────────────────────────────────────────

create table if not exists maintenance_schedules (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(trim(title)) > 0),
  description        text not null default '',
  asset_id           uuid references assets on delete cascade,
  room_id            uuid references rooms on delete cascade,
  location           text not null default '',
  interval_days      int not null check (interval_days between 1 and 3650),
  next_due_on        date not null,
  priority           text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assigned_to        uuid references staff on delete set null,
  is_active          boolean not null default true,
  last_generated_on  date,
  created_by         uuid references staff on delete set null,
  created_at         timestamptz not null default now()
);

-- ── Tickets ─────────────────────────────────────────────────────────────────

create sequence if not exists maintenance_ticket_seq start 1001;

create table if not exists maintenance_tickets (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique default ('MT-' || nextval('maintenance_ticket_seq')),
  title            text not null check (length(trim(title)) > 0),
  description      text not null default '',
  room_id          uuid references rooms on delete set null,
  asset_id         uuid references assets on delete set null,
  location         text not null default '',
  priority         text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status           text not null default 'open'
                   check (status in ('open', 'in_progress', 'on_hold', 'resolved', 'cancelled')),
  source           text not null default 'staff'
                   check (source in ('staff', 'guest_request', 'room_block', 'preventive')),
  request_id       uuid references guest_requests on delete set null,
  schedule_id      uuid references maintenance_schedules on delete set null,
  -- The room cannot be sold until this is fixed.
  affects_room     boolean not null default false,
  assigned_to      uuid references staff on delete set null,
  assigned_at      timestamptz,
  reported_by      uuid references staff on delete set null,
  -- Resolution target, from the priority's hours.
  due_at           timestamptz not null default now(),
  started_at       timestamptz,
  hold_reason      text not null default '',
  resolved_at      timestamptz,
  resolved_by      uuid references staff on delete set null,
  resolution_note  text not null default '',
  escalated_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists mt_tickets_open_idx on maintenance_tickets (status, due_at);
create index if not exists mt_tickets_room_idx on maintenance_tickets (room_id, created_at desc);
create index if not exists mt_tickets_asset_idx on maintenance_tickets (asset_id, created_at desc);
create index if not exists mt_tickets_assignee_idx on maintenance_tickets (assigned_to, status);
-- One open preventive ticket per schedule.
create unique index if not exists mt_tickets_schedule_open_idx on maintenance_tickets (schedule_id)
  where status in ('open', 'in_progress', 'on_hold');

create table if not exists maintenance_photos (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references maintenance_tickets on delete cascade,
  storage_path  text not null unique,
  stage         text not null default 'report' check (stage in ('report', 'resolution')),
  uploaded_by   uuid references staff on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists mt_photos_ticket_idx on maintenance_photos (ticket_id, uploaded_at);

-- A room block may belong to a ticket; releasing the ticket releases it.
alter table room_blocks add column if not exists ticket_id uuid references maintenance_tickets on delete set null;
create index if not exists room_blocks_ticket_idx on room_blocks (ticket_id);

-- Staff alerts (urgent tickets, escalations) are logged with the guest ones.
alter table notifications add column if not exists ticket_id uuid references maintenance_tickets on delete cascade;

-- ── Resolution target ───────────────────────────────────────────────────────

create or replace function mt_sla_hours(p_priority text)
returns int language sql stable security definer set search_path = public as $$
  select case p_priority
           when 'urgent' then mt_sla_urgent_hours
           when 'high'   then mt_sla_high_hours
           when 'low'    then mt_sla_low_hours
           else mt_sla_medium_hours
         end
    from property_settings limit 1;
$$;

create or replace function mt_ticket_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.priority is distinct from old.priority then
    new.due_at := new.created_at + make_interval(hours => coalesce(mt_sla_hours(new.priority), 24));
    -- A new target gets its own escalation.
    if tg_op = 'UPDATE' and new.due_at > now() then new.escalated_at := null; end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists mt_ticket_defaults on maintenance_tickets;
create trigger mt_ticket_defaults before insert or update on maintenance_tickets
  for each row execute function mt_ticket_defaults();

-- ── Links to the rest of the system ─────────────────────────────────────────

-- Module 3: a room taken out of order from the Rooms page is flagged to
-- maintenance. Blocks created by a ticket already carry ticket_id.
create or replace function mt_ticket_for_block()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if new.ticket_id is null then
    insert into maintenance_tickets (title, description, room_id, priority, source, affects_room, reported_by)
    values (case when new.kind::text = 'out_of_service' then 'Out of service: ' else 'Out of order: ' end
              || left(new.reason, 150),
            new.reason, new.room_id, 'high', 'room_block', true, new.created_by)
    returning id into v_id;
    new.ticket_id := v_id;
  end if;
  return new;
end;
$$;

drop trigger if exists room_blocks_flag_maintenance on room_blocks;
create trigger room_blocks_flag_maintenance before insert on room_blocks
  for each row execute function mt_ticket_for_block();

-- A maintenance request logged by the front desk becomes a ticket.
create or replace function mt_ticket_for_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'maintenance' then
    insert into maintenance_tickets (title, description, room_id, source, request_id, reported_by)
    values (left(new.description, 150), new.description, new.room_id, 'guest_request', new.id, new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists guest_requests_to_maintenance on guest_requests;
create trigger guest_requests_to_maintenance after insert on guest_requests
  for each row execute function mt_ticket_for_request();

-- Fixing it closes the guest's request.
create or replace function mt_ticket_resolved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' and new.request_id is not null then
    update guest_requests
       set status = 'done', completed_at = now(), completed_by = new.resolved_by
     where id = new.request_id and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists mt_ticket_resolved on maintenance_tickets;
create trigger mt_ticket_resolved after update on maintenance_tickets
  for each row execute function mt_ticket_resolved();

-- ── Automatic room block / unblock ──────────────────────────────────────────

-- Any staff member reporting a problem that stops a room being sold takes it
-- out of order from today until the ticket is resolved. Refused while a stay
-- is assigned to the room, so no guest is left without one.
create or replace function mt_block_room(p_ticket uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_t      maintenance_tickets;
  v_today  date := hk_business_today();
  v_stays  text;
  v_block  uuid;
begin
  if not has_permission('maintenance.report') then raise exception 'not permitted'; end if;
  select * into v_t from maintenance_tickets where id = p_ticket;
  if v_t.id is null or v_t.room_id is null then raise exception 'NO_ROOM' using errcode = 'P0001'; end if;
  if v_t.status in ('resolved', 'cancelled') then raise exception 'TICKET_CLOSED' using errcode = 'P0001'; end if;

  select id into v_block from room_blocks where ticket_id = p_ticket and released_at is null limit 1;
  if v_block is not null then return v_block; end if;

  select string_agg(reference, ', ' order by check_in) into v_stays
    from bookings
   where room_id = v_t.room_id
     and status::text in ('tentative', 'confirmed', 'checked_in')
     and check_out > v_today;
  if v_stays is not null then
    raise exception 'ROOM_IN_USE: %', v_stays using errcode = 'P0001';
  end if;

  insert into room_blocks (room_id, kind, start_date, reason, created_by, ticket_id)
  values (v_t.room_id, 'out_of_order', v_today, v_t.reference || ': ' || v_t.title, auth.uid(), p_ticket)
  returning id into v_block;

  update rooms set status = 'out_of_order' where id = v_t.room_id and status <> 'occupied';
  update maintenance_tickets set affects_room = true where id = p_ticket;
  return v_block;
end;
$$;

-- Releases the ticket's blocks. The room returns to inventory marked dirty,
-- for housekeeping to clean and inspect, unless another block covers today.
create or replace function mt_release_room(p_ticket uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := hk_business_today();
  v_room  uuid;
  v_count int := 0;
begin
  if not (has_permission('maintenance.work') or has_permission('maintenance.manage')) then
    raise exception 'not permitted';
  end if;

  for v_room in
    update room_blocks
       set released_at = now(), released_by = auth.uid(),
           release_note = 'Maintenance ticket closed'
     where ticket_id = p_ticket and released_at is null
    returning room_id
  loop
    v_count := v_count + 1;
    if not exists (select 1 from room_blocks
                    where room_id = v_room and released_at is null
                      and start_date <= v_today and (end_date is null or end_date >= v_today)) then
      update rooms
         set status = 'available', housekeeping_status = 'dirty', housekeeping_updated_at = now()
       where id = v_room and status in ('out_of_order', 'out_of_service');
    end if;
  end loop;
  return v_count;
end;
$$;

-- ── Preventive tickets and escalation ───────────────────────────────────────

create or replace function mt_is_system()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

-- Raises a ticket for every schedule due on or before p_date that has no open
-- ticket, then moves the schedule on by its interval.
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
       and not exists (select 1 from maintenance_tickets t
                        where t.schedule_id = ms.id and t.status in ('open', 'in_progress', 'on_hold'))
     for update
  loop
    insert into maintenance_tickets (title, description, room_id, asset_id, location, priority, source,
                                     schedule_id, assigned_to, assigned_at, reported_by)
    values (s.title, s.description, s.room_id, s.asset_id, s.location, s.priority, 'preventive',
            s.id, s.assigned_to, case when s.assigned_to is not null then now() end, auth.uid());

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

-- Marks open tickets past their target as escalated, once, and returns them
-- so the app can alert the supervisors.
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
         and due_at < now()
         and escalated_at is null
      returning *
    )
    select * from escalated;
end;
$$;

create or replace function set_mt_sla(p_low int, p_medium int, p_high int, p_urgent int)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not has_permission('maintenance.manage') then raise exception 'not permitted'; end if;
  update property_settings
     set mt_sla_low_hours = p_low, mt_sla_medium_hours = p_medium,
         mt_sla_high_hours = p_high, mt_sla_urgent_hours = p_urgent;
end;
$$;

-- ── Photo storage ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance-photos', 'maintenance-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "maintenance photos readable by maintenance" on storage.objects;
drop policy if exists "maintenance photos uploaded by staff"       on storage.objects;
drop policy if exists "maintenance photos removed by supervisors"  on storage.objects;
create policy "maintenance photos readable by maintenance" on storage.objects
  for select using (bucket_id = 'maintenance-photos' and public.has_permission('maintenance.report'));
create policy "maintenance photos uploaded by staff" on storage.objects
  for insert with check (bucket_id = 'maintenance-photos' and public.has_permission('maintenance.report'));
create policy "maintenance photos removed by supervisors" on storage.objects
  for delete using (bucket_id = 'maintenance-photos' and public.has_permission('maintenance.manage'));

-- ── Row level security ──────────────────────────────────────────────────────

alter table assets                enable row level security;
alter table maintenance_schedules enable row level security;
alter table maintenance_tickets   enable row level security;
alter table maintenance_photos    enable row level security;

drop policy if exists assets_select on assets;
drop policy if exists assets_write  on assets;
create policy assets_select on assets for select using (has_permission('maintenance.report'));
create policy assets_write  on assets for all
  using (has_permission('maintenance.manage')) with check (has_permission('maintenance.manage'));

drop policy if exists mt_schedules_select on maintenance_schedules;
drop policy if exists mt_schedules_write  on maintenance_schedules;
create policy mt_schedules_select on maintenance_schedules for select
  using (has_permission('maintenance.work') or has_permission('maintenance.manage'));
create policy mt_schedules_write on maintenance_schedules for all
  using (has_permission('maintenance.manage')) with check (has_permission('maintenance.manage'));

drop policy if exists mt_tickets_select on maintenance_tickets;
drop policy if exists mt_tickets_insert on maintenance_tickets;
drop policy if exists mt_tickets_update on maintenance_tickets;
create policy mt_tickets_select on maintenance_tickets for select using (has_permission('maintenance.report'));
create policy mt_tickets_insert on maintenance_tickets for insert with check (has_permission('maintenance.report'));
-- Engineers work their own tickets (or pick up unassigned ones); supervisors any.
create policy mt_tickets_update on maintenance_tickets for update
  using (has_permission('maintenance.manage')
         or (has_permission('maintenance.work') and (assigned_to = auth.uid() or assigned_to is null)))
  with check (has_permission('maintenance.manage')
              or (has_permission('maintenance.work') and assigned_to = auth.uid()));

drop policy if exists mt_photos_select on maintenance_photos;
drop policy if exists mt_photos_insert on maintenance_photos;
drop policy if exists mt_photos_delete on maintenance_photos;
create policy mt_photos_select on maintenance_photos for select using (has_permission('maintenance.report'));
create policy mt_photos_insert on maintenance_photos for insert with check (has_permission('maintenance.report'));
create policy mt_photos_delete on maintenance_photos for delete using (has_permission('maintenance.manage'));

do $$
declare
  t record;
begin
  for t in select * from (values
    ('maintenance_tickets', 'maintenance'), ('maintenance_schedules', 'maintenance'), ('assets', 'maintenance')
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
      alter publication supabase_realtime add table maintenance_tickets;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
