import { describe, it, expect } from "vitest";
import {
  invoiceLines,
  invoiceTotals,
  taxBreakdown,
  amountPaid,
  formatInvoiceNumber,
  financialYearOf,
  refundNeedsApproval,
} from "../app/lib/invoices";
import type { FolioEntry } from "../app/lib/types";

/** Module 7 — the arithmetic a tax invoice depends on. */

const entry = (e: Partial<FolioEntry>): FolioEntry => ({
  id: crypto.randomUUID(),
  booking_id: "b1",
  folio_id: "f1",
  kind: "room",
  description: "Room 101",
  stay_date: "2026-09-20",
  amount: 0,
  tax_amount: 0,
  tax_rate: 0,
  method: null,
  reference: "",
  is_deposit: false,
  fx_currency: null,
  fx_amount: null,
  fx_rate: null,
  night_audit_date: null,
  voided_at: null,
  void_reason: "",
  created_at: "2026-09-20T10:00:00.000Z",
  ...e,
});

describe("invoice lines", () => {
  it("bills charges and leaves payments off the invoice", () => {
    const lines = invoiceLines([
      entry({ kind: "room", amount: 6000, tax_amount: 300, tax_rate: 5 }),
      entry({ kind: "extra", description: "Laundry", amount: 500, tax_amount: 90, tax_rate: 18 }),
      entry({ kind: "payment", amount: 3000, method: "cash" }),
      entry({ kind: "adjustment", amount: 100 }),
    ]);
    expect(lines.map((l) => l.description)).toEqual(["Room 101", "Laundry"]);
  });

  it("leaves out voided charges, so a corrected mistake is never billed", () => {
    const lines = invoiceLines([
      entry({ amount: 6000, tax_amount: 300, tax_rate: 5 }),
      entry({ amount: 6000, tax_amount: 300, tax_rate: 5, voided_at: "2026-09-20T12:00:00.000Z" }),
    ]);
    expect(lines).toHaveLength(1);
  });

  it("carries each line's own total", () => {
    const [line] = invoiceLines([entry({ amount: 6000, tax_amount: 300, tax_rate: 5 })]);
    expect(line.net).toBe(6000);
    expect(line.tax).toBe(300);
    expect(line.total).toBe(6300);
  });
});

describe("tax breakdown", () => {
  it("groups charges by rate, lowest first", () => {
    const lines = invoiceLines([
      entry({ amount: 6000, tax_amount: 300, tax_rate: 5 }),
      entry({ amount: 4000, tax_amount: 200, tax_rate: 5 }),
      entry({ kind: "extra", amount: 500, tax_amount: 90, tax_rate: 18 }),
    ]);
    expect(taxBreakdown(lines)).toEqual([
      { rate: 5, net: 10000, tax: 500 },
      { rate: 18, net: 500, tax: 90 },
    ]);
  });

  it("keeps a zero-rated band of its own rather than folding it in", () => {
    const lines = invoiceLines([
      entry({ amount: 1000, tax_amount: 0, tax_rate: 0 }),
      entry({ kind: "extra", amount: 200, tax_amount: 36, tax_rate: 18 }),
    ]);
    expect(taxBreakdown(lines).map((b) => b.rate)).toEqual([0, 18]);
  });

  it("the breakdown adds up to the invoice totals", () => {
    const lines = invoiceLines([
      entry({ amount: 7499.5, tax_amount: 374.98, tax_rate: 5 }),
      entry({ kind: "extra", amount: 1250.25, tax_amount: 225.05, tax_rate: 18 }),
    ]);
    const totals = invoiceTotals(lines);
    const bands = taxBreakdown(lines);
    expect(bands.reduce((s, b) => s + b.net, 0)).toBeCloseTo(totals.net, 2);
    expect(bands.reduce((s, b) => s + b.tax, 0)).toBeCloseTo(totals.tax, 2);
    expect(totals.grand).toBeCloseTo(totals.net + totals.tax, 2);
  });
});

describe("amount paid", () => {
  it("counts payments and credits, and takes refunds back off", () => {
    const paid = amountPaid([
      entry({ kind: "payment", amount: 3000, method: "cash" }),
      entry({ kind: "adjustment", amount: 200 }),
      entry({ kind: "refund", amount: 500, method: "cash" }),
      entry({ kind: "payment", amount: 1000, method: "card", voided_at: "2026-09-20T12:00:00.000Z" }),
    ]);
    expect(paid).toBe(2700);
  });
});

describe("invoice numbering", () => {
  it("pads the sequence so numbers sort and read consistently", () => {
    expect(formatInvoiceNumber("INV", "2026-27", 1)).toBe("INV/2026-27/0001");
    expect(formatInvoiceNumber("INV", "2026-27", 1234)).toBe("INV/2026-27/1234");
  });

  it("does not truncate once a series passes four digits", () => {
    expect(formatInvoiceNumber("INV", "2026-27", 12345)).toBe("INV/2026-27/12345");
  });

  it("runs the Indian financial year from April to March", () => {
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
    expect(financialYearOf("2026-09-21")).toBe("2026-27");
    expect(financialYearOf("2027-03-31")).toBe("2026-27");
    expect(financialYearOf("2027-04-01")).toBe("2027-28");
    expect(financialYearOf("2026-01-15")).toBe("2025-26");
  });

  it("matches the database's financial year at the turn of the century", () => {
    expect(financialYearOf("2099-04-01")).toBe("2099-00");
  });
});

describe("refund approval", () => {
  it("needs approval at and above the threshold", () => {
    expect(refundNeedsApproval(5000, 5000)).toBe(true);
    expect(refundNeedsApproval(5000.01, 5000)).toBe(true);
    expect(refundNeedsApproval(4999.99, 5000)).toBe(false);
  });

  it("a threshold of zero sends every refund for approval", () => {
    expect(refundNeedsApproval(1, 0)).toBe(true);
    expect(refundNeedsApproval(0.01, 0)).toBe(true);
  });
});
