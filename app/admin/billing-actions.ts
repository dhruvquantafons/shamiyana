"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import {
  invoiceLines,
  invoiceTotals,
  taxBreakdown,
  formatInvoiceNumber,
  financialYearOf,
  refundNeedsApproval,
} from "../lib/invoices";
import {
  createPaymentLink,
  cancelPaymentLink,
  refundPayment,
  razorpayConfigured,
} from "../lib/razorpay";
import { normalisePhone } from "../lib/integrations";
import { todayIn } from "../lib/dates";
import type { Booking, FolioEntry, PaymentMethod } from "../lib/types";
import { type ActionState, str, num, uuidOrNull, oneOf, oneOfOrNull } from "./form-utils";

/**
 * Module 7 — Billing, invoicing and payments.
 *
 * Split folios, tax invoices, online payment links and the refund approval
 * workflow. Payments taken at the desk stay in booking-actions.ts with the
 * rest of the folio; everything here either produces a tax document or moves
 * money through the gateway.
 */

const PAYMENT_METHODS: PaymentMethod[] = [
  "cash", "card", "upi", "bank_transfer", "online_gateway", "corporate_billing", "ota_prepaid", "wallet", "other",
];

function revalidateBilling(bookingId?: string) {
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin/billing/refunds");
  revalidatePath("/admin/billing/invoices");
  revalidatePath("/admin/bookings");
}

// ── Split folios ────────────────────────────────────────────────────────────

/** Opens a second bill on a stay, e.g. "Company" or "Extras". */
export async function createFolio(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.adjust");
  const supabase = await createClient();
  const bookingId = uuidOrNull(fd, "booking_id");
  const label = str(fd, "label", 60);
  if (!bookingId) return { error: "Booking not found." };
  if (!label) return { error: "Give the folio a name, such as “Company” or “Extras”." };

  const { error } = await supabase.from("folios").insert({
    booking_id: bookingId,
    kind: "split",
    label,
    company_id: uuidOrNull(fd, "company_id"),
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBilling(bookingId);
  return { success: `Folio “${label}” opened.` };
}

/**
 * Moves one charge to another folio on the same stay — the everyday way a
 * split bill is built. The database refuses a folio from another booking.
 */
export async function moveFolioEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("folio.adjust");
  const supabase = await createClient();
  const entryId = uuidOrNull(fd, "entry_id");
  const folioId = uuidOrNull(fd, "folio_id");
  if (!entryId || !folioId) return { error: "Choose an entry and a folio." };

  const { data: entry } = await supabase
    .from("folio_entries")
    .select("id, booking_id, folio_id, voided_at")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { error: "Entry not found." };
  if (entry.voided_at) return { error: "That entry is voided." };
  if (entry.folio_id === folioId) return { error: "That charge is already on this folio." };

  // Neither the folio it leaves nor the one it joins may already be invoiced:
  // an issued invoice is a tax document and its lines are fixed.
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("status", "issued")
    .in("folio_id", [folioId, entry.folio_id].filter(Boolean) as string[]);
  if (count) return { error: "One of those folios has already been invoiced. Cancel the invoice first." };

  const { error } = await supabase.from("folio_entries").update({ folio_id: folioId }).eq("id", entryId);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBilling(entry.booking_id);
  return { success: "Charge moved." };
}

// ── Tax invoices ────────────────────────────────────────────────────────────

/**
 * Issues a GST invoice for one folio. The number is claimed by the database
 * so it is sequential and never repeated, and the lines, totals and the
 * customer's details are frozen onto the row: a later change to the guest
 * record cannot alter a tax document that has already been given out.
 */
export async function issueInvoice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.invoice");
  const supabase = await createClient();
  const settings = await getSettings();
  const folioId = uuidOrNull(fd, "folio_id");
  if (!folioId) return { error: "Choose a folio to invoice." };

  const { data: folio } = await supabase
    .from("folios")
    .select("id, booking_id, label, company_id, companies(name, gstin, billing_address)")
    .eq("id", folioId)
    .maybeSingle();
  if (!folio) return { error: "Folio not found." };

  const { data: existing } = await supabase
    .from("invoices")
    .select("number")
    .eq("folio_id", folioId)
    .eq("status", "issued")
    .maybeSingle();
  if (existing) return { error: `This folio already has invoice ${existing.number}. Cancel it before issuing another.` };

  const { data: bookingRow } = await supabase
    .from("bookings")
    .select("*, guests(full_name)")
    .eq("id", folio.booking_id)
    .maybeSingle();
  if (!bookingRow) return { error: "Booking not found." };
  const booking = bookingRow as Booking;

  const { data: entryRows } = await supabase
    .from("folio_entries")
    .select("*")
    .eq("folio_id", folioId)
    .order("created_at");
  const entries = (entryRows ?? []) as FolioEntry[];

  const lines = invoiceLines(entries);
  if (lines.length === 0) return { error: "There is nothing to invoice on this folio yet." };
  const totals = invoiceTotals(lines);
  const bands = taxBreakdown(lines);

  const company = folio.companies as unknown as
    | { name: string; gstin: string; billing_address: string }
    | null;

  // The number is claimed inside the database so two people issuing at the
  // same moment cannot take the same sequence.
  const fy = financialYearOf(todayIn(settings.timezone));
  const { data: seq, error: seqError } = await supabase.rpc("next_invoice_number", {
    p_series: settings.invoice_prefix || "INV",
    p_fy: fy,
  });
  if (seqError || typeof seq !== "number") {
    return { error: friendlyDbError(seqError?.message ?? "Could not allocate an invoice number.") };
  }

  // If the guest settled any part of this folio in another currency, note
  // that currency and the rate used on the invoice, so a foreign-currency
  // copy of the document always reprints with the same numbers. The invoice
  // itself stays denominated in the property's own currency.
  const settledIn = entries.find((e) => !e.voided_at && e.kind === "payment" && e.fx_currency);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      number: formatInvoiceNumber(settings.invoice_prefix || "INV", fy, seq),
      series: settings.invoice_prefix || "INV",
      financial_year: fy,
      seq,
      booking_id: folio.booking_id,
      folio_id: folioId,
      bill_to_name: company?.name || booking.contact_name,
      bill_to_address: company?.billing_address ?? "",
      bill_to_gstin: company?.gstin ?? "",
      company_id: folio.company_id,
      place_of_supply: settings.state,
      currency: settings.currency,
      net_total: totals.net,
      tax_total: totals.tax,
      grand_total: totals.grand,
      tax_breakdown: bands,
      lines,
      fx_currency: settledIn?.fx_currency ?? null,
      fx_rate: settledIn?.fx_rate ?? null,
      issued_by: session.staff.id,
    })
    .select("id, number")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBilling(folio.booking_id);
  return { success: `Invoice ${invoice.number} issued.` };
}

/**
 * Cancels an invoice. The number stays used — that is what "non-repeating"
 * means — and a fresh invoice can then be issued for the folio.
 */
export async function cancelInvoice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.invoice");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const reason = str(fd, "reason", 300);
  if (!id) return { error: "Invoice not found." };
  if (!reason) return { error: "Give a reason for cancelling." };

  const { data, error } = await supabase
    .from("invoices")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: session.staff.id,
      cancel_reason: reason,
    })
    .eq("id", id)
    .eq("status", "issued")
    .select("booking_id, number")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBilling(data.booking_id);
  return { success: `Invoice ${data.number} cancelled. The number stays on record.` };
}

// ── Online payments ─────────────────────────────────────────────────────────

/**
 * Creates a Razorpay payment link for a booking and, if asked, has Razorpay
 * email and text it to the guest. Nothing is credited to the folio here: the
 * webhook does that once Razorpay confirms the money arrived.
 */
export async function createPaymentRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.payment");
  const supabase = await createClient();
  const settings = await getSettings();
  if (!razorpayConfigured()) {
    return { error: "Online payments are not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." };
  }

  const bookingId = uuidOrNull(fd, "booking_id");
  const amount = num(fd, "amount");
  const purpose = oneOf(fd, "purpose", ["deposit", "settlement"] as const, "settlement");
  if (!bookingId) return { error: "Booking not found." };
  if (amount === null || amount <= 0) return { error: "Enter an amount above zero." };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference, contact_name, contact_email, contact_phone")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (!booking.contact_email && !booking.contact_phone) {
    return { error: "Add an email address or phone number to the booking before sending a payment link." };
  }

  const link = await createPaymentLink({
    amount,
    currency: settings.currency,
    description: `${purpose === "deposit" ? "Deposit" : "Payment"} for booking ${booking.reference} at ${settings.name}`,
    referenceId: `${booking.reference}-${Date.now()}`,
    // Razorpay rejects a bare 10-digit number, which is how the desk types
    // one, so it gets the same +91 treatment as an SMS.
    customer: {
      name: booking.contact_name,
      email: booking.contact_email,
      phone: booking.contact_phone ? normalisePhone(booking.contact_phone) : "",
    },
    notify: fd.get("notify") !== null,
    expiresInMinutes: 60 * 24,
    notes: { booking_id: booking.id, reference: booking.reference, purpose },
  });
  if (!link.ok || !link.data) return { error: link.error };

  const { error } = await supabase.from("payment_transactions").insert({
    booking_id: bookingId,
    folio_id: uuidOrNull(fd, "folio_id"),
    provider: "razorpay",
    provider_link_id: link.data.id,
    short_url: link.data.short_url,
    purpose,
    amount,
    currency: settings.currency,
    status: "created",
    expires_at: link.data.expire_by ? new Date(link.data.expire_by * 1000).toISOString() : null,
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateBilling(bookingId);
  return { success: `Payment link created: ${link.data.short_url}` };
}

export async function cancelPaymentRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("folio.payment");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Payment request not found." };

  const { data: tx } = await supabase
    .from("payment_transactions")
    .select("id, booking_id, provider_link_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!tx) return { error: "Payment request not found." };
  if (tx.status !== "created") return { error: "That payment request is no longer open." };

  if (tx.provider_link_id) {
    const res = await cancelPaymentLink(tx.provider_link_id);
    if (!res.ok) return { error: res.error };
  }
  await supabase
    .from("payment_transactions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);

  revalidateBilling(tx.booking_id);
  return { success: "Payment link cancelled." };
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Asks for a refund. Below the property's threshold it is paid out straight
 * away; at or above it, it waits for someone with approval rights — and never
 * the person who asked (SOW Module 7 "Refund Rules").
 */
export async function requestRefund(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.payment");
  const supabase = await createClient();
  const settings = await getSettings();

  const bookingId = uuidOrNull(fd, "booking_id");
  const amount = num(fd, "amount");
  const reason = str(fd, "reason", 300);
  const method = oneOfOrNull(fd, "method", PAYMENT_METHODS);
  if (!bookingId) return { error: "Booking not found." };
  if (amount === null || amount <= 0) return { error: "Enter an amount above zero." };
  if (!reason) return { error: "Give a reason for the refund." };
  if (!method) return { error: "Choose how the money goes back." };

  const { data: request, error } = await supabase
    .from("refund_requests")
    .insert({
      booking_id: bookingId,
      folio_id: uuidOrNull(fd, "folio_id"),
      amount,
      reason,
      method,
      payment_tx_id: uuidOrNull(fd, "payment_tx_id"),
      requested_by: session.staff.id,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  if (refundNeedsApproval(amount, Number(settings.refund_approval_threshold))) {
    revalidateBilling(bookingId);
    return {
      success: `Refund of ₹${amount.toLocaleString("en-IN")} sent for approval — it is above the ₹${Number(
        settings.refund_approval_threshold,
      ).toLocaleString("en-IN")} threshold.`,
    };
  }

  // Under the threshold: pay it out now, recording who asked as the approver.
  const paid = await payOutRefund(supabase, request.id, session.staff.id);
  revalidateBilling(bookingId);
  return paid.error ? { error: paid.error } : { success: paid.message };
}

export async function decideRefund(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.refund_approve");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const approve = fd.get("decision") === "approve";
  const note = str(fd, "note", 300);
  if (!id) return { error: "Refund request not found." };
  if (!approve && !note) return { error: "Say why the refund is refused." };

  const { data: request } = await supabase
    .from("refund_requests")
    .select("id, booking_id, status, requested_by")
    .eq("id", id)
    .maybeSingle();
  if (!request) return { error: "Refund request not found." };
  if (request.status !== "pending") return { error: "That request has already been decided." };
  if (request.requested_by === session.staff.id) {
    return { error: "A refund must be approved by someone other than the person who requested it." };
  }

  const { error } = await supabase
    .from("refund_requests")
    .update({
      status: approve ? "approved" : "rejected",
      decided_by: session.staff.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: friendlyDbError(error.message) };

  if (!approve) {
    revalidateBilling(request.booking_id);
    return { success: "Refund refused." };
  }

  const paid = await payOutRefund(supabase, id, session.staff.id);
  revalidateBilling(request.booking_id);
  return paid.error ? { error: paid.error } : { success: paid.message };
}

/**
 * Pays an approved refund: back through Razorpay when it came in that way,
 * otherwise recorded as paid by hand. Either way the folio gets the refund
 * line, so the balance and the invoice always agree with the money.
 */
async function payOutRefund(
  supabase: Awaited<ReturnType<typeof createClient>>,
  refundId: string,
  staffId: string,
): Promise<{ error: string | null; message: string }> {
  const { data: request } = await supabase
    .from("refund_requests")
    .select("*, payment_transactions(provider_ref)")
    .eq("id", refundId)
    .maybeSingle();
  if (!request) return { error: "Refund request not found.", message: "" };

  const gatewayRef = (request.payment_transactions as { provider_ref: string | null } | null)?.provider_ref;

  if (request.method === "online_gateway") {
    if (!gatewayRef) {
      await supabase
        .from("refund_requests")
        .update({ status: "failed", error: "No gateway payment to refund against." })
        .eq("id", refundId);
      return { error: "This refund is marked as going back through the gateway, but the original online payment is not linked.", message: "" };
    }
    const res = await refundPayment(gatewayRef, Number(request.amount), { refund_request: refundId });
    if (!res.ok) {
      await supabase.from("refund_requests").update({ status: "failed", error: res.error }).eq("id", refundId);
      return { error: `Razorpay refused the refund: ${res.error}`, message: "" };
    }
  }

  const { data: entry, error } = await supabase
    .from("folio_entries")
    .insert({
      booking_id: request.booking_id,
      folio_id: request.folio_id,
      kind: "refund",
      description: `Refund — ${request.reason}`.slice(0, 200),
      amount: request.amount,
      method: request.method,
      reference: gatewayRef ?? "",
      created_by: staffId,
    })
    .select("id")
    .single();
  if (error) {
    await supabase.from("refund_requests").update({ status: "failed", error: error.message }).eq("id", refundId);
    return { error: friendlyDbError(error.message), message: "" };
  }

  await supabase
    .from("refund_requests")
    .update({ status: "processed", processed_at: new Date().toISOString(), folio_entry_id: entry.id, error: "" })
    .eq("id", refundId);

  return {
    error: null,
    message: `Refund of ₹${Number(request.amount).toLocaleString("en-IN")} paid and posted to the folio.`,
  };
}
