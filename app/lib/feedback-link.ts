import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE } from "./site";

/**
 * The guest's private feedback link for a stay, creating it on first use.
 *
 * Shared by express check-out and by the nightly post-stay message, so a
 * guest who was emailed their bill and one who gets the thank-you a day later
 * are sent the same link rather than two competing ones. Returns null once
 * the feedback has been given, which is what stops a thank-you nagging
 * somebody who already answered.
 *
 * The token is the only credential the form has, so it is generated from a
 * cryptographic source and never derived from the booking.
 */
export async function feedbackLinkFor(
  supabase: SupabaseClient,
  bookingId: string,
  guestId: string | null,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("guest_feedback")
    .select("token, submitted_at")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (existing?.submitted_at) return null;

  let token = existing?.token as string | null | undefined;
  if (!existing) {
    token = randomBytes(24).toString("base64url");
    const { error } = await supabase
      .from("guest_feedback")
      .insert({ booking_id: bookingId, guest_id: guestId, token });
    if (error) return null;
  }

  return token ? `${SITE.url}/feedback/${token}` : null;
}
