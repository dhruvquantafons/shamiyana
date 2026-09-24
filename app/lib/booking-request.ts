"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/server";
import { createPaymentLink, cancelPaymentLink, razorpayConfigured } from "./razorpay";
import { normalisePhone } from "./integrations";
import { hasSupabaseConfig } from "./supabase/config";
import { loadPricingData, resolvePromo, type PricingData } from "./rate-data";
import { discountNights, nightsTotal } from "./revenue";
import { quoteStay } from "./pricing";
import { splitRoomTax } from "./tax";
import { isOverbooked } from "./db-errors";
import { eachNight, isIsoDate, todayIn } from "./dates";
import { sendBookingMessage } from "./notifications";
import { DEFAULT_SETTINGS, taxSlabsOf } from "./settings";
import {
  MEAL_PLAN_LABELS,
  type PropertySettings,
  type RatePlan,
  type RoomType,
} from "./types";

export type RequestState = {
  error?: string;
  success?: string;
  /**
   * A Razorpay hosted page for the deposit, when one is due and the gateway
   * is configured (SOW Module 17: "Secure online payment for booking deposit
   * or full payment"). Offered, never forced: the guest may still pay at the
   * hotel, and the request stands either way.
   */
  payUrl?: string;
  payAmount?: number;
};

/** One rate plan the guest can pick, priced for the stay asked about. */
export interface PlanOffer {
  id: string;
  name: string;
  description: string;
  meal: string;
  refundable: boolean;
  freeCancellationHours: number;
  /** All rooms, all nights, tax included. */
  total: number;
  /** Per room per night, tax included. */
  perNight: number;
  deposit: number;
}

export interface StayQuote {
  /** available: bookable online. waitlist: full, a request joins the waiting list. closed: cannot be requested. */
  status: "available" | "waitlist" | "closed" | "offline";
  message?: string;
  nights: number;
  taxLabel: string;
  plans: PlanOffer[];
}

export interface StayQuery {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  roomTypeId: string;
}

const PHONE = "+91 90700 90713";
const OCCUPYING = ["tentative", "confirmed", "checked_in"];

/**
 * A hosted payment page for a website booking's deposit.
 *
 * Best-effort: a gateway that is not configured, or is having a bad day, must
 * not lose the hotel a booking that has already been taken. On any failure
 * the guest is simply not offered the link and pays at the hotel instead.
 */
async function depositLink(
  bookingId: string,
  reference: string,
  amount: number,
  settings: PropertySettings,
  guest: { name: string; email: string; phone: string },
): Promise<{ url: string } | null> {
  if (!razorpayConfigured()) return null;

  try {
    const link = await createPaymentLink({
      amount,
      currency: settings.currency,
      description: `Deposit for booking ${reference} at ${settings.name}`,
      referenceId: `${reference}-${Date.now()}`,
      customer: { name: guest.name, email: guest.email, phone: guest.phone ? normalisePhone(guest.phone) : "" },
      notify: true,
      expiresInMinutes: 60 * 24,
      notes: { booking_id: bookingId, reference, purpose: "deposit" },
    });
    if (!link.ok || !link.data) return null;

    const service = createServiceClient();
    const { error } = await service.from("payment_transactions").insert({
      booking_id: bookingId,
      provider: "razorpay",
      provider_link_id: link.data.id,
      short_url: link.data.short_url,
      purpose: "deposit",
      amount,
      currency: settings.currency,
      status: "created",
      expires_at: link.data.expire_by ? new Date(link.data.expire_by * 1000).toISOString() : null,
    });
    // Without the row the webhook cannot credit the folio, so an unrecorded
    // link must not be handed out: the guest would pay into a void.
    if (error) {
      await cancelPaymentLink(link.data.id);
      return null;
    }

    return { url: link.data.short_url };
  } catch {
    return null;
  }
}

async function loadSettings(supabase: SupabaseClient): Promise<PropertySettings> {
  const { data } = await supabase.from("property_settings").select("*").maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) } as PropertySettings;
}

/** Public plans that can be sold for this room type. Company rates are never offered online. */
function plansFor(pricing: PricingData, roomType: RoomType): RatePlan[] {
  return pricing.plans.filter(
    (p) => !p.company_id && (p.room_type_ids.length === 0 || p.room_type_ids.includes(roomType.id)),
  );
}

/**
 * Whether the website may take these rooms, judged the way the database's
 * inventory guard does: rooms of the type, less blocked rooms, less stays
 * already held — and within the website's channel allocation, if one is set.
 */
async function availability(
  supabase: SupabaseClient,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  rooms: number,
): Promise<"available" | "waitlist"> {
  const nights = eachNight(checkIn, checkOut);

  const [{ data: typeRooms }, { data: held }, { data: alloc }] = await Promise.all([
    supabase.from("rooms").select("id").eq("room_type_id", roomTypeId),
    supabase
      .from("bookings")
      .select("check_in, check_out, rooms_count, source")
      .eq("room_type_id", roomTypeId)
      .in("status", OCCUPYING)
      .lt("check_in", checkOut)
      .gt("check_out", checkIn),
    supabase
      .from("channel_allocations")
      .select("rooms")
      .eq("room_type_id", roomTypeId)
      .eq("source", "website")
      .maybeSingle(),
  ]);

  const roomIds = (typeRooms ?? []).map((r) => r.id as string);
  const stays = held ?? [];
  const usedOn = (night: string, websiteOnly: boolean) =>
    stays
      .filter((b) => b.check_in <= night && b.check_out > night && (!websiteOnly || b.source === "website"))
      .reduce((s, b) => s + b.rooms_count, 0);

  // Until a type has rooms in inventory the guard does not count against it.
  if (roomIds.length > 0) {
    const { data: blocks } = await supabase
      .from("room_blocks")
      .select("room_id, start_date, end_date")
      .in("room_id", roomIds)
      .is("released_at", null)
      .lt("start_date", checkOut);
    const capacityOn = (night: string) =>
      roomIds.filter(
        (id) =>
          !(blocks ?? []).some(
            (b) => b.room_id === id && b.start_date <= night && (b.end_date === null || b.end_date >= night),
          ),
      ).length;
    if (nights.some((night) => usedOn(night, false) + rooms > capacityOn(night))) return "waitlist";
  }

  if (alloc && nights.some((night) => usedOn(night, true) + rooms > alloc.rooms)) return "waitlist";
  return "available";
}

function readQuery(q: StayQuery): StayQuery | string {
  const count = (n: unknown, min: number, fallback: number) => {
    const v = Number(n);
    return Number.isInteger(v) && v >= min && v <= 50 ? v : fallback;
  };
  if (!isIsoDate(q.checkIn) || !isIsoDate(q.checkOut)) return "Please choose your dates.";
  if (q.checkOut <= q.checkIn) return "Check-out must be after check-in.";
  if (eachNight(q.checkIn, q.checkOut).length > 60) return `For stays over 60 nights, please call us on ${PHONE}.`;
  return {
    checkIn: q.checkIn,
    checkOut: q.checkOut,
    adults: count(q.adults, 1, 2),
    children: count(q.children, 0, 0),
    rooms: count(q.rooms, 1, 1),
    roomTypeId: String(q.roomTypeId ?? "").slice(0, 36),
  };
}

/** Prices every public plan for the stay and says whether it can be booked. */
async function buildQuote(supabase: SupabaseClient, q: StayQuery): Promise<StayQuote> {
  const settings = await loadSettings(supabase);
  const nights = eachNight(q.checkIn, q.checkOut).length;
  const base = { nights, taxLabel: settings.tax_label, plans: [] as PlanOffer[] };

  if (q.checkIn < todayIn(settings.timezone)) {
    return { ...base, status: "closed", message: "Please choose a date from today onwards." };
  }

  const pricing = await loadPricingData(supabase, { publicOnly: true });
  const roomType = pricing.roomTypes.find((t) => t.id === q.roomTypeId);
  if (!roomType) return { ...base, status: "closed", message: "Please choose a room." };

  const slabs = taxSlabsOf(settings);
  const offers: PlanOffer[] = [];
  let firstProblem = "";

  for (const plan of plansFor(pricing, roomType)) {
    const quote = quoteStay({
      roomType,
      plan,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      adults: q.adults,
      children: q.children,
      rooms: q.rooms,
      seasons: pricing.seasons,
      restrictions: pricing.restrictions,
      extraCharges: pricing.extraCharges,
      adjustments: pricing.adjustments,
    });
    if (quote.violations.length) {
      firstProblem ||= quote.violations.join(" ");
      continue;
    }
    // Rates are per room per night; tax is charged on each of those.
    const perRoom = quote.nights.reduce((sum, n) => {
      const split = splitRoomTax(n.rate, slabs, settings.tax_inclusive);
      return sum + split.net + split.tax;
    }, 0);
    const total = Math.round(perRoom * q.rooms);
    offers.push({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      meal: MEAL_PLAN_LABELS[plan.meal_plan] ?? plan.meal_plan,
      refundable: plan.is_refundable,
      freeCancellationHours: plan.free_cancellation_hours,
      total,
      perNight: Math.round(perRoom / Math.max(1, nights)),
      deposit: quote.deposit,
    });
  }

  if (offers.length === 0) {
    return {
      ...base,
      status: "closed",
      message: `${firstProblem || "These dates cannot be booked online."} Please adjust your stay or call us on ${PHONE}.`,
    };
  }

  const status = await availability(supabase, roomType.id, q.checkIn, q.checkOut, q.rooms);
  return {
    ...base,
    plans: offers,
    status,
    message:
      status === "waitlist"
        ? "These dates are fully booked online. Send a request and we will add you to our waiting list."
        : undefined,
  };
}

/** Live price and availability for the booking form. */
export async function quoteStayRequest(query: StayQuery): Promise<StayQuote> {
  const q = readQuery(query);
  if (typeof q === "string") return { status: "closed", message: q, nights: 0, taxLabel: "", plans: [] };
  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: "offline", nights: 0, taxLabel: "", plans: [] };
  }
  try {
    return await buildQuote(createServiceClient(), q);
  } catch {
    return { status: "offline", nights: 0, taxLabel: "", plans: [] };
  }
}

/**
 * Accepts a booking request from the public website.
 *
 * Runs with the service role key because the visitor is anonymous and RLS
 * deliberately forbids the anon key from writing bookings. Everything that
 * reaches the database here is treated as untrusted input: only the specific
 * fields below are written, the price is calculated here from the public rate
 * plan the guest chose, and status/source are fixed server-side so a crafted
 * request cannot confirm itself.
 *
 * The request is held as tentative for the desk to confirm. If the website's
 * channel allocation or the hotel is full, it is kept as waitlisted instead.
 */
export async function submitBookingRequest(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const get = (k: string, max = 200) => String(formData.get(k) ?? "").trim().slice(0, max);

  const name = get("contact_name");
  const phone = get("contact_phone", 50);
  const email = get("contact_email").toLowerCase();

  if (!name) return { error: "Please tell us your name." };
  if (!phone && !email) return { error: "Please leave a phone number or an email address." };

  const q = readQuery({
    checkIn: get("check_in", 10),
    checkOut: get("check_out", 10),
    adults: Number(get("adults")),
    children: Number(get("children")),
    rooms: Number(get("rooms_count")),
    roomTypeId: get("room_type_id", 36),
  });
  if (typeof q === "string") return { error: q };

  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: `Online requests are not available right now. Please call us on ${PHONE}.` };
  }

  try {
    const supabase = createServiceClient();
    const quote = await buildQuote(supabase, q);
    if (quote.status === "closed") return { error: quote.message };

    // Price with the plan the guest picked; the quote only holds plans that can be sold.
    const chosen = quote.plans.find((p) => p.id === get("rate_plan_id", 36)) ?? quote.plans[0];
    const pricing = await loadPricingData(supabase, { publicOnly: true });
    const roomType = pricing.roomTypes.find((t) => t.id === q.roomTypeId)!;
    const plan = pricing.plans.find((p) => p.id === chosen.id)!;
    const priced = quoteStay({
      roomType,
      plan,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      adults: q.adults,
      children: q.children,
      rooms: q.rooms,
      seasons: pricing.seasons,
      restrictions: pricing.restrictions,
      extraCharges: pricing.extraCharges,
      adjustments: pricing.adjustments,
    });

    const settings = await loadSettings(supabase);
    let status: "tentative" | "waitlisted" = quote.status === "waitlist" ? "waitlisted" : "tentative";

    // A promo code typed on the public site: only a public code counts, and
    // the discount is worked out here rather than trusted from the form.
    const typedCode = get("promo_code", 40).toUpperCase();
    const promo = await resolvePromo(
      supabase,
      typedCode,
      {
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        roomTypeId: roomType.id,
        ratePlanId: plan.id,
        amount: priced.total,
        today: todayIn(settings.timezone),
      },
      { publicOnly: true, email },
    );

    // The discount goes into the nightly rates so the folio bills it and the
    // tax follows it; see discountNights.
    const nights = discountNights(priced.nights, promo.discount, q.rooms);
    const total = nightsTotal(nights, q.rooms);
    const discountGiven = priced.total - total;

    const row = {
      check_in: q.checkIn,
      check_out: q.checkOut,
      adults: q.adults,
      children: q.children,
      rooms_count: q.rooms,
      room_type_id: roomType.id,
      rate_plan_id: plan.id,
      quoted_rate: nights.length ? Math.round(total / q.rooms / nights.length) : 0,
      total_amount: total,
      promo_code_id: promo.codeId,
      promo_discount: discountGiven,
      rate_breakdown: nights,
      deposit_required: Math.round((total * Number(plan.deposit_percent)) / 100),
      promo_code: typedCode,
      special_requests: get("special_requests", 2000),
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      source: "website",
    };
    const holdUntil = new Date(Date.now() + settings.hold_hours * 3600000).toISOString();

    let { data, error } = await supabase
      .from("bookings")
      .insert({ ...row, status, hold_until: status === "tentative" ? holdUntil : null })
      .select("*")
      .single();
    // Someone took the last room since the quote: keep the request on the waitlist.
    if (error && isOverbooked(error.message)) {
      status = "waitlisted";
      ({ data, error } = await supabase.from("bookings").insert({ ...row, status, hold_until: null }).select("*").single());
    }
    if (error || !data) {
      return { error: `We could not send that request. Please call us on ${PHONE}.` };
    }

    // The code is spent by the booking itself: the redemption row follows
    // bookings.promo_code_id in the database (0020_revenue.sql), and comes
    // back if the request is later cancelled.

    await sendBookingMessage(
      supabase,
      "request_received",
      { ...data, room_type_name: roomType.name, rate_plan_name: plan.name, meal_plan: plan.meal_plan },
      settings,
      { sms: false },
    );

    const promoNote = promo.codeId
      ? ` ${typedCode} has been applied, saving ₹${discountGiven.toLocaleString("en-IN")}.`
      : typedCode && promo.reason
        ? ` We could not apply ${typedCode}: ${promo.reason}`
        : "";

    // Offer the deposit online while the guest is still here. A waitlisted
    // request holds no room, so there is nothing to take money for yet.
    const deposit = Number(row.deposit_required ?? 0);
    const payment =
      status === "tentative" && deposit > 0
        ? await depositLink(data.id, data.reference, deposit, settings, { name, email, phone })
        : null;

    return {
      success:
        (status === "waitlisted"
          ? "Thank you. Those dates are fully booked online, so we have added you to our waiting list — our front desk will contact you if a room opens up."
          : "Thank you — we have your request. Our front desk will confirm availability with you shortly.") + promoNote,
      ...(payment ? { payUrl: payment.url, payAmount: deposit } : {}),
    };
  } catch {
    return { error: `We could not send that request. Please call us on ${PHONE}.` };
  }
}
