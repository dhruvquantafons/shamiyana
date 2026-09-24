import { createServiceClient } from "../../../lib/supabase/server";
import { hasBearer } from "../../../lib/bearer";
import { sendBookingMessage } from "../../../lib/notifications";
import { alertVipArrival } from "../../../lib/staff-alerts";
import { feedbackLinkFor } from "../../../lib/feedback-link";
import { addDays, todayIn } from "../../../lib/dates";
import { DEFAULT_SETTINGS } from "../../../lib/settings";
import type { PropertySettings } from "../../../lib/types";

/**
 * The timed guest messages (SOW Module 16).
 *
 * Three of the messages the SOW asks for are not caused by anything the desk
 * does — they are due because a date has arrived:
 *
 *   pre_arrival           notify_pre_arrival_days before check-in
 *   checkin_instructions  notify_checkin_days before check-in
 *   post_stay             notify_post_stay_days after check-out
 *
 * plus the VIP arrival alert to the desk for anyone arriving today.
 *
 * Run once a day from a scheduler (Vercel Cron sends
 * "Authorization: Bearer <CRON_SECRET>"; see vercel.json). Disabled until
 * CRON_SECRET is set.
 *
 * Safe to run more than once a day, and safe to miss a day: a partial unique
 * index on notifications refuses a second successful send of the same timed
 * message for the same booking, so a retry re-sends only what genuinely
 * failed. A day that is missed altogether is simply not sent — a reminder
 * that arrives after the guest has left is worse than none.
 */

const BOOKING_SELECT =
  "id, reference, check_in, check_out, adults, children, rooms_count, total_amount, " +
  "contact_name, contact_email, contact_phone, cancellation_reason, penalty_amount, " +
  "guest_id, is_vip, source, status, room_types(name), rate_plans(name, meal_plan)";

type Row = {
  id: string;
  guest_id: string | null;
  room_types?: { name: string } | null;
  rate_plans?: { name: string; meal_plan: string } | null;
  [key: string]: unknown;
};

/** The shape sendBookingMessage wants, from a joined row. */
const forMessage = (b: Row) => ({
  ...b,
  room_type_name: b.room_types?.name ?? null,
  rate_plan_name: b.rate_plans?.name ?? null,
  meal_plan: b.rate_plans?.meal_plan ?? null,
}) as Parameters<typeof sendBookingMessage>[2];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "The notifications job is not configured." }, { status: 503 });
  }
  if (!hasBearer(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase.from("property_settings").select("*").maybeSingle();
  const settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) } as PropertySettings;
  const today = todayIn(settings.timezone);

  const counts = { pre_arrival: 0, checkin_instructions: 0, post_stay: 0, vip_alerts: 0 };

  // ── Pre-arrival reminder and check-in instructions ──
  // Both look forward from today, and both only for stays that are actually
  // going to happen: a cancelled booking must never be reminded about.
  for (const [template, days] of [
    ["pre_arrival", settings.notify_pre_arrival_days],
    ["checkin_instructions", settings.notify_checkin_days],
  ] as const) {
    if (!(days > 0)) continue;

    const { data: due } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("check_in", addDays(today, days))
      .in("status", ["confirmed", "tentative"]);

    for (const booking of (due ?? []) as unknown as Row[]) {
      const summary = await sendBookingMessage(supabase, template, forMessage(booking), settings);
      if (summary.email?.status === "sent" || summary.sms?.status === "sent") counts[template]++;
    }
  }

  // ── Post-stay thank-you and feedback request ──
  if (settings.notify_post_stay_days > 0) {
    const { data: departed } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("check_out", addDays(today, -settings.notify_post_stay_days))
      .eq("status", "checked_out");

    for (const booking of (departed ?? []) as unknown as Row[]) {
      // The same private link the final bill carries, so a guest who kept
      // that email and one who gets this one reach the same form.
      const feedbackLink = await feedbackLinkFor(supabase, booking.id, booking.guest_id);
      const summary = await sendBookingMessage(supabase, "post_stay", forMessage(booking), settings, {
        feedbackLink: feedbackLink ?? undefined,
      });
      if (summary.email?.status === "sent" || summary.sms?.status === "sent") counts.post_stay++;
    }
  }

  // ── VIP arrivals today ──
  if (settings.notify_staff_vip_arrival) {
    const { data: vips } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("check_in", today)
      .eq("is_vip", true)
      .in("status", ["confirmed", "tentative"]);

    for (const booking of (vips ?? []) as unknown as Row[]) {
      const sent = await alertVipArrival(supabase, {
        id: booking.id,
        reference: String(booking.reference),
        contact_name: String(booking.contact_name ?? "Guest"),
        check_in: String(booking.check_in),
        check_out: String(booking.check_out),
        rooms_count: Number(booking.rooms_count ?? 1),
        total_amount: Number(booking.total_amount ?? 0),
        source: String(booking.source ?? ""),
        room_type_name: booking.room_types?.name ?? null,
      });
      if (sent > 0) counts.vip_alerts++;
    }
  }

  return Response.json({ date: today, ...counts });
}
