import { describe, expect, it } from "vitest";
import { quoteStay, seasonFor, checkRestrictions, type QuoteInput } from "../app/lib/pricing";
import type { RateRestriction, RateSeason } from "../app/lib/types";

const premier = {
  id: "premier",
  name: "Premier Room",
  base_rate: 9499,
  weekend_rate: null as number | null,
  base_occupancy: 2,
  max_adults: 3,
  max_children: 1,
};

const bar = {
  id: "bar",
  name: "Best Available Rate",
  adjustment_kind: "percent" as const,
  adjustment_value: 0,
  room_type_ids: [],
  min_los: null,
  max_los: null,
  los_discount_min_nights: null,
  los_discount_percent: null,
  valid_from: null,
  valid_to: null,
  is_active: true,
  deposit_percent: 0,
};

const season = (over: Partial<RateSeason>): RateSeason => ({
  id: "s",
  name: "Season",
  start_date: "2026-10-01",
  end_date: "2026-10-31",
  room_type_id: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  adjustment_kind: "percent",
  adjustment_value: 20,
  priority: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const restriction = (over: Partial<RateRestriction>): RateRestriction => ({
  id: "r",
  start_date: "2026-10-01",
  end_date: "2026-10-31",
  room_type_id: null,
  rate_plan_id: null,
  min_los: null,
  max_los: null,
  closed_to_arrival: false,
  closed_to_departure: false,
  stop_sell: false,
  note: "",
  ...over,
});

const base: QuoteInput = {
  roomType: premier,
  plan: bar,
  // Monday 5 → Wednesday 7 October 2026: two weekday nights.
  checkIn: "2026-10-05",
  checkOut: "2026-10-07",
  adults: 2,
  children: 0,
  rooms: 1,
  seasons: [],
  restrictions: [],
  extraCharges: [{ kind: "extra_adult", amount: 2200, is_active: true }],
};

describe("quoteStay", () => {
  it("charges the base rate per night", () => {
    const q = quoteStay(base);
    expect(q.nights).toEqual([
      { date: "2026-10-05", rate: 9499 },
      { date: "2026-10-06", rate: 9499 },
    ]);
    expect(q.total).toBe(18998);
    expect(q.violations).toEqual([]);
  });

  it("uses the weekend rate on Friday and Saturday nights only", () => {
    const q = quoteStay({
      ...base,
      roomType: { ...premier, weekend_rate: 11000 },
      checkIn: "2026-10-09", // Friday
      checkOut: "2026-10-12", // Monday
    });
    expect(q.nights.map((n) => n.rate)).toEqual([11000, 11000, 9499]);
  });

  it("applies a season, then the plan adjustment", () => {
    const q = quoteStay({
      ...base,
      seasons: [season({ adjustment_value: 20 })],
      plan: { ...bar, adjustment_value: -10 },
    });
    // 9499 × 1.2 × 0.9 = 10258.92 → 10259
    expect(q.nights[0].rate).toBe(10259);
  });

  it("multiplies by rooms and adds extra adults per room", () => {
    const q = quoteStay({ ...base, adults: 3, rooms: 1 });
    expect(q.nights[0].rate).toBe(9499 + 2200);

    const two = quoteStay({ ...base, adults: 4, rooms: 2 });
    expect(two.nights[0].rate).toBe(9499);
    expect(two.total).toBe(9499 * 2 * 2);
  });

  it("gives the length-of-stay discount once the stay is long enough", () => {
    const plan = { ...bar, los_discount_min_nights: 3, los_discount_percent: 10 };
    expect(quoteStay({ ...base, plan }).nights[0].rate).toBe(9499);
    const long = quoteStay({ ...base, plan, checkOut: "2026-10-08" });
    expect(long.nights[0].rate).toBe(8549);
  });

  it("works out the deposit from the plan", () => {
    const q = quoteStay({ ...base, plan: { ...bar, deposit_percent: 50 } });
    expect(q.deposit).toBe(9499);
  });
});

describe("seasonFor", () => {
  it("prefers higher priority, then a room-type season over an all-types one", () => {
    const all = season({ id: "all", priority: 0 });
    const specific = season({ id: "specific", room_type_id: "premier", priority: 0 });
    const high = season({ id: "high", priority: 5 });
    expect(seasonFor("2026-10-05", "premier", [all, specific])?.id).toBe("specific");
    expect(seasonFor("2026-10-05", "premier", [all, specific, high])?.id).toBe("high");
  });

  it("honours days of the week", () => {
    const weekendsOnly = season({ days_of_week: [5, 6] });
    expect(seasonFor("2026-10-05", "premier", [weekendsOnly])).toBeNull(); // Monday
    expect(seasonFor("2026-10-09", "premier", [weekendsOnly])).not.toBeNull(); // Friday
  });
});

describe("checkRestrictions", () => {
  it("enforces MinLOS and MaxLOS on the arrival date", () => {
    expect(checkRestrictions({ ...base, restrictions: [restriction({ min_los: 3 })] })).toEqual([
      "Minimum stay of 3 night(s) for arrivals on 2026-10-05.",
    ]);
    expect(checkRestrictions({ ...base, restrictions: [restriction({ max_los: 1 })] })).toHaveLength(1);
  });

  it("enforces closed to arrival and closed to departure", () => {
    const cta = restriction({ start_date: "2026-10-05", end_date: "2026-10-05", closed_to_arrival: true });
    const ctd = restriction({ start_date: "2026-10-07", end_date: "2026-10-07", closed_to_departure: true });
    expect(checkRestrictions({ ...base, restrictions: [cta, ctd] })).toEqual([
      "Closed to arrival on 2026-10-05.",
      "Closed to departure on 2026-10-07.",
    ]);
  });

  it("blocks any night in a blackout", () => {
    const blackout = restriction({ start_date: "2026-10-06", end_date: "2026-10-06", stop_sell: true });
    expect(checkRestrictions({ ...base, restrictions: [blackout] })).toEqual([
      "Not for sale on 2026-10-06 (blackout).",
    ]);
  });

  it("ignores restrictions for other room types and plans", () => {
    const other = restriction({ room_type_id: "luxury", min_los: 5 });
    const otherPlan = restriction({ rate_plan_id: "corp", min_los: 5 });
    expect(checkRestrictions({ ...base, restrictions: [other, otherPlan] })).toEqual([]);
  });

  it("checks plan validity, room types and occupancy", () => {
    const plan = { ...bar, room_type_ids: ["luxury"], valid_to: "2026-09-30" };
    const problems = checkRestrictions({ ...base, plan, adults: 4 });
    expect(problems).toContain("Best Available Rate is not available for Premier Room.");
    expect(problems).toContain("Best Available Rate is valid for arrivals until 2026-09-30.");
    expect(problems).toContain("Premier Room takes at most 3 adult(s) per room.");
  });
});
