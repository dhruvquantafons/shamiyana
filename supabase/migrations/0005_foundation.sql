-- ============================================================================
-- Phase 2 foundation (SOW Module 15 and §6.6)
--
--   1. Roles become rows with a configurable permission set, replacing the
--      fixed staff_role enum. Nine default roles ship; administrators can edit
--      them and add their own.
--   2. Property settings — a single row holding hotel details, times, tax,
--      fees and security policy.
--   3. An append-only audit trail written by triggers, so every change is
--      recorded however it reaches the database.
--   4. Failed sign-in tracking for account lockout.
--
-- Run after 0004_staff_roles.sql.
-- ============================================================================

-- ── 1. Roles and permissions ────────────────────────────────────────────────

create table if not exists roles (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name          text not null,
  description   text not null default '',
  -- Shipped with the system. Can be edited but not deleted.
  is_system     boolean not null default false,
  -- Holds every permission, including ones added in future releases.
  is_superuser  boolean not null default false,
  requires_2fa  boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists role_permissions (
  role_key    text not null references roles (key) on delete cascade on update cascade,
  permission  text not null check (permission ~ '^[a-z_]+\.[a-z_]+$'),
  primary key (role_key, permission)
);

-- The SOW's minimum role list. Keys "admin", "manager", "front_desk" and
-- "housekeeping" already exist on staff rows, so they are kept.
insert into roles (key, name, description, is_system, is_superuser, requires_2fa, sort_order) values
  ('admin',                   'System Administrator',     'Everything, including staff accounts, roles and settings.', true, true,  true,  1),
  ('manager',                 'General Manager',          'Runs the property: reservations, front desk, rooms and rates.', true, false, false, 2),
  ('front_office_manager',    'Front Office Manager',     'Front desk plus overrides: overbooking, penalty waivers, night audit.', true, false, false, 3),
  ('front_desk',              'Front Desk Agent',         'Reservations, check-in and check-out.', true, false, false, 4),
  ('housekeeping_supervisor', 'Housekeeping Supervisor',  'Room status, inspections and room blocks.', true, false, false, 5),
  ('housekeeping',            'Housekeeping Staff',       'Room status updates.', true, false, false, 6),
  ('pos_cashier',             'POS Cashier',              'Posts outlet charges to guest folios.', true, false, false, 7),
  ('finance',                 'Finance / Accounts',       'Folios, payments and financial reports.', true, false, true,  8),
  ('sales_marketing',         'Sales & Marketing',        'Rate plans, corporate accounts and group bookings.', true, false, false, 9),
  ('maintenance',             'Maintenance / Engineering','Room blocks for repairs.', true, false, false, 10)
on conflict (key) do nothing;

insert into role_permissions (role_key, permission)
select r, p from (values
  -- General Manager
  ('manager', 'dashboard.view'), ('manager', 'bookings.view'), ('manager', 'bookings.create'),
  ('manager', 'bookings.edit'), ('manager', 'bookings.cancel'), ('manager', 'bookings.waive_penalty'),
  ('manager', 'bookings.overbook'), ('manager', 'bookings.groups'), ('manager', 'frontdesk.view'),
  ('manager', 'frontdesk.checkin'), ('manager', 'frontdesk.checkout'), ('manager', 'frontdesk.night_audit'),
  ('manager', 'frontdesk.requests'), ('manager', 'guests.view'), ('manager', 'guests.edit'),
  ('manager', 'guests.view_id'), ('manager', 'companies.manage'), ('manager', 'folio.view'),
  ('manager', 'folio.post'), ('manager', 'folio.payment'), ('manager', 'folio.adjust'),
  ('manager', 'rooms.view'), ('manager', 'rooms.status'), ('manager', 'rooms.block'),
  ('manager', 'rooms.manage'), ('manager', 'rates.view'), ('manager', 'rates.manage'),
  ('manager', 'audit.view'),
  -- Front Office Manager
  ('front_office_manager', 'dashboard.view'), ('front_office_manager', 'bookings.view'),
  ('front_office_manager', 'bookings.create'), ('front_office_manager', 'bookings.edit'),
  ('front_office_manager', 'bookings.cancel'), ('front_office_manager', 'bookings.waive_penalty'),
  ('front_office_manager', 'bookings.overbook'), ('front_office_manager', 'bookings.groups'),
  ('front_office_manager', 'frontdesk.view'), ('front_office_manager', 'frontdesk.checkin'),
  ('front_office_manager', 'frontdesk.checkout'), ('front_office_manager', 'frontdesk.night_audit'),
  ('front_office_manager', 'frontdesk.requests'), ('front_office_manager', 'guests.view'),
  ('front_office_manager', 'guests.edit'), ('front_office_manager', 'guests.view_id'),
  ('front_office_manager', 'companies.manage'), ('front_office_manager', 'folio.view'),
  ('front_office_manager', 'folio.post'), ('front_office_manager', 'folio.payment'),
  ('front_office_manager', 'folio.adjust'), ('front_office_manager', 'rooms.view'),
  ('front_office_manager', 'rooms.status'), ('front_office_manager', 'rooms.block'),
  ('front_office_manager', 'rates.view'), ('front_office_manager', 'audit.view'),
  -- Front Desk Agent
  ('front_desk', 'dashboard.view'), ('front_desk', 'bookings.view'), ('front_desk', 'bookings.create'),
  ('front_desk', 'bookings.edit'), ('front_desk', 'bookings.cancel'), ('front_desk', 'frontdesk.view'),
  ('front_desk', 'frontdesk.checkin'), ('front_desk', 'frontdesk.checkout'),
  ('front_desk', 'frontdesk.requests'), ('front_desk', 'guests.view'), ('front_desk', 'guests.edit'),
  ('front_desk', 'guests.view_id'), ('front_desk', 'folio.view'), ('front_desk', 'folio.post'),
  ('front_desk', 'folio.payment'), ('front_desk', 'rooms.view'), ('front_desk', 'rooms.status'),
  ('front_desk', 'rates.view'),
  -- Housekeeping Supervisor
  ('housekeeping_supervisor', 'dashboard.view'), ('housekeeping_supervisor', 'rooms.view'),
  ('housekeeping_supervisor', 'rooms.status'), ('housekeeping_supervisor', 'rooms.block'),
  ('housekeeping_supervisor', 'frontdesk.requests'),
  -- Housekeeping Staff
  ('housekeeping', 'dashboard.view'), ('housekeeping', 'rooms.view'), ('housekeeping', 'rooms.status'),
  -- POS Cashier
  ('pos_cashier', 'dashboard.view'), ('pos_cashier', 'folio.view'), ('pos_cashier', 'folio.post'),
  -- Finance / Accounts
  ('finance', 'dashboard.view'), ('finance', 'bookings.view'), ('finance', 'guests.view'),
  ('finance', 'companies.manage'), ('finance', 'folio.view'), ('finance', 'folio.post'),
  ('finance', 'folio.payment'), ('finance', 'folio.adjust'), ('finance', 'bookings.waive_penalty'),
  ('finance', 'rates.view'), ('finance', 'audit.view'),
  -- Sales & Marketing
  ('sales_marketing', 'dashboard.view'), ('sales_marketing', 'bookings.view'),
  ('sales_marketing', 'bookings.create'), ('sales_marketing', 'bookings.edit'),
  ('sales_marketing', 'bookings.groups'), ('sales_marketing', 'guests.view'),
  ('sales_marketing', 'companies.manage'), ('sales_marketing', 'rates.view'),
  ('sales_marketing', 'rates.manage'), ('sales_marketing', 'rooms.view'),
  -- Maintenance / Engineering
  ('maintenance', 'dashboard.view'), ('maintenance', 'rooms.view'), ('maintenance', 'rooms.block'),
  ('maintenance', 'frontdesk.requests')
) as seed (r, p)
on conflict do nothing;

-- ── staff.role: enum → text referencing roles ───────────────────────────────

-- The sign-up trigger casts to the enum, so it must be replaced before the
-- enum can go.
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
    case when (select count(*) from public.staff) = 0 then 'admin' else 'front_desk' end
  );
  return new;
end;
$$;

alter table staff alter column role drop default;
alter table staff alter column role type text using role::text;
alter table staff alter column role set default 'front_desk';
alter table staff drop constraint if exists staff_role_fkey;
alter table staff add constraint staff_role_fkey
  foreign key (role) references roles (key) on update cascade;
drop type if exists staff_role;

alter table staff add column if not exists last_seen_at        timestamptz;
alter table staff add column if not exists password_changed_at timestamptz not null default now();
alter table staff add column if not exists must_change_password boolean not null default false;

-- ── Permission checks used by every policy ─────────────────────────────────

create or replace function has_permission(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from staff s
      join roles r on r.key = s.role
     where s.id = auth.uid()
       and s.is_active
       and (
         r.is_superuser
         or exists (
           select 1 from role_permissions rp
            where rp.role_key = r.key and rp.permission = p
         )
       )
  );
$$;

-- The helpers earlier policies were written against, re-expressed as
-- permissions so those policies follow whatever the roles are configured to.
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('staff.manage');
$$;

create or replace function can_manage_rates()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('rates.manage');
$$;

create or replace function can_manage_bookings()
returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('bookings.view');
$$;

alter table roles            enable row level security;
alter table role_permissions enable row level security;

drop policy if exists roles_select on roles;
drop policy if exists roles_write  on roles;
drop policy if exists role_permissions_select on role_permissions;
drop policy if exists role_permissions_write  on role_permissions;

create policy roles_select on roles for select using (is_staff());
create policy roles_write  on roles for all
  using (has_permission('roles.manage')) with check (has_permission('roles.manage'));
create policy role_permissions_select on role_permissions for select using (is_staff());
create policy role_permissions_write  on role_permissions for all
  using (has_permission('roles.manage')) with check (has_permission('roles.manage'));

drop policy if exists staff_update on staff;
drop policy if exists staff_delete on staff;
create policy staff_update on staff for update
  using (has_permission('staff.manage')) with check (has_permission('staff.manage'));
create policy staff_delete on staff for delete using (has_permission('staff.manage'));

-- Staff may record their own activity without being able to edit their row.
create or replace function touch_staff_seen()
returns void language sql volatile security definer set search_path = public as $$
  update staff set last_seen_at = now() where id = auth.uid();
$$;

create or replace function mark_password_changed()
returns void language sql volatile security definer set search_path = public as $$
  update staff set password_changed_at = now(), must_change_password = false
   where id = auth.uid();
$$;

-- ── 2. Property settings ────────────────────────────────────────────────────

create table if not exists property_settings (
  id                        boolean primary key default true check (id),
  name                      text not null default 'Hotel Shamiyana',
  legal_name                text not null default '',
  address                   text not null default '',
  city                      text not null default 'Srinagar',
  state                     text not null default 'Jammu & Kashmir',
  country                   text not null default 'India',
  postcode                  text not null default '',
  phone                     text not null default '',
  email                     text not null default '',
  gstin                     text not null default '',
  currency                  text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  timezone                  text not null default 'Asia/Kolkata',
  check_in_time             time not null default '14:00',
  check_out_time            time not null default '12:00',
  -- The hotel's operating day. Night audit closes it and rolls it forward.
  business_date             date not null default current_date,
  -- Published rates include tax; the folio splits it out.
  tax_inclusive             boolean not null default true,
  -- Ascending slabs by nightly room value. A null ceiling is the top slab.
  -- Seeded with India's accommodation GST from 22 Sep 2025; confirm with
  -- the hotel's accountant before relying on it.
  tax_slabs                 jsonb not null default '[{"up_to": 7500, "rate": 5}, {"up_to": null, "rate": 18}]',
  tax_label                 text not null default 'GST',
  early_checkin_fee_type    text not null default 'percent' check (early_checkin_fee_type in ('none', 'percent', 'flat')),
  early_checkin_fee_value   numeric(10,2) not null default 50 check (early_checkin_fee_value >= 0),
  late_checkout_fee_type    text not null default 'percent' check (late_checkout_fee_type in ('none', 'percent', 'flat')),
  late_checkout_fee_value   numeric(10,2) not null default 50 check (late_checkout_fee_value >= 0),
  -- How long a tentative booking is held before night audit releases it.
  hold_hours                int not null default 24 check (hold_hours between 1 and 720),
  session_timeout_minutes   int not null default 30 check (session_timeout_minutes between 5 and 720),
  password_min_length       int not null default 10 check (password_min_length between 8 and 128),
  password_max_age_days     int not null default 90 check (password_max_age_days between 0 and 3650),
  max_failed_logins         int not null default 5 check (max_failed_logins between 3 and 50),
  lockout_minutes           int not null default 15 check (lockout_minutes between 1 and 1440),
  id_document_retention_days int not null default 365 check (id_document_retention_days between 30 and 3650),
  updated_at                timestamptz not null default now()
);

insert into property_settings (id, phone, email)
values (true, '0194-3500113', 'info@hotelsamciriviera.com')
on conflict (id) do nothing;

alter table property_settings enable row level security;
drop policy if exists settings_select on property_settings;
drop policy if exists settings_update on property_settings;
create policy settings_select on property_settings for select using (is_staff());
create policy settings_update on property_settings for update
  using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

drop trigger if exists property_settings_touch on property_settings;
create trigger property_settings_touch before update on property_settings
  for each row execute function touch_updated_at();

-- ── 3. Audit trail ──────────────────────────────────────────────────────────

create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_name   text not null default '',
  module       text not null,
  table_name   text not null default '',
  record_id    text,
  action       text not null,
  summary      text not null default '',
  changed      text[] not null default '{}',
  before       jsonb,
  after        jsonb
);

create index if not exists audit_log_record_idx on audit_log (table_name, record_id, occurred_at desc);
create index if not exists audit_log_time_idx   on audit_log (occurred_at desc);
create index if not exists audit_log_actor_idx  on audit_log (actor_id, occurred_at desc);
create index if not exists audit_log_module_idx on audit_log (module, occurred_at desc);

create or replace function current_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(full_name, '') from staff where id = auth.uid()),
    (select email from staff where id = auth.uid()),
    -- No signed-in person: the website (service role), a migration or a job.
    'System'
  );
$$;

-- Generic row trigger. The first trigger argument names the module.
create or replace function audit_row()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[] := '{}';
  v_id      text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), '{}')
      into v_changed
      from jsonb_each(v_after) a
     where a.key not in ('updated_at', 'last_seen_at')
       and a.value is distinct from v_before -> a.key;

    -- Nothing meaningful changed; do not pad the trail.
    if cardinality(v_changed) = 0 then return new; end if;

    -- Store only what changed, which keeps the trail readable.
    select jsonb_object_agg(k, v_before -> k), jsonb_object_agg(k, v_after -> k)
      into v_before, v_after
      from unnest(v_changed) k;
  end if;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id',
                   v_after ->> 'key', v_before ->> 'key',
                   v_after ->> 'role_key', v_before ->> 'role_key');

  insert into audit_log (actor_id, actor_name, module, table_name, record_id, action, changed, before, after)
  values (auth.uid(), current_actor_name(), tg_argv[0], tg_table_name, v_id,
          lower(tg_op), v_changed, v_before, v_after);

  return coalesce(new, old);
end;
$$;

-- Application-level events (check-in, night audit, sign-ins, overrides).
-- The actor is taken from the session, never from the caller.
create or replace function log_event(
  p_module text, p_action text, p_record_id text, p_summary text, p_details jsonb default null
)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'not permitted'; end if;
  insert into audit_log (actor_id, actor_name, module, record_id, action, summary, after)
  values (auth.uid(), current_actor_name(), p_module, p_record_id, p_action, p_summary, p_details);
end;
$$;

alter table audit_log enable row level security;
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select using (has_permission('audit.view'));
-- No insert, update or delete policies: rows arrive only through the
-- security-definer functions above, and nobody can rewrite history.
revoke update, delete, truncate on audit_log from anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('staff', 'staff'), ('roles', 'roles'), ('role_permissions', 'roles'),
    ('property_settings', 'settings'), ('room_types', 'rates'), ('extra_charges', 'rates'),
    ('rooms', 'rooms'), ('guests', 'guests'), ('bookings', 'bookings')
  ) as x (tbl, module) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_audit', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function audit_row(%L)',
      t.tbl || '_audit', t.tbl, t.module);
  end loop;
end;
$$;

-- ── 4. Sign-in attempts ─────────────────────────────────────────────────────

create table if not exists login_attempts (
  id            bigint generated always as identity primary key,
  email         text not null,
  succeeded     boolean not null,
  ip            text not null default '',
  attempted_at  timestamptz not null default now()
);

create index if not exists login_attempts_email_idx on login_attempts (lower(email), attempted_at desc);

-- Written and read only by the server with the service role key.
alter table login_attempts enable row level security;

-- ── Live updates for the desk ───────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table bookings;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table rooms;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
