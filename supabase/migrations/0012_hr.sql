-- ============================================================================
-- Module 12 — HR & Staff Management
--
--   • Staff HR profile: employee ID, department, designation, shift pattern,
--     contact details, joining date.
--   • Configurable shift types (Morning, Afternoon, Night, Split) and a
--     weekly roster.
--   • Attendance: manual entry, self clock-in (optionally geofenced from a
--     phone), and a biometric device hook.
--   • Leave requests with an approval workflow.
--   • Guest feedback linked to staff, for basic performance tracking.
--   • Housekeeping auto-assignment skips staff on approved leave and prefers
--     those rostered for the day.
--
-- Run after 0011_maintenance.sql.
-- ============================================================================

-- ── Roles and permissions ───────────────────────────────────────────────────

insert into roles (key, name, description, is_system, is_superuser, requires_2fa, sort_order) values
  ('hr_manager', 'HR Manager', 'Staff profiles, rosters, attendance, leave and payroll export.', true, false, false, 12)
on conflict (key) do nothing;

insert into role_permissions (role_key, permission)
select r, p from (values
  ('hr_manager', 'dashboard.view'), ('hr_manager', 'maintenance.report'),
  ('hr_manager', 'hr.view'), ('hr_manager', 'hr.manage'), ('hr_manager', 'hr.approve_leave'), ('hr_manager', 'hr.export'),
  ('manager', 'hr.view'), ('manager', 'hr.manage'), ('manager', 'hr.approve_leave'), ('manager', 'hr.export'),
  -- Supervisors see their teams' rosters and approve their leave.
  ('front_office_manager', 'hr.view'), ('front_office_manager', 'hr.approve_leave'),
  ('housekeeping_supervisor', 'hr.view'), ('housekeeping_supervisor', 'hr.approve_leave'),
  ('maintenance_supervisor', 'hr.view'), ('maintenance_supervisor', 'hr.approve_leave'),
  ('finance', 'hr.view'), ('finance', 'hr.export')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Departments and shift types ─────────────────────────────────────────────

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  sort_order  int not null default 0
);

insert into departments (name, sort_order)
select * from (values
  ('Management', 1), ('Front Office', 2), ('Housekeeping', 3), ('Engineering', 4),
  ('Food & Beverage', 5), ('Finance', 6), ('Sales & Marketing', 7), ('Security', 8)
) as seed (name, sort_order)
where not exists (select 1 from departments);

create table if not exists shift_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (length(trim(name)) > 0),
  start_time   time not null,
  end_time     time not null,
  -- Second half of a split shift.
  start_time_2 time,
  end_time_2   time,
  color        text not null default 'slate'
               check (color in ('slate', 'yellow', 'orange', 'indigo', 'emerald', 'rose', 'sky', 'violet')),
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  constraint split_both_or_neither check ((start_time_2 is null) = (end_time_2 is null))
);

insert into shift_types (name, start_time, end_time, start_time_2, end_time_2, color, sort_order)
select * from (values
  ('Morning',   time '07:00', time '15:00', null::time, null::time, 'yellow', 1),
  ('Afternoon', time '15:00', time '23:00', null::time, null::time, 'orange', 2),
  ('Night',     time '23:00', time '07:00', null::time, null::time, 'indigo', 3),
  ('Split',     time '07:00', time '11:00', time '17:00', time '21:00', 'emerald', 4)
) as seed (name, start_time, end_time, start_time_2, end_time_2, color, sort_order)
where not exists (select 1 from shift_types);

-- ── Staff HR profile ────────────────────────────────────────────────────────

alter table staff add column if not exists employee_code     text;
alter table staff add column if not exists department_id     uuid references departments on delete set null;
alter table staff add column if not exists joining_date      date;
-- Shift pattern: the usual shift, and the weekly day off (0 = Sunday).
alter table staff add column if not exists default_shift_id  uuid references shift_types on delete set null;
alter table staff add column if not exists weekly_off        smallint check (weekly_off between 0 and 6);
alter table staff add column if not exists address           text not null default '';
alter table staff add column if not exists emergency_contact text not null default '';

create unique index if not exists staff_employee_code_idx on staff (lower(employee_code)) where employee_code is not null;

-- HR maintains these without full staff-account access.
create or replace function set_staff_hr(
  p_staff uuid, p_code text, p_department uuid, p_designation text, p_joining date,
  p_shift uuid, p_weekly_off smallint, p_phone text, p_address text, p_emergency text
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not has_permission('hr.manage') then raise exception 'not permitted'; end if;
  update staff
     set employee_code = nullif(trim(p_code), ''),
         department_id = p_department,
         job_title = coalesce(trim(p_designation), ''),
         joining_date = p_joining,
         default_shift_id = p_shift,
         weekly_off = p_weekly_off,
         phone = coalesce(trim(p_phone), ''),
         address = coalesce(trim(p_address), ''),
         emergency_contact = coalesce(trim(p_emergency), '')
   where id = p_staff;
end;
$$;

-- ── Roster ──────────────────────────────────────────────────────────────────

create table if not exists staff_shifts (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references staff on delete cascade,
  shift_date     date not null,
  -- Null is a rostered day off.
  shift_type_id  uuid references shift_types on delete cascade,
  notes          text not null default '',
  updated_by     uuid references staff on delete set null,
  updated_at     timestamptz not null default now(),
  unique (staff_id, shift_date)
);

create index if not exists staff_shifts_date_idx on staff_shifts (shift_date);

-- ── Attendance ──────────────────────────────────────────────────────────────

alter table property_settings add column if not exists hr_geofence_lat numeric(9, 6);
alter table property_settings add column if not exists hr_geofence_lng numeric(9, 6);
alter table property_settings add column if not exists hr_geofence_radius_m int not null default 200
  check (hr_geofence_radius_m between 20 and 5000);
-- When on, self clock-in must come from a phone inside the radius.
alter table property_settings add column if not exists hr_require_geofence boolean not null default false;
alter table property_settings add column if not exists hr_late_grace_minutes int not null default 10
  check (hr_late_grace_minutes between 0 and 240);

create table if not exists attendance (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references staff on delete cascade,
  work_date       date not null,
  clock_in        timestamptz not null,
  clock_out       timestamptz,
  method          text not null check (method in ('manual', 'self', 'mobile', 'biometric')),
  -- Distance from the property when clocked in from a phone.
  in_distance_m   int,
  out_distance_m  int,
  notes           text not null default '',
  recorded_by     uuid references staff on delete set null,
  created_at      timestamptz not null default now(),
  constraint out_after_in check (clock_out is null or clock_out > clock_in)
);

create index if not exists attendance_date_idx on attendance (work_date, staff_id);
-- One open clock-in per person.
create unique index if not exists attendance_open_idx on attendance (staff_id) where clock_out is null;

create or replace function hr_distance_m(p_lat numeric, p_lng numeric)
returns int language sql stable security definer set search_path = public as $$
  select case when s.hr_geofence_lat is null or p_lat is null then null else
    round(6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - s.hr_geofence_lat) / 2), 2) +
      cos(radians(s.hr_geofence_lat)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - s.hr_geofence_lng) / 2), 2)
    )))::int end
    from property_settings s limit 1;
$$;

create or replace function hr_check_geofence(p_lat numeric, p_lng numeric)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  v_required boolean;
  v_radius   int;
  v_distance int := hr_distance_m(p_lat, p_lng);
begin
  select hr_require_geofence and hr_geofence_lat is not null, hr_geofence_radius_m
    into v_required, v_radius from property_settings limit 1;
  if v_required and p_lat is null then
    raise exception 'GEOFENCE: location needed' using errcode = 'P0001';
  end if;
  if v_required and v_distance > v_radius then
    raise exception 'GEOFENCE: % m from the hotel', v_distance using errcode = 'P0001';
  end if;
  return v_distance;
end;
$$;

-- Self-service clock-in for the signed-in staff member.
create or replace function clock_in(p_lat numeric default null, p_lng numeric default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_distance int;
  v_id uuid;
begin
  if not is_staff() then raise exception 'not permitted'; end if;
  if exists (select 1 from attendance where staff_id = auth.uid() and clock_out is null) then
    raise exception 'ALREADY_IN' using errcode = 'P0001';
  end if;
  v_distance := hr_check_geofence(p_lat, p_lng);
  insert into attendance (staff_id, work_date, clock_in, method, in_distance_m, recorded_by)
  values (auth.uid(), hk_business_today(), now(), case when p_lat is null then 'self' else 'mobile' end,
          v_distance, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function clock_out(p_lat numeric default null, p_lng numeric default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_distance int;
  v_id uuid;
begin
  if not is_staff() then raise exception 'not permitted'; end if;
  v_distance := hr_check_geofence(p_lat, p_lng);
  update attendance set clock_out = now(), out_distance_m = v_distance
   where staff_id = auth.uid() and clock_out is null
  returning id into v_id;
  if v_id is null then raise exception 'NOT_IN' using errcode = 'P0001'; end if;
  return v_id;
end;
$$;

-- Biometric devices report through the server (service role) by employee ID.
create or replace function attendance_device_event(p_code text, p_event text, p_at timestamptz default now())
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_staff uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not permitted'; end if;
  select id into v_staff from staff where lower(employee_code) = lower(trim(p_code)) and is_active;
  if v_staff is null then return 'unknown_employee'; end if;

  if p_event = 'in' then
    if exists (select 1 from attendance where staff_id = v_staff and clock_out is null) then
      return 'already_in';
    end if;
    insert into attendance (staff_id, work_date, clock_in, method)
    values (v_staff, (p_at at time zone coalesce((select timezone from property_settings limit 1), 'Asia/Kolkata'))::date,
            p_at, 'biometric');
    return 'clocked_in';
  elsif p_event = 'out' then
    update attendance set clock_out = p_at
     where staff_id = v_staff and clock_out is null and clock_in < p_at;
    return case when found then 'clocked_out' else 'not_in' end;
  end if;
  return 'bad_event';
end;
$$;

create or replace function set_hr_geofence(p_lat numeric, p_lng numeric, p_radius int, p_required boolean, p_grace int)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not has_permission('hr.manage') then raise exception 'not permitted'; end if;
  update property_settings
     set hr_geofence_lat = p_lat, hr_geofence_lng = p_lng, hr_geofence_radius_m = p_radius,
         hr_require_geofence = p_required and p_lat is not null, hr_late_grace_minutes = p_grace;
end;
$$;

-- ── Leave ───────────────────────────────────────────────────────────────────

create table if not exists leave_requests (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references staff on delete cascade,
  kind           text not null check (kind in ('casual', 'sick', 'earned', 'unpaid', 'other')),
  start_date     date not null,
  end_date       date not null,
  reason         text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid references staff on delete set null,
  decided_at     timestamptz,
  decision_note  text not null default '',
  created_at     timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date)
);

create index if not exists leave_requests_status_idx on leave_requests (status, start_date);
create index if not exists leave_requests_staff_idx on leave_requests (staff_id, start_date desc);

-- ── Guest feedback about staff ──────────────────────────────────────────────

create table if not exists staff_feedback (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff on delete cascade,
  booking_id   uuid references bookings on delete set null,
  rating       smallint not null check (rating between 1 and 5),
  comment      text not null default '',
  source       text not null default 'guest' check (source in ('guest', 'manager')),
  recorded_by  uuid references staff on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists staff_feedback_staff_idx on staff_feedback (staff_id, created_at desc);

-- ── Housekeeping knows who is working ───────────────────────────────────────

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
     -- Not on approved leave, and not rostered off that day.
     and not exists (select 1 from leave_requests l
                      where l.staff_id = s.id and l.status = 'approved'
                        and p_date between l.start_date and l.end_date)
     and not exists (select 1 from staff_shifts sh
                      where sh.staff_id = s.id and sh.shift_date = p_date and sh.shift_type_id is null)
   order by exists (select 1 from staff_shifts sh
                     where sh.staff_id = s.id and sh.shift_date = p_date and sh.shift_type_id is not null) desc,
            (p_floor is not null and p_floor = any (coalesce(z.floors, '{}'))) desc,
            (select count(*) from housekeeping_tasks t
              where t.assigned_to = s.id and t.task_date = p_date
                and t.status in ('pending', 'in_progress')) asc,
            s.full_name
   limit 1;
$$;

-- ── Row level security ──────────────────────────────────────────────────────

alter table departments     enable row level security;
alter table shift_types     enable row level security;
alter table staff_shifts    enable row level security;
alter table attendance      enable row level security;
alter table leave_requests  enable row level security;
alter table staff_feedback  enable row level security;

drop policy if exists departments_select on departments;
drop policy if exists departments_write  on departments;
create policy departments_select on departments for select using (is_staff());
create policy departments_write  on departments for all
  using (has_permission('hr.manage')) with check (has_permission('hr.manage'));

drop policy if exists shift_types_select on shift_types;
drop policy if exists shift_types_write  on shift_types;
create policy shift_types_select on shift_types for select using (is_staff());
create policy shift_types_write  on shift_types for all
  using (has_permission('hr.manage')) with check (has_permission('hr.manage'));

drop policy if exists staff_shifts_select on staff_shifts;
drop policy if exists staff_shifts_write  on staff_shifts;
create policy staff_shifts_select on staff_shifts for select
  using (staff_id = auth.uid() or has_permission('hr.view') or has_permission('hr.manage'));
create policy staff_shifts_write on staff_shifts for all
  using (has_permission('hr.manage')) with check (has_permission('hr.manage'));

-- Self clock-in goes through clock_in()/clock_out(); direct writes are HR's.
drop policy if exists attendance_select on attendance;
drop policy if exists attendance_write  on attendance;
create policy attendance_select on attendance for select
  using (staff_id = auth.uid() or has_permission('hr.view') or has_permission('hr.manage') or has_permission('hr.export'));
create policy attendance_write on attendance for all
  using (has_permission('hr.manage')) with check (has_permission('hr.manage'));

drop policy if exists leave_select on leave_requests;
drop policy if exists leave_insert on leave_requests;
drop policy if exists leave_update on leave_requests;
create policy leave_select on leave_requests for select
  using (staff_id = auth.uid() or has_permission('hr.view') or has_permission('hr.approve_leave')
         or has_permission('hr.export'));
create policy leave_insert on leave_requests for insert
  with check ((staff_id = auth.uid() and status = 'pending') or has_permission('hr.manage'));
-- Staff may cancel their own pending request; approvers decide others' (never their own).
create policy leave_update on leave_requests for update
  using ((staff_id = auth.uid() and status = 'pending')
         or (has_permission('hr.approve_leave') and staff_id <> auth.uid()))
  with check ((staff_id = auth.uid() and status in ('pending', 'cancelled'))
              or (has_permission('hr.approve_leave') and staff_id <> auth.uid()));

drop policy if exists staff_feedback_select on staff_feedback;
drop policy if exists staff_feedback_insert on staff_feedback;
drop policy if exists staff_feedback_delete on staff_feedback;
create policy staff_feedback_select on staff_feedback for select using (has_permission('hr.view'));
create policy staff_feedback_insert on staff_feedback for insert
  with check (has_permission('hr.manage') or has_permission('frontdesk.requests'));
create policy staff_feedback_delete on staff_feedback for delete using (has_permission('hr.manage'));

do $$
declare
  t record;
begin
  for t in select * from (values
    ('departments', 'hr'), ('shift_types', 'hr'), ('staff_shifts', 'hr'),
    ('attendance', 'hr'), ('leave_requests', 'hr'), ('staff_feedback', 'hr')
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
      alter publication supabase_realtime add table attendance;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table leave_requests;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
