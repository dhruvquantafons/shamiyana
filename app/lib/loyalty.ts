import type { LoyaltyTier, LoyaltyTransaction } from "./types";

/**
 * Loyalty points and membership tiers (SOW Module 8).
 *
 * Points are held as *lots*: every earning creates one, carrying its own
 * expiry date and how much of it is still unspent. A redemption eats the
 * oldest lots first and expiry retires whatever is left when a lot's date
 * passes. A single running total could not answer "when do my points die?",
 * which is the question every member actually asks.
 *
 * The database owns the movements (see 0016_loyalty.sql) because they must be
 * atomic with the folio. What lives here is the arithmetic and the tier rules,
 * so the desk can be shown what a redemption is worth before it happens, and
 * so the numbers are unit tested in tests/loyalty.test.ts.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Points earned on a spend at a given tier. Always rounded down: a hotel
 *  never awards a fraction of a point, and rounding up gives money away. */
export function pointsFor(baseAmount: number, tier: Pick<LoyaltyTier, "earn_rate">): number {
  if (!(baseAmount > 0)) return 0;
  return Math.floor(baseAmount * Number(tier.earn_rate));
}

/** What points are worth in base currency at a given tier. */
export function redemptionValue(points: number, tier: Pick<LoyaltyTier, "redeem_rate">): number {
  if (!(points > 0)) return 0;
  return round2(points * Number(tier.redeem_rate));
}

/** How many points it takes to settle an amount — rounded up, so the bill is
 *  actually cleared rather than left a rupee short. */
export function pointsToCover(baseAmount: number, tier: Pick<LoyaltyTier, "redeem_rate">): number {
  const rate = Number(tier.redeem_rate);
  if (!(rate > 0) || !(baseAmount > 0)) return 0;
  return Math.ceil(baseAmount / rate);
}

const spendable = (t: LoyaltyTransaction, asOf: string) =>
  t.remaining > 0 && (t.expires_on === null || t.expires_on >= asOf);

/** The balance a guest can actually spend today. */
export function balanceOf(transactions: LoyaltyTransaction[], asOf: string): number {
  return transactions.filter((t) => spendable(t, asOf)).reduce((s, t) => s + t.remaining, 0);
}

/** Lots in the order a redemption would consume them: nearest expiry first. */
export function lotQueue(transactions: LoyaltyTransaction[], asOf: string): LoyaltyTransaction[] {
  return transactions
    .filter((t) => spendable(t, asOf))
    .slice()
    .sort((a, b) => {
      if (a.expires_on === b.expires_on) return a.created_at.localeCompare(b.created_at);
      if (a.expires_on === null) return 1;
      if (b.expires_on === null) return -1;
      return a.expires_on.localeCompare(b.expires_on);
    });
}

export interface ExpiringSoon {
  points: number;
  on: string | null;
}

/**
 * The next batch of points due to expire, for the "use them or lose them"
 * line on a guest's profile. Null `on` means nothing is expiring.
 */
export function nextExpiry(transactions: LoyaltyTransaction[], asOf: string): ExpiringSoon {
  const dated = lotQueue(transactions, asOf).filter((t) => t.expires_on !== null);
  if (dated.length === 0) return { points: 0, on: null };
  const on = dated[0].expires_on;
  return { points: dated.filter((t) => t.expires_on === on).reduce((s, t) => s + t.remaining, 0), on };
}

/** Points earned, spent and expired over the whole history, for the profile. */
export function lifetime(transactions: LoyaltyTransaction[]) {
  const sum = (kind: LoyaltyTransaction["kind"]) =>
    transactions.filter((t) => t.kind === kind).reduce((s, t) => s + Math.abs(t.points), 0);
  return {
    earned: sum("earn"),
    redeemed: sum("redeem"),
    expired: sum("expire"),
    adjusted: transactions.filter((t) => t.kind === "adjust").reduce((s, t) => s + t.points, 0),
  };
}

export interface TierProgress {
  tier: LoyaltyTier;
  next: LoyaltyTier | null;
  nightsToNext: number;
  spendToNext: number;
  /** 0–1, how far through the gap to the next tier — whichever measure is
   *  further along, since either one alone earns the upgrade. */
  fraction: number;
}

const byRank = (tiers: LoyaltyTier[]) =>
  tiers.filter((t) => t.is_active).slice().sort((a, b) => a.sort_order - b.sort_order);

/** The entry tier — the one every enrolled member starts on. */
export function entryTier(tiers: LoyaltyTier[]): LoyaltyTier | null {
  return byRank(tiers)[0] ?? null;
}

/**
 * The highest tier a guest's rolling twelve months qualifies for (SOW Module
 * 8 "Tier Upgrade Rules"). Both thresholds must be met; a guest who meets
 * neither falls back to the entry tier, which is what a downgrade means.
 */
export function tierFor(tiers: LoyaltyTier[], nights: number, spend: number): LoyaltyTier | null {
  const ranked = byRank(tiers);
  for (const tier of ranked.slice().reverse()) {
    if (nights >= tier.min_nights && spend >= Number(tier.min_spend)) return tier;
  }
  return ranked[0] ?? null;
}

/** Where a guest stands and what the next tier would take. */
export function tierProgress(tiers: LoyaltyTier[], nights: number, spend: number): TierProgress | null {
  const ranked = byRank(tiers);
  const current = tierFor(tiers, nights, spend);
  if (!current) return null;

  const next = ranked.find((t) => t.sort_order > current.sort_order) ?? null;
  if (!next) return { tier: current, next: null, nightsToNext: 0, spendToNext: 0, fraction: 1 };

  const nightsToNext = Math.max(0, next.min_nights - nights);
  const spendToNext = round2(Math.max(0, Number(next.min_spend) - spend));

  const span = (from: number, to: number, at: number) => (to > from ? Math.min(1, Math.max(0, (at - from) / (to - from))) : 1);
  const fraction = Math.max(
    span(current.min_nights, next.min_nights, nights),
    span(Number(current.min_spend), Number(next.min_spend), spend),
  );

  return { tier: current, next, nightsToNext, spendToNext, fraction };
}

export function tierByKey(tiers: LoyaltyTier[], key: string | null): LoyaltyTier | null {
  return key ? (tiers.find((t) => t.key === key) ?? null) : null;
}

/**
 * Whether a redemption may go ahead, and what it is worth. Mirrors the checks
 * the database enforces so the desk is told why before it tries: loyalty
 * settles a debt, so it can never exceed what is owed, and never breach the
 * property's minimum.
 */
export interface RedemptionCheck {
  allowed: boolean;
  points: number;
  value: number;
  reason: string;
}

export function checkRedemption(options: {
  points: number;
  balance: number;
  owed: number;
  minimum: number;
  tier: LoyaltyTier | null;
}): RedemptionCheck {
  const { points, balance, owed, minimum, tier } = options;
  const fail = (reason: string, value = 0): RedemptionCheck => ({ allowed: false, points, value, reason });

  if (!tier) return fail("This guest is not enrolled in the loyalty programme.");
  if (Number(tier.redeem_rate) <= 0) return fail(`${tier.name} has no redemption rate set.`);
  if (!Number.isInteger(points) || points <= 0) return fail("Enter a whole number of points.");
  if (points > balance) return fail(`Only ${balance.toLocaleString("en-IN")} points are available.`);
  if (points < minimum) return fail(`The smallest redemption is ${minimum.toLocaleString("en-IN")} points.`);

  const value = redemptionValue(points, tier);
  if (value <= 0) return fail("That many points are not worth anything yet.");
  if (owed <= 0) return fail("There is nothing left to settle on this folio.");
  if (value > owed) {
    return fail(
      `That is worth ${value.toFixed(2)} but only ${owed.toFixed(2)} is owed. ` +
        `Redeem up to ${Math.floor(owed / Number(tier.redeem_rate)).toLocaleString("en-IN")} points.`,
      value,
    );
  }

  return { allowed: true, points, value, reason: "" };
}

/** The most a guest could usefully redeem against a bill right now. */
export function maxRedeemablePoints(balance: number, owed: number, tier: LoyaltyTier | null): number {
  if (!tier || Number(tier.redeem_rate) <= 0 || owed <= 0) return 0;
  return Math.min(balance, Math.floor(owed / Number(tier.redeem_rate)));
}
