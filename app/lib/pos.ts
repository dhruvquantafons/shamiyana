import type {
  Outlet,
  PosCategory,
  PosItem,
  PosLineModifier,
  PosModifier,
  PosOrder,
  PosOrderLine,
  PosPayment,
} from "./types";

/**
 * Point of Sale arithmetic (SOW Module 6).
 *
 * The database owns the real numbers — a line's totals are frozen onto it by
 * `pos_add_line` and an order's by `pos_recalc_order`, because a bill must not
 * change value depending on who reads it. What lives here is the same
 * arithmetic for the *preview*: showing a waiter what a line will come to
 * before it is sent, and what a bill is worth before it is settled.
 *
 * Keeping both in step matters, so these functions mirror the SQL exactly:
 * tax resolves item → category → outlet, a tax-inclusive price has its tax
 * taken back out, and the service charge is taxed at the outlet's own rate.
 *
 * Pure functions, no database access — unit tested in tests/pos.test.ts.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The rate an item is taxed at: its own, else its category's, else the
 * outlet's. Mirrors pos_item_tax_rate() in 0017_pos.sql.
 */
export function taxRateFor(
  item: Pick<PosItem, "tax_rate" | "category_id">,
  categories: Pick<PosCategory, "id" | "tax_rate">[],
  outlet: Pick<Outlet, "tax_rate">,
): number {
  if (item.tax_rate !== null) return Number(item.tax_rate);
  const category = item.category_id ? categories.find((c) => c.id === item.category_id) : undefined;
  if (category && category.tax_rate !== null) return Number(category.tax_rate);
  return Number(outlet.tax_rate);
}

export interface LineQuote {
  unitPrice: number;
  gross: number;
  net: number;
  tax: number;
  taxRate: number;
  modifiers: PosLineModifier[];
}

/**
 * What a line will come to. `modifiers` are only counted when they are
 * actually attached to the item, which is the same restriction the database
 * applies — a waiter cannot put "extra gravy" on a cup of tea.
 */
export function quoteLine(options: {
  item: Pick<PosItem, "id" | "price" | "tax_rate" | "category_id">;
  qty: number;
  modifiers?: Pick<PosModifier, "id" | "name" | "price_delta">[];
  categories?: Pick<PosCategory, "id" | "tax_rate">[];
  outlet: Pick<Outlet, "tax_rate" | "tax_inclusive">;
}): LineQuote {
  const { item, qty, modifiers = [], categories = [], outlet } = options;
  const taxRate = taxRateFor(item, categories, outlet);
  const chosen: PosLineModifier[] = modifiers.map((m) => ({
    name: m.name,
    price_delta: Number(m.price_delta),
  }));
  const delta = chosen.reduce((s, m) => s + m.price_delta, 0);
  const unitPrice = round2(Number(item.price) + delta);

  if (!(qty > 0)) {
    return { unitPrice, gross: 0, net: 0, tax: 0, taxRate, modifiers: chosen };
  }

  const gross = round2(unitPrice * qty);

  // A tax-inclusive menu price has the tax taken back out, so the folio and
  // the invoice can always show net and tax separately.
  if (outlet.tax_inclusive && taxRate > 0) {
    const net = round2(gross / (1 + taxRate / 100));
    return { unitPrice, gross, net, tax: round2(gross - net), taxRate, modifiers: chosen };
  }

  return { unitPrice, gross, net: gross, tax: round2(gross * (taxRate / 100)), taxRate, modifiers: chosen };
}

export interface OrderTotals {
  net: number;
  tax: number;
  serviceNet: number;
  serviceTax: number;
  tip: number;
  grand: number;
}

const liveLines = (lines: PosOrderLine[]) => lines.filter((l) => !l.voided_at);

/** An order's totals from its lines. Mirrors pos_recalc_order(). */
export function orderTotals(
  lines: PosOrderLine[],
  outlet: Pick<Outlet, "tax_rate" | "service_charge_percent">,
  tip = 0,
): OrderTotals {
  const live = liveLines(lines);
  const net = round2(live.reduce((s, l) => s + Number(l.net_amount), 0));
  const tax = round2(live.reduce((s, l) => s + Number(l.tax_amount), 0));
  // Service charge is part of the supply, so it carries the outlet's tax.
  const serviceNet = round2(net * (Number(outlet.service_charge_percent) / 100));
  const serviceTax = round2(serviceNet * (Number(outlet.tax_rate) / 100));
  return {
    net,
    tax,
    serviceNet,
    serviceTax,
    tip: round2(tip),
    grand: round2(net + tax + serviceNet + serviceTax + round2(tip)),
  };
}

/** What is still owed on a bill. Mirrors pos_order_balance(). */
export function orderBalance(order: Pick<PosOrder, "grand_total">, payments: PosPayment[]): number {
  const paid = payments.filter((p) => !p.voided_at).reduce((s, p) => s + Number(p.amount), 0);
  return round2(Number(order.grand_total) - paid);
}

export function amountPaid(payments: PosPayment[]): number {
  return round2(payments.filter((p) => !p.voided_at).reduce((s, p) => s + Number(p.amount), 0));
}

export interface TaxBandRow {
  rate: number;
  net: number;
  tax: number;
}

/**
 * The lines grouped by tax rate — what the bill shows and, when charged to a
 * room, how many folio entries it becomes. A folio entry carries one rate and
 * a GST invoice has to show what was charged at each, so a bill mixing rates
 * has to reach the folio as more than one line.
 */
export function taxBands(lines: PosOrderLine[]): TaxBandRow[] {
  const bands = new Map<number, TaxBandRow>();
  for (const line of liveLines(lines)) {
    const rate = Number(line.tax_rate);
    const band = bands.get(rate) ?? { rate, net: 0, tax: 0 };
    band.net += Number(line.net_amount);
    band.tax += Number(line.tax_amount);
    bands.set(rate, band);
  }
  return [...bands.values()]
    .map((b) => ({ rate: b.rate, net: round2(b.net), tax: round2(b.tax) }))
    .filter((b) => b.net !== 0 || b.tax !== 0)
    .sort((a, b) => a.rate - b.rate);
}

/** Lines the kitchen has not been told about yet. */
export function unsentLines(lines: PosOrderLine[]): PosOrderLine[] {
  return liveLines(lines).filter((l) => l.kot_sent_at === null);
}

export interface ChargeToRoomCheck {
  allowed: boolean;
  reason: string;
}

/**
 * Whether a bill may be charged to a room (SOW Module 6 "Charge-to-Room
 * Validation"). Mirrors the checks in pos_charge_to_room() so the till can
 * say why before it tries.
 *
 * Being checked in *is* the authorisation: a guest who has not arrived, or
 * has already left, has no room to charge to. On top of that the property may
 * cap how much outlet spend one stay carries unpaid, and a folio billed to a
 * company is bound by that company's credit limit.
 */
export function checkChargeToRoom(options: {
  owed: number;
  bookingStatus: string | null;
  /** Already charged to this stay and not yet paid, from other bills. */
  alreadyCharged: number;
  /** Property cap; zero means no limit. */
  limit: number;
  /** Set when the folio is billed to a company. */
  company?: { name: string; credit_limit: number | null; balance: number } | null;
}): ChargeToRoomCheck {
  const { owed, bookingStatus, alreadyCharged, limit, company } = options;

  if (owed <= 0) return { allowed: false, reason: "This bill is already settled." };
  if (!bookingStatus) return { allowed: false, reason: "Choose the room the guest is staying in." };
  if (bookingStatus !== "checked_in") {
    return {
      allowed: false,
      reason: "Only a guest who is checked in may charge to their room. Take payment at the outlet instead.",
    };
  }
  if (limit > 0 && alreadyCharged + owed > limit) {
    return {
      allowed: false,
      reason:
        `This stay already carries ${alreadyCharged.toFixed(2)} of a ${limit.toFixed(2)} outlet limit, ` +
        `and this bill adds ${owed.toFixed(2)}. Take payment at the outlet, or settle the folio first.`,
    };
  }
  if (company && company.credit_limit !== null && company.balance + owed > Number(company.credit_limit)) {
    return {
      allowed: false,
      reason: `${company.name} would go past its credit limit of ${Number(company.credit_limit).toFixed(2)}.`,
    };
  }
  return { allowed: true, reason: "" };
}

/** Outlets grouped for the till's landing page, busiest first. */
export function outletSummary(
  outlets: Outlet[],
  orders: Pick<PosOrder, "outlet_id" | "status" | "grand_total">[],
) {
  return outlets
    .filter((o) => o.is_active)
    .map((outlet) => {
      const own = orders.filter((o) => o.outlet_id === outlet.id);
      const open = own.filter((o) => o.status === "open" || o.status === "billed");
      return {
        outlet,
        openBills: open.length,
        openValue: round2(open.reduce((s, o) => s + Number(o.grand_total), 0)),
        takings: round2(
          own.filter((o) => o.status === "settled").reduce((s, o) => s + Number(o.grand_total), 0),
        ),
      };
    })
    .sort((a, b) => b.openBills - a.openBills || a.outlet.sort_order - b.outlet.sort_order);
}
