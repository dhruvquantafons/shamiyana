-- ============================================================================
-- Module 5 — trim to the SOW
--
-- Tasks now come only from check-outs (and room moves) and the recurring
-- deep-clean schedule, as the SOW describes. Daily stay-over service and
-- touch-up tasks are no longer generated. Existing ones are cancelled.
--
-- Lost & found keeps the SOW's fields (room/location, date, description);
-- the category, storage and close-out columns stay in place but unused.
--
-- Run after 0009_housekeeping.sql.
-- ============================================================================

update housekeeping_tasks
   set status = 'cancelled'
 where kind in ('stayover', 'touch_up')
   and status in ('pending', 'in_progress', 'cleaned');

-- Deep cleans that have fallen due. Called by night audit and the board.
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
