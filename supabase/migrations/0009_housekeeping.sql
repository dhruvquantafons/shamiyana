-- ============================================================================
-- Module 5 — Housekeeping Management
--
--   • Cleaning tasks: created automatically at check-out, plus daily stayover
--     and recurring deep-clean tasks. Auto-assigned by floor zone and staff on
--     duty; supervisors reassign.
--   • Status flow: Dirty → Cleaning in progress → Clean → Inspected (ready
--     for guest). A failed inspection sends the room back to Dirty.
--   • Turnaround targets per room type, deep-clean interval, DND flag.
--   • Linen / amenities / minibar checklist per task.
--   • Lost & found log linked to room, date and the guest who stayed.
--
-- Run after 0008_front_desk.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('housekeeping', 'housekeeping.tasks'), ('housekeeping', 'housekeeping.lost_found'),
  ('housekeeping_supervisor', 'housekeeping.tasks'), ('housekeeping_supervisor', 'housekeeping.inspect'),
  ('housekeeping_supervisor', 'housekeeping.assign'), ('housekeeping_supervisor', 'housekeeping.lost_found'),
  ('manager', 'housekeeping.tasks'), ('manager', 'housekeeping.inspect'),
  ('manager', 'housekeeping.assign'), ('manager', 'housekeeping.lost_found'),
  ('front_office_manager', 'housekeeping.tasks'), ('front_office_manager', 'housekeeping.inspect'),
  ('front_office_manager', 'housekeeping.assign'), ('front_office_manager', 'housekeeping.lost_found'),
  ('front_desk', 'housekeeping.lost_found')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings and room fields ───────────────────────────────────────────────

alter table property_settings add column if not exists hk_default_minutes int not null default 30
  check (hk_default_minutes between 5 and 480);
alter table property_settings add column if not exists hk_deep_clean_days int not null default 30
  check (hk_deep_clean_days between 1 and 365);

-- Turnaround target for this room type; null uses the property default.
alter table room_types add column if not exists cleaning_minutes int check (cleaning_minutes between 5 and 480);

alter table rooms add column if not exists dnd boolean not null default false;
alter table rooms add column if not exists dnd_updated_at timestamptz;
-- Counting starts now, so every room is not due for a deep clean at once.
alter table rooms add column if not exists last_deep_clean_on date default current_date;

-- ── Zones and staff on duty ────────────────────────────────────────────────

create table if not exists housekeeping_zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  floors      int[] not null default '{}',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

alter table staff add column if not exists hk_zone_id uuid references housekeeping_zones on delete set null;
alter table staff add column if not exists on_duty boolean not null default true;

-- ── Checklist ───────────────────────────────────────────────────────────────

create table if not exists hk_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('linen', 'amenities', 'minibar')),
  label       text not null check (length(trim(label)) > 0),
  par_qty     int not null default 1 check (par_qty between 0 and 99),
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

insert into hk_checklist_items (category, label, par_qty, sort_order)
select * from (values
  ('linen', 'Bed sheets', 2, 1), ('linen', 'Pillow covers', 4, 2), ('linen', 'Duvet cover', 1, 3),
  ('linen', 'Bath towels', 2, 4), ('linen', 'Hand towels', 2, 5), ('linen', 'Bath mat', 1, 6),
  ('amenities', 'Shampoo & conditioner', 2, 10), ('amenities', 'Soap & body wash', 2, 11),
  ('amenities', 'Dental kit', 2, 12), ('amenities', 'Tea & coffee sachets', 4, 13),
  ('amenities', 'Drinking water', 2, 14),
  ('minibar', 'Soft drinks', 2, 20), ('minibar', 'Juice', 2, 21), ('minibar', 'Snacks', 2, 22)
) as seed (category, label, par_qty, sort_order)
where not exists (select 1 from hk_checklist_items);

-- ── Tasks ───────────────────────────────────────────────────────────────────

create table if not exists housekeeping_tasks (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms on delete cascade,
  task_date        date not null,
  kind             text not null check (kind in ('checkout', 'stayover', 'deep_clean', 'touch_up')),
  -- pending → in_progress → cleaned → inspected. A failed inspection returns
  -- the task to pending. Stayovers finish straight to inspected.
  status           text not null default 'pending'
                   check (status in ('pending', 'in_progress', 'cleaned', 'inspected', 'cancelled')),
  -- High when a guest is due into the room today.
  priority         text not null default 'normal' check (priority in ('normal', 'high')),
  assigned_to      uuid references staff on delete set null,
  assigned_at      timestamptz,
  target_minutes   int not null default 30,
  started_at       timestamptz,
  completed_at     timestamptz,
  completed_by     uuid references staff on delete set null,
  inspected_at     timestamptz,
  inspected_by     uuid references staff on delete set null,
  inspection_note  text not null default '',
  failed_count     int not null default 0,
  -- [{"item_id", "label", "category", "done", "qty"}]
  checklist        jsonb not null default '[]',
  notes            text not null default '',
  created_by       uuid references staff on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists hk_tasks_date_idx on housekeeping_tasks (task_date, status);
create index if not exists hk_tasks_assignee_idx on housekeeping_tasks (assigned_to, task_date);
-- One open task of each kind per room per day.
create unique index if not exists hk_tasks_open_idx
  on housekeeping_tasks (room_id, task_date, kind)
  where status in ('pending', 'in_progress', 'cleaned');

-- ── Lost & found ────────────────────────────────────────────────────────────

create sequence if not exists lost_found_reference_seq start 1001;

create table if not exists lost_found_items (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default ('LF-' || nextval('lost_found_reference_seq')),
  room_id           uuid references rooms on delete set null,
  -- Where it was found when not in a room (lobby, restaurant…).
  location          text not null default '',
  found_on          date not null,
  description       text not null check (length(trim(description)) > 0),
  category          text not null default 'other'
                    check (category in ('electronics', 'documents', 'jewellery', 'clothing', 'money', 'other')),
  -- The stay the item most likely belongs to.
  booking_id        uuid references bookings on delete set null,
  found_by          uuid references staff on delete set null,
  storage_location  text not null default '',
  status            text not null default 'stored' check (status in ('stored', 'returned', 'disposed')),
  returned_to       text not null default '',
  resolved_at       timestamptz,
  resolved_by       uuid references staff on delete set null,
  notes             text not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists lost_found_status_idx on lost_found_items (status, found_on desc);

-- ── Assignment and generation ───────────────────────────────────────────────

create or replace function hk_business_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from property_settings limit 1), 'Asia/Kolkata'))::date;
$$;

-- The on-duty housekeeper best placed to clean a room: one whose zone covers
-- the floor first, then whoever has the fewest open tasks that day.
create or replace function hk_pick_staff(p_floor int, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id
    from staff s
    join role_permissions rp on rp.role_key = s.role and rp.permission = 'housekeeping.tasks'
    left join housekeeping_zones z on z.id = s.hk_zone_id
   where s.is_active and s.on_duty
     -- Supervisors and managers assign work; they are not given it.
     and not exists (select 1 from role_permissions a
                      where a.role_key = s.role and a.permission = 'housekeeping.assign')
   order by (p_floor is not null and p_floor = any (coalesce(z.floors, '{}'))) desc,
            (select count(*) from housekeeping_tasks t
              where t.assigned_to = s.id and t.task_date = p_date
                and t.status in ('pending', 'in_progress')) asc,
            s.full_name
   limit 1;
$$;

create or replace function hk_create_task(p_room uuid, p_kind text, p_date date, p_notes text default '')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_room     record;
  v_minutes  int;
  v_priority text := 'normal';
  v_id       uuid;
begin
  select r.id, r.floor, rt.cleaning_minutes into v_room
    from rooms r join room_types rt on rt.id = r.room_type_id where r.id = p_room;
  if v_room.id is null then return null; end if;

  v_minutes := coalesce(v_room.cleaning_minutes, (select hk_default_minutes from property_settings limit 1), 30);
  if p_kind = 'deep_clean' then v_minutes := v_minutes * 3; end if;

  -- A guest due into this room today makes it urgent.
  if exists (select 1 from bookings where room_id = p_room and check_in = p_date
              and status::text in ('tentative', 'confirmed')) then
    v_priority := 'high';
  end if;

  insert into housekeeping_tasks (room_id, task_date, kind, priority, target_minutes, assigned_to, assigned_at, notes, created_by)
  values (p_room, p_date, p_kind, v_priority, v_minutes, hk_pick_staff(v_room.floor, p_date),
          now(), coalesce(p_notes, ''), auth.uid())
  on conflict do nothing
  returning id into v_id;

  -- Nobody on duty: leave it unassigned for the supervisor.
  update housekeeping_tasks set assigned_at = null where id = v_id and assigned_to is null;
  return v_id;
end;
$$;

-- Daily list: stayovers for occupied rooms (not DND), dirty rooms with no
-- open task, and deep cleans that have fallen due.
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
     where r.status = 'occupied' and not r.dnd
       and exists (select 1 from bookings b where b.room_id = r.id and b.status::text = 'checked_in'
                    and b.check_out > p_date)
  loop
    if hk_create_task(v_room.id, 'stayover', p_date) is not null then v_count := v_count + 1; end if;
  end loop;

  for v_room in
    select r.id from rooms r
     where r.housekeeping_status in ('dirty', 'cleaning') and r.status <> 'occupied'
       and r.status not in ('out_of_order', 'out_of_service')
       and not exists (select 1 from housekeeping_tasks t where t.room_id = r.id
                        and t.status in ('pending', 'in_progress', 'cleaned'))
  loop
    if hk_create_task(v_room.id, 'touch_up', p_date) is not null then v_count := v_count + 1; end if;
  end loop;

  for v_room in
    select r.id from rooms r
     where r.status not in ('out_of_order', 'out_of_service')
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

-- A guest leaving a room (check-out or room move) creates its cleaning task.
-- Supersedes the 0006 version, which only marked the room dirty.
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

    perform hk_create_task(old.room_id, 'checkout', hk_business_today(),
      case when new.room_id is distinct from old.room_id and new.status = 'checked_in'
           then 'Guest moved to another room' else '' end);
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

-- Supervisors set who is on duty and in which zone without full staff access.
create or replace function set_hk_staff(p_staff uuid, p_zone uuid, p_on_duty boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not has_permission('housekeeping.assign') then raise exception 'not permitted'; end if;
  update staff set hk_zone_id = p_zone, on_duty = p_on_duty where id = p_staff;
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table housekeeping_zones enable row level security;
alter table hk_checklist_items enable row level security;
alter table housekeeping_tasks enable row level security;
alter table lost_found_items   enable row level security;

drop policy if exists hk_zones_select on housekeeping_zones;
drop policy if exists hk_zones_write  on housekeeping_zones;
create policy hk_zones_select on housekeeping_zones for select using (is_staff());
create policy hk_zones_write  on housekeeping_zones for all
  using (has_permission('housekeeping.assign')) with check (has_permission('housekeeping.assign'));

drop policy if exists hk_items_select on hk_checklist_items;
drop policy if exists hk_items_write  on hk_checklist_items;
create policy hk_items_select on hk_checklist_items for select using (is_staff());
create policy hk_items_write  on hk_checklist_items for all
  using (has_permission('housekeeping.assign')) with check (has_permission('housekeeping.assign'));

drop policy if exists hk_tasks_select on housekeeping_tasks;
drop policy if exists hk_tasks_insert on housekeeping_tasks;
drop policy if exists hk_tasks_update on housekeeping_tasks;
create policy hk_tasks_select on housekeeping_tasks for select
  using (has_permission('housekeeping.tasks') or has_permission('housekeeping.inspect')
         or has_permission('housekeeping.assign') or has_permission('rooms.view'));
create policy hk_tasks_insert on housekeeping_tasks for insert
  with check (has_permission('housekeeping.assign'));
-- Housekeepers work only their own tasks; supervisors any.
create policy hk_tasks_update on housekeeping_tasks for update
  using (has_permission('housekeeping.assign') or has_permission('housekeeping.inspect')
         or (has_permission('housekeeping.tasks') and assigned_to = auth.uid()))
  with check (true);

drop policy if exists lost_found_select on lost_found_items;
drop policy if exists lost_found_write  on lost_found_items;
create policy lost_found_select on lost_found_items for select using (has_permission('housekeeping.lost_found'));
create policy lost_found_write  on lost_found_items for all
  using (has_permission('housekeeping.lost_found')) with check (has_permission('housekeeping.lost_found'));

do $$
declare
  t record;
begin
  for t in select * from (values
    ('housekeeping_tasks', 'housekeeping'), ('housekeeping_zones', 'housekeeping'),
    ('hk_checklist_items', 'housekeeping'), ('lost_found_items', 'housekeeping')
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
      alter publication supabase_realtime add table housekeeping_tasks;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
