-- ============================================================================
-- Event tax back in the GST return
--
-- 0019_events.sql made report_tax_summary include the tax on events that
-- carry their own bill. 0024_multi_property.sql rewrote the function to scope
-- it to one property and kept only the folio half, so an event billed to a
-- company or paid directly stopped appearing in the tax summary at all.
--
-- This restores the event half, scoped to the current property like the rest.
-- As before, an event charged to a guest's room is already on that folio, so
-- only events that carry their own bill are added.
--
-- Run after 0024_multi_property.sql.
-- ============================================================================

create or replace function report_tax_summary(p_from date, p_to date)
returns table (rate numeric, net numeric, tax numeric, entries int)
language plpgsql stable security definer set search_path = public as $$
declare v_property uuid := current_property();
begin
  if not (has_permission('reports.financial') or is_service_role()) then
    raise exception 'not permitted';
  end if;

  return query
  with folio as (
    select f.tax_rate as rate, f.amount as net, f.tax_amount as tax
      from folio_entries f
     where f.voided_at is null
       and f.property_id = v_property
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
       and e.property_id = v_property
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
