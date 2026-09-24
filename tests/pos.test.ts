import { describe, it, expect } from "vitest";
import {
  amountPaid,
  checkChargeToRoom,
  orderBalance,
  orderTotals,
  outletSummary,
  quoteLine,
  taxBands,
  taxRateFor,
  unsentLines,
} from "../app/lib/pos";
import type { Outlet, PosItem, PosOrderLine, PosPayment } from "../app/lib/types";

/** Module 6 — the arithmetic behind a POS bill. */

const outlet = (o: Partial<Outlet> = {}): Outlet => ({
  id: "o1",
  code: "RST",
  name: "Shamiyana Restaurant",
  kind: "restaurant",
  tax_rate: 5,
  tax_inclusive: false,
  service_charge_percent: 10,
  orders_by: "either",
  sends_kot: true,
  is_active: true,
  sort_order: 1,
  ...o,
});

const item = (i: Partial<PosItem> & Pick<PosItem, "price">): PosItem => ({
  id: `i${i.price}`,
  outlet_id: "o1",
  category_id: null,
  code: "",
  name: "Item",
  description: "",
  tax_rate: null,
  is_active: true,
  sort_order: 0,
  ...i,
});

let seq = 0;
const line = (l: Partial<PosOrderLine> = {}): PosOrderLine => ({
  id: `l${++seq}`,
  order_id: "ord1",
  item_id: null,
  name: "Line",
  qty: 1,
  unit_price: 0,
  modifiers: [],
  notes: "",
  net_amount: 0,
  tax_rate: 5,
  tax_amount: 0,
  kot_sent_at: null,
  voided_at: null,
  void_reason: "",
  created_at: "2026-09-22T12:00:00.000Z",
  ...l,
});

const payment = (p: Partial<PosPayment> & Pick<PosPayment, "amount">): PosPayment => ({
  id: `p${p.amount}`,
  order_id: "ord1",
  kind: "cash",
  booking_id: null,
  folio_id: null,
  points: null,
  reference: "",
  voided_at: null,
  void_reason: "",
  created_at: "2026-09-22T12:00:00.000Z",
  ...p,
});

describe("which tax rate an item carries", () => {
  const categories = [
    { id: "c1", tax_rate: 12 },
    { id: "c2", tax_rate: null },
  ];

  it("falls back to the outlet when nothing overrides it", () => {
    expect(taxRateFor(item({ price: 100 }), categories, outlet())).toBe(5);
  });

  it("takes the category's rate over the outlet's", () => {
    expect(taxRateFor(item({ price: 100, category_id: "c1" }), categories, outlet())).toBe(12);
  });

  it("takes the item's own rate over everything", () => {
    expect(taxRateFor(item({ price: 100, category_id: "c1", tax_rate: 18 }), categories, outlet())).toBe(18);
  });

  it("skips a category that sets no rate of its own", () => {
    expect(taxRateFor(item({ price: 100, category_id: "c2" }), categories, outlet())).toBe(5);
  });

  it("honours a deliberate zero rather than treating it as unset", () => {
    expect(taxRateFor(item({ price: 100, tax_rate: 0 }), categories, outlet())).toBe(0);
  });
});

describe("quoting a line", () => {
  it("adds tax on top of an exclusive price", () => {
    const quote = quoteLine({ item: item({ price: 1000 }), qty: 1, outlet: outlet() });
    expect(quote.net).toBe(1000);
    expect(quote.tax).toBe(50);
  });

  it("takes tax back out of an inclusive price", () => {
    const quote = quoteLine({ item: item({ price: 1050 }), qty: 1, outlet: outlet({ tax_inclusive: true }) });
    expect(quote.net).toBe(1000);
    expect(quote.tax).toBe(50);
    expect(quote.net + quote.tax).toBe(1050);
  });

  it("multiplies by quantity", () => {
    const quote = quoteLine({ item: item({ price: 500 }), qty: 3, outlet: outlet() });
    expect(quote.net).toBe(1500);
    expect(quote.tax).toBe(75);
  });

  it("adds a modifier's price to the unit, not the line", () => {
    const quote = quoteLine({
      item: item({ price: 1000 }),
      qty: 2,
      modifiers: [{ id: "m1", name: "Extra gravy", price_delta: 50 }],
      outlet: outlet(),
    });
    expect(quote.unitPrice).toBe(1050);
    expect(quote.net).toBe(2100);
    expect(quote.modifiers).toEqual([{ name: "Extra gravy", price_delta: 50 }]);
  });

  it("handles a modifier that reduces the price", () => {
    const quote = quoteLine({
      item: item({ price: 500 }),
      qty: 1,
      modifiers: [{ id: "m2", name: "No cream", price_delta: -25 }],
      outlet: outlet(),
    });
    expect(quote.unitPrice).toBe(475);
  });

  it("charges nothing at a zero tax rate", () => {
    const quote = quoteLine({ item: item({ price: 100, tax_rate: 0 }), qty: 1, outlet: outlet() });
    expect(quote.tax).toBe(0);
    expect(quote.net).toBe(100);
  });

  it("comes to nothing for a zero or negative quantity", () => {
    expect(quoteLine({ item: item({ price: 100 }), qty: 0, outlet: outlet() }).gross).toBe(0);
    expect(quoteLine({ item: item({ price: 100 }), qty: -2, outlet: outlet() }).gross).toBe(0);
  });

  it("keeps a tax-inclusive price whole to the paisa", () => {
    // 333 at 18% inclusive does not divide evenly; net + tax must still be 333.
    const quote = quoteLine({
      item: item({ price: 333, tax_rate: 18 }),
      qty: 1,
      outlet: outlet({ tax_inclusive: true }),
    });
    expect(quote.net + quote.tax).toBe(333);
  });
});

describe("order totals", () => {
  it("matches what the database computes for the same bill", () => {
    // The same fixture as the behaviour test in supabase/tests/behaviour.sql:
    // Rista 1000 x1 and Kahwa 500 x2 at 5%, service charge 10%.
    const totals = orderTotals(
      [
        line({ net_amount: 1000, tax_amount: 50, tax_rate: 5 }),
        line({ net_amount: 1000, tax_amount: 50, tax_rate: 5 }),
      ],
      outlet(),
    );
    expect(totals.net).toBe(2000);
    expect(totals.tax).toBe(100);
    expect(totals.serviceNet).toBe(200);
    expect(totals.serviceTax).toBe(10);
    expect(totals.grand).toBe(2310);
  });

  it("adds a tip without taxing it", () => {
    const totals = orderTotals([line({ net_amount: 1000, tax_amount: 50 })], outlet(), 100);
    expect(totals.tip).toBe(100);
    expect(totals.grand).toBe(1000 + 50 + 100 + 5 + 100);
  });

  it("ignores voided lines", () => {
    const totals = orderTotals(
      [
        line({ net_amount: 1000, tax_amount: 50 }),
        line({ net_amount: 500, tax_amount: 25, voided_at: "2026-09-22T13:00:00.000Z" }),
      ],
      outlet(),
    );
    expect(totals.net).toBe(1000);
  });

  it("charges no service on an outlet that does not levy it", () => {
    const totals = orderTotals([line({ net_amount: 1000, tax_amount: 180, tax_rate: 18 })], outlet({
      kind: "gift_shop",
      tax_rate: 18,
      service_charge_percent: 0,
    }));
    expect(totals.serviceNet).toBe(0);
    expect(totals.serviceTax).toBe(0);
    expect(totals.grand).toBe(1180);
  });

  it("is all zeroes for an empty bill", () => {
    expect(orderTotals([], outlet()).grand).toBe(0);
  });
});

describe("what is still owed", () => {
  it("is the total less every live payment", () => {
    const order = { grand_total: 2310 };
    expect(orderBalance(order, [payment({ amount: 1000 })])).toBe(1310);
    expect(amountPaid([payment({ amount: 1000 }), payment({ amount: 310 })])).toBe(1310);
  });

  it("ignores a voided payment", () => {
    const order = { grand_total: 500 };
    expect(orderBalance(order, [payment({ amount: 500, voided_at: "2026-09-22T14:00:00.000Z" })])).toBe(500);
  });

  it("is zero once settled", () => {
    expect(orderBalance({ grand_total: 250 }, [payment({ amount: 250 })])).toBe(0);
  });
});

describe("tax bands", () => {
  it("groups the lines by rate, lowest first", () => {
    const bands = taxBands([
      line({ net_amount: 800, tax_amount: 144, tax_rate: 18 }),
      line({ net_amount: 500, tax_amount: 25, tax_rate: 5 }),
      line({ net_amount: 500, tax_amount: 25, tax_rate: 5 }),
    ]);
    expect(bands).toEqual([
      { rate: 5, net: 1000, tax: 50 },
      { rate: 18, net: 800, tax: 144 },
    ]);
  });

  it("gives one band for a bill at a single rate", () => {
    expect(taxBands([line({ net_amount: 100, tax_amount: 5, tax_rate: 5 })])).toHaveLength(1);
  });

  it("keeps a zero-rated band, because it still has to be declared", () => {
    const bands = taxBands([line({ net_amount: 100, tax_amount: 0, tax_rate: 0 })]);
    expect(bands).toEqual([{ rate: 0, net: 100, tax: 0 }]);
  });
});

describe("the kitchen ticket", () => {
  it("lists only lines not yet sent", () => {
    const lines = [
      line({ name: "Rista" }),
      line({ name: "Kahwa", kot_sent_at: "2026-09-22T12:05:00.000Z" }),
      line({ name: "Voided", voided_at: "2026-09-22T12:06:00.000Z" }),
    ];
    expect(unsentLines(lines).map((l) => l.name)).toEqual(["Rista"]);
  });
});

describe("charging to a room", () => {
  const base = { owed: 500, bookingStatus: "checked_in", alreadyCharged: 0, limit: 0 };

  it("allows a checked-in guest with no limit set", () => {
    expect(checkChargeToRoom(base).allowed).toBe(true);
  });

  it("refuses a guest who has not checked in", () => {
    expect(checkChargeToRoom({ ...base, bookingStatus: "confirmed" }).reason).toContain("checked in");
  });

  it("refuses a guest who has already left", () => {
    expect(checkChargeToRoom({ ...base, bookingStatus: "checked_out" }).allowed).toBe(false);
  });

  it("refuses when no room was chosen", () => {
    expect(checkChargeToRoom({ ...base, bookingStatus: null }).reason).toContain("Choose the room");
  });

  it("refuses a settled bill", () => {
    expect(checkChargeToRoom({ ...base, owed: 0 }).reason).toContain("already settled");
  });

  it("enforces the property's outlet limit across bills", () => {
    const check = checkChargeToRoom({ ...base, limit: 1000, alreadyCharged: 800 });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("1000.00 outlet limit");
  });

  it("allows a charge that lands exactly on the limit", () => {
    expect(checkChargeToRoom({ ...base, limit: 1000, alreadyCharged: 500 }).allowed).toBe(true);
  });

  it("treats a zero limit as no limit", () => {
    expect(checkChargeToRoom({ ...base, limit: 0, alreadyCharged: 999999 }).allowed).toBe(true);
  });

  it("enforces a company's credit limit on a company-billed folio", () => {
    const check = checkChargeToRoom({
      ...base,
      company: { name: "Dal Travels", credit_limit: 1000, balance: 900 },
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Dal Travels");
  });

  it("lets a company with no limit carry the charge", () => {
    expect(
      checkChargeToRoom({ ...base, company: { name: "Group HQ", credit_limit: null, balance: 999999 } }).allowed,
    ).toBe(true);
  });
});

describe("the till's landing page", () => {
  it("puts the busiest outlet first and counts open bills and takings", () => {
    const outlets = [
      outlet({ id: "o1", name: "Restaurant", sort_order: 1 }),
      outlet({ id: "o2", name: "Bar", sort_order: 2 }),
      outlet({ id: "o3", name: "Closed outlet", sort_order: 3, is_active: false }),
    ];
    const orders = [
      { outlet_id: "o2", status: "open" as const, grand_total: 300 },
      { outlet_id: "o2", status: "billed" as const, grand_total: 200 },
      { outlet_id: "o1", status: "open" as const, grand_total: 100 },
      { outlet_id: "o1", status: "settled" as const, grand_total: 900 },
      { outlet_id: "o3", status: "open" as const, grand_total: 50 },
    ];
    const summary = outletSummary(outlets, orders);
    expect(summary.map((s) => s.outlet.name)).toEqual(["Bar", "Restaurant"]);
    expect(summary[0].openBills).toBe(2);
    expect(summary[0].openValue).toBe(500);
    expect(summary[1].takings).toBe(900);
  });
});
