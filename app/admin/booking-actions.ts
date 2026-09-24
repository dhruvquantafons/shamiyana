"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/server";
import { requirePermission, requireAnyPermission } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { loadPricingData, resolvePromo } from "../lib/rate-data";
import { quoteStay, flatBreakdown } from "../lib/pricing";
import { discountNights, nightsTotal } from "../lib/revenue";
import { cancellationPenalty, noShowPenalty, describePenalty } from "../lib/policies";
import { friendlyDbError, isOverbooked } from "../lib/db-errors";
import { sendBookingMessage, describeSend, type Template } from "../lib/notifications";
import { alertNewBooking } from "../lib/staff-alerts";
import { eachNight, hoursUntil, todayIn } from "../lib/dates";
import type {
  Booking,
  BookingSource,
  NightRate,
  PaymentMethod,
  PropertySettings,
  RatePlan,
} from "../lib/types";
import { rankRooms } from "../lib/room-assignment";
import {
  type ActionState,
  str,
  num,
  int,
  bool,
  oneOf,
  oneOfOrNull,
  dateStr,
  uuidOrNull,
} from "./form-utils";

const SOURCES: BookingSource[] = [
  "walk_in", "phone", "email", "website", "ota", "travel_agent", "corporate", "mobile_app",
];
const PAYMENT_METHODS: PaymentMethod[] = [
  "cash", "card", "upi", "bank_transfer", "online_gateway", "corporate_billing", "ota_prepaid", "wallet", "other",
];
const ID_TYPES = ["passport", "aadhaar", "driving_licence", "voter_id", "pan", "other"] as const;

const BOOKING_SELECT =
  "*, guests(id, full_name, email, phone), room_types(id, name), rooms(id, room_number), rate_plans(*), companies(id, name)";

type BookingWithPlan = Booking & { rate_plans: RatePlan | null };

function revalidateBooking(id?: string) {
  if (id) revalidatePath(`/admin/bookings/${id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/front-desk");
  revalidatePath("/admin/tape-chart");
  revalidatePath("/admin/rooms");
  revalidatePath("/admin");
}

async function loadBooking(supabase: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await supabase.from("bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  return (data as BookingWithPlan | null) ?? null;
}

/** Hours from now until check-in time on the arrival date, at the hotel. */
function hoursBeforeArrival(booking: Pick<Booking, "check_in">, settings: PropertySettings) {
  return hoursUntil(booking.check_in, settings.check_in_time, settings.timezone);
}

function cancellationPolicyText(plan: RatePlan | null) {
  if (!plan) return null;
  if (!plan.is_refundable) {
    return `Non-refundable: ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)} on cancellation.`;
  }
  return `Free cancellation until ${plan.free_cancellation_hours} hours before arrival; after that, ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)}.`;
}

/** The fields the guest-facing templates need, from a loaded booking. */
function messageFields(b: BookingWithPlan) {
  return {
    ...b,
    room_type_name: b.room_types?.name ?? null,
    rate_plan_name: b.rate_plans?.name ?? null,
    meal_plan: b.rate_plans?.meal_plan ?? null,
    cancellation_policy: cancellationPolicyText(b.rate_plans),
  };
}

/**
 * Emails a receipt for a payment just taken, with the balance that is left.
 *
 * The balance is read back from the folio rather than worked out here, so the
 * figure the guest is told matches the one the desk sees.
 */
async function sendPaymentReceipt(
  supabase: SupabaseClient,
  bookingId: string,
  amount: number,
  staffId: string,
) {
  const [booking, settings] = await Promise.all([loadBooking(supabase, bookingId), getSettings()]);
  if (!booking) return "Booking not found.";

  const { data: balance } = await supabase.rpc("folio_balance", { p_booking: bookingId });

  const summary = await sendBookingMessage(supabase, "payment_receipt", messageFields(booking), settings, {
    staffId,
    amount,
    bill: { lines: [], balance: Number(balance ?? 0) },
  });
  return describeSend(summary);
}

async function sendMessage(
  supabase: SupabaseClient,
  template: Template,
  bookingId: string,
  staffId: string,
) {
  const [booking, settings] = await Promise.all([loadBooking(supabase, bookingId), getSettings()]);
  if (!booking) return "Booking not found.";
  const summary = await sendBookingMessage(supabase, template, messageFields(booking), settings, { staffId });
  if (template === "confirmation" && (summary.email?.status === "sent" || summary.sms?.status === "sent")) {
    await supabase.from("bookings").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", bookingId);
  }
  return describeSend(summary);
}

/** Finds a guest by email or phone, or creates one. */
async function findOrCreateGuest(
  supabase: SupabaseClient,
  details: { name: string; email: string; phone: string; nationality: string; companyId: string | null; isVip: boolean },
) {
  let guestId: string | null = null;
  if (details.email || details.phone) {
    const query = supabase.from("guests").select("id, tags, blacklist_reason").is("erased_at", null).limit(1);
    const { data } = details.email
      ? await query.ilike("email", details.email)
      : await query.eq("phone", details.phone);
    guestId = data?.[0]?.id ?? null;
    if (guestId && details.isVip && !(data?.[0]?.tags ?? []).includes("VIP")) {
      await supabase.from("guests").update({ tags: [...(data?.[0]?.tags ?? []), "VIP"] }).eq("id", guestId);
    }
    if (guestId && (data?.[0]?.tags ?? []).includes("Blacklisted")) {
      return { id: guestId, error: null, blacklisted: (data?.[0]?.blacklist_reason as string) || "no reason recorded" };
    }
  }
  if (guestId) return { id: guestId, error: null };

  const { data, error } = await supabase
    .from("guests")
    .insert({
      full_name: details.name,
      email: details.email || null,
      phone: details.phone || null,
      nationality: details.nationality || "Indian",
      company_id: details.companyId,
      tags: details.isVip ? ["VIP"] : [],
    })
    .select("id")
    .single();
  return { id: (data?.id as string | undefined) ?? null, error: error?.message ?? null };
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.create");
  const supabase = await createClient();
  const settings = await getSettings();

  const name = str(fd, "contact_name", 200);
  const phone = str(fd, "contact_phone", 50);
  const email = str(fd, "contact_email", 200).toLowerCase();
  const checkIn = dateStr(fd, "check_in");
  const checkOut = dateStr(fd, "check_out");
  const roomTypeId = uuidOrNull(fd, "room_type_id");
  const ratePlanId = uuidOrNull(fd, "rate_plan_id");
  const status = oneOf(fd, "status", ["tentative", "confirmed", "waitlisted"] as const, "confirmed");
  const paymentMethod = oneOfOrNull(fd, "payment_method", PAYMENT_METHODS);
  const idType = oneOfOrNull(fd, "id_type", ID_TYPES);
  const idNumber = str(fd, "id_number", 50);

  // SOW Module 1 "minimum data per booking".
  if (!name) return { error: "Guest name is required." };
  if (!phone) return { error: "A contact number is required." };
  if (!email) return { error: "An email address is required." };
  if (!checkIn || !checkOut) return { error: "Both dates are required." };
  if (checkOut <= checkIn) return { error: "Check-out must be after check-in." };
  if (!roomTypeId) return { error: "Choose a room type." };
  if (!ratePlanId) return { error: "Choose a rate plan." };
  if (!paymentMethod) return { error: "Choose how the guest will pay." };
  if (idNumber && !idType) return { error: "Choose the type of ID for that number." };
  if (checkIn < todayIn(settings.timezone) && status !== "waitlisted") {
    return { error: "Arrival is in the past. Use today's date for a walk-in." };
  }

  const pricing = await loadPricingData(supabase);
  const roomType = pricing.roomTypes.find((t) => t.id === roomTypeId);
  const plan = pricing.plans.find((p) => p.id === ratePlanId) ?? null;
  if (!roomType) return { error: "That room type no longer exists." };
  if (!plan) return { error: "That rate plan no longer exists." };

  const adults = int(fd, "adults", 2, 1, 50);
  const children = int(fd, "children", 0, 0, 50);
  const rooms = int(fd, "rooms_count", 1, 1, 50);

  const quote = quoteStay({
    roomType,
    plan,
    checkIn,
    checkOut,
    adults,
    children,
    rooms,
    seasons: pricing.seasons,
    restrictions: pricing.restrictions,
    extraCharges: pricing.extraCharges,
    adjustments: pricing.adjustments,
  });

  const overrideRestrictions = bool(fd, "override_restrictions") && can(session, "bookings.overbook");
  if (quote.violations.length && !overrideRestrictions) {
    return { error: quote.violations.join(" ") };
  }

  // A manual nightly rate replaces the calculated one for every night.
  const rateOverride = num(fd, "rate_override");
  let breakdown: NightRate[] = quote.nights;
  if (rateOverride !== null) {
    if (!can(session, "bookings.edit")) return { error: "Your role cannot override the rate." };
    if (rateOverride < 0) return { error: "Enter a valid nightly rate." };
    breakdown = flatBreakdown(checkIn, checkOut, rateOverride);
  }
  const grossTotal = breakdown.reduce((s, n) => s + n.rate, 0) * rooms;

  // A promo code the desk has typed in. Checked here rather than trusted from
  // the form, and refused out loud: unlike the public site, the person at the
  // desk can fix a wrong code and try again.
  const typedPromo = str(fd, "promo_code", 40).toUpperCase();
  const promo = await resolvePromo(
    supabase,
    typedPromo,
    {
      checkIn,
      checkOut,
      roomTypeId,
      ratePlanId,
      amount: grossTotal,
      today: todayIn(settings.timezone),
    },
    { email },
  );
  if (typedPromo && !promo.codeId && promo.reason) return { error: promo.reason };

  // The discount goes into the nightly rates, not just the total, so the folio
  // bills the discounted figure and the tax follows it.
  breakdown = discountNights(breakdown, promo.discount, rooms);
  const total = nightsTotal(breakdown, rooms);
  // What was actually given, after the rupee rounding above.
  const discountGiven = grossTotal - total;
  const average = breakdown.length ? Math.round(total / rooms / breakdown.length) : 0;
  const deposit = Math.round((total * Number(plan.deposit_percent)) / 100);

  const companyId = uuidOrNull(fd, "company_id");
  const isVip = bool(fd, "is_vip");
  const guest = await findOrCreateGuest(supabase, {
    name,
    email,
    phone,
    nationality: str(fd, "nationality", 80),
    companyId,
    isVip,
  });
  if (!guest.id) return { error: friendlyDbError(guest.error) };
  if ("blacklisted" in guest && guest.blacklisted && !bool(fd, "blacklist_ok")) {
    return {
      error: `${name} is blacklisted (${guest.blacklisted}). Tick "Book even though the guest is blacklisted" to go ahead.`,
    };
  }

  if (idType && idNumber) {
    const { error } = await supabase.rpc("set_guest_identity", {
      p_guest: guest.id,
      p_type: idType,
      p_number: idNumber,
      p_country: str(fd, "issuing_country", 80) || "India",
    });
    if (error) return { error: friendlyDbError(error.message) };
  }

  const overbookReason = str(fd, "overbook_reason", 500);
  if (overbookReason && !can(session, "bookings.overbook")) {
    return { error: "Your role cannot override overbooking." };
  }

  const preferredFloor = num(fd, "preferred_floor");
  const eta = str(fd, "eta", 5);

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      guest_id: guest.id,
      company_id: companyId,
      room_type_id: roomTypeId,
      rate_plan_id: ratePlanId,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      children,
      rooms_count: rooms,
      status,
      source: oneOf(fd, "source", SOURCES, "phone"),
      payment_method: paymentMethod,
      promo_code: typedPromo,
      promo_code_id: promo.codeId,
      promo_discount: discountGiven,
      quoted_rate: average,
      total_amount: total,
      rate_breakdown: breakdown,
      deposit_required: deposit,
      hold_until:
        status === "tentative"
          ? new Date(Date.now() + settings.hold_hours * 3600000).toISOString()
          : null,
      preferred_floor: preferredFloor === null ? null : Math.round(preferredFloor),
      preferred_view: str(fd, "preferred_view", 80),
      is_vip: isVip,
      eta: /^\d{2}:\d{2}$/.test(eta) ? eta : null,
      special_requests: str(fd, "special_requests"),
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      overbook_reason: overbookReason,
      created_by: session.staff.id,
    })
    .select("id, reference")
    .single();

  if (error) {
    return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };
  }

  // The redemption row follows the booking's promo_code_id in the database
  // (0020_revenue.sql), so there is nothing to record here.

  // Deposit taken while on the phone.
  const depositPaid = num(fd, "deposit_amount");
  if (depositPaid && depositPaid > 0) {
    const method = oneOfOrNull(fd, "deposit_method", PAYMENT_METHODS) ?? paymentMethod;
    await supabase.from("folio_entries").insert({
      booking_id: data.id,
      kind: "payment",
      description: "Advance deposit",
      amount: depositPaid,
      method,
      reference: str(fd, "deposit_reference", 100),
      is_deposit: true,
      created_by: session.staff.id,
    });
  }

  if (status === "confirmed" && bool(fd, "send_confirmation")) {
    await sendMessage(supabase, "confirmation", data.id, session.staff.id);
  }

  // SOW Module 16, trigger event "booking created".
  if (settings.notify_staff_new_booking) {
    await alertNewBooking(
      supabase,
      {
        id: data.id,
        reference: data.reference,
        contact_name: name,
        check_in: checkIn,
        check_out: checkOut,
        rooms_count: rooms,
        total_amount: total,
        source: oneOf(fd, "source", SOURCES, "phone"),
        room_type_name: roomType.name,
      },
      session.staff.id,
    );
  }

  revalidateBooking();
  redirect(`/admin/bookings/${data.id}`);
}

// ── Status changes ─────────────────────────────────────────────────────────

export async function confirmBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.edit");
  const supabase = await createClient();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (!["tentative", "waitlisted"].includes(booking.status)) {
    return { error: "Only tentative or waitlisted bookings can be confirmed." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "confirmed", hold_until: null, overbook_reason: str(fd, "overbook_reason", 500) || booking.overbook_reason })
    .eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };

  let sent = "";
  if (bool(fd, "send_confirmation")) sent = " " + (await sendMessage(supabase, "confirmation", booking.id, session.staff.id));

  revalidateBooking(booking.id);
  return { success: `Confirmed.${sent}` };
}

/** Moves a cancelled or waitlisted booking back into play. */
export async function reinstateBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("bookings.edit");
  const supabase = await createClient();
  const settings = await getSettings();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (!["cancelled", "no_show"].includes(booking.status)) {
    return { error: "Only cancelled or no-show bookings can be reinstated." };
  }
  if (booking.check_out <= todayIn(settings.timezone)) {
    return { error: "That stay is already over." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "tentative",
      cancelled_at: null,
      cancelled_by: null,
      hold_until: new Date(Date.now() + settings.hold_hours * 3600000).toISOString(),
    })
    .eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };

  revalidateBooking(booking.id);
  return { success: "Reinstated as tentative. Any penalty already posted stays on the folio until voided." };
}

export async function cancelBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.cancel");
  const supabase = await createClient();
  const settings = await getSettings();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (!["tentative", "confirmed", "waitlisted"].includes(booking.status)) {
    return { error: "Only bookings that have not arrived can be cancelled." };
  }

  const reason = str(fd, "reason", 500);
  if (!reason) return { error: "Give a reason for the cancellation." };

  const waive = bool(fd, "waive_penalty");
  if (waive && !can(session, "bookings.waive_penalty")) {
    return { error: "Your role cannot waive cancellation penalties." };
  }

  // Waitlisted bookings never held a room, so they carry no penalty.
  const penalty =
    booking.status === "waitlisted"
      ? { amount: 0, explanation: "Waitlisted — no penalty." }
      : cancellationPenalty(
          booking.rate_plans,
          booking.rate_breakdown ?? [],
          booking.rooms_count,
          hoursBeforeArrival(booking, settings),
        );
  const charge = waive ? 0 : penalty.amount;

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: session.staff.id,
      cancellation_reason: reason,
      penalty_amount: penalty.amount,
      penalty_waived: waive && penalty.amount > 0,
      hold_until: null,
    })
    .eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message) };

  if (charge > 0) {
    await supabase.from("folio_entries").insert({
      booking_id: booking.id,
      kind: "penalty",
      description: `Cancellation charge — ${penalty.explanation}`,
      amount: charge,
      created_by: session.staff.id,
    });
  }

  let sent = "";
  if (bool(fd, "notify_guest")) sent = " " + (await sendMessage(supabase, "cancellation", booking.id, session.staff.id));

  revalidateBooking(booking.id);
  return {
    success: `Cancelled. ${charge > 0 ? `Penalty of ₹${charge.toLocaleString("en-IN")} posted to the folio.` : waive && penalty.amount > 0 ? "Penalty waived." : "No penalty."}${sent}`,
  };
}

export async function markNoShow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.cancel");
  const supabase = await createClient();
  const settings = await getSettings();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (!["tentative", "confirmed"].includes(booking.status)) {
    return { error: "Only an expected arrival can be marked as a no-show." };
  }
  if (booking.check_in > settings.business_date) {
    return { error: "The guest is not due yet." };
  }

  const waive = bool(fd, "waive_penalty");
  if (waive && !can(session, "bookings.waive_penalty")) {
    return { error: "Your role cannot waive penalties." };
  }

  const penalty = noShowPenalty(booking.rate_plans, booking.rate_breakdown ?? [], booking.rooms_count);
  const charge = waive ? 0 : penalty.amount;

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "no_show",
      cancelled_at: new Date().toISOString(),
      cancelled_by: session.staff.id,
      cancellation_reason: str(fd, "reason", 500) || "Guest did not arrive",
      penalty_amount: penalty.amount,
      penalty_waived: waive && penalty.amount > 0,
      hold_until: null,
    })
    .eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message) };

  if (charge > 0) {
    await supabase.from("folio_entries").insert({
      booking_id: booking.id,
      kind: "penalty",
      description: penalty.explanation,
      amount: charge,
      created_by: session.staff.id,
    });
  }

  revalidateBooking(booking.id);
  return { success: `Marked as no-show.${charge > 0 ? ` ₹${charge.toLocaleString("en-IN")} posted to the folio.` : ""}` };
}

// ── Amendments ─────────────────────────────────────────────────────────────

export async function updateBookingDetails(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.edit");
  const supabase = await createClient();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (["checked_out", "cancelled", "no_show"].includes(booking.status)) {
    return { error: "This booking is closed and can no longer be amended." };
  }

  const checkIn = dateStr(fd, "check_in");
  const checkOut = dateStr(fd, "check_out");
  if (!checkIn || !checkOut) return { error: "Both dates are required." };
  if (checkOut <= checkIn) return { error: "Check-out must be after check-in." };
  if (booking.status === "checked_in" && checkIn !== booking.check_in) {
    return { error: "The guest has arrived; the check-in date cannot change." };
  }

  const roomTypeId = uuidOrNull(fd, "room_type_id");
  const ratePlanId = uuidOrNull(fd, "rate_plan_id");
  const adults = int(fd, "adults", booking.adults, 1, 50);
  const children = int(fd, "children", booking.children, 0, 50);
  const rooms = int(fd, "rooms_count", booking.rooms_count, 1, 50);

  const pricingChanged =
    checkIn !== booking.check_in ||
    checkOut !== booking.check_out ||
    roomTypeId !== booking.room_type_id ||
    ratePlanId !== booking.rate_plan_id ||
    adults !== booking.adults ||
    rooms !== booking.rooms_count;

  const rateOverride = num(fd, "rate_override");
  let breakdown: NightRate[] = booking.rate_breakdown ?? [];
  let violations: string[] = [];

  if (rateOverride !== null) {
    if (rateOverride < 0) return { error: "Enter a valid nightly rate." };
    breakdown = flatBreakdown(checkIn, checkOut, rateOverride);
  } else if (pricingChanged || bool(fd, "reprice")) {
    if (!roomTypeId || !ratePlanId) {
      return { error: "Choose a room type and rate plan so the stay can be priced." };
    }
    const pricing = await loadPricingData(supabase);
    const roomType = pricing.roomTypes.find((t) => t.id === roomTypeId);
    const plan = pricing.plans.find((p) => p.id === ratePlanId) ?? null;
    if (!roomType || !plan) return { error: "Room type or rate plan not found." };
    const quote = quoteStay({
      roomType,
      plan,
      checkIn,
      checkOut,
      adults,
      children,
      rooms,
      seasons: pricing.seasons,
      restrictions: pricing.restrictions,
      extraCharges: pricing.extraCharges,
      adjustments: pricing.adjustments,
    });
    violations = quote.violations;
    // Nights already stayed keep the price they were sold at.
    const kept = new Map(
      (booking.status === "checked_in" ? booking.rate_breakdown ?? [] : []).map((n) => [n.date, n]),
    );
    breakdown = quote.nights.map((n) => kept.get(n.date) ?? n);
  }

  if (violations.length && !(bool(fd, "override_restrictions") && can(session, "bookings.overbook"))) {
    return { error: violations.join(" ") };
  }

  const nights = eachNight(checkIn, checkOut);
  // Any night the breakdown does not cover (dates moved, no reprice) is filled
  // at the booking's average so the folio and penalties stay whole.
  const byDate = new Map(breakdown.map((n) => [n.date, n.rate]));
  const fallback = Number(booking.quoted_rate ?? breakdown[0]?.rate ?? 0);
  breakdown = nights.map((date) => ({ date, rate: byDate.get(date) ?? fallback }));

  const total = breakdown.reduce((s, n) => s + n.rate, 0) * rooms;
  const plan = ratePlanId
    ? ((await supabase.from("rate_plans").select("deposit_percent").eq("id", ratePlanId).maybeSingle()).data as
        | { deposit_percent: number }
        | null)
    : null;

  const overbookReason = str(fd, "overbook_reason", 500);
  if (overbookReason && !can(session, "bookings.overbook")) {
    return { error: "Your role cannot override overbooking." };
  }
  const eta = str(fd, "eta", 5);
  const floor = num(fd, "preferred_floor");

  const { error } = await supabase
    .from("bookings")
    .update({
      check_in: checkIn,
      check_out: checkOut,
      adults,
      children,
      rooms_count: rooms,
      room_type_id: roomTypeId,
      rate_plan_id: ratePlanId,
      company_id: uuidOrNull(fd, "company_id"),
      source: oneOf(fd, "source", SOURCES, booking.source),
      payment_method: oneOfOrNull(fd, "payment_method", PAYMENT_METHODS) ?? booking.payment_method,
      rate_breakdown: breakdown,
      quoted_rate: breakdown.length ? Math.round(total / rooms / breakdown.length) : null,
      total_amount: total,
      deposit_required: Math.round((total * Number(plan?.deposit_percent ?? 0)) / 100),
      preferred_floor: floor === null ? null : Math.round(floor),
      preferred_view: str(fd, "preferred_view", 80),
      is_vip: bool(fd, "is_vip"),
      eta: /^\d{2}:\d{2}$/.test(eta) ? eta : null,
      special_requests: str(fd, "special_requests"),
      contact_name: str(fd, "contact_name", 200) || booking.contact_name,
      contact_phone: str(fd, "contact_phone", 50),
      contact_email: str(fd, "contact_email", 200).toLowerCase(),
      ...(overbookReason ? { overbook_reason: overbookReason } : {}),
    })
    .eq("id", booking.id);

  if (error) return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };

  // SOW Module 16, trigger event "booking modified". Only worth telling the
  // guest when the stay itself moved — a corrected phone number is not news,
  // and a message about it would only worry them.
  const moved =
    checkIn !== booking.check_in ||
    checkOut !== booking.check_out ||
    roomTypeId !== booking.room_type_id ||
    ratePlanId !== booking.rate_plan_id ||
    rooms !== booking.rooms_count;

  let told = "";
  if (moved && bool(fd, "notify_guest")) {
    told = " " + (await sendMessage(supabase, "booking_modified", booking.id, session.staff.id));
  }

  revalidateBooking(booking.id);
  return { success: `Booking updated. The change is recorded in its history.${told}` };
}

// ── Rooms: assign, move, split ─────────────────────────────────────────────

export async function assignRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAnyPermission(["bookings.edit", "frontdesk.checkin"]);
  const supabase = await createClient();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (booking.status === "checked_in") return { error: "The guest is in house — use Move room instead." };
  if (!["tentative", "confirmed", "waitlisted"].includes(booking.status)) {
    return { error: "This booking is closed." };
  }

  let roomId = uuidOrNull(fd, "room_id");
  const auto = bool(fd, "auto");

  if (auto) {
    const [{ data: rooms }, { data: stays }, { data: blocks }] = await Promise.all([
      supabase.from("rooms").select("*").eq("room_type_id", booking.room_type_id ?? ""),
      supabase
        .from("bookings")
        .select("room_id, check_in, check_out")
        .in("status", ["tentative", "confirmed", "checked_in"])
        .neq("id", booking.id)
        .not("room_id", "is", null)
        .lt("check_in", booking.check_out)
        .gt("check_out", booking.check_in),
      supabase.from("room_blocks").select("room_id, start_date, end_date").is("released_at", null),
    ]);
    const { ranked } = rankRooms(
      {
        roomTypeId: booking.room_type_id,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        adults: Math.ceil(booking.adults / booking.rooms_count),
        preferredFloor: booking.preferred_floor,
        preferredView: booking.preferred_view,
        isVip: booking.is_vip,
        forImmediateCheckIn: false,
      },
      rooms ?? [],
      stays ?? [],
      blocks ?? [],
    );
    roomId = ranked[0]?.room.id ?? null;
    if (!roomId) return { error: "No free room of this type for every night of the stay." };
  }

  const { error } = await supabase.from("bookings").update({ room_id: roomId }).eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBooking(booking.id);
  return { success: roomId ? "Room assigned." : "Room unassigned." };
}

export async function moveRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["bookings.edit", "frontdesk.checkin"]);
  const supabase = await createClient();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (booking.status !== "checked_in") return { error: "Only an in-house guest can be moved." };

  const toRoom = uuidOrNull(fd, "room_id");
  const reason = str(fd, "reason", 500);
  if (!toRoom) return { error: "Choose the room to move to." };
  if (toRoom === booking.room_id) return { error: "That is the current room." };
  if (!reason) return { error: "Give a reason for the move." };

  const { data: target } = await supabase
    .from("rooms")
    .select("status, housekeeping_status, room_number")
    .eq("id", toRoom)
    .single();
  if (!target) return { error: "Room not found." };
  if (target.status !== "available" || target.housekeeping_status !== "inspected") {
    return { error: `Room ${target.room_number} is not vacant and inspected.` };
  }

  // The trigger frees and dirties the old room and occupies the new one.
  const { error } = await supabase.from("bookings").update({ room_id: toRoom }).eq("id", booking.id);
  if (error) return { error: friendlyDbError(error.message) };

  await supabase.from("room_moves").insert({
    booking_id: booking.id,
    from_room_id: booking.room_id,
    to_room_id: toRoom,
    reason,
    moved_by: session.staff.id,
  });

  revalidateBooking(booking.id);
  return { success: `Moved to room ${target.room_number}. Re-issue key cards for the new room.` };
}

/**
 * Splits a booking in two.
 *   by date  — the stay ends at the split date and a second booking carries
 *              on from there (for a room or rate change part-way through)
 *   by rooms — a multi-room booking becomes one booking per room, so each
 *              room can be assigned and checked in on its own
 */
export async function splitBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.edit");
  const supabase = await createClient();
  const booking = await loadBooking(supabase, uuidOrNull(fd, "id"));
  if (!booking) return { error: "Booking not found." };
  if (!["tentative", "confirmed", "checked_in"].includes(booking.status)) {
    return { error: "Only an open booking can be split." };
  }

  const mode = oneOf(fd, "mode", ["date", "rooms"] as const, "date");
  const breakdown = booking.rate_breakdown ?? [];
  const sum = (ns: NightRate[]) => ns.reduce((s, n) => s + Number(n.rate), 0);

  const base = {
    guest_id: booking.guest_id,
    company_id: booking.company_id,
    group_id: booking.group_id,
    rate_plan_id: booking.rate_plan_id,
    room_type_id: booking.room_type_id,
    adults: booking.adults,
    children: booking.children,
    source: booking.source,
    payment_method: booking.payment_method,
    contact_name: booking.contact_name,
    contact_email: booking.contact_email,
    contact_phone: booking.contact_phone,
    special_requests: booking.special_requests,
    preferred_floor: booking.preferred_floor,
    preferred_view: booking.preferred_view,
    is_vip: booking.is_vip,
    split_from_id: booking.id,
    created_by: session.staff.id,
  };

  if (mode === "date") {
    const at = dateStr(fd, "split_date");
    if (!at || at <= booking.check_in || at >= booking.check_out) {
      return { error: "Choose a split date between check-in and check-out." };
    }
    const first = breakdown.filter((n) => n.date < at);
    const second = breakdown.filter((n) => n.date >= at);
    const rooms = booking.rooms_count;

    const { error: shortenError } = await supabase
      .from("bookings")
      .update({ check_out: at, rate_breakdown: first, total_amount: sum(first) * rooms })
      .eq("id", booking.id);
    if (shortenError) return { error: friendlyDbError(shortenError.message) };

    const { data: created, error } = await supabase
      .from("bookings")
      .insert({
        ...base,
        check_in: at,
        check_out: booking.check_out,
        rooms_count: rooms,
        // An in-house guest's second part is a future stay until they reach it.
        status: booking.status === "checked_in" ? "confirmed" : booking.status,
        room_id: booking.room_id,
        rate_breakdown: second,
        quoted_rate: second.length ? Math.round(sum(second) / second.length) : booking.quoted_rate,
        total_amount: sum(second) * rooms,
      })
      .select("id, reference")
      .single();

    if (error) {
      // Put the original back so nothing is lost.
      await supabase
        .from("bookings")
        .update({ check_out: booking.check_out, rate_breakdown: breakdown, total_amount: booking.total_amount })
        .eq("id", booking.id);
      return { error: friendlyDbError(error.message) };
    }

    revalidateBooking(booking.id);
    return { success: `Split at ${at}. The second part is ${created.reference}.` };
  }

  if (booking.rooms_count < 2) return { error: "This booking is for one room already." };
  if (booking.status === "checked_in") return { error: "Split rooms before check-in." };

  const perRoomTotal = sum(breakdown);
  const extra = booking.rooms_count - 1;
  const adultsEach = Math.max(1, Math.floor(booking.adults / booking.rooms_count));

  const { error: shrinkError } = await supabase
    .from("bookings")
    .update({ rooms_count: 1, adults: adultsEach, total_amount: perRoomTotal })
    .eq("id", booking.id);
  if (shrinkError) return { error: friendlyDbError(shrinkError.message) };

  const { error } = await supabase.from("bookings").insert(
    Array.from({ length: extra }, () => ({
      ...base,
      adults: adultsEach,
      children: 0,
      check_in: booking.check_in,
      check_out: booking.check_out,
      rooms_count: 1,
      status: booking.status,
      rate_breakdown: breakdown,
      quoted_rate: booking.quoted_rate,
      total_amount: perRoomTotal,
      deposit_required: 0,
    })),
  );
  if (error) {
    await supabase
      .from("bookings")
      .update({ rooms_count: booking.rooms_count, adults: booking.adults, total_amount: booking.total_amount })
      .eq("id", booking.id);
    return { error: friendlyDbError(error.message) };
  }

  revalidateBooking(booking.id);
  return { success: `Split into ${booking.rooms_count} single-room bookings.` };
}

// ── Messages ─────────────────────────────────────────────────────

export async function sendBookingEmail(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["bookings.edit", "frontdesk.checkout"]);
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const template = oneOf(fd, "template", ["confirmation", "cancellation", "request_received"] as const, "confirmation");
  if (!id) return { error: "Booking not found." };

  const result = await sendMessage(supabase, template, id, session.staff.id);
  revalidateBooking(id);
  return { success: result };
}

// ── Folio ──────────────────────────────────────────────────────────────────

export async function recordPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.payment");
  const supabase = await createClient();
  const bookingId = uuidOrNull(fd, "booking_id");
  const amount = num(fd, "amount");
  const method = oneOfOrNull(fd, "method", PAYMENT_METHODS);
  const kind = oneOf(fd, "kind", ["payment", "refund"] as const, "payment");

  if (!bookingId) return { error: "Booking not found." };
  if (amount === null || amount <= 0) return { error: "Enter an amount above zero." };
  if (!method) return { error: "Choose a payment method." };

  const { error } = await supabase.from("folio_entries").insert({
    booking_id: bookingId,
    kind,
    description: str(fd, "description", 200) || (kind === "refund" ? "Refund" : "Payment"),
    amount,
    method,
    reference: str(fd, "reference", 100),
    is_deposit: kind === "payment" && bool(fd, "is_deposit"),
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  // SOW Module 16, trigger event "payment received". A refund is not a
  // receipt, so only a payment sends one, and only when asked: the desk
  // takes plenty of payments the guest is standing right there for.
  let sent = "";
  if (kind === "payment" && bool(fd, "send_receipt")) {
    sent = " " + (await sendPaymentReceipt(supabase, bookingId, amount, session.staff.id));
  }

  revalidateBooking(bookingId);
  return {
    success: `${kind === "refund" ? "Refund" : "Payment"} of ₹${amount.toLocaleString("en-IN")} recorded.${sent}`,
  };
}

export async function postCharge(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.post");
  const supabase = await createClient();
  const bookingId = uuidOrNull(fd, "booking_id");
  const amount = num(fd, "amount");
  const description = str(fd, "description", 200);

  if (!bookingId) return { error: "Booking not found." };
  if (!description) return { error: "Describe the charge." };
  if (amount === null || amount <= 0) return { error: "Enter an amount above zero." };
  const taxRate = num(fd, "tax_rate") ?? 0;
  if (taxRate < 0 || taxRate > 100) return { error: "Enter a tax rate between 0 and 100." };

  const { error } = await supabase.from("folio_entries").insert({
    booking_id: bookingId,
    kind: oneOf(fd, "kind", ["extra", "fee"] as const, "extra"),
    description,
    amount,
    tax_rate: taxRate,
    tax_amount: Math.round(amount * taxRate) / 100,
    stay_date: dateStr(fd, "stay_date") || null,
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBooking(bookingId);
  return { success: "Charge posted." };
}

export async function voidFolioEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.adjust");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const reason = str(fd, "reason", 300);
  if (!id) return { error: "Entry not found." };
  if (!reason) return { error: "Give a reason for voiding." };

  const { data, error } = await supabase
    .from("folio_entries")
    .update({ voided_at: new Date().toISOString(), voided_by: session.staff.id, void_reason: reason })
    .eq("id", id)
    .is("voided_at", null)
    .select("booking_id")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBooking(data.booking_id);
  return { success: "Entry voided." };
}
