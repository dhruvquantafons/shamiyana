import { describe, it, expect } from "vitest";
import {
  balanceOf,
  checkRedemption,
  entryTier,
  lifetime,
  lotQueue,
  maxRedeemablePoints,
  nextExpiry,
  pointsFor,
  pointsToCover,
  redemptionValue,
  tierFor,
  tierProgress,
  tierByKey,
} from "../app/lib/loyalty";
import type { LoyaltyTier, LoyaltyTransaction, LoyaltyTxKind } from "../app/lib/types";

/** Module 8 — loyalty points, lot expiry and membership tiers. */

const tier = (t: Partial<LoyaltyTier> & Pick<LoyaltyTier, "key" | "sort_order">): LoyaltyTier => ({
  name: t.key,
  min_nights: 0,
  min_spend: 0,
  earn_rate: 0.05,
  redeem_rate: 0.25,
  perks: "",
  colour: "slate",
  is_active: true,
  ...t,
});

const silver = tier({ key: "silver", name: "Silver", sort_order: 1 });
const gold = tier({ key: "gold", name: "Gold", sort_order: 2, min_nights: 10, min_spend: 75000, earn_rate: 0.075 });
const platinum = tier({
  key: "platinum",
  name: "Platinum",
  sort_order: 3,
  min_nights: 25,
  min_spend: 200000,
  earn_rate: 0.1,
  redeem_rate: 0.3,
});
const TIERS = [silver, gold, platinum];

let seq = 0;
const tx = (
  kind: LoyaltyTxKind,
  points: number,
  e: Partial<LoyaltyTransaction> = {},
): LoyaltyTransaction => ({
  id: `t${++seq}`,
  guest_id: "g1",
  kind,
  points,
  remaining: points > 0 ? points : 0,
  base_amount: 0,
  booking_id: null,
  invoice_id: null,
  folio_entry_id: null,
  source_id: null,
  tier: "silver",
  description: "",
  expires_on: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...e,
});

describe("earning", () => {
  it("awards points at the tier's rate", () => {
    expect(pointsFor(20000, silver)).toBe(1000);
    expect(pointsFor(20000, gold)).toBe(1500);
    expect(pointsFor(20000, platinum)).toBe(2000);
  });

  it("rounds down, so the hotel never gives away a fraction of a point", () => {
    expect(pointsFor(199, silver)).toBe(9); // 9.95
  });

  it("awards nothing on a zero or negative spend", () => {
    expect(pointsFor(0, silver)).toBe(0);
    expect(pointsFor(-500, silver)).toBe(0);
  });

  it("awards nothing at a zero earn rate", () => {
    expect(pointsFor(10000, tier({ key: "none", sort_order: 0, earn_rate: 0 }))).toBe(0);
  });
});

describe("what points are worth", () => {
  it("values them at the tier's redemption rate", () => {
    expect(redemptionValue(1000, silver)).toBe(250);
    expect(redemptionValue(1000, platinum)).toBe(300);
  });

  it("rounds up the points needed to clear an amount", () => {
    // 250 / 0.25 is exact; 251 needs one more point than the division gives.
    expect(pointsToCover(250, silver)).toBe(1000);
    expect(pointsToCover(250.01, silver)).toBe(1001);
    expect(redemptionValue(pointsToCover(999, silver), silver)).toBeGreaterThanOrEqual(999);
  });

  it("returns zero when a tier cannot redeem", () => {
    expect(pointsToCover(500, tier({ key: "x", sort_order: 0, redeem_rate: 0 }))).toBe(0);
  });
});

describe("the points balance", () => {
  const today = "2026-06-01";

  it("counts only what is left in unexpired lots", () => {
    const history = [
      tx("earn", 1000, { remaining: 400, expires_on: "2027-01-01" }),
      tx("earn", 500, { remaining: 500, expires_on: "2027-06-01" }),
      tx("redeem", -600),
    ];
    expect(balanceOf(history, today)).toBe(900);
  });

  it("drops a lot the day after it expires", () => {
    const lot = [tx("earn", 1000, { remaining: 1000, expires_on: "2026-06-01" })];
    expect(balanceOf(lot, "2026-06-01")).toBe(1000);
    expect(balanceOf(lot, "2026-06-02")).toBe(0);
  });

  it("keeps points that never expire", () => {
    expect(balanceOf([tx("adjust", 250, { expires_on: null })], "2099-01-01")).toBe(250);
  });

  it("is zero for a guest with no history", () => {
    expect(balanceOf([], today)).toBe(0);
    expect(nextExpiry([], today)).toEqual({ points: 0, on: null });
  });
});

describe("the order points are spent in", () => {
  const today = "2026-06-01";

  it("spends the lot that expires soonest first", () => {
    const queue = lotQueue(
      [
        tx("earn", 100, { remaining: 100, expires_on: "2028-01-01" }),
        tx("earn", 200, { remaining: 200, expires_on: "2026-12-01" }),
        tx("earn", 300, { remaining: 300, expires_on: "2027-01-01" }),
      ],
      today,
    );
    expect(queue.map((l) => l.remaining)).toEqual([200, 300, 100]);
  });

  it("leaves never-expiring points until last", () => {
    const queue = lotQueue(
      [
        tx("adjust", 500, { remaining: 500, expires_on: null }),
        tx("earn", 100, { remaining: 100, expires_on: "2027-01-01" }),
      ],
      today,
    );
    expect(queue[0].remaining).toBe(100);
    expect(queue[1].remaining).toBe(500);
  });

  it("reports the next batch to expire, adding up lots that share a date", () => {
    const expiry = nextExpiry(
      [
        tx("earn", 100, { remaining: 100, expires_on: "2026-12-01" }),
        tx("earn", 250, { remaining: 250, expires_on: "2026-12-01" }),
        tx("earn", 900, { remaining: 900, expires_on: "2027-12-01" }),
      ],
      today,
    );
    expect(expiry).toEqual({ points: 350, on: "2026-12-01" });
  });
});

describe("lifetime summary", () => {
  it("adds each kind of movement up separately", () => {
    const summary = lifetime([
      tx("earn", 1000),
      tx("earn", 500),
      tx("redeem", -800),
      tx("expire", -200),
      tx("adjust", 100),
      tx("adjust", -50),
    ]);
    expect(summary).toEqual({ earned: 1500, redeemed: 800, expired: 200, adjusted: 50 });
  });
});

describe("tiers", () => {
  it("gives the highest tier whose thresholds are both met", () => {
    expect(tierFor(TIERS, 30, 250000)?.key).toBe("platinum");
    expect(tierFor(TIERS, 12, 80000)?.key).toBe("gold");
    expect(tierFor(TIERS, 2, 9000)?.key).toBe("silver");
  });

  it("needs both nights and spend, not either", () => {
    // Plenty of nights, not enough spend — still Silver.
    expect(tierFor(TIERS, 30, 10000)?.key).toBe("silver");
    // Big spender, too few nights — still Silver.
    expect(tierFor(TIERS, 1, 500000)?.key).toBe("silver");
  });

  it("falls back to the entry tier, which is what a downgrade is", () => {
    expect(tierFor(TIERS, 0, 0)?.key).toBe("silver");
    expect(entryTier(TIERS)?.key).toBe("silver");
  });

  it("ignores a retired tier", () => {
    const tiers = [silver, { ...gold, is_active: false }, platinum];
    expect(tierFor(tiers, 12, 80000)?.key).toBe("silver");
  });

  it("looks a tier up by key, and copes with none", () => {
    expect(tierByKey(TIERS, "gold")?.name).toBe("Gold");
    expect(tierByKey(TIERS, null)).toBeNull();
    expect(tierByKey(TIERS, "nope")).toBeNull();
  });
});

describe("progress to the next tier", () => {
  it("says what is still needed", () => {
    const progress = tierProgress(TIERS, 6, 40000);
    expect(progress?.tier.key).toBe("silver");
    expect(progress?.next?.key).toBe("gold");
    expect(progress?.nightsToNext).toBe(4);
    expect(progress?.spendToNext).toBe(35000);
  });

  it("measures progress by whichever count is further along", () => {
    // 9 of 10 nights is 90% of the way; spend is only 13%.
    const progress = tierProgress(TIERS, 9, 10000);
    expect(progress?.fraction).toBeCloseTo(0.9, 5);
  });

  it("is complete at the top tier", () => {
    const progress = tierProgress(TIERS, 40, 400000);
    expect(progress?.next).toBeNull();
    expect(progress?.fraction).toBe(1);
  });
});

describe("checking a redemption before it is made", () => {
  const base = { balance: 5000, owed: 2000, minimum: 500, tier: silver };

  it("allows one that fits inside the balance and the bill", () => {
    const check = checkRedemption({ ...base, points: 4000 });
    expect(check.allowed).toBe(true);
    expect(check.value).toBe(1000);
  });

  it("refuses more points than the guest has", () => {
    expect(checkRedemption({ ...base, points: 6000 }).reason).toContain("5,000 points are available");
  });

  it("refuses less than the property's minimum", () => {
    expect(checkRedemption({ ...base, points: 100 }).reason).toContain("smallest redemption");
  });

  it("refuses more than the bill, and says the most that would fit", () => {
    // 5000 points are worth 1250, but only 400 is owed → 1600 points fit.
    const check = checkRedemption({ ...base, owed: 400, points: 5000 });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("1,600");
  });

  it("refuses when there is nothing left to settle", () => {
    expect(checkRedemption({ ...base, owed: 0, points: 1000 }).reason).toContain("nothing left to settle");
  });

  it("refuses a guest who is not a member", () => {
    expect(checkRedemption({ ...base, tier: null, points: 1000 }).reason).toContain("not enrolled");
  });

  it("refuses a tier with no redemption rate set", () => {
    const noRate = tier({ key: "silver", sort_order: 1, name: "Silver", redeem_rate: 0 });
    expect(checkRedemption({ ...base, tier: noRate, points: 1000 }).reason).toContain("no redemption rate");
  });

  it("refuses a fraction of a point", () => {
    expect(checkRedemption({ ...base, points: 100.5 }).reason).toContain("whole number");
  });

  it("caps the redemption at whichever runs out first", () => {
    expect(maxRedeemablePoints(5000, 2000, silver)).toBe(5000); // bill is the larger
    expect(maxRedeemablePoints(5000, 400, silver)).toBe(1600); // bill runs out first
    expect(maxRedeemablePoints(5000, 0, silver)).toBe(0);
    expect(maxRedeemablePoints(5000, 2000, null)).toBe(0);
  });

  it("never offers a redemption the bill cannot absorb", () => {
    const most = maxRedeemablePoints(5000, 400, silver);
    expect(redemptionValue(most, silver)).toBeLessThanOrEqual(400);
  });
});
