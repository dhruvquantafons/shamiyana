-- Data as it would exist in production before this upgrade.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'admin@x.test', '{"full_name":"Asha Admin"}'),
  ('00000000-0000-0000-0000-000000000002', 'desk@x.test',  '{"full_name":"Dev Desk"}'),
  ('00000000-0000-0000-0000-000000000003', 'hk@x.test',    '{"full_name":"Hana Housekeeping"}');
update staff set role = 'housekeeping' where email = 'hk@x.test';
insert into rooms (room_number, room_type_id, floor, status)
select n, (select id from room_types where slug='premier-room'), 1, 'available'
  from unnest(array['101','102']) n;
insert into rooms (room_number, room_type_id, floor, status)
values ('103', (select id from room_types where slug='premier-room'), 1, 'maintenance');
insert into bookings (reference, room_type_id, check_in, check_out, status, source, contact_name, quoted_rate)
values ('SR-OLD1', (select id from room_types where slug='premier-room'), current_date + 10, current_date + 12, 'new', 'website', 'Old Enquiry', 9499);
