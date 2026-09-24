"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { financialYearOf, formatInvoiceNumber, invoiceTotals, taxBreakdown } from "../lib/invoices";
import { clientName, defaultPaymentTerms, eventHours, formatEventNumber, holdWindow } from "../lib/events";
import { todayIn } from "../lib/dates";
import type {
  EventBooking,
  EventSpace,
  EventType,
  InvoiceLine,
  PaymentMethod,
  RentalBasis,
  TaxBand,
} from "../lib/types";
import {
  type ActionState,
  str,
  num,
  int,
  bool,
  oneOf,
  uuidOrNull,
  dateStr,
  lines as formLines,
} from "./form-utils";

/**
 * Module 10 — banquets, conferences and events.
 *
 * The pricing, the availability guard and the approval rules all live in the
 * database (0019_events.sql), so an event priced by this page and an event
 * priced by anything else come to the same number. These actions collect the
 * form, call the function, and turn a refusal into a sentence.
 */

const EVENT_TYPES: EventType[] = [
  "conference",
  "residential_conference",
  "corporate_meeting",
  "training",
  "wedding",
  "reception",
  "banquet",
  "birthday",
  "exhibition",
  "other",
];

const RENTAL_BASES: RentalBasis[] = ["full_day", "half_day", "hourly", "custom", "waived"];

const PAYMENT_METHODS: PaymentMethod[] = [
  "cash", "card", "upi", "bank_transfer", "online_gateway", "corporate_billing", "ota_prepaid", "wallet", "other",
];

const LINE_KINDS = ["equipment", "food_extra", "decor", "other"] as const;
const MEAL_PERIODS = ["breakfast", "lunch", "hi_tea", "dinner", "full_day", "custom"] as const;
const PAYMENT_KINDS = ["advance", "payment", "refund"] as const;

function revalidateEvent(id?: string) {
  if (id) revalidatePath(`/admin/events/${id}`);
  revalidatePath("/admin/events");
  revalidatePath("/admin/events/diary");
}

/** A time input, as HH:MM, or "" when it is not one. */
const timeStr = (fd: FormData, key: string) => {
  const v = str(fd, key, 8);
  return /^([01]\d|2[0-3]):[0-5]\d/.test(v) ? v.slice(0, 5) : "";
};

// ── Enquiries and events ────────────────────────────────────────────────────

/**
 * Takes an enquiry. Everything after this is a change to the same record: the
 * enquiry becomes the quotation, the quotation becomes the confirmed event
 * and the confirmed event becomes the bill, so the history of a function is
 * one row with one number on it.
 */
export async function createEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("events.book");
  const supabase = await createClient();
  const settings = await getSettings();

  const spaceId = uuidOrNull(fd, "space_id");
  const title = str(fd, "title", 120);
  const eventDate = dateStr(fd, "event_date");
  const startTime = timeStr(fd, "start_time");
  const endTime = timeStr(fd, "end_time");
  const pax = int(fd, "pax_expected", 0, 0, 100000);
  const contactName = str(fd, "contact_name", 120);
  const guestId = uuidOrNull(fd, "guest_id");
  const companyId = uuidOrNull(fd, "company_id");

  if (!spaceId) return { error: "Choose the space the event is in." };
  if (!title) return { error: "Give the event a name, such as “Khan wedding reception”." };
  if (!eventDate) return { error: "Choose the date of the event." };
  if (!startTime || !endTime) return { error: "Give the times the event starts and finishes." };
  if (endTime <= startTime) return { error: "The event has to finish after it starts." };
  if (pax < 1) return { error: "How many people are expected?" };
  if (!guestId && !companyId && !contactName) {
    return { error: "Say who the event is for: a guest, a company, or a contact name." };
  }

  const { data: spaceRow } = await supabase
    .from("event_spaces")
    .select("*")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) return { error: "That space no longer exists." };
  const space = spaceRow as EventSpace;

  // The hall is held either side of the event by the space's own allowances,
  // so the diary does not promise it while it is being dressed or cleared.
  const hold = holdWindow(startTime, endTime, space.setup_minutes, space.teardown_minutes);

  const fy = financialYearOf(eventDate);
  const { data: seq, error: seqError } = await supabase.rpc("next_event_number", { p_fy: fy });
  if (seqError || typeof seq !== "number") {
    return { error: friendlyDbError(seqError?.message ?? "Could not allocate an event number.") };
  }

  const basis = oneOf(fd, "rental_basis", RENTAL_BASES, "full_day");

  // Payment terms are booking data in the SOW. A corporate client already has
  // agreed terms on their account, so those are what the quotation says
  // rather than something typed again; whoever is selling can edit it after.
  let paymentTerms = str(fd, "payment_terms", 500);
  if (!paymentTerms) {
    const { data: company } = companyId
      ? await supabase.from("companies").select("name, payment_terms_days").eq("id", companyId).maybeSingle()
      : { data: null };
    paymentTerms = defaultPaymentTerms(company, settings.event_advance_percent);
  }

  const { data, error } = await supabase
    .from("event_bookings")
    .insert({
      number: formatEventNumber(fy, seq),
      financial_year: fy,
      seq,
      space_id: spaceId,
      layout_id: uuidOrNull(fd, "layout_id"),
      title,
      event_type: oneOf(fd, "event_type", EVENT_TYPES, "conference"),
      guest_id: guestId,
      company_id: companyId,
      contact_name: contactName,
      contact_phone: str(fd, "contact_phone", 30),
      contact_email: str(fd, "contact_email", 120),
      payment_terms: paymentTerms,
      booking_id: uuidOrNull(fd, "booking_id"),
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      setup_from: hold.setup_from,
      teardown_to: hold.teardown_to,
      pax_expected: pax,
      pax_guaranteed: int(fd, "pax_guaranteed", 0, 0, 100000),
      package_id: uuidOrNull(fd, "package_id"),
      menu_notes: str(fd, "menu_notes", 2000),
      rental_basis: basis,
      // Hourly rental defaults to the length of the event, which is what the
      // desk means when it says "charge them by the hour".
      rental_hours: basis === "hourly" ? (num(fd, "rental_hours") ?? eventHours(startTime, endTime)) : 0,
      rental_override: basis === "custom" ? num(fd, "rental_override") : null,
      notes: str(fd, "notes", 2000),
      created_by: session.staff.id,
    })
    .select("id, number")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(data.id);
  return {
    success:
      `Enquiry ${data.number} taken for ${eventDate}. ` +
      `Price the hall and the catering, then send a quotation${
        settings.event_quote_approval_threshold > 0 ? " for approval if it is a large one" : ""
      }.`,
  };
}

/** Changes an event's details. Repricing is refused once it has been billed. */
export async function updateEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { data: current } = await supabase
    .from("event_bookings")
    .select("*, event_spaces(setup_minutes, teardown_minutes)")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "Event not found." };
  const event = current as EventBooking & {
    event_spaces: Pick<EventSpace, "setup_minutes" | "teardown_minutes"> | null;
  };

  const title = str(fd, "title", 120);
  const eventDate = dateStr(fd, "event_date");
  const startTime = timeStr(fd, "start_time");
  const endTime = timeStr(fd, "end_time");
  if (!title) return { error: "Give the event a name." };
  if (!eventDate) return { error: "Choose the date of the event." };
  if (!startTime || !endTime) return { error: "Give the times the event starts and finishes." };
  if (endTime <= startTime) return { error: "The event has to finish after it starts." };

  const hold = holdWindow(
    startTime,
    endTime,
    event.event_spaces?.setup_minutes ?? 60,
    event.event_spaces?.teardown_minutes ?? 60,
  );
  const basis = oneOf(fd, "rental_basis", RENTAL_BASES, event.rental_basis);

  const { error } = await supabase
    .from("event_bookings")
    .update({
      layout_id: uuidOrNull(fd, "layout_id"),
      title,
      event_type: oneOf(fd, "event_type", EVENT_TYPES, event.event_type),
      guest_id: uuidOrNull(fd, "guest_id"),
      company_id: uuidOrNull(fd, "company_id"),
      contact_name: str(fd, "contact_name", 120),
      contact_phone: str(fd, "contact_phone", 30),
      contact_email: str(fd, "contact_email", 120),
      payment_terms: str(fd, "payment_terms", 500),
      booking_id: uuidOrNull(fd, "booking_id"),
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      setup_from: hold.setup_from,
      teardown_to: hold.teardown_to,
      pax_expected: int(fd, "pax_expected", event.pax_expected, 1, 100000),
      pax_guaranteed: int(fd, "pax_guaranteed", event.pax_guaranteed, 0, 100000),
      package_id: uuidOrNull(fd, "package_id"),
      menu_notes: str(fd, "menu_notes", 2000),
      rental_basis: basis,
      rental_hours: basis === "hourly" ? (num(fd, "rental_hours") ?? eventHours(startTime, endTime)) : 0,
      rental_override: basis === "custom" ? num(fd, "rental_override") : null,
      discount_percent: Math.min(100, Math.max(0, num(fd, "discount_percent") ?? 0)),
      notes: str(fd, "notes", 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: "Event updated." };
}

/** The banquet event order: what each department needs to know on the day. */
export async function saveEventOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { error } = await supabase
    .from("event_bookings")
    .update({
      beo_setup_notes: str(fd, "beo_setup_notes", 4000),
      beo_service_notes: str(fd, "beo_service_notes", 4000),
      beo_av_notes: str(fd, "beo_av_notes", 4000),
      menu_notes: str(fd, "menu_notes", 4000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: "Event order saved. Print it for the kitchen and the stewards." };
}

/** Records the signed contract, which is what makes the booking firm on paper. */
export async function recordEventContract(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const signedOn = dateStr(fd, "contract_signed_on");
  const signedName = str(fd, "contract_signed_name", 120);
  if (!id) return { error: "Event not found." };
  if (!signedOn) return { error: "When was the contract signed?" };
  if (!signedName) return { error: "Who signed it?" };

  const { error } = await supabase
    .from("event_bookings")
    .update({ contract_signed_on: signedOn, contract_signed_name: signedName, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: `Contract recorded as signed by ${signedName}.` };
}

// ── Charges ─────────────────────────────────────────────────────────────────

/** Adds a line to an event: equipment hire, extra food, flowers, a band. */
export async function addEventLine(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("events.book");
  const supabase = await createClient();
  const eventId = uuidOrNull(fd, "event_id");
  if (!eventId) return { error: "Event not found." };

  const equipmentId = uuidOrNull(fd, "equipment_id");
  let description = str(fd, "description", 200);
  let unitPrice = num(fd, "unit_price");
  let taxRate = num(fd, "tax_rate");
  let kind: (typeof LINE_KINDS)[number] = oneOf(fd, "kind", LINE_KINDS, "other");

  // Picking from the equipment list fills in the rest, so the price and the
  // tax rate come from the hotel's own list rather than being typed twice.
  if (equipmentId) {
    const { data: item } = await supabase
      .from("event_equipment")
      .select("name, rental_price, tax_rate, space_id")
      .eq("id", equipmentId)
      .maybeSingle();
    if (!item) return { error: "That equipment no longer exists." };

    // Equipment tied to another space is not available in this one.
    if (item.space_id) {
      const { data: ev } = await supabase
        .from("event_bookings")
        .select("space_id")
        .eq("id", eventId)
        .maybeSingle();
      if (ev && ev.space_id !== item.space_id) {
        return { error: `${item.name} belongs to another space and is not available in this one.` };
      }
    }
    kind = "equipment";
    description = description || item.name;
    if (unitPrice === null) unitPrice = Number(item.rental_price);
    if (taxRate === null) taxRate = Number(item.tax_rate);
  }

  if (!description) return { error: "Say what the charge is for." };
  if (unitPrice === null || unitPrice < 0) return { error: "Enter a price." };

  const qty = num(fd, "qty") ?? 1;
  if (qty <= 0) return { error: "Enter a quantity greater than zero." };

  const { error } = await supabase.from("event_lines").insert({
    event_id: eventId,
    kind,
    equipment_id: equipmentId,
    description,
    qty,
    unit_price: unitPrice,
    tax_rate: Math.min(100, Math.max(0, taxRate ?? 18)),
    sort_order: int(fd, "sort_order", 0, 0, 999),
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(eventId);
  return { success: `“${description}” added.` };
}

export async function removeEventLine(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const eventId = uuidOrNull(fd, "event_id");
  if (!id) return { error: "That charge no longer exists." };

  const { error } = await supabase.from("event_lines").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(eventId ?? undefined);
  return { success: "Charge removed." };
}

// ── Quotation, approval, confirmation ───────────────────────────────────────

export async function submitEventQuote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.quote");
  const supabase = await createClient();
  const settings = await getSettings();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { error } = await supabase.rpc("event_submit_quote", { p_event: id });
  if (error) return { error: friendlyDbError(error.message) };

  const { data } = await supabase
    .from("event_bookings")
    .select("number, grand_total, approval_required")
    .eq("id", id)
    .maybeSingle();

  revalidateEvent(id);
  if (data?.approval_required) {
    return {
      success:
        `Quotation ${data.number} prepared at ${Number(data.grand_total).toFixed(2)}, which is at or above the ` +
        `approval threshold of ${Number(settings.event_quote_approval_threshold).toFixed(2)}. ` +
        `A manager has to approve it before the date can be held.`,
    };
  }
  return { success: `Quotation ${data?.number ?? ""} prepared. Print or email it, then confirm once the client agrees.` };
}

export async function approveEventQuote(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.approve");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { error } = await supabase.rpc("event_approve_quote", { p_event: id });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: "Quotation approved. The event can now be confirmed." };
}

export async function confirmEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { error } = await supabase.rpc("event_confirm", { p_event: id });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: "Event confirmed. The hall is now held and will refuse a second function at that time." };
}

export async function completeEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const paxActual = num(fd, "pax_actual");
  if (!id) return { error: "Event not found." };
  if (paxActual === null || paxActual < 0 || !Number.isInteger(paxActual)) {
    return { error: "Enter how many people actually attended." };
  }

  const { error } = await supabase.rpc("event_complete", { p_event: id, p_pax_actual: paxActual });
  if (error) return { error: friendlyDbError(error.message) };

  const { data } = await supabase
    .from("event_bookings")
    .select("pax_guaranteed, grand_total")
    .eq("id", id)
    .maybeSingle();

  revalidateEvent(id);
  return {
    success:
      paxActual > Number(data?.pax_guaranteed ?? 0)
        ? `Closed at ${paxActual} attending, above the guarantee, so the catering has been rebilled on ${paxActual}.`
        : `Closed at ${paxActual} attending. The guarantee of ${data?.pax_guaranteed ?? 0} is still what is billed.`,
  };
}

export async function cancelEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.book");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const reason = str(fd, "reason", 300);
  if (!id) return { error: "Event not found." };
  if (!reason) return { error: "Give a reason for cancelling." };

  const { error } = await supabase.rpc("event_cancel", { p_event: id, p_reason: reason });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return { success: "Event cancelled. Any deposit already taken can be refunded from the money tab." };
}

// ── Money ───────────────────────────────────────────────────────────────────

export async function takeEventPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.bill");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const amount = num(fd, "amount");
  if (!id) return { error: "Event not found." };
  if (amount === null || amount <= 0) return { error: "Enter an amount greater than zero." };

  const kind = oneOf(fd, "kind", PAYMENT_KINDS, "payment");
  const { error } = await supabase.rpc("event_take_payment", {
    p_event: id,
    p_kind: kind,
    p_method: oneOf(fd, "method", PAYMENT_METHODS, "cash"),
    p_amount: amount,
    p_reference: str(fd, "reference", 120),
    p_notes: str(fd, "notes", 300),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  return {
    success:
      kind === "refund"
        ? "Refund recorded."
        : kind === "advance"
          ? "Deposit recorded. The date can now be held with something behind it."
          : "Payment recorded.",
  };
}

/** Bills the event onto a resident guest's stay — a residential conference. */
export async function billEventToRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.bill");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const bookingId = uuidOrNull(fd, "booking_id");
  if (!id) return { error: "Event not found." };
  if (!bookingId) return { error: "Choose the stay to bill this event to." };

  const { error } = await supabase.rpc("event_post_to_folio", {
    p_event: id,
    p_booking: bookingId,
    p_folio: uuidOrNull(fd, "folio_id"),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: "Event billed to the room. It is now on the guest's folio and will appear on their invoice." };
}

/** Bills the event to a company, which is how corporate conferences settle. */
export async function billEventToCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.bill");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { error } = await supabase.rpc("event_to_city_ledger", {
    p_event: id,
    p_company: uuidOrNull(fd, "company_id"),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  revalidatePath("/admin/billing/city-ledger");
  return {
    success:
      "Event billed to the company. It is on the city ledger now, due on the company's terms, and ages with the rest of their debt.",
  };
}

/**
 * Issues a GST invoice for an event, from the property's own invoice series —
 * the same run of numbers as a room invoice, because the tax law wants one
 * series for the whole property, not one per department.
 */
export async function issueEventInvoice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.invoice");
  const supabase = await createClient();
  const settings = await getSettings();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Event not found." };

  const { data: row } = await supabase
    .from("event_bookings")
    .select("*, companies(name, gstin, billing_address), guests(full_name), event_spaces(name)")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Event not found." };
  const event = row as EventBooking & { event_spaces: { name: string } | null };

  if (event.status !== "confirmed" && event.status !== "completed") {
    return { error: "Confirm the event before invoicing it." };
  }

  const { data: existing } = await supabase
    .from("invoices")
    .select("number")
    .eq("event_id", id)
    .eq("status", "issued")
    .maybeSingle();
  if (existing) {
    return { error: `This event already has invoice ${existing.number}. Cancel it before issuing another.` };
  }

  // The bands come from the database, so the invoice cannot disagree with the
  // event or with the tax summary report.
  const { data: bandRows, error: bandError } = await supabase.rpc("event_tax_bands", { p_event: id });
  if (bandError) return { error: friendlyDbError(bandError.message) };
  const bands = ((bandRows ?? []) as TaxBand[]).map((b) => ({
    rate: Number(b.rate),
    net: Number(b.net),
    tax: Number(b.tax),
  }));
  if (bands.length === 0) return { error: "There is nothing to invoice on this event yet." };

  const invoiceLines: InvoiceLine[] = bands.map((b) => ({
    date: event.event_date,
    description:
      `${event.title} — ${event.event_spaces?.name ?? "Event"} on ${event.event_date}` +
      (b.rate ? ` (taxed at ${b.rate}%)` : ""),
    kind: "event",
    net: b.net,
    tax_rate: b.rate,
    tax: b.tax,
    total: Math.round((b.net + b.tax) * 100) / 100,
  }));
  const totals = invoiceTotals(invoiceLines);

  const fy = financialYearOf(todayIn(settings.timezone));
  const { data: seq, error: seqError } = await supabase.rpc("next_invoice_number", {
    p_series: settings.invoice_prefix || "INV",
    p_fy: fy,
  });
  if (seqError || typeof seq !== "number") {
    return { error: friendlyDbError(seqError?.message ?? "Could not allocate an invoice number.") };
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      number: formatInvoiceNumber(settings.invoice_prefix || "INV", fy, seq),
      series: settings.invoice_prefix || "INV",
      financial_year: fy,
      seq,
      event_id: id,
      bill_to_name: clientName(event),
      bill_to_address: event.companies?.billing_address ?? "",
      bill_to_gstin: event.companies?.gstin ?? "",
      company_id: event.company_id,
      place_of_supply: settings.state,
      currency: settings.currency,
      net_total: totals.net,
      tax_total: totals.tax,
      grand_total: totals.grand,
      tax_breakdown: taxBreakdown(invoiceLines),
      lines: invoiceLines,
      issued_by: session.staff.id,
    })
    .select("number")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidateEvent(id);
  revalidatePath("/admin/billing/invoices");
  return { success: `Invoice ${invoice.number} issued for this event.` };
}

// ── Setup: the hall, its layouts, the packages and the equipment ────────────

export async function saveEventSpace(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  const code = str(fd, "code", 8).toUpperCase();
  if (!name) return { error: "Give the space a name." };
  if (!id && !/^[A-Z0-9]{2,8}$/.test(code)) {
    return { error: "Give the space a short code of 2 to 8 letters or digits, such as HALL." };
  }

  const row = {
    name,
    description: str(fd, "description", 500),
    floor: num(fd, "floor"),
    area_sqft: num(fd, "area_sqft"),
    rental_full_day: Math.max(0, num(fd, "rental_full_day") ?? 0),
    rental_half_day: Math.max(0, num(fd, "rental_half_day") ?? 0),
    rental_per_hour: Math.max(0, num(fd, "rental_per_hour") ?? 0),
    min_charge: Math.max(0, num(fd, "min_charge") ?? 0),
    tax_rate: Math.min(100, Math.max(0, num(fd, "tax_rate") ?? 18)),
    setup_minutes: int(fd, "setup_minutes", 60, 0, 1440),
    teardown_minutes: int(fd, "teardown_minutes", 60, 0, 1440),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("event_spaces").update(row).eq("id", id)
    : await supabase.from("event_spaces").insert({ ...row, code });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/events/setup");
  revalidateEvent();
  return { success: `“${name}” saved.` };
}

export async function saveEventLayout(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const spaceId = uuidOrNull(fd, "space_id");
  const name = str(fd, "name", 60);
  const capacity = int(fd, "capacity", 0, 0, 100000);
  if (!id && !spaceId) return { error: "Choose the space this seating plan belongs to." };
  if (!name) return { error: "Name the seating plan, such as “U-shape”." };
  if (capacity < 1) return { error: "How many people does this plan seat?" };

  const row = {
    name,
    capacity,
    notes: str(fd, "notes", 300),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
  };

  const { error } = id
    ? await supabase.from("event_layouts").update(row).eq("id", id)
    : await supabase.from("event_layouts").insert({ ...row, space_id: spaceId });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/events/setup");
  return { success: `“${name}” seats ${capacity}.` };
}

export async function deleteEventLayout(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "That seating plan no longer exists." };

  const { error } = await supabase.from("event_layouts").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/events/setup");
  return { success: "Seating plan removed." };
}

/**
 * A per-head catering package. The hotel quotes banquet food per head rather
 * than from the restaurant card, so these are the prices a quotation is built
 * from and they are deliberately separate from the POS menus.
 */
export async function saveEventPackage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  const code = str(fd, "code", 12).toUpperCase();
  const price = num(fd, "price_per_head");
  if (!name) return { error: "Name the package." };
  if (!id && !/^[A-Z0-9-]{2,12}$/.test(code)) {
    return { error: "Give the package a short code of 2 to 12 letters, digits or hyphens." };
  }
  if (price === null || price < 0) return { error: "Enter a price per head." };

  const row = {
    name,
    description: str(fd, "description", 500),
    meal_period: oneOf(fd, "meal_period", MEAL_PERIODS, "custom"),
    price_per_head: price,
    tax_rate: Math.min(100, Math.max(0, num(fd, "tax_rate") ?? 5)),
    min_pax: int(fd, "min_pax", 0, 0, 100000),
    inclusions: formLines(fd, "inclusions", 30),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("event_packages").update(row).eq("id", id)
    : await supabase.from("event_packages").insert({ ...row, code });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/events/setup");
  revalidateEvent();
  return { success: `“${name}” saved at ${price} per head.` };
}

export async function saveEventEquipment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  const price = num(fd, "rental_price");
  if (!name) return { error: "Name the equipment." };
  if (price === null || price < 0) return { error: "Enter what it is hired out for." };

  const row = {
    name,
    // Null means the item travels between spaces rather than living in one.
    space_id: uuidOrNull(fd, "space_id"),
    description: str(fd, "description", 500),
    unit: str(fd, "unit", 20) || "unit",
    rental_price: price,
    tax_rate: Math.min(100, Math.max(0, num(fd, "tax_rate") ?? 18)),
    qty_available: int(fd, "qty_available", 1, 0, 1000),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("event_equipment").update(row).eq("id", id)
    : await supabase.from("event_equipment").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/events/setup");
  return { success: `“${name}” saved.` };
}
