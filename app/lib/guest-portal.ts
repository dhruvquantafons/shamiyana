"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "./supabase/server";
import {
  getGuestSession,
  sendGuestCode,
  verifyGuestCode,
  signOutGuest,
  guestPasswordLoginEnabled,
  signInGuestWithPassword,
  signUpGuestWithPassword,
  linkGuestProfile,
} from "./guest-auth";
import { getSettings } from "./settings";
import { createPaymentLink, razorpayConfigured } from "./razorpay";
import { normalisePhone } from "./integrations";
import { friendlyDbError } from "./db-errors";
import { LANGUAGES } from "./types";
import type { Booking, FolioEntry, PaymentTransaction, RatePlan } from "./types";

/**
 * Server actions for the guest booking portal (SOW Module 17).
 *
 * Everything here is done as the signed-in guest, so row level security is
 * the backstop rather than the only check: each action also re-establishes
 * who the guest is from the session and never takes an identity from the
 * form. The two writes a guest may make — cancelling a stay and editing
 * their own details — go through the security-definer functions in
 * 0021_guest_portal.sql, which decide the penalty and whitelist the columns.
 */

export type PortalState = { error?: string; success?: string };

const field = (fd: FormData, key: string, max = 200) =>
  String(fd.get(key) ?? "").trim().slice(0, max);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Signing in ──────────────────────────────────────────────────────────────

export async function requestGuestCode(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const email = field(fd, "email").toLowerCase();
  if (!EMAIL.test(email)) return { error: "Please enter a valid email address." };

  const { error } = await sendGuestCode(email);
  // Never say whether an address is known: that would turn this form into a
  // way of asking whether somebody has stayed here.
  if (error) return { error: "We could not send the code just now. Please try again shortly." };

  return { success: `We have emailed your sign-in code to ${email}. It is valid for one hour.` };
}

export async function confirmGuestCode(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const email = field(fd, "email").toLowerCase();
  const code = field(fd, "code", 10).replace(/\D/g, "");

  if (!EMAIL.test(email)) return { error: "Please enter a valid email address." };
  // Supabase issues between 6 and 10 digits depending on the project's
  // setting, so the length is not pinned here — only that it looks like one.
  if (code.length < 6) return { error: "Enter the code from the email." };

  const { error } = await verifyGuestCode(email, code);
  if (error) return { error: "That code is wrong or has expired. Ask for a new one." };

  revalidatePath("/account");
  redirect("/account");
}

/**
 * The password alternative, for teams testing a staging deployment.
 *
 * One form does both jobs: an address we know signs in, one we do not gets an
 * account. That is deliberate — asking "do you already have an account?" would
 * answer, for anyone who cared to ask, whether a given person has stayed here.
 * A wrong password on a known address still fails, so this never becomes a way
 * into somebody else's account.
 *
 * An account opened this way always starts empty, whatever address is typed:
 * guest_link_account() will not adopt an existing profile for a password
 * session, because a password proves nothing about the address.
 */
export async function guestPasswordAuth(_prev: PortalState, fd: FormData): Promise<PortalState> {
  if (!guestPasswordLoginEnabled()) {
    return { error: "Please use the emailed sign-in code." };
  }

  const email = field(fd, "email").toLowerCase();
  const password = field(fd, "password", 200);

  if (!EMAIL.test(email)) return { error: "Please enter a valid email address." };
  if (password.length < 8) return { error: "Your password needs at least 8 characters." };

  const signIn = await signInGuestWithPassword(email, password);
  if (signIn.error) {
    const signUp = await signUpGuestWithPassword(email, password);
    if (signUp.error) {
      return { error: "That email address and password do not match an account we can open." };
    }
  }

  const { unconfirmed, error } = await linkGuestProfile();
  // Supabase can be configured to hold a new signup until the address is
  // confirmed, in which case no session was issued and there is nothing to
  // link yet. Switch "Confirm email" off to let a team test without inboxes.
  if (unconfirmed) {
    return { success: "Check your email to confirm your address, then sign in again." };
  }
  if (error) return { error };

  revalidatePath("/account");
  redirect("/account");
}

export async function endGuestSession() {
  await signOutGuest();
  revalidatePath("/account");
  redirect("/");
}

// ── The guest's own bookings ────────────────────────────────────────────────

export interface GuestBooking extends Omit<Booking, "room_types" | "rate_plans"> {
  room_types?: { id: string; name: string; slug: string } | null;
  rate_plans?: Pick<
    RatePlan,
    "id" | "code" | "name" | "meal_plan" | "is_refundable" | "free_cancellation_hours"
  > | null;
  /** Taken online and credited, in the property's currency. */
  paid: number;
  /** Still to pay on the stay as booked. */
  outstanding: number;
  /** An open payment link the guest can still use. */
  openPaymentUrl: string | null;
}

/**
 * Every stay on the account, newest arrival first.
 *
 * The reads are scoped by the bookings_own_select and folio_entries_own_select
 * policies, so this cannot return somebody else's stay even if the query were
 * wrong.
 */
export async function loadGuestBookings(): Promise<GuestBooking[]> {
  const session = await getGuestSession();
  if (!session) return [];

  const supabase = await createClient();
  const [{ data: bookings }, { data: entries }, { data: transactions }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "*, room_types(id, name, slug), rate_plans(id, code, name, meal_plan, is_refundable, free_cancellation_hours)",
      )
      .eq("guest_id", session.guest.id)
      .order("check_in", { ascending: false }),
    supabase.from("folio_entries").select("*").is("voided_at", null),
    supabase.from("payment_transactions").select("*"),
  ]);

  const folio = (entries ?? []) as FolioEntry[];
  const txs = (transactions ?? []) as PaymentTransaction[];

  return ((bookings ?? []) as GuestBooking[]).map((b) => {
    const mine = folio.filter((e) => e.booking_id === b.id);
    // Payments and refunds, the way folio_balance_of() counts them.
    const paid = mine
      .filter((e) => e.kind === "payment")
      .reduce((s, e) => s + Number(e.amount), 0);
    const refunded = mine
      .filter((e) => e.kind === "refund")
      .reduce((s, e) => s + Number(e.amount), 0);

    const open = txs.find((t) => t.booking_id === b.id && t.status === "created" && t.short_url);

    return {
      ...b,
      paid: Math.round((paid - refunded) * 100) / 100,
      outstanding: Math.max(0, Math.round((Number(b.total_amount ?? 0) - (paid - refunded)) * 100) / 100),
      openPaymentUrl: open?.short_url ?? null,
    };
  });
}

// ── Cancelling ──────────────────────────────────────────────────────────────

export async function cancelGuestBooking(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const session = await getGuestSession();
  if (!session) return { error: "Please sign in again." };

  const id = field(fd, "booking_id", 36);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "We could not find that booking." };

  const supabase = await createClient();
  // The function checks ownership, works out the penalty from the rate plan
  // and posts it to the folio, so there is nothing to calculate here.
  const { data, error } = await supabase.rpc("guest_cancel_booking", {
    p_booking: id,
    p_reason: field(fd, "reason", 500),
  });

  if (error) return { error: friendlyDbError(error.message) };

  const penalty = Number(data ?? 0);
  revalidatePath("/account");
  return {
    success:
      penalty > 0
        ? `Your booking is cancelled. A cancellation charge of ₹${penalty.toLocaleString("en-IN")} applies under the rate you booked, and we will be in touch about it.`
        : "Your booking is cancelled, with nothing to pay. We hope to welcome you another time.",
  };
}

// ── Profile ─────────────────────────────────────────────────────────────────

export async function updateGuestProfile(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const session = await getGuestSession();
  if (!session) return { error: "Please sign in again." };

  const name = field(fd, "full_name");
  if (!name) return { error: "Please give us a name for your bookings." };

  const language = field(fd, "language", 5);
  const supabase = await createClient();

  const { error } = await supabase.rpc("guest_update_profile", {
    p_full_name: name,
    p_phone: field(fd, "phone", 50),
    p_language: language in LANGUAGES ? language : null,
    p_dietary: field(fd, "dietary", 500),
    p_preferences: field(fd, "preferences", 1000),
    p_marketing: fd.get("marketing_opt_in") !== null,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/account");
  return { success: "Your details are saved." };
}

// ── Paying online ───────────────────────────────────────────────────────────

/**
 * Opens a payment link for the guest's own booking and sends them to it.
 *
 * SOW Module 17: "Secure online payment for booking deposit or full payment".
 * The guest pays on Razorpay's hosted page, so no card data reaches this
 * application (§6.1, PCI-DSS) — and the money only touches the folio when
 * the signed webhook says it arrived, never because the browser came back.
 */
export async function startGuestPayment(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const session = await getGuestSession();
  if (!session) return { error: "Please sign in again." };

  if (!razorpayConfigured()) {
    return { error: "Online payment is not available at the moment. Please call us to pay." };
  }

  const id = field(fd, "booking_id", 36);
  const which = field(fd, "amount_kind", 10) === "full" ? "full" : "deposit";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "We could not find that booking." };

  const supabase = await createClient();
  const settings = await getSettings();

  // Read as the guest: the row comes back only if it is theirs.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference, status, guest_id, contact_name, contact_email, contact_phone, total_amount, deposit_required")
    .eq("id", id)
    .eq("guest_id", session.guest.id)
    .maybeSingle();

  if (!booking) return { error: "We could not find that booking on your account." };
  if (["cancelled", "no_show", "checked_out"].includes(booking.status)) {
    return { error: "That booking is closed, so there is nothing to pay." };
  }

  const { data: entries } = await supabase
    .from("folio_entries")
    .select("kind, amount")
    .eq("booking_id", id)
    .is("voided_at", null);

  const settled = (entries ?? []).reduce(
    (s, e) => s + (e.kind === "payment" ? Number(e.amount) : e.kind === "refund" ? -Number(e.amount) : 0),
    0,
  );

  const wanted =
    which === "full"
      ? Number(booking.total_amount ?? 0) - settled
      : Number(booking.deposit_required ?? 0) - settled;
  const amount = Math.round(Math.max(0, wanted) * 100) / 100;

  if (amount <= 0) {
    return { error: which === "full" ? "This stay is already paid in full." : "Your deposit is already paid." };
  }

  const link = await createPaymentLink({
    amount,
    currency: settings.currency,
    description: `${which === "full" ? "Payment" : "Deposit"} for booking ${booking.reference} at ${settings.name}`,
    referenceId: `${booking.reference}-${Date.now()}`,
    customer: {
      name: booking.contact_name || session.guest.full_name,
      email: booking.contact_email || session.email,
      phone: booking.contact_phone ? normalisePhone(booking.contact_phone) : "",
    },
    notify: true,
    expiresInMinutes: 60 * 24,
    notes: { booking_id: booking.id, reference: booking.reference, purpose: which === "full" ? "settlement" : "deposit" },
  });
  if (!link.ok || !link.data) {
    return { error: "We could not start the payment. Please try again or call us." };
  }

  // Guests have no insert policy on payment_transactions — a ledger of money
  // owed is not theirs to write — so the row is written server-side, after
  // the read above proved the booking is theirs.
  const service = createServiceClient();
  const { error } = await service.from("payment_transactions").insert({
    booking_id: booking.id,
    provider: "razorpay",
    provider_link_id: link.data.id,
    short_url: link.data.short_url,
    purpose: which === "full" ? "settlement" : "deposit",
    amount,
    currency: settings.currency,
    status: "created",
    expires_at: link.data.expire_by ? new Date(link.data.expire_by * 1000).toISOString() : null,
  });
  if (error) return { error: friendlyDbError(error.message) };

  redirect(link.data.short_url);
}
