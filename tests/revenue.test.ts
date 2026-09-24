import { describe, expect, it } from "vitest";
import {
  adjustedRate,
  checkPromo,
  discountNights,
  nightsTotal,
  occupancyPercent,
  packageRetailValue,
  promoDiscount,
  proposeForNight,
  proposeRates,
  ruleFor,
  ruleMatches,
  undynamicRate,
  type RuleContext,
  type RuleLimits,
} from "../app/lib/revenue";
import { quoteStay, type QuoteInput } from "../app/lib/pricing";
import type {
  PackageComponent,
  PricingRule,
  PromoCode,
  RateSeason,
} from "../app/lib/types";

const premier = {
  id: "premier",
  name: "Premier Room",
  base_rate: 10000,
  weekend_rate: null as number | null,
  base_occupancy: 2,
  max_adults: 3,
  max_children: 1,
};

const rule = (over: Partial<PricingRule> = {}): PricingRule => ({
  id: "r1",
  name: "High occupancy",
  description: "",
  room_type_id: null,
  min_occupancy: null,
  max_occupancy: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_date: null,
  end_date: null,
  occasion: "",
  min_lead_days: null,
  max_lead_days: null,
  adjustment_kind: "percent",
  adjustment_value: 10,
  floor_rate: 0,
  ceiling_rate: 0,
  priority: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

// Monday 5 October 2026, seen from Thursday 1 October: three days' lead time.
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  date: "2026-10-05",
  roomType: premier,
  roomsSold: 9,
  capacity: 10,
  today: "2026-10-01",
  ...over,
});

const limits: RuleLimits = { floorRate: 0, ceilingRate: 0, autoApprovePercent: 10 };

const promo = (over: Partial<PromoCode> = {}): PromoCode => ({
  id: "p1",
  code: "MONSOON",
  name: "Monsoon offer",
  description: "",
  discount_kind: "percent",
  discount_value: 10,
  max_discount: 0,
  room_type_ids: [],
  rate_plan_ids: [],
  valid_from: null,
  valid_to: null,
  stay_from: null,
  stay_to: null,
  min_nights: null,
  min_amount: 0,
  max_redemptions: null,
  max_per_guest: null,
  redemption_count: 0,
  is_public: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by: null,
  ...over,
});

const stay = {
  checkIn: "2026-10-05",
  checkOut: "2026-10-07",
  roomTypeId: "premier",
  ratePlanId: "bar",
  amount: 20000,
  today: "2026-10-01",
};

describe("occupancyPercent", () => {
  it("is the share of sellable rooms taken", () => {
    expect(occupancyPercent(8, 10)).toBe(80);
    expect(occupancyPercent(0, 10)).toBe(0);
    expect(occupancyPercent(3, 7)).toBe(42.86);
  });

  it("treats a room type with no sellable rooms as full", () => {
    // Otherwise a closed type divides by zero and reads as empty, which would
    // have every "discount when quiet" rule fire on a hotel that is shut.
    expect(occupancyPercent(0, 0)).toBe(100);
  });
});

describe("ruleMatches", () => {
  it("matches a night with no conditions at all", () => {
    expect(ruleMatches(rule(), ctx())).toBe(true);
  });

  it("ignores an inactive rule", () => {
    expect(ruleMatches(rule({ is_active: false }), ctx())).toBe(false);
  });

  it("holds an occupancy floor inclusively", () => {
    const r = rule({ min_occupancy: 80 });
    expect(ruleMatches(r, ctx({ roomsSold: 8, capacity: 10 }))).toBe(true);
    expect(ruleMatches(r, ctx({ roomsSold: 7, capacity: 10 }))).toBe(false);
  });

  it("holds an occupancy ceiling, for discounting a quiet night", () => {
    const r = rule({ max_occupancy: 40 });
    expect(ruleMatches(r, ctx({ roomsSold: 4, capacity: 10 }))).toBe(true);
    expect(ruleMatches(r, ctx({ roomsSold: 5, capacity: 10 }))).toBe(false);
  });

  it("limits itself to the days of the week it names", () => {
    // 5 October 2026 is a Monday (1); 10 October is a Saturday (6).
    const weekends = rule({ days_of_week: [5, 6] });
    expect(ruleMatches(weekends, ctx({ date: "2026-10-05" }))).toBe(false);
    expect(ruleMatches(weekends, ctx({ date: "2026-10-10" }))).toBe(true);
  });

  it("limits itself to its special-event window", () => {
    const diwali = rule({ start_date: "2026-11-06", end_date: "2026-11-10", occasion: "Diwali" });
    expect(ruleMatches(diwali, ctx({ date: "2026-11-07" }))).toBe(true);
    expect(ruleMatches(diwali, ctx({ date: "2026-11-11" }))).toBe(false);
  });

  it("reads lead time as days from today to the night", () => {
    const lastMinute = rule({ max_lead_days: 3 });
    expect(ruleMatches(lastMinute, ctx({ today: "2026-10-03" }))).toBe(true);
    expect(ruleMatches(lastMinute, ctx({ today: "2026-09-20" }))).toBe(false);

    const earlyBird = rule({ min_lead_days: 30 });
    expect(ruleMatches(earlyBird, ctx({ today: "2026-08-01" }))).toBe(true);
    expect(ruleMatches(earlyBird, ctx({ today: "2026-10-01" }))).toBe(false);
  });

  it("never prices a night that has already passed", () => {
    expect(ruleMatches(rule(), ctx({ today: "2026-10-06" }))).toBe(false);
  });

  it("applies a room-type rule only to that type", () => {
    expect(ruleMatches(rule({ room_type_id: "luxury" }), ctx())).toBe(false);
    expect(ruleMatches(rule({ room_type_id: "premier" }), ctx())).toBe(true);
  });

  it("ANDs its conditions, so one failing condition is enough", () => {
    // 80%+ full, but only on a Friday or Saturday. Monday is out.
    const r = rule({ min_occupancy: 80, days_of_week: [5, 6] });
    expect(ruleMatches(r, ctx({ date: "2026-10-05" }))).toBe(false);
    expect(ruleMatches(r, ctx({ date: "2026-10-10" }))).toBe(true);
  });
});

describe("ruleFor", () => {
  it("takes the highest priority when two rules match", () => {
    const low = rule({ id: "low", priority: 1, adjustment_value: 5 });
    const high = rule({ id: "high", priority: 9, adjustment_value: 25 });
    expect(ruleFor([low, high], ctx())?.id).toBe("high");
  });

  it("prefers a room-type rule over an all-types rule at equal priority", () => {
    const all = rule({ id: "all", room_type_id: null });
    const mine = rule({ id: "mine", room_type_id: "premier" });
    expect(ruleFor([all, mine], ctx())?.id).toBe("mine");
  });

  it("is stable when rules tie, so re-running does not churn rates", () => {
    const older = rule({ id: "older", created_at: "2026-01-01T00:00:00Z" });
    const newer = rule({ id: "newer", created_at: "2026-06-01T00:00:00Z" });
    expect(ruleFor([newer, older], ctx())?.id).toBe("older");
    expect(ruleFor([older, newer], ctx())?.id).toBe("older");
  });

  it("returns null when nothing matches", () => {
    expect(ruleFor([rule({ min_occupancy: 95 })], ctx())).toBeNull();
  });
});

describe("undynamicRate", () => {
  const weekendType = { ...premier, weekend_rate: 12000 };

  it("uses the base rate on a weekday", () => {
    expect(undynamicRate("2026-10-05", premier, [])).toBe(10000);
  });

  it("uses the weekend rate on a Friday or Saturday", () => {
    expect(undynamicRate("2026-10-10", weekendType, [])).toBe(12000);
    expect(undynamicRate("2026-10-05", weekendType, [])).toBe(10000);
  });

  it("applies the season the ordinary quote would apply", () => {
    const peak: RateSeason = {
      id: "s",
      name: "Peak",
      start_date: "2026-10-01",
      end_date: "2026-10-31",
      room_type_id: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      adjustment_kind: "percent",
      adjustment_value: 20,
      priority: 0,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(undynamicRate("2026-10-05", premier, [peak])).toBe(12000);
  });
});

describe("proposeForNight", () => {
  it("raises the rate by a percentage", () => {
    const p = proposeForNight([rule({ adjustment_value: 10 })], ctx(), [], limits);
    expect(p?.base_rate).toBe(10000);
    expect(p?.proposed_rate).toBe(11000);
    expect(p?.change_percent).toBe(10);
  });

  it("sets the rate outright when the rule is a fixed one", () => {
    const r = rule({ adjustment_kind: "fixed", adjustment_value: 15000 });
    expect(proposeForNight([r], ctx(), [], limits)?.proposed_rate).toBe(15000);
  });

  it("adds a flat amount", () => {
    const r = rule({ adjustment_kind: "amount", adjustment_value: 1500 });
    expect(proposeForNight([r], ctx(), [], limits)?.proposed_rate).toBe(11500);
  });

  it("auto-approves a change inside the threshold and queues one outside it", () => {
    expect(proposeForNight([rule({ adjustment_value: 10 })], ctx(), [], limits)?.autoApproves).toBe(true);
    expect(proposeForNight([rule({ adjustment_value: 25 })], ctx(), [], limits)?.autoApproves).toBe(false);
  });

  it("judges a cut by its size, not its direction", () => {
    const p = proposeForNight([rule({ adjustment_value: -30 })], ctx(), [], limits);
    expect(p?.change_percent).toBe(-30);
    expect(p?.autoApproves).toBe(false);
  });

  it("honours the rule's own floor and ceiling", () => {
    const capped = rule({ adjustment_value: 50, ceiling_rate: 12000 });
    expect(proposeForNight([capped], ctx(), [], limits)?.proposed_rate).toBe(12000);

    const floored = rule({ adjustment_value: -50, floor_rate: 8000 });
    expect(proposeForNight([floored], ctx(), [], limits)?.proposed_rate).toBe(8000);
  });

  it("lets the property's limits override a rule that asks for more", () => {
    const tight = { ...limits, ceilingRate: 10500 };
    const r = rule({ adjustment_value: 50, ceiling_rate: 14000 });
    expect(proposeForNight([r], ctx(), [], tight)?.proposed_rate).toBe(10500);
  });

  it("proposes nothing when a clamp leaves the rate where it started", () => {
    // The ceiling is the rate it already has, so there is no decision to take.
    const r = rule({ adjustment_value: 50, ceiling_rate: 10000 });
    expect(proposeForNight([r], ctx(), [], limits)).toBeNull();
  });

  it("proposes nothing when no rule matches", () => {
    expect(proposeForNight([rule({ min_occupancy: 99 })], ctx(), [], limits)).toBeNull();
  });

  it("carries the forecast and the occasion for whoever approves it", () => {
    const r = rule({ adjustment_value: 30, occasion: "Diwali" });
    const p = proposeForNight([r], ctx({ roomsSold: 9, capacity: 10 }), [], limits);
    expect(p?.occupancy_percent).toBe(90);
    expect(p?.rooms_sold).toBe(9);
    expect(p?.capacity).toBe(10);
    expect(p?.occasion).toBe("Diwali");
    expect(p?.rule_name).toBe("High occupancy");
  });
});

describe("proposeRates", () => {
  const forecast = [
    { stay_date: "2026-10-05", room_type_id: "premier", capacity: 10, rooms_sold: 9, revenue_on_books: 0 },
    { stay_date: "2026-10-06", room_type_id: "premier", capacity: 10, rooms_sold: 2, revenue_on_books: 0 },
  ];

  it("prices only the nights whose conditions hold", () => {
    const r = rule({ min_occupancy: 80, adjustment_value: 15 });
    const out = proposeRates(forecast, [r], [premier], [], limits, "2026-10-01");
    expect(out).toHaveLength(1);
    expect(out[0].stay_date).toBe("2026-10-05");
    expect(out[0].proposed_rate).toBe(11500);
  });

  it("skips forecast rows for a room type it was not given", () => {
    const rows = [{ ...forecast[0], room_type_id: "ghost" }];
    expect(proposeRates(rows, [rule()], [premier], [], limits, "2026-10-01")).toEqual([]);
  });

  it("leaves inactive rules out", () => {
    const out = proposeRates(forecast, [rule({ is_active: false })], [premier], [], limits, "2026-10-01");
    expect(out).toEqual([]);
  });
});

describe("a live adjustment reaching the quote", () => {
  const input: QuoteInput = {
    roomType: premier,
    plan: null,
    checkIn: "2026-10-05",
    checkOut: "2026-10-07",
    adults: 2,
    children: 0,
    rooms: 1,
    seasons: [],
    restrictions: [],
    extraCharges: [],
  };

  it("replaces the ordinary rate for that night only", () => {
    const q = quoteStay({
      ...input,
      adjustments: [
        { stay_date: "2026-10-05", room_type_id: "premier", proposed_rate: 13000, status: "applied" },
      ],
    });
    expect(q.nights).toEqual([
      { date: "2026-10-05", rate: 13000 },
      { date: "2026-10-06", rate: 10000 },
    ]);
    expect(q.total).toBe(23000);
  });

  it("ignores a rate still waiting for approval", () => {
    const q = quoteStay({
      ...input,
      adjustments: [
        { stay_date: "2026-10-05", room_type_id: "premier", proposed_rate: 13000, status: "pending" },
      ],
    });
    expect(q.nights[0].rate).toBe(10000);
  });

  it("ignores a rate set for another room type", () => {
    const q = quoteStay({
      ...input,
      adjustments: [
        { stay_date: "2026-10-05", room_type_id: "luxury", proposed_rate: 13000, status: "applied" },
      ],
    });
    expect(q.nights[0].rate).toBe(10000);
  });

  it("still discounts a dynamic rate by the rate plan", () => {
    const q = quoteStay({
      ...input,
      plan: {
        id: "corp",
        name: "Corporate",
        adjustment_kind: "percent",
        adjustment_value: -10,
        room_type_ids: [],
        min_los: null,
        max_los: null,
        los_discount_min_nights: null,
        los_discount_percent: null,
        valid_from: null,
        valid_to: null,
        is_active: true,
        deposit_percent: 0,
      },
      adjustments: [
        { stay_date: "2026-10-05", room_type_id: "premier", proposed_rate: 13000, status: "applied" },
      ],
    });
    expect(q.nights[0].rate).toBe(11700);
  });
});

describe("adjustedRate", () => {
  it("reads the live rate for a night", () => {
    const rows = [
      { stay_date: "2026-10-05", room_type_id: "premier", proposed_rate: 13000, status: "applied" as const },
    ];
    expect(adjustedRate(rows, "2026-10-05", "premier")).toBe(13000);
    expect(adjustedRate(rows, "2026-10-06", "premier")).toBeNull();
  });
});

describe("packageRetailValue", () => {
  const component = (over: Partial<PackageComponent>): PackageComponent => ({
    id: "c",
    rate_plan_id: "pkg",
    name: "Breakfast",
    description: "",
    retail_value: 500,
    basis: "per_stay",
    quantity: 1,
    is_active: true,
    sort_order: 0,
    created_at: "",
    ...over,
  });

  it("counts a once-per-stay component once", () => {
    expect(packageRetailValue([component({ basis: "per_stay" })], 3, 2)).toBe(500);
  });

  it("counts a nightly component per night", () => {
    expect(packageRetailValue([component({ basis: "per_night" })], 3, 2)).toBe(1500);
  });

  it("counts a per-person component per person", () => {
    expect(packageRetailValue([component({ basis: "per_person_per_stay" })], 3, 2)).toBe(1000);
    expect(packageRetailValue([component({ basis: "per_person_per_night" })], 3, 2)).toBe(3000);
  });

  it("multiplies by the quantity", () => {
    expect(packageRetailValue([component({ quantity: 2 })], 1, 1)).toBe(1000);
  });

  it("leaves out an inactive component", () => {
    expect(packageRetailValue([component({ is_active: false })], 3, 2)).toBe(0);
  });

  it("adds a room-plus-breakfast-plus-spa bundle up", () => {
    const parts = [
      component({ name: "Breakfast", retail_value: 800, basis: "per_person_per_night" }),
      component({ name: "Spa", retail_value: 2500, basis: "per_person_per_stay" }),
    ];
    // Two guests, two nights: breakfast 800×2×2, spa 2500×2.
    expect(packageRetailValue(parts, 2, 2)).toBe(8200);
  });
});

describe("promoDiscount", () => {
  it("takes a percentage off", () => {
    expect(promoDiscount(promo({ discount_value: 10 }), 20000)).toBe(2000);
  });

  it("takes a flat amount off", () => {
    expect(promoDiscount(promo({ discount_kind: "amount", discount_value: 1500 }), 20000)).toBe(1500);
  });

  it("caps a percentage in money terms", () => {
    expect(promoDiscount(promo({ discount_value: 25, max_discount: 3000 }), 20000)).toBe(3000);
  });

  it("never takes off more than the stay is worth", () => {
    expect(promoDiscount(promo({ discount_kind: "amount", discount_value: 50000 }), 20000)).toBe(20000);
  });

  it("is nothing on a stay worth nothing", () => {
    expect(promoDiscount(promo(), 0)).toBe(0);
  });
});

describe("checkPromo", () => {
  it("accepts a good code and returns the discount", () => {
    const r = checkPromo(promo(), stay);
    expect(r.ok).toBe(true);
    expect(r.discount).toBe(2000);
  });

  it("refuses a code that does not exist", () => {
    expect(checkPromo(null, stay).ok).toBe(false);
  });

  it("refuses an inactive code", () => {
    expect(checkPromo(promo({ is_active: false }), stay).ok).toBe(false);
  });

  it("refuses an expired code and says when it expired", () => {
    const r = checkPromo(promo({ valid_to: "2026-09-30" }), stay);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("2026-09-30");
  });

  it("refuses a code that has not opened yet", () => {
    expect(checkPromo(promo({ valid_from: "2026-10-15" }), stay).ok).toBe(false);
  });

  it("accepts a code on the last night of its stay window", () => {
    // The stay is 5–7 October, so the last night is the 6th. A window ending
    // on the 6th covers it, even though check-out is the 7th.
    expect(checkPromo(promo({ stay_to: "2026-10-06" }), stay).ok).toBe(true);
    expect(checkPromo(promo({ stay_to: "2026-10-05" }), stay).ok).toBe(false);
  });

  it("refuses a stay starting before its window", () => {
    expect(checkPromo(promo({ stay_from: "2026-10-06" }), stay).ok).toBe(false);
  });

  it("honours a minimum stay", () => {
    expect(checkPromo(promo({ min_nights: 2 }), stay).ok).toBe(true);
    expect(checkPromo(promo({ min_nights: 3 }), stay).ok).toBe(false);
  });

  it("honours a minimum spend", () => {
    expect(checkPromo(promo({ min_amount: 20000 }), stay).ok).toBe(true);
    expect(checkPromo(promo({ min_amount: 25000 }), stay).ok).toBe(false);
  });

  it("limits itself to the room types it names", () => {
    expect(checkPromo(promo({ room_type_ids: ["premier"] }), stay).ok).toBe(true);
    expect(checkPromo(promo({ room_type_ids: ["luxury"] }), stay).ok).toBe(false);
  });

  it("limits itself to the rate plans it names", () => {
    expect(checkPromo(promo({ rate_plan_ids: ["bar"] }), stay).ok).toBe(true);
    expect(checkPromo(promo({ rate_plan_ids: ["corp"] }), stay).ok).toBe(false);
    // A stay with no plan cannot satisfy a plan-limited code.
    expect(checkPromo(promo({ rate_plan_ids: ["bar"] }), { ...stay, ratePlanId: null }).ok).toBe(false);
  });

  it("refuses a code that has been fully redeemed", () => {
    expect(checkPromo(promo({ max_redemptions: 100, redemption_count: 99 }), stay).ok).toBe(true);
    expect(checkPromo(promo({ max_redemptions: 100, redemption_count: 100 }), stay).ok).toBe(false);
  });

  it("honours a per-guest limit", () => {
    const once = promo({ max_per_guest: 1 });
    expect(checkPromo(once, { ...stay, guestRedemptions: 0 }).ok).toBe(true);
    expect(checkPromo(once, { ...stay, guestRedemptions: 1 }).ok).toBe(false);
  });

  it("hides a private code from the public site but not from the desk", () => {
    const private_ = promo({ is_public: false });
    expect(checkPromo(private_, { ...stay, publicOnly: true }).ok).toBe(false);
    expect(checkPromo(private_, stay).ok).toBe(true);
  });

  it("refuses a stay with no nights in it", () => {
    expect(checkPromo(promo(), { ...stay, checkOut: "2026-10-05" }).ok).toBe(false);
  });
});

describe("discountNights", () => {
  const nights = [
    { date: "2026-10-05", rate: 10000 },
    { date: "2026-10-06", rate: 10000 },
  ];

  it("spreads a discount evenly across the nights", () => {
    expect(discountNights(nights, 2000, 1)).toEqual([
      { date: "2026-10-05", rate: 9000 },
      { date: "2026-10-06", rate: 9000 },
    ]);
  });

  it("keeps the whole discount when it does not divide evenly", () => {
    // 999 over two nights: 500 off the first, 499 off the second.
    const out = discountNights(nights, 999, 1);
    expect(nightsTotal(out, 1)).toBe(20000 - 999);
    expect(out.map((n) => n.rate)).toEqual([9500, 9501]);
  });

  it("takes only this room's share when several rooms are booked", () => {
    // The breakdown is per room per night, so a 4000 discount over two rooms
    // is 2000 off one room's stay — and 4000 off the booking.
    const out = discountNights(nights, 4000, 2);
    expect(nightsTotal(out, 2)).toBe(40000 - 4000);
  });

  it("never drives a night below zero", () => {
    const out = discountNights(nights, 999999, 1);
    expect(out.every((n) => n.rate >= 0)).toBe(true);
    expect(nightsTotal(out, 1)).toBe(0);
  });

  it("leaves the nights alone when there is no discount", () => {
    expect(discountNights(nights, 0, 1)).toBe(nights);
  });

  it("leaves a free stay alone rather than dividing by zero", () => {
    const free = [{ date: "2026-10-05", rate: 0 }];
    expect(discountNights(free, 500, 1)).toBe(free);
  });
});

describe("nightsTotal", () => {
  it("multiplies the nightly rates by the rooms booked", () => {
    const nights = [
      { date: "2026-10-05", rate: 9000 },
      { date: "2026-10-06", rate: 9000 },
    ];
    expect(nightsTotal(nights, 1)).toBe(18000);
    expect(nightsTotal(nights, 3)).toBe(54000);
  });
});
