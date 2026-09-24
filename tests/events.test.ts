import { describe, it, expect } from "vitest";
import {
  advanceDue,
  advanceSettled,
  amountPaid,
  billablePax,
  blocksConfirmation,
  clashWith,
  competingFor,
  defaultPaymentTerms,
  equipmentForSpace,
  eventBalance,
  eventHours,
  holdWindow,
  isBilled,
  layoutFits,
  layoutsFor,
  minutesOf,
  overlaps,
  priceEvent,
  quoteLine,
  quoteNeedsApproval,
  rentalNet,
} from "../app/lib/events";
import type {
  EventBooking,
  EventEquipment,
  EventLayout,
  EventLine,
  EventPackage,
  EventPayment,
  EventSpace,
} from "../app/lib/types";

/**
 * Module 10 — the arithmetic behind a banquet quotation.
 *
 * The figures asserted here were taken from running the same event through
 * event_recalc() in 0019_events.sql against a real Postgres, so a change that
 * makes the screen and the database disagree fails here.
 */

const space = (s: Partial<EventSpace> = {}): EventSpace => ({
  id: "s1",
  code: "HALL",
  name: "Shamiyana Conference Hall",
  description: "",
  floor: 1,
  area_sqft: null,
  rental_full_day: 25000,
  rental_half_day: 15000,
  rental_per_hour: 3500,
  min_charge: 0,
  tax_rate: 18,
  setup_minutes: 60,
  teardown_minutes: 60,
  is_active: true,
  sort_order: 1,
  ...s,
});

const pkg = (p: Partial<EventPackage> = {}): EventPackage => ({
  id: "p1",
  code: "CONF-FD",
  name: "Conference full day",
  description: "",
  meal_period: "full_day",
  price_per_head: 1200,
  tax_rate: 5,
  min_pax: 20,
  inclusions: [],
  is_active: true,
  sort_order: 1,
  ...p,
});

const line = (l: Partial<EventLine> = {}): EventLine => ({
  id: "l1",
  event_id: "e1",
  kind: "equipment",
  equipment_id: null,
  description: "Projector and screen",
  qty: 1,
  unit_price: 3000,
  tax_rate: 18,
  net_amount: 3000,
  tax_amount: 540,
  sort_order: 0,
  created_at: "2026-09-01T00:00:00Z",
  ...l,
});

const event = (e: Partial<EventBooking> = {}): EventBooking => ({
  id: "e1",
  number: "EVT/2026-27/0001",
  financial_year: "2026-27",
  seq: 1,
  space_id: "s1",
  layout_id: null,
  title: "Kashmir Trade Conference",
  event_type: "conference",
  guest_id: null,
  company_id: null,
  contact_name: "Bilal Khan",
  contact_phone: "",
  contact_email: "",
  payment_terms: "",
  booking_id: null,
  event_date: "2026-10-15",
  start_time: "09:00:00",
  end_time: "18:00:00",
  setup_from: "08:00:00",
  teardown_to: "19:00:00",
  pax_expected: 80,
  pax_guaranteed: 80,
  pax_actual: null,
  package_id: "p1",
  menu_notes: "",
  rental_basis: "full_day",
  rental_hours: 0,
  rental_override: null,
  discount_percent: 0,
  rental_net: 0,
  rental_tax: 0,
  catering_net: 0,
  catering_tax: 0,
  equipment_net: 0,
  equipment_tax: 0,
  other_net: 0,
  other_tax: 0,
  service_net: 0,
  service_tax: 0,
  discount_amount: 0,
  net_total: 0,
  tax_total: 0,
  grand_total: 0,
  tax_breakdown: [],
  status: "enquiry",
  quoted_at: null,
  quoted_by: null,
  approval_required: false,
  approved_at: null,
  approved_by: null,
  confirmed_at: null,
  confirmed_by: null,
  contract_signed_on: null,
  contract_signed_name: "",
  completed_at: null,
  cancelled_at: null,
  cancelled_by: null,
  cancel_reason: "",
  beo_setup_notes: "",
  beo_service_notes: "",
  beo_av_notes: "",
  notes: "",
  created_by: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  ...e,
});

const payment = (p: Partial<EventPayment> = {}): EventPayment => ({
  id: "pay1",
  event_id: "e1",
  kind: "advance",
  amount: 1000,
  method: "bank_transfer",
  reference: "",
  notes: "",
  booking_id: null,
  folio_id: null,
  city_ledger_entry_id: null,
  voided_at: null,
  void_reason: "",
  created_at: "2026-09-01T00:00:00Z",
  ...p,
});

describe("billablePax — the guarantee is what is billed", () => {
  it("bills the guarantee when fewer people turn up", () => {
    expect(billablePax(event({ pax_guaranteed: 80, pax_actual: 60 }))).toBe(80);
  });

  it("bills the actual number when more turn up", () => {
    expect(billablePax(event({ pax_guaranteed: 80, pax_actual: 100 }))).toBe(100);
  });

  it("falls back to the expected number before a guarantee is given", () => {
    expect(billablePax(event({ pax_expected: 45, pax_guaranteed: 0, pax_actual: null }))).toBe(45);
  });
});

describe("rentalNet", () => {
  it("takes the full-day rate", () => {
    expect(rentalNet(event(), space())).toBe(25000);
  });

  it("takes the half-day rate", () => {
    expect(rentalNet(event({ rental_basis: "half_day" }), space())).toBe(15000);
  });

  it("multiplies the hourly rate by the hours", () => {
    expect(rentalNet(event({ rental_basis: "hourly", rental_hours: 4.5 }), space())).toBe(15750);
  });

  it("uses the agreed amount when one was negotiated", () => {
    expect(rentalNet(event({ rental_basis: "custom", rental_override: 18000 }), space())).toBe(18000);
  });

  it("lifts a low hourly booking to the minimum charge", () => {
    expect(
      rentalNet(event({ rental_basis: "hourly", rental_hours: 1 }), space({ min_charge: 8000 })),
    ).toBe(8000);
  });

  it("does not apply the minimum to a hall that was thrown in", () => {
    expect(rentalNet(event({ rental_basis: "waived" }), space({ min_charge: 8000 }))).toBe(0);
  });
});

describe("priceEvent — the hall and the food are taxed at their own rates", () => {
  it("prices a conference of 80 at the full-day rate", () => {
    const p = priceEvent({ event: event(), space: space(), pkg: pkg(), lines: [], servicePercent: 0 });
    expect(p.rentalNet).toBe(25000);
    expect(p.rentalTax).toBe(4500);
    expect(p.cateringNet).toBe(96000);
    expect(p.cateringTax).toBe(4800);
    expect(p.netTotal).toBe(121000);
    expect(p.taxTotal).toBe(9300);
    expect(p.grandTotal).toBe(130300);
    expect(p.bands).toEqual([
      { rate: 5, net: 96000, tax: 4800 },
      { rate: 18, net: 25000, tax: 4500 },
    ]);
  });

  it("puts equipment in the hall's own tax band", () => {
    const p = priceEvent({
      event: event(),
      space: space(),
      pkg: pkg(),
      lines: [line()],
      servicePercent: 0,
    });
    expect(p.equipmentNet).toBe(3000);
    expect(p.equipmentTax).toBe(540);
    expect(p.netTotal).toBe(124000);
    expect(p.taxTotal).toBe(9840);
    expect(p.grandTotal).toBe(133840);
    // One 18% band, not two: the hall and the projector share a rate.
    expect(p.bands).toHaveLength(2);
    expect(p.bands[1]).toEqual({ rate: 18, net: 28000, tax: 5040 });
  });

  it("takes service charge on what is actually paid and taxes it at the hall's rate", () => {
    const p = priceEvent({
      event: event({ discount_percent: 10 }),
      space: space(),
      pkg: pkg(),
      lines: [line()],
      servicePercent: 10,
    });
    expect(p.serviceNet).toBe(11160);
    expect(p.serviceTax).toBe(2008.8);
    expect(p.discountAmount).toBe(12400);
    expect(p.netTotal).toBe(122760);
    expect(p.taxTotal).toBe(10864.8);
    expect(p.grandTotal).toBe(133624.8);
    expect(p.bands).toEqual([
      { rate: 5, net: 86400, tax: 4320 },
      { rate: 18, net: 36360, tax: 6544.8 },
    ]);
  });

  it("charges nothing for an event with no hall, food or extras", () => {
    const p = priceEvent({
      event: event({ rental_basis: "waived", package_id: null }),
      space: space(),
      pkg: null,
      lines: [],
      servicePercent: 10,
    });
    expect(p.grandTotal).toBe(0);
    expect(p.bands).toEqual([]);
  });

  it("keeps a food extra out of the equipment subtotal", () => {
    const p = priceEvent({
      event: event({ rental_basis: "waived", package_id: null }),
      space: space(),
      pkg: null,
      lines: [
        line({ kind: "food_extra", description: "Kahwa station", unit_price: 4000, net_amount: 4000, tax_rate: 5, tax_amount: 200 }),
        line({ id: "l2", kind: "decor", description: "Flowers", unit_price: 6000, net_amount: 6000, tax_amount: 1080 }),
      ],
      servicePercent: 0,
    });
    expect(p.equipmentNet).toBe(0);
    expect(p.otherNet).toBe(10000);
    expect(p.otherTax).toBe(1280);
    expect(p.bands).toEqual([
      { rate: 5, net: 4000, tax: 200 },
      { rate: 18, net: 6000, tax: 1080 },
    ]);
  });

  it("bills the higher actual head count once the event has happened", () => {
    const p = priceEvent({
      event: event({ pax_guaranteed: 80, pax_actual: 100 }),
      space: space(),
      pkg: pkg(),
      lines: [],
      servicePercent: 0,
    });
    expect(p.cateringNet).toBe(120000);
    expect(p.grandTotal).toBe(155500);
  });
});

describe("quoteLine", () => {
  it("prices a quantity at a rate", () => {
    expect(quoteLine(3, 2500, 18)).toEqual({ net: 7500, tax: 1350, total: 8850 });
  });

  it("handles a zero-rated line", () => {
    expect(quoteLine(2, 500, 0)).toEqual({ net: 1000, tax: 0, total: 1000 });
  });
});

describe("what is owed", () => {
  it("nets refunds off the money taken", () => {
    expect(
      amountPaid([payment({ amount: 30000 }), payment({ id: "p2", kind: "refund", amount: 5000 })]),
    ).toBe(25000);
  });

  it("ignores a voided payment", () => {
    expect(
      amountPaid([payment({ amount: 30000 }), payment({ id: "p2", amount: 9999, voided_at: "2026-09-02T00:00:00Z" })]),
    ).toBe(30000);
  });

  it("leaves the balance owing", () => {
    expect(eventBalance(event({ grand_total: 133624.8 }), [payment({ amount: 33406.2 })])).toBe(100218.6);
  });

  it("asks for a quarter up front by default", () => {
    expect(advanceDue(133624.8, 25)).toBe(33406.2);
  });

  it("treats the deposit as settled once it has been taken", () => {
    const e = event({ grand_total: 100000 });
    expect(advanceSettled(e, [payment({ amount: 25000 })], 25)).toBe(true);
    expect(advanceSettled(e, [payment({ amount: 24999 })], 25)).toBe(false);
  });

  it("needs no deposit when the hotel asks for none", () => {
    expect(advanceSettled(event({ grand_total: 100000 }), [], 0)).toBe(true);
  });

  it("knows an event has been billed once it is on a room or a company account", () => {
    expect(isBilled([payment({ kind: "advance" })])).toBe(false);
    expect(isBilled([payment({ kind: "company_account" })])).toBe(true);
    expect(isBilled([payment({ kind: "room_charge", voided_at: "2026-09-02T00:00:00Z" })])).toBe(false);
  });
});

describe("the approval workflow", () => {
  it("needs approval at the threshold and above", () => {
    expect(quoteNeedsApproval(99999, 100000)).toBe(false);
    expect(quoteNeedsApproval(100000, 100000)).toBe(true);
    expect(quoteNeedsApproval(133624.8, 100000)).toBe(true);
  });

  it("needs approval for everything when the threshold is zero", () => {
    expect(quoteNeedsApproval(1, 0)).toBe(true);
  });

  it("will not confirm an event that has not been quoted", () => {
    expect(blocksConfirmation(event({ status: "enquiry" }))).toMatch(/quotation first/);
  });

  it("will not confirm a quotation that is waiting for approval", () => {
    expect(
      blocksConfirmation(event({ status: "quoted", approval_required: true, approved_at: null })),
    ).toMatch(/needs approval/);
  });

  it("confirms an approved quotation", () => {
    expect(
      blocksConfirmation(
        event({ status: "quoted", approval_required: true, approved_at: "2026-09-02T00:00:00Z" }),
      ),
    ).toBeNull();
  });

  it("confirms a quotation below the threshold with no approval at all", () => {
    expect(blocksConfirmation(event({ status: "quoted", approval_required: false }))).toBeNull();
  });
});

describe("the diary", () => {
  const morning = event({ id: "a", setup_from: "08:00:00", teardown_to: "13:00:00", status: "confirmed" });
  const evening = event({ id: "b", setup_from: "17:00:00", teardown_to: "23:30:00", status: "enquiry" });

  it("sees no overlap between a morning and an evening function", () => {
    expect(overlaps(morning, evening)).toBe(false);
  });

  it("sees an overlap when the dressing time runs into the last function", () => {
    expect(overlaps(morning, event({ setup_from: "12:30:00", teardown_to: "18:00:00" }))).toBe(true);
  });

  it("treats back-to-back holds as clear", () => {
    expect(overlaps(morning, event({ setup_from: "13:00:00", teardown_to: "18:00:00" }))).toBe(false);
  });

  it("clashes only with a confirmed event", () => {
    const candidate = event({ id: "c", setup_from: "10:00:00", teardown_to: "16:00:00" });
    expect(clashWith(candidate, [morning])?.id).toBe("a");
    expect(clashWith(candidate, [{ ...morning, status: "enquiry" }])).toBeNull();
  });

  it("does not clash across halls or days", () => {
    const candidate = event({ id: "c", setup_from: "10:00:00", teardown_to: "16:00:00" });
    expect(clashWith(candidate, [{ ...morning, space_id: "s2" }])).toBeNull();
    expect(clashWith(candidate, [{ ...morning, event_date: "2026-10-16" }])).toBeNull();
  });

  it("lists the enquiries competing for the same day", () => {
    const candidate = event({ id: "c", setup_from: "16:00:00", teardown_to: "23:00:00" });
    expect(competingFor(candidate, [morning, evening]).map((e) => e.id)).toEqual(["b"]);
  });
});

describe("times", () => {
  it("reads a Postgres time value", () => {
    expect(minutesOf("09:30:00")).toBe(570);
    expect(minutesOf("not a time")).toBeNull();
  });

  it("holds the hall either side of the event", () => {
    expect(holdWindow("09:00:00", "18:00:00", 60, 60)).toEqual({
      setup_from: "08:00",
      teardown_to: "19:00",
    });
  });

  it("clamps a late function's teardown to the end of the day", () => {
    expect(holdWindow("19:00", "23:30", 120, 90)).toEqual({
      setup_from: "17:00",
      teardown_to: "23:59",
    });
  });

  it("clamps an early setup to the start of the day", () => {
    expect(holdWindow("00:30", "04:00", 120, 30).setup_from).toBe("00:00");
  });

  it("measures the event for hourly rental", () => {
    expect(eventHours("09:00:00", "18:00:00")).toBe(9);
    expect(eventHours("09:00", "10:30")).toBe(1.5);
    expect(eventHours("18:00", "09:00")).toBe(0);
  });
});

describe("seating", () => {
  const layout = (l: Partial<EventLayout> = {}): EventLayout => ({
    id: "l1",
    space_id: "s1",
    name: "U-shape",
    capacity: 60,
    notes: "",
    is_active: true,
    sort_order: 1,
    ...l,
  });

  it("knows when a plan is too small", () => {
    expect(layoutFits(80, layout())).toBe(false);
    expect(layoutFits(60, layout())).toBe(true);
    expect(layoutFits(500, null)).toBe(true);
  });

  it("offers the smallest plan that fits first", () => {
    const plans = [
      layout({ id: "theatre", name: "Theatre", capacity: 200 }),
      layout({ id: "u", name: "U-shape", capacity: 60 }),
      layout({ id: "rounds", name: "Round tables", capacity: 150 }),
      layout({ id: "old", name: "Retired", capacity: 300, is_active: false }),
    ];
    expect(layoutsFor(plans, 80).map((l) => l.id)).toEqual(["rounds", "theatre"]);
  });
});

describe("equipment available in a space", () => {
  const item = (o: Partial<EventEquipment> = {}): EventEquipment => ({
    id: "e1",
    space_id: null,
    name: "Projector and screen",
    description: "",
    unit: "set",
    rental_price: 3000,
    tax_rate: 18,
    qty_available: 1,
    is_active: true,
    sort_order: 1,
    ...o,
  });

  it("offers an item that travels in every space", () => {
    expect(equipmentForSpace([item()], "s1").map((e) => e.id)).toEqual(["e1"]);
    expect(equipmentForSpace([item()], "s2").map((e) => e.id)).toEqual(["e1"]);
  });

  it("offers an item tied to a space only in that space", () => {
    const fixed = item({ id: "wall", name: "LED wall", space_id: "s1" });
    expect(equipmentForSpace([fixed], "s1").map((e) => e.id)).toEqual(["wall"]);
    expect(equipmentForSpace([fixed], "s2")).toEqual([]);
  });

  it("leaves out anything withdrawn", () => {
    expect(equipmentForSpace([item({ is_active: false })], "s1")).toEqual([]);
  });
});

describe("payment terms", () => {
  it("uses a company's own account terms", () => {
    expect(defaultPaymentTerms({ name: "Dal Travels", payment_terms_days: 30 }, 25)).toBe(
      "Billed to Dal Travels on account, due 30 days from invoice.",
    );
  });

  it("says due on invoice when a company has no credit period", () => {
    expect(defaultPaymentTerms({ name: "Dal Travels", payment_terms_days: 0 }, 25)).toMatch(/due on invoice/);
  });

  it("falls back to the hotel's deposit sentence for anyone else", () => {
    expect(defaultPaymentTerms(null, 25)).toBe(
      "25% deposit to confirm the booking; balance due on or before the day of the event.",
    );
  });

  it("asks for no deposit when the hotel asks for none", () => {
    expect(defaultPaymentTerms(null, 0)).toBe("Balance due on or before the day of the event.");
  });
});
