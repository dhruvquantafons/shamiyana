import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { hasSupabaseConfig } from "./supabase/config";
import type { Guest } from "./types";

/**
 * Guest accounts for the booking portal (SOW Module 17: "Guest account
 * creation to view/manage their own bookings").
 *
 * A guest is an ordinary Supabase auth user with no row in `staff`. That is
 * the whole separation from the admin side: has_permission() in the database
 * reads the staff table, so it answers false for a guest and every existing
 * policy refuses them by default. What a guest may see is granted explicitly
 * by the policies in 0021_guest_portal.sql, all written in terms of
 * current_guest().
 *
 * Sign-in is a one-time code emailed to the address, never a password. The
 * reason is not convenience: the account is matched to stays the guest made
 * earlier by phone or at the desk, and those are matched on email address. If
 * the address were not proved on every sign-in, that matching would be a way
 * to read a stranger's booking history. A code also means there is no
 * password here to store, reset or expire.
 *
 * Requires the Supabase project's "Magic Link" email template to include
 * {{ .Token }}, which is what puts the code in the email. How many digits
 * that is belongs to the project (Authentication → Email OTP length, 6 to
 * 10), so nothing here assumes a particular length.
 */

export interface GuestSession {
  guest: Guest;
  email: string;
}

/**
 * The signed-in guest, or null.
 *
 * Returns null for a signed-in *staff* member too: they have no guests row
 * linked to their login, so there is nothing of their own to show them.
 *
 * cache()d so a layout and the page inside it share one lookup per request,
 * the same way getSession() does for staff.
 */
export const getGuestSession = cache(async (): Promise<GuestSession | null> => {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  // Scoped by the guests_own_select policy, so this can only ever return the
  // caller's own row.
  const { data } = await supabase
    .from("guests")
    .select("*")
    .eq("auth_user_id", user.id)
    .is("erased_at", null)
    .maybeSingle();

  if (!data) return null;
  return { guest: data as Guest, email: user.email };
});

/** Emails a one-time code, creating the login on first use. */
export async function sendGuestCode(email: string): Promise<{ error: string | null }> {
  if (!hasSupabaseConfig()) {
    return { error: "Guest accounts are not available at the moment. Please call us." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // Read by handle_new_user() in 0021_guest_portal.sql, and only ever to
      // *decline* a staff row — never to grant one, because this metadata
      // comes from the browser and so cannot be trusted to hand out access.
      data: { is_guest: true },
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Checks the code, then attaches the login to a guest profile.
 *
 * guest_link_account() reads the email from the verified token rather than
 * from anything the browser sent, and either adopts the existing profile for
 * that address or creates one.
 */
export async function verifyGuestCode(
  email: string,
  token: string,
): Promise<{ error: string | null }> {
  if (!hasSupabaseConfig()) {
    return { error: "Guest accounts are not available at the moment. Please call us." };
  }
  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { error: error.message };

  const { error: linkError } = await supabase.rpc("guest_link_account");
  if (linkError) {
    // The code was good but the profile could not be attached, which would
    // leave a session that can see nothing. Better to end it and say so.
    await supabase.auth.signOut();
    return { error: "We could not open your account. Please call us and we will sort it out." };
  }
  return { error: null };
}

export async function signOutGuest() {
  if (!hasSupabaseConfig()) return;
  const supabase = await createClient();
  await supabase.auth.signOut();
}

// ── The password option ─────────────────────────────────────────────────────

/**
 * Whether the deployment offers a password as well as an emailed code.
 *
 * A testing affordance, not a feature. A staging deployment can usually only
 * email one address, which would otherwise leave the rest of a team unable to
 * open the account page at all. Off unless switched on, so production gets the
 * one-time code and nothing else.
 */
export function guestPasswordLoginEnabled(): boolean {
  return process.env.GUEST_PASSWORD_LOGIN === "true";
}

/**
 * Creates a login from an address and a password.
 *
 * Note what this does *not* buy: a password says nothing about whether the
 * person owns the address. guest_link_account() knows that — it reads the
 * token's amr claim and refuses to adopt an existing guest profile for a
 * password session — so an account made here always starts empty, whatever
 * address was typed. See 0023_guest_password_login.sql.
 */
export async function signUpGuestWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  if (!guestPasswordLoginEnabled()) return { error: "Passwords are not available here." };
  if (!hasSupabaseConfig()) {
    return { error: "Guest accounts are not available at the moment. Please call us." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    // Read by handle_new_user() only to decline a staff row, as with the code
    // flow. Never a reason to grant anything.
    options: { data: { is_guest: true } },
  });
  return { error: error?.message ?? null };
}

export async function signInGuestWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  if (!guestPasswordLoginEnabled()) return { error: "Passwords are not available here." };
  if (!hasSupabaseConfig()) {
    return { error: "Guest accounts are not available at the moment. Please call us." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

/**
 * Attaches a password session to a guest profile.
 *
 * Separate from verifyGuestCode() only because there is no code to check
 * first; the linking, and the cleanup when it fails, are the same.
 */
export async function linkGuestProfile(): Promise<{
  /** No session to link: Supabase is holding the signup for email confirmation. */
  unconfirmed: boolean;
  error: string | null;
}> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("guest_link_account");
  if (!error) return { unconfirmed: false, error: null };

  // Raised by guest_link_account() when auth.uid() is null, which after a
  // successful signup means only one thing: no session was issued because the
  // project has "Confirm email" switched on.
  if (error.message.includes("GUEST_NOT_SIGNED_IN")) {
    return { unconfirmed: true, error: null };
  }

  await supabase.auth.signOut();
  return {
    unconfirmed: false,
    error: "We could not open your account. Please call us and we will sort it out.",
  };
}
