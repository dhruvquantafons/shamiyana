"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { todayIn } from "../lib/dates";
import { toBase, impliedRate } from "../lib/currency";
import type { Currency, PaymentMethod } from "../lib/types";
import { type ActionState, str, num, bool, uuidOrNull, oneOf, int } from "./form-utils";

/**
 * Module 7 — city ledger (corporate accounts receivable) and multi-currency.
 *
 * Transferring a stay onto a company's account and voiding that transfer both
 * touch two books at once, so they run inside database functions where they
 * are atomic. Everything else — receipts, credit notes, write-offs and the
 * exchange rate table — is an ordinary insert guarded by RLS.
 */

const PAYMENT_METHODS: PaymentMethod[] = [
  "cash", "card", "upi", "bank_transfer", "online_gateway", "corporate_billing", "ota_prepaid", "wallet", "other",
];

function revalidateLedger(companyId?: string | null, bookingId?: string | null) {
  revalidatePath("/admin/billing/city-ledger");
  if (companyId) revalidatePath(`/admin/billing/city-ledger/${companyId}`);
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin/companies");
}

// ── Transfer a stay onto a company's account ────────────────────────────────

/**
 * Bills an unpaid folio to a company (SOW Module 7). The database settles the
 * folio and opens the receivable in one transaction, and refuses the transfer
 * if it would take the company past its credit limit.
 */
export async function transferToCityLedger(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("folio.city_ledger");
  const supabase = await createClient();
  const settings = await getSettings();

  const folioId = uuidOrNull(fd, "folio_id");
  const companyId = uuidOrNull(fd, "company_id");
  const bookingId = uuidOrNull(fd, "booking_id");
  if (!folioId) return { error: "Choose a folio to transfer." };
  if (!companyId) return { error: "Choose the company to bill." };

  const { data, error } = await supabase.rpc("city_ledger_transfer", {
    p_folio: folioId,
    p_company: companyId,
    p_date: todayIn(settings.timezone),
    p_note: str(fd, "note", 200),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateLedger(companyId, bookingId);
  return {
    success: data
      ? "Billed to the company's account. The stay now reads as settled and the balance is on the city ledger."
      : "Transferred to the city ledger.",
  };
}

/** Undoes a transfer, putting the balance back on the guest's folio. */
export async function voidCityLedgerEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("folio.city_ledger");
  const supabase = await createClient();
  const entryId = uuidOrNull(fd, "entry_id");
  const reason = str(fd, "reason", 300);
  if (!entryId) return { error: "Entry not found." };
  if (!reason) return { error: "Give a reason for voiding this entry." };

  const { data: entry } = await supabase
    .from("city_ledger_entries")
    .select("company_id, booking_id")
    .eq("id", entryId)
    .maybeSingle();

  const { error } = await supabase.rpc("city_ledger_void", { p_entry: entryId, p_reason: reason });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateLedger(entry?.company_id, entry?.booking_id);
  return { success: "Entry voided. The balance is back on the guest's folio." };
}

// ── Receipts, credit notes and write-offs ──────────────────────────────────

/**
 * Records money received from a company. Payments are taken against the
 * account rather than a named invoice — one cheque usually covers several
 * stays — and the aging report applies them to the oldest charge first.
 */
export async function recordCityLedgerPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.city_ledger");
  const supabase = await createClient();

  const companyId = uuidOrNull(fd, "company_id");
  const amount = num(fd, "amount");
  if (!companyId) return { error: "Company not found." };
  if (amount === null || amount <= 0) return { error: "Enter the amount received." };

  const { error } = await supabase.from("city_ledger_entries").insert({
    company_id: companyId,
    kind: "payment",
    amount,
    method: oneOf(fd, "method", PAYMENT_METHODS, "bank_transfer"),
    reference: str(fd, "reference", 120),
    description: str(fd, "description", 300) || "Payment received on account",
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateLedger(companyId);
  return { success: "Payment recorded against the account." };
}

/**
 * A credit note or a write-off. Both reduce what the company owes; the
 * difference is why, which the statement and the audit log keep.
 */
export async function creditCityLedger(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.city_ledger");
  const supabase = await createClient();

  const companyId = uuidOrNull(fd, "company_id");
  const amount = num(fd, "amount");
  const reason = str(fd, "description", 300);
  const kind = oneOf(fd, "kind", ["adjustment", "writeoff"] as const, "adjustment");
  if (!companyId) return { error: "Company not found." };
  if (amount === null || amount <= 0) return { error: "Enter the amount to credit." };
  if (!reason) {
    return {
      error: kind === "writeoff" ? "Give a reason for writing this off." : "Say what the credit note is for.",
    };
  }

  const { error } = await supabase.from("city_ledger_entries").insert({
    company_id: companyId,
    kind,
    amount,
    description: reason,
    reference: str(fd, "reference", 120),
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateLedger(companyId);
  return { success: kind === "writeoff" ? "Written off." : "Credit note recorded." };
}

// ── Foreign-currency settlement ────────────────────────────────────────────

/**
 * Takes a payment in a currency other than the property's. The folio is
 * credited in base currency — every report and balance stays in one money —
 * while what the guest actually handed over, and the rate it converted at,
 * are recorded on the same line so the receipt is reproducible for ever.
 */
export async function takeForeignPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("folio.payment");
  const supabase = await createClient();
  const settings = await getSettings();

  const bookingId = uuidOrNull(fd, "booking_id");
  const folioId = uuidOrNull(fd, "folio_id");
  const code = str(fd, "currency", 3).toUpperCase();
  const foreign = num(fd, "fx_amount");
  if (!bookingId) return { error: "Booking not found." };
  if (!code) return { error: "Choose a currency." };
  if (foreign === null || foreign <= 0) return { error: "Enter the amount the guest is paying." };

  if (!settings.multi_currency_enabled) {
    return { error: "Multi-currency is switched off. Turn it on under Settings first." };
  }
  if (code === settings.currency) {
    return { error: `${code} is the property's own currency — take it as an ordinary payment.` };
  }

  const { data: row } = await supabase.from("currencies").select("*").eq("code", code).maybeSingle();
  const currency = row as Currency | null;
  if (!currency || !currency.is_active) return { error: "That currency is not set up for this property." };

  // A desk that agreed a different rate with the guest may override it; the
  // rate actually used is what gets stored.
  const override = num(fd, "rate");
  const rate = override !== null && override > 0 ? override : Number(currency.rate_to_base);
  const base = toBase(foreign, { rate_to_base: rate });
  if (base <= 0) return { error: "That converts to nothing. Check the rate." };

  const { error } = await supabase.from("folio_entries").insert({
    booking_id: bookingId,
    folio_id: folioId,
    kind: "payment",
    description: `Payment in ${currency.code}${override !== null && override > 0 ? " (agreed rate)" : ""}`,
    amount: base,
    method: oneOf(fd, "method", PAYMENT_METHODS, "cash"),
    reference: str(fd, "reference", 120),
    is_deposit: bool(fd, "is_deposit"),
    fx_currency: currency.code,
    fx_amount: foreign,
    fx_rate: impliedRate(foreign, base),
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/admin/bookings/${bookingId}`);
  return {
    success: `Took ${currency.code} ${foreign.toFixed(currency.decimals)}, credited as ${base.toFixed(2)} ${settings.currency}.`,
  };
}

// ── Exchange rates ──────────────────────────────────────────────────────────

/** Adds a currency the property will quote and accept. */
export async function saveCurrency(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("settings.manage");
  const supabase = await createClient();
  const settings = await getSettings();

  const code = str(fd, "code", 3).toUpperCase();
  const rate = num(fd, "rate_to_base");
  const name = str(fd, "name", 60);
  if (!/^[A-Z]{3}$/.test(code)) return { error: "Use a three-letter currency code, such as USD." };
  if (!name) return { error: "Give the currency a name." };
  if (rate === null || rate <= 0) return { error: "Enter how much one unit is worth in " + settings.currency + "." };
  if (code === settings.currency && rate !== 1) {
    return { error: `${code} is the property's own currency and is always held at a rate of 1.` };
  }

  const { error } = await supabase.from("currencies").upsert(
    {
      code,
      name,
      symbol: str(fd, "symbol", 6),
      rate_to_base: rate,
      decimals: int(fd, "decimals", 2, 0, 4),
      is_active: bool(fd, "is_active"),
      updated_by: session.staff.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "code" },
  );
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/billing/currencies");
  return { success: `${code} saved at ${rate} ${settings.currency}.` };
}

/**
 * Updates several rates at once — what finance actually does each morning,
 * rather than opening seven forms.
 */
export async function updateExchangeRates(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("settings.manage");
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase.from("currencies").select("code, rate_to_base");
  const existing = (data ?? []) as Pick<Currency, "code" | "rate_to_base">[];

  const changed: string[] = [];
  for (const currency of existing) {
    const next = num(fd, `rate_${currency.code}`);
    if (next === null || next <= 0) continue;
    if (currency.code === settings.currency) continue;
    if (Number(currency.rate_to_base) === next) continue;

    const { error } = await supabase
      .from("currencies")
      .update({ rate_to_base: next, updated_by: session.staff.id, updated_at: new Date().toISOString() })
      .eq("code", currency.code);
    if (error) return { error: friendlyDbError(error.message) };
    changed.push(currency.code);
  }

  revalidatePath("/admin/billing/currencies");
  if (changed.length === 0) return { success: "No rates changed." };
  return { success: `Updated ${changed.join(", ")}.` };
}
