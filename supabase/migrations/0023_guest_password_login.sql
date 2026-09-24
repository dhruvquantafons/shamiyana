-- ============================================================================
-- Guest portal: a password as a second way in, for testing
--
-- Module 17 sign-in is a one-time code emailed to the address, and that stays
-- the way in for real guests. This migration exists for a practical problem on
-- a staging deployment: the sending address there can usually only deliver to
-- one inbox, which leaves the rest of a team unable to open /account at all.
--
-- The danger is specific. guest_link_account() adopts an existing guest
-- profile for the address, which is what lets a guest who booked by phone see
-- that stay when they first open an account. That is only safe because the
-- one-time code proves the address. A password proves knowledge of a password
-- and says nothing whatever about the address, so a password session must not
-- reach the adopt branch — otherwise signing up as someone@example.com would
-- hand over their stay history.
--
-- So: a password session always gets a fresh, empty profile. The check reads
-- the authentication method from the signed token rather than from anything
-- the browser sends, and is written as a deny-list — an unrecognised or
-- missing method still adopts. That direction matters: if Supabase ever
-- relabels how it marks a one-time code, the worst case is that this fails to
-- notice a password (which the app gates separately, behind
-- GUEST_PASSWORD_LOGIN) rather than silently breaking the main way in.
--
-- Run after 0022_notifications.sql.
-- ============================================================================

-- ── How did this session authenticate? ──────────────────────────────────────

/*
 * True when the current token says a password was used.
 *
 * Supabase records each authentication step in the JWT's "amr" claim (RFC
 * 8176), e.g. [{"method": "otp", "timestamp": ...}]. Reading it here rather
 * than trusting a flag from the browser is the whole point: raw_user_meta_data
 * is writable by whoever calls signUp, the amr claim is not.
 *
 * Defensive about shape — a missing claim, a null, or a claim that is not an
 * array must answer false rather than raise, because this is called from
 * guest_link_account() on every single sign-in.
 */
create or replace function auth_used_password()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from jsonb_array_elements(
             case
               when jsonb_typeof(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) = 'array'
                 then auth.jwt() -> 'amr'
               else '[]'::jsonb
             end
           ) as entry
     where entry ->> 'method' in ('password', 'email_password', 'pkce_password')
  );
$$;

-- ── Linking, with the adopt branch closed to passwords ──────────────────────

/*
 * Replaces the version in 0021. The only change is the guard around the
 * adopt-an-existing-profile branch; everything else is as it was.
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

  -- Already linked. Reached on every sign-in after the first, including every
  -- password sign-in once the fresh profile below exists.
  select id into v_guest from guests where auth_user_id = v_user and erased_at is null;
  if v_guest is not null then
    return v_guest;
  end if;

  -- An existing profile for this address, oldest first — but only where the
  -- address was actually proved. A password session skips this entirely and
  -- falls through to a new profile below.
  if not auth_used_password() then
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
  end if;

  insert into guests (full_name, email, auth_user_id, account_created_at)
  values (split_part(v_email, '@', 1), v_email, v_user, now())
  returning id into v_guest;

  return v_guest;
end;
$$;
