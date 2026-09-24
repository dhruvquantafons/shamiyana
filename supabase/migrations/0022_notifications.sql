-- ============================================================================
-- Module 16 — Notifications Engine, completed
--
-- What 0008 and 0013 already built: a notifications log, four guest templates
-- editable per language, and email/SMS delivery that records a "skipped" row
-- when a provider is not configured. What the SOW asks for beyond that:
--
--   • The rest of the guest messages. A confirmation was sent; the pre-arrival
--     reminder, the check-in instructions and the post-stay thank-you were
--     not. All three are timed rather than event-driven, so they are sent by
--     the nightly job in app/api/cron/notifications rather than by a desk
--     action, and each is written against the booking so it can go out once
--     and only once.
--   • Staff notifications. The maintenance alerts in 0011 were the only ones.
--     A new booking, a VIP arriving today and a ticket being assigned now
--     reach the people whose permissions say it is their job.
--   • A history "per guest and per staff member". The log could only be read
--     by booking, which answers neither question: a guest's messages span
--     their stays, and a staff member's are not about a booking at all. Both
--     get a column and an index.
--
-- Out of scope, and deliberately:
--   • WhatsApp. The SOW's channel list marks "WhatsApp Business API
--     (optional)", and §5 lists it among the optional integrations.
--   • Push notifications. The SOW ties that channel to the mobile app
--     (Module 18), which this project is not building, so there is nothing
--     to push to. Email and SMS carry every trigger instead.
--   • The low-stock trigger. It fires from the POS stock module, which the
--     SOW itself marks "(optional stock module)" and which is not built, so
--     there is no stock level to be low. Every other trigger in the table is
--     wired.
--
-- Run after 0021_guest_portal.sql.
-- ============================================================================

-- ── The rest of the guest messages ──────────────────────────────────────────

-- The template key is constrained by an inline check from 0013, so it carries
-- whatever name Postgres gave it. Found by what it constrains rather than by
-- a guessed name; dropping the wrong one would leave the old four-value check
-- in place and reject every new template.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'message_templates'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%template%'
  loop
    execute format('alter table message_templates drop constraint %I', v_name);
  end loop;
end;
$$;

alter table message_templates add constraint message_templates_template_check
  check (template in (
    'request_received', 'confirmation', 'cancellation', 'final_bill',
    -- SOW Module 16: "pre-arrival reminder, check-in instructions, post-stay
    -- thank-you/feedback request".
    'pre_arrival', 'checkin_instructions', 'post_stay',
    -- Trigger events: "payment received" and "booking modified".
    'payment_receipt', 'booking_modified'
  ));

-- English wording the hotel can then edit under Settings → Templates. Kept
-- deliberately plain: it is placeholder copy for the property to make its
-- own, which is what "admins must be able to edit templates without needing a
-- developer" is for.
insert into message_templates (template, language, subject, body, footer, sms) values
  ('pre_arrival', 'en', 'Looking forward to seeing you — {Reference}',
   'We are looking forward to welcoming you to {HotelName} on {CheckInDate}. Your reservation {Reference} is confirmed and your room is being prepared.',
   'If your plans have changed, or you would like to arrange an airport pick-up or an early check-in, simply reply to this email or call us on {HotelPhone}.',
   '{HotelName}: we look forward to seeing you on {CheckInDate}. Reservation {Reference}. Call {HotelPhone} for anything you need.'),

  ('checkin_instructions', 'en', 'Your arrival tomorrow — {Reference}',
   'Your stay at {HotelName} begins tomorrow, {CheckInDate}. Check-in is from {CheckInTime}, and check-out on {CheckOutDate} is by {CheckOutTime}.',
   'Please bring a government-issued photo ID for every adult; foreign nationals need their passport and visa. If you expect to arrive late, do let us know on {HotelPhone} so we can hold your room.',
   '{HotelName}: see you tomorrow. Check-in from {CheckInTime}. Bring photo ID. Reservation {Reference}.'),

  ('post_stay', 'en', 'Thank you for staying with us — {Reference}',
   'Thank you for choosing {HotelName}, {FirstName}. It was a pleasure having you with us, and we hope the valley treated you kindly.',
   'If you have a moment, we would be grateful to hear how we did: {FeedbackLink}',
   '{HotelName}: thank you for staying with us. We would love your feedback: {FeedbackLink}'),

  ('payment_receipt', 'en', 'Payment received — {Reference}',
   'Thank you — we have received your payment of {Amount} towards reservation {Reference}.',
   'Your balance is now {Balance}. This message is a receipt of payment; your tax invoice is issued at check-out.',
   '{HotelName}: payment of {Amount} received for {Reference}. Balance {Balance}.'),

  ('booking_modified', 'en', 'Your booking has been updated — {Reference}',
   'Your reservation {Reference} at {HotelName} has been updated. The current details are below — please check them and tell us if anything is not as you expected.',
   'If you did not ask for this change, please call us at once on {HotelPhone}.',
   '{HotelName}: booking {Reference} updated. {StayDates}. Call {HotelPhone} if this is wrong.')
on conflict (template, language) do nothing;

-- ── A history per guest and per staff member ────────────────────────────────

-- Who the message was about, so a guest's history follows them across stays
-- rather than being scattered one booking at a time.
alter table notifications add column if not exists guest_id uuid references guests on delete set null;

-- Who it was sent *to*, when the recipient is a member of staff. created_by
-- already records who caused a message; this records who received one, which
-- is a different question and the one the SOW asks.
alter table notifications add column if not exists staff_id uuid references staff on delete set null;

alter table notifications add column if not exists kind text not null default 'guest'
  check (kind in ('guest', 'staff'));

create index if not exists notifications_guest_idx on notifications (guest_id, created_at desc);
create index if not exists notifications_staff_idx on notifications (staff_id, created_at desc);
create index if not exists notifications_template_idx on notifications (template, created_at desc);

-- Fills in the guest on the messages already sent, so the new history view
-- does not start empty.
update notifications n
   set guest_id = b.guest_id
  from bookings b
 where n.booking_id = b.id
   and n.guest_id is null
   and b.guest_id is not null;

/*
 * A timed message goes out once.
 *
 * The nightly job looks at a window of dates, and a window necessarily
 * overlaps the one before it — a reminder due "three days before arrival" is
 * due again tomorrow if nothing records that it went. Rather than trusting
 * the job to be careful, the database refuses the second one.
 *
 * Only successful sends are covered: a skipped or failed attempt should be
 * retried the next night, which is exactly what the hotel would want when
 * the SMS provider was down.
 */
create unique index if not exists notifications_timed_once_idx
  on notifications (booking_id, template, channel)
  where status = 'sent'
    and template in ('pre_arrival', 'checkin_instructions', 'post_stay');

-- ── When the timed messages go out ──────────────────────────────────────────

-- Days before arrival for the reminder. Zero switches it off.
alter table property_settings add column if not exists notify_pre_arrival_days int
  not null default 3 check (notify_pre_arrival_days between 0 and 30);

-- Days before arrival for the practical instructions — normally the day
-- before, which is when a guest is actually packing. Zero switches it off.
alter table property_settings add column if not exists notify_checkin_days int
  not null default 1 check (notify_checkin_days between 0 and 30);

-- Days after departure for the thank-you and feedback request. Zero switches
-- it off. A day later is the usual choice: long enough to be home, soon
-- enough to remember the stay.
alter table property_settings add column if not exists notify_post_stay_days int
  not null default 1 check (notify_post_stay_days between 0 and 30);

-- Staff alerts, each able to be turned off by a property that finds it noisy.
alter table property_settings add column if not exists notify_staff_new_booking boolean not null default true;
alter table property_settings add column if not exists notify_staff_vip_arrival boolean not null default true;
alter table property_settings add column if not exists notify_staff_ticket_assigned boolean not null default true;

-- ── Reading the log ─────────────────────────────────────────────────────────

-- The existing select policy is by is_staff(); a guest may now read the
-- messages that were sent to them about their own stays, which is the same
-- history the desk sees on their profile.
drop policy if exists notifications_own_select on notifications;
create policy notifications_own_select on notifications for select
  using (kind = 'guest' and guest_id = current_guest());
