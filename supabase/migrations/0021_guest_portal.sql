-- ============================================================================
-- Module 17 — Guest-Facing Web Booking Portal: accounts and self-service
--
--   • A guest account is an ordinary Supabase auth user with no staff row, so
--     every policy written so far already refuses it: has_permission() reads
--     the staff table and answers false for a guest. Nothing existing has to
--     be re-checked; what this migration adds is a small, explicit set of
--     guest-scoped permissions on top of that default of "no".
--   • Guests sign in with a one-time code emailed to them, so possession of
--     the address is proved on every sign-in. That is what makes it safe to
--     attach the account to stays the guest made earlier by phone or at the
--     desk, which are matched on email: with an unverified address, that
--     matching would be a way to read a stranger's booking history.
--   • Guests read through row level security but never write through it. A
--     select policy can scope rows; it cannot stop a guest who may update
--     their own booking row from changing its dates, its rate or its status.
--     So the one thing a guest may change — cancelling — goes through
--     guest_cancel_booking(), which decides the penalty itself and writes
--     only the columns a cancellation should touch.
--   • Likewise the guest's own profile: an update policy on guests would let
--     them award themselves a VIP tag or clear a blacklist reason, because
--     row level security cannot restrict columns. guest_update_profile()
--     whitelists the handful of fields a guest owns.
--
-- Run after 0020_revenue.sql.
-- ============================================================================

-- ── A new login is not a new member of staff ────────────────────────────────

/*
 * Guests may now create logins, so the sign-up trigger has to stop handing
 * out staff accounts.
 *
 * Since 0001 every insert into auth.users created a staff row — the first as
 * an administrator, everyone after as a front desk agent. That was safe while
 * the only way to get a login was an administrator creating one. It stops
 * being safe the moment the booking portal lets the public sign up: a guest
 * asking for a one-time code would have been handed a front-desk account, and
 * with it every booking and guest profile in the hotel.
 *
 * So the trigger now creates a staff row only to bootstrap a brand new
 * project, and app/admin/actions.ts writes the row itself when an
 * administrator creates a colleague. Everybody else — every guest — gets no
 * staff row, which is what makes has_permission() answer false for them and
 * every policy written before this migration refuse them.
 *
 * Note what is *not* trusted here. A browser calling signInWithOtp can put
 * whatever it likes in raw_user_meta_data, so a flag there can never be the
 * reason somebody becomes staff. It is only ever read to *decline* the
 * bootstrap, which takes privileges away rather than granting them, and which
 * closes the one remaining gap: a guest signing up on a property whose staff
 * list is still empty.
 */
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Marked by the guest portal. Only ever used to refuse, never to grant.
  if coalesce((new.raw_user_meta_data ->> 'is_guest')::boolean, false) then
    return new;
  end if;

  -- A project that already has staff creates them through the admin panel.
  if exists (select 1 from public.staff) then
    return new;
  end if;

  insert into public.staff (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'admin')
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ── The link between an auth user and a guest ───────────────────────────────

-- Null for the great majority of guests, who never open an account. Unique so
-- one login cannot claim two profiles; set null on delete so removing a login
-- leaves the stay history intact, which the hotel still needs.
alter table guests add column if not exists auth_user_id uuid references auth.users on delete set null;

create unique index if not exists guests_auth_user_idx on guests (auth_user_id)
  where auth_user_id is not null;

-- When the guest first opened their account, for the CRM.
alter table guests add column if not exists account_created_at timestamptz;

-- The guest behind the current request, or null when it is staff, the public
-- or nobody. Every guest-facing policy below is written in terms of this, so
-- there is one definition of "mine" rather than one per table.
--
-- An erased guest (Module 8 right-to-erasure) resolves to null: the account
-- stops seeing anything, which is the point of the erasure.
create or replace function current_guest()
returns uuid language sql stable security definer set search_path = public as $$
  select g.id
    from guests g
   where g.auth_user_id = auth.uid()
     and g.erased_at is null
   limit 1;
$$;

-- ── Signing in and linking ──────────────────────────────────────────────────

/*
 * Attaches the signed-in auth user to a guest profile, creating one if this
 * is a new customer.
 *
 * Called once, straight after the one-time code is verified. The email is
 * taken from the verified JWT rather than from anything the browser sent,
 * because the whole safety of matching on email rests on it having been
 * proved.
 *
 * Where a profile already exists for that address — the guest stayed last
 * year, booked by phone, or was created by the desk — the account attaches to
 * it and the guest sees that history. Where two profiles share an address,
 * the oldest wins and the rest are left for the desk's merge tool (Module 8),
 * because silently merging guest records is not this function's business.
 */
create or replace function guest_link_account()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_guest uuid;
begin
  if v_user is null then
    raise exception 'GUEST_NOT_SIGNED_IN' using hint = 'Sign in before opening an account.';
  end if;

  select lower(nullif(trim(u.email), '')) into v_email from auth.users u where u.id = v_user;
  if v_email is null then
    raise exception 'GUEST_NO_EMAIL' using hint = 'This login has no email address.';
  end if;

  -- Already linked.
  select id into v_guest from guests where auth_user_id = v_user and erased_at is null;
  if v_guest is not null then
    return v_guest;
  end if;

  -- An existing profile for this verified address, oldest first.
  select id into v_guest
    from guests
   where lower(email) = v_email
     and auth_user_id is null
     and erased_at is null
   order by created_at
   limit 1;

  if v_guest is not null then
    update guests
       set auth_user_id = v_user,
           account_created_at = coalesce(account_created_at, now())
     where id = v_guest;
    return v_guest;
  end if;

  insert into guests (full_name, email, auth_user_id, account_created_at)
  values (split_part(v_email, '@', 1), v_email, v_user, now())
  returning id into v_guest;

  return v_guest;
end;
$$;

/*
 * The fields a guest may change about themselves.
 *
 * Deliberately not an update policy: row level security grants a whole row or
 * none of it, and this row also carries the VIP and blacklist tags, the
 * loyalty tier and the erasure marker. A guest who could write the row could
 * write those.
 */
create or replace function guest_update_profile(
  p_full_name text,
  p_phone     text,
  p_language  text default null,
  p_dietary   text default null,
  p_preferences text default null,
  p_marketing boolean default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_guest uuid := current_guest();
begin
  if v_guest is null then
    raise exception 'GUEST_NOT_SIGNED_IN' using hint = 'Sign in to change your details.';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'GUEST_NAME_REQUIRED' using hint = 'Please give us a name for the booking.';
  end if;

  update guests
     set full_name   = left(trim(p_full_name), 200),
         phone       = nullif(left(trim(coalesce(p_phone, '')), 50), ''),
         language    = coalesce(nullif(trim(coalesce(p_language, '')), ''), language),
         dietary     = coalesce(left(trim(coalesce(p_dietary, '')), 500), dietary),
         preferences = coalesce(left(trim(coalesce(p_preferences, '')), 1000), preferences),
         marketing_opt_in = coalesce(p_marketing, marketing_opt_in),
         updated_at  = now()
   where id = v_guest;
end;
$$;

-- ── Cancelling a stay from the portal ───────────────────────────────────────

/*
 * Cancels the guest's own booking and charges whatever the rate plan says.
 *
 * The penalty is worked out here rather than accepted from the browser, and
 * from the same rate-plan fields the desk's cancellation uses, so a guest
 * cancelling online and the desk cancelling for them over the phone reach the
 * same number.
 *
 * Only a stay that has not started may be cancelled this way. Once the guest
 * is in the room it is a departure, not a cancellation, and the desk handles
 * it.
 */
create or replace function guest_cancel_booking(p_booking uuid, p_reason text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_guest   uuid := current_guest();
  v_b       record;
  v_plan    record;
  v_hours   numeric;
  v_stay    numeric;
  v_first   numeric;
  v_penalty numeric := 0;
  v_tz      text;
  v_in_time time;
begin
  if v_guest is null then
    raise exception 'GUEST_NOT_SIGNED_IN' using hint = 'Sign in to manage your booking.';
  end if;

  select * into v_b from bookings where id = p_booking and guest_id = v_guest;
  if not found then
    raise exception 'GUEST_BOOKING_NOT_FOUND' using hint = 'We could not find that booking on your account.';
  end if;

  if v_b.status in ('cancelled', 'no_show') then
    raise exception 'GUEST_ALREADY_CANCELLED' using hint = 'That booking is already cancelled.';
  end if;
  if v_b.status in ('checked_in', 'checked_out') then
    raise exception 'GUEST_STAY_STARTED'
      using hint = 'Your stay has already started. Please speak to the front desk.';
  end if;

  select property_timezone(), check_in_time into v_tz, v_in_time from property_settings limit 1;
  v_hours := extract(epoch from (
    ((v_b.check_in + coalesce(v_in_time, '14:00')) at time zone coalesce(v_tz, 'Asia/Kolkata')) - now()
  )) / 3600;

  -- The stay as sold: the stored nightly breakdown, all rooms.
  select coalesce(sum((e ->> 'rate')::numeric), 0) * v_b.rooms_count,
         coalesce(min((e ->> 'rate')::numeric) filter (where (e ->> 'date') = v_b.check_in::text), 0) * v_b.rooms_count
    into v_stay, v_first
    from jsonb_array_elements(
      case when jsonb_typeof(v_b.rate_breakdown) = 'array' then v_b.rate_breakdown else '[]'::jsonb end) e;

  if v_stay = 0 then
    v_stay  := coalesce(v_b.total_amount, 0);
    v_first := coalesce(v_b.quoted_rate, 0) * v_b.rooms_count;
  end if;

  select * into v_plan from rate_plans where id = v_b.rate_plan_id;

  if v_plan is null then
    v_penalty := 0;
  elsif v_plan.is_refundable and v_hours >= v_plan.free_cancellation_hours then
    v_penalty := 0;
  else
    v_penalty := case v_plan.cancellation_penalty
                   when 'none'        then 0
                   when 'first_night' then v_first
                   when 'full_stay'   then v_stay
                   when 'percent'     then round(v_stay * v_plan.cancellation_penalty_percent / 100, 2)
                   else 0
                 end;
  end if;

  -- The same columns the desk's cancellation writes, so a stay cancelled
  -- online and one cancelled over the phone read alike on the booking screen.
  -- cancelled_by stays null: no member of staff did this.
  update bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = left(coalesce(nullif(trim(p_reason), ''), 'Cancelled by the guest online'), 500),
         penalty_amount = v_penalty,
         penalty_waived = false,
         hold_until = null,
         updated_at = now()
   where id = p_booking;

  -- The charge goes on the folio like any other, so the desk and the reports
  -- see it without knowing it came from the website.
  if v_penalty > 0 then
    insert into folio_entries (booking_id, kind, description, amount, created_by)
    values (p_booking, 'penalty', 'Cancellation charge (cancelled online)', v_penalty, null);
  end if;

  return v_penalty;
end;
$$;

-- ── Best-rate guarantee ─────────────────────────────────────────────────────

-- SOW Module 17: "Best-rate guarantee messaging". The hotel's own words, so
-- it can be changed without a developer. Empty hides the message entirely.
alter table property_settings add column if not exists best_rate_message text not null default
  'Book direct for our best available rate. Find a lower public rate for the same room and dates elsewhere, and we will match it.';

-- ── Settings the portal may read ────────────────────────────────────────────

/*
 * The handful of settings the public website needs.
 *
 * property_settings is staff-only and stays that way: the row also holds the
 * GSTIN, the operating cost, the approval thresholds and the password policy,
 * and row level security grants whole rows, not columns. So rather than
 * opening the table, this function hands out the nine fields that are already
 * visible to anyone reading the website — its name, its phone number, the
 * currency it prices in, the languages it offers.
 *
 * Deliberately has no permission check, and must stay this narrow: anything
 * added to the select list below becomes public.
 *
 * Also needed for a signed-in *guest*, who is not staff: without this, the
 * portal would quietly fall back to built-in defaults and show the wrong
 * currency and languages.
 */
create or replace function portal_settings()
returns table (
  property_name          text,
  currency               text,
  multi_currency_enabled boolean,
  default_language       text,
  languages              text[],
  tax_label              text,
  best_rate_message      text,
  phone                  text,
  email                  text
) language sql stable security definer set search_path = public as $$
  select s.name, s.currency, s.multi_currency_enabled, s.default_language, s.languages,
         s.tax_label, s.best_rate_message, s.phone, s.email
    from property_settings s
   limit 1;
$$;

-- ── Row level security for guests ───────────────────────────────────────────

-- Each of these sits alongside the staff policies already on the table.
-- Postgres ORs permissive policies together, so a guest is granted exactly
-- the rows named here and staff keep what they had.

drop policy if exists guests_own_select on guests;
create policy guests_own_select on guests for select
  using (id = current_guest());

drop policy if exists bookings_own_select on bookings;
create policy bookings_own_select on bookings for select
  using (guest_id = current_guest());

-- What the guest paid and what is still due. Needed for the account page to
-- show a deposit link; scoped to the guest's own stays.
drop policy if exists payment_tx_own_select on payment_transactions;
create policy payment_tx_own_select on payment_transactions for select
  using (booking_id in (select id from bookings where guest_id = current_guest()));

-- The guest's own bill. Read-only, and only their own: folio_entries carries
-- every charge in the hotel.
drop policy if exists folio_entries_own_select on folio_entries;
create policy folio_entries_own_select on folio_entries for select
  using (booking_id in (select id from bookings where guest_id = current_guest()));

-- The tariff the portal quotes from needs no new policy: 0006 already lets
-- the public read active seasons and every restriction, and room types and
-- rate plans alongside them.

-- Exchange rates, so a price can be shown in the guest's own money
-- (SOW Module 17: "Multi-language and multi-currency display").
drop policy if exists currencies_public_select on currencies;
create policy currencies_public_select on currencies for select using (is_active);
