import type { FolioEntry, InvoiceLine, TaxBand } from "./types";

/**
 * Turning a folio into a tax invoice (SOW Module 7).
 *
 * An invoice bills the *charges* on a folio — rooms, fees, extras, penalties.
 * Payments are not lines on it; they decide how much of it is still owed. The
 * rate-wise summary (how much was taxed at 5%, how much at 18%) is what a GST
 * invoice has to show, so it is computed here and frozen onto the invoice row.
 *
 * These are pure functions with no database access, so the arithmetic is unit
 * tested in tests/billing.test.ts.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kinds that appear on an invoice. Credits are settlement, not billing. */
const BILLABLE = new Set(["room", "fee", "penalty", "extra"]);

export function invoiceLines(entries: FolioEntry[]): InvoiceLine[] {
  return entries
    .filter((e) => !e.voided_at && BILLABLE.has(e.kind))
    .map((e) => ({
      date: e.stay_date ?? e.created_at.slice(0, 10),
      description: e.description || e.kind,
      kind: e.kind,
      net: round2(Number(e.amount)),
      tax_rate: Number(e.tax_rate),
      tax: round2(Number(e.tax_amount)),
      total: round2(Number(e.amount) + Number(e.tax_amount)),
    }));
}

/** How much was charged at each tax rate, highest rate last. */
export function taxBreakdown(lines: InvoiceLine[]): TaxBand[] {
  const bands = new Map<number, TaxBand>();
  for (const l of lines) {
    const band = bands.get(l.tax_rate) ?? { rate: l.tax_rate, net: 0, tax: 0 };
    band.net += l.net;
    band.tax += l.tax;
    bands.set(l.tax_rate, band);
  }
  return [...bands.values()]
    .map((b) => ({ rate: b.rate, net: round2(b.net), tax: round2(b.tax) }))
    .sort((a, b) => a.rate - b.rate);
}

export interface InvoiceTotals {
  net: number;
  tax: number;
  grand: number;
}

export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const tax = round2(lines.reduce((s, l) => s + l.tax, 0));
  return { net, tax, grand: round2(net + tax) };
}

/** How much of this folio has already been paid, for the "balance due" line. */
export function amountPaid(entries: FolioEntry[]): number {
  return round2(
    entries
      .filter((e) => !e.voided_at && (e.kind === "payment" || e.kind === "adjustment"))
      .reduce((s, e) => s + Number(e.amount), 0) -
      entries
        .filter((e) => !e.voided_at && e.kind === "refund")
        .reduce((s, e) => s + Number(e.amount) + Number(e.tax_amount), 0),
  );
}

/**
 * The printed number: prefix, financial year and a zero-padded sequence, e.g.
 * INV/2026-27/0001. The sequence comes from the database, which is what makes
 * it sequential and non-repeating.
 */
export function formatInvoiceNumber(prefix: string, financialYear: string, seq: number) {
  return `${prefix}/${financialYear}/${String(seq).padStart(4, "0")}`;
}

/** Indian financial year, 1 April to 31 March, written "2026-27". */
export function financialYearOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * SOW Module 7: "Refunds above a set amount require manager or finance-head
 * approval before processing." At or above the threshold, someone else has to
 * approve. A threshold of zero means every refund does.
 */
export function refundNeedsApproval(amount: number, threshold: number): boolean {
  return amount >= threshold;
}
