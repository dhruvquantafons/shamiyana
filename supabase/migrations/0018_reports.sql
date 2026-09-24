-- ============================================================================
-- Module 13 — Reporting, Analytics & Management Dashboard
--
--   • Every report is a security-definer function with its own permission
--     check, which is how the SOW's access rule ("financial reports
--     restricted to Management/Finance roles only") is actually enforced
--     rather than merely hidden in the interface.
--   • Daily figures prefer the snapshot the night audit stored for that date
--     and only compute live for dates it never closed. That is what makes a
--     report reproducible (SOW §6.6: "running the same report for the same
--     date range should always give the same result") — a stay amended in
--     March cannot silently rewrite January's revenue.
--   • Each row says which source it came from, so a manager can see at a
--     glance whether a figure is closed or still moving.
--
-- Run after 0017_pos.sql.
-- ============================================================================

-- ── Permissions ─────────────────────────────────────────────────────────────

insert into role_permissions (role_key, permission)
select r, p from (values
  ('manager', 'reports.view'),              ('manager', 'reports.financial'),
  ('manager', 'reports.schedule'),
  ('finance', 'reports.view'),              ('finance', 'reports.financial'),
  ('finance', 'reports.schedule'),
  ('front_office_manager', 'reports.view'),
  ('sales_marketing', 'reports.view')
) as seed (r, p)
where exists (select 1 from roles where key = seed.r)
on conflict do nothing;

-- ── Settings ────────────────────────────────────────────────────────────────

-- GOPPAR is gross operating profit per available room, and this system holds
-- no expense ledger — that is an accounting package's job and the SOW puts it
-- out of scope. The hotel enters its monthly running cost here and the report
-- prorates it across the days in range. Zero means GOPPAR is not reported
-- rather than reported as equal to revenue, which would be a lie.
alter table property_settings add column if not exists monthly_operating_cost numeric(14,2) not null default 0
  check (monthly_operating_cost >= 0);

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- The scheduler calls these reports with the service key, where there is no
-- signed-in user and auth.uid() is null. That is a trusted server-side
-- identity, but so is `anon` under a null auth.uid(), so the two must be told
-- apart: a SECURITY DEFINER function rewrites current_user to its owner,
-- while the `role` setting still holds whatever was SET for the caller.
create or replace function is_service_role()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('role', true), '') = 'service_role';
$$;

create or replace function property_timezone()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from property_settings limit 1), 'Asia/Kolkata');
$$;

-- The property's local date for a timestamp, so a charge posted at 1am is
-- counted on the right day.
create or replace function local_day(p_at timestamptz)
returns date language sql stable security definer set search_path = public as $$
  select (p_at at time zone property_timezone())::date;
$$;

-- Rooms that can be sold at all. Out-of-service rooms are off the inventory,
-- so counting them would understate occupancy for ever.
create or replace function sellable_rooms()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from rooms where status <> 'out_of_service';
$$;

-- ── Daily revenue and occupancy ────────────────────────────────────────────

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
begin
  if not (has_permission('reports.financial') or has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  audited as (
    select na.business_date,
           na.report
      from night_audits na
     where na.status = 'completed'
       and na.business_date between p_from and p_to
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
          and b.status in ('checked_in', 'checked_out'))
    ) as rooms_sold,
    coalesce(
      (a.report -> 'revenue' ->> 'room')::numeric,
      (select coalesce(sum(f.amount), 0)
         from folio_entries f
        where f.voided_at is null and f.kind = 'room' and f.stay_date = days.day)
    ) as room_revenue,
    coalesce(
      (a.report -> 'revenue' ->> 'fees')::numeric
        + (a.report -> 'revenue' ->> 'extras')::numeric
        + (a.report -> 'revenue' ->> 'penalties')::numeric,
      (select coalesce(sum(f.amount), 0)
         from folio_entries f
        where f.voided_at is null and f.kind in ('fee', 'extra', 'penalty')
          and local_day(f.created_at) = days.day)
    ) as other_revenue,
    coalesce(
      (a.report -> 'revenue' ->> 'tax')::numeric,
      (select coalesce(sum(f.tax_amount), 0)
         from folio_entries f
        where f.voided_at is null
          and f.kind in ('room', 'fee', 'extra', 'penalty')
          and coalesce(f.stay_date, local_day(f.created_at)) = days.day)
    ) as tax_total,
    coalesce(
      (a.report -> 'revenue' ->> 'total')::numeric,
      (select coalesce(sum(f.amount + f.tax_amount), 0)
         from folio_entries f
        where f.voided_at is null
          and f.kind in ('room', 'fee', 'extra', 'penalty')
          and coalesce(f.stay_date, local_day(f.created_at)) = days.day)
    ) as total_revenue
  from days
  left join audited a on a.business_date = days.day
  order by days.day;
end;
$$;

-- ── Tax summary ─────────────────────────────────────────────────────────────

-- What was charged at each rate, which is what a GST return needs. Read from
-- the folio rather than from invoices, so charges not yet invoiced are still
-- declared.
create or replace function report_tax_summary(p_from date, p_to date)
returns table (rate numeric, net numeric, tax numeric, entries int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select f.tax_rate,
         sum(f.amount)     as net,
         sum(f.tax_amount) as tax,
         count(*)::int     as entries
    from folio_entries f
   where f.voided_at is null
     and f.kind in ('room', 'fee', 'extra', 'penalty')
     and coalesce(f.stay_date, local_day(f.created_at)) between p_from and p_to
   group by f.tax_rate
   order by f.tax_rate;
end;
$$;

-- ── Payments taken ──────────────────────────────────────────────────────────

create or replace function report_payments(p_from date, p_to date)
returns table (method text, taken numeric, refunded numeric, count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select coalesce(f.method::text, 'unspecified') as method,
         sum(case when f.kind = 'payment' then f.amount else 0 end)              as taken,
         sum(case when f.kind = 'refund'  then f.amount + f.tax_amount else 0 end) as refunded,
         count(*)::int
    from folio_entries f
   where f.voided_at is null
     and f.kind in ('payment', 'refund')
     and local_day(f.created_at) between p_from and p_to
   group by 1
   order by 2 desc;
end;
$$;

-- ── Outlet sales (Module 6 feeding Module 13) ──────────────────────────────

create or replace function report_outlet_sales(p_from date, p_to date)
returns table (
  outlet text,
  kind   text,
  bills  int,
  covers int,
  net    numeric,
  tax    numeric,
  service numeric,
  tips   numeric,
  total  numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select o.name,
         o.kind,
         count(*)::int                         as bills,
         coalesce(sum(po.covers), 0)::int      as covers,
         coalesce(sum(po.net_total), 0)        as net,
         coalesce(sum(po.tax_total + po.service_tax), 0) as tax,
         coalesce(sum(po.service_net), 0)      as service,
         coalesce(sum(po.tip_amount), 0)       as tips,
         coalesce(sum(po.grand_total), 0)      as total
    from pos_orders po
    join pos_outlets o on o.id = po.outlet_id
   where po.status = 'settled'
     and local_day(coalesce(po.closed_at, po.opened_at)) between p_from and p_to
   group by o.name, o.kind, o.sort_order
   order by o.sort_order;
end;
$$;

-- How outlet bills were settled — cash at the till against charged to a room.
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
     and local_day(p.created_at) between p_from and p_to
   group by p.kind
   order by 2 desc;
end;
$$;

-- ── Outstanding money ───────────────────────────────────────────────────────

-- Stays that still owe money: guests in house, and guests who have left with
-- a balance. Corporate debt is deliberately not repeated here — the city
-- ledger's own aging already does that, and one implementation of "how
-- overdue is this" is better than two that can disagree.
create or replace function report_outstanding()
returns table (
  source    text,
  reference text,
  who       text,
  status    text,
  due_date  date,
  amount    numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select case when b.status = 'checked_in' then 'in_house' else 'departed' end,
         b.reference,
         b.contact_name,
         b.status::text,
         b.check_out,
         folio_balance(b.id)
    from bookings b
   where b.status in ('checked_in', 'checked_out')
     and folio_balance(b.id) > 0
   order by 6 desc;
end;
$$;

-- ── Booking performance ─────────────────────────────────────────────────────

create or replace function report_bookings(p_from date, p_to date)
returns table (
  source          text,
  bookings        int,
  room_nights     int,
  cancelled       int,
  no_shows        int,
  revenue         numeric
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
   group by b.source
   order by 2 desc;
end;
$$;

-- ── Housekeeping performance ───────────────────────────────────────────────

create or replace function report_housekeeping(p_from date, p_to date)
returns table (
  staff_name   text,
  tasks        int,
  inspected    int,
  failed       int,
  avg_minutes  numeric
) language plpgsql stable security definer set search_path = public as $$
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
     and t.status <> 'cancelled'
   group by 1
   order by 2 desc;
end;
$$;

-- ── Maintenance turnaround ─────────────────────────────────────────────────

create or replace function report_maintenance(p_from date, p_to date)
returns table (
  priority   text,
  raised     int,
  resolved   int,
  breached   int,
  avg_hours  numeric
) language plpgsql stable security definer set search_path = public as $$
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
   group by t.priority
   order by 2 desc;
end;
$$;

-- ── Guest and loyalty metrics ──────────────────────────────────────────────

create or replace function report_guests(p_from date, p_to date)
returns table (
  stays            int,
  distinct_guests  int,
  repeat_guests    int,
  feedback_count   int,
  avg_overall      numeric,
  loyalty_members  int,
  points_earned    int,
  points_redeemed  int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('reports.view') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  select
    (select count(*)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')),
    (select count(distinct b.guest_id)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')
        and b.guest_id is not null),
    -- A repeat guest is one who had already stayed before this stay began.
    (select count(distinct b.guest_id)::int from bookings b
      where b.check_in between p_from and p_to and b.status in ('checked_in', 'checked_out')
        and b.guest_id is not null
        and exists (select 1 from bookings prior
                     where prior.guest_id = b.guest_id
                       and prior.status in ('checked_in', 'checked_out')
                       and prior.check_in < b.check_in)),
    (select count(*)::int from guest_feedback gf
      where gf.submitted_at is not null and local_day(gf.submitted_at) between p_from and p_to),
    (select round(avg(gf.overall), 2) from guest_feedback gf
      where gf.submitted_at is not null and gf.overall is not null
        and local_day(gf.submitted_at) between p_from and p_to),
    (select count(*)::int from guests g where g.loyalty_opt_in and g.erased_at is null),
    (select coalesce(sum(lt.points), 0)::int from loyalty_transactions lt
      where lt.kind = 'earn' and local_day(lt.created_at) between p_from and p_to),
    (select coalesce(sum(-lt.points), 0)::int from loyalty_transactions lt
      where lt.kind = 'redeem' and local_day(lt.created_at) between p_from and p_to);
end;
$$;

-- ── Staff attendance ────────────────────────────────────────────────────────

create or replace function report_attendance(p_from date, p_to date)
returns table (
  staff_name  text,
  department  text,
  present     int,
  absent      int,
  leave_days  int,
  hours       numeric
) language plpgsql stable security definer set search_path = public as $$
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
             and lr.start_date <= p_to and lr.end_date >= p_from),
         round(coalesce(sum(
           case when a.clock_in is not null and a.clock_out is not null
                then extract(epoch from (a.clock_out - a.clock_in)) / 3600
           end
         ), 0), 1)
    from staff s
    left join departments d on d.id = s.department_id
    left join attendance a on a.staff_id = s.id and a.work_date between p_from and p_to
    left join staff_shifts sh on sh.staff_id = s.id and sh.shift_date between p_from and p_to
   where s.is_active
   group by s.id, s.full_name, d.name
   order by s.full_name;
end;
$$;

-- ── Scheduled reports ───────────────────────────────────────────────────────

-- SOW Module 13: "Scheduled email reports (daily/weekly/monthly) to
-- management". The cron endpoint reads this table; with no email keys set the
-- send is logged as skipped, exactly like every other notification.
create table if not exists report_schedules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  -- Which report to send. Matches the keys the app knows how to build.
  report       text not null check (report in ('daily_revenue', 'kpi_summary', 'outstanding', 'outlet_sales', 'housekeeping', 'maintenance')),
  frequency    text not null check (frequency in ('daily', 'weekly', 'monthly')),
  -- Comma-separated recipients. Kept as text so a manager can edit it
  -- without a developer, as the SOW asks for templates.
  recipients   text not null default '',
  is_active    boolean not null default true,
  last_sent_at timestamptz,
  last_status  text not null default '',
  created_by   uuid references staff on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists report_schedules_active_idx on report_schedules (is_active, frequency);

-- ── Row level security ──────────────────────────────────────────────────────

alter table report_schedules enable row level security;

drop policy if exists report_schedules_select on report_schedules;
drop policy if exists report_schedules_write  on report_schedules;
create policy report_schedules_select on report_schedules for select
  using (has_permission('reports.view') or has_permission('reports.schedule'));
create policy report_schedules_write on report_schedules for all
  using (has_permission('reports.schedule')) with check (has_permission('reports.schedule'));

-- ── Audit ───────────────────────────────────────────────────────────────────

drop trigger if exists report_schedules_audit on report_schedules;
create trigger report_schedules_audit after insert or update or delete on report_schedules
  for each row execute function audit_row('reports');
