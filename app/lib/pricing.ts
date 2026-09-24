/**
 * Stay pricing and sellability.
 *
 * Pure functions: the booking form runs them in the browser for an instant
 * quote, and the server action runs them again on submit so the price that is
 * stored never comes from the client.
 *
 * A night's rate, per room, is built up in order:
 *   1. the room type's base rate, or its weekend rate on Friday/Saturday nights
 *   2. the highest-priority season covering that night, if any
 *   3. a live dynamic-pricing adjustment for that night, which replaces 1–2
 *      outright, because a revenue rule sets the selling rate rather than
 *      nudging it (Module 4; the rule worked from the same 1–2 figure)
 *   4. the rate plan's adjustment (e.g. -10% corporate)
 *   5. the plan's length-of-stay discount, when the stay is long enough
 * plus the extra-adult charge for each adult above the room type's base
 * occupancy.
 *
 * A promo code is not part of this build-up. It comes off the finished total,
 * so that "10% off" means 10% off what the guest was about to pay; see
 * checkPromo in revenue.ts.
 */
import type {
  ExtraCharge,
  NightRate,
  RatePlan,
  RateRestriction,
  RateSeason,
  RoomType,
} from "./types";
import { dayOfWeek, eachNight } from "./dates";

export type PricingRoomType = Pick<
  RoomType,
  "id" | "name" | "base_rate" | "weekend_rate" | "base_occupancy" | "max_adults" | "max_children"
>;

export type PricingPlan = Pick<
  RatePlan,
  | "id"
  | "name"
  | "adjustment_kind"
  | "adjustment_value"
  | "room_type_ids"
  | "min_los"
  | "max_los"
  | "los_discount_min_nights"
  | "los_discount_percent"
  | "valid_from"
  | "valid_to"
  | "is_active"
  | "deposit_percent"
>;

/**
 * A rate a revenue rule has set for one night of one room type.
 *
 * Declared here rather than imported from revenue.ts, which imports this
 * module for the season and weekend logic it prices against.
 */
export interface LiveAdjustment {
  stay_date: string;
  room_type_id: string;
  proposed_rate: number;
  status: string;
}

export interface QuoteInput {
  roomType: PricingRoomType;
  plan: PricingPlan | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  seasons: RateSeason[];
  restrictions: RateRestriction[];
  extraCharges: Pick<ExtraCharge, "kind" | "amount" | "is_active">[];
  /** Live dynamic-pricing decisions. Absent is the same as none. */
  adjustments?: LiveAdjustment[];
}

export interface Quote {
  /** Rate per room per night, extras included. */
  nights: NightRate[];
  nightCount: number;
  /** All rooms, all nights. */
  total: number;
  averageNightly: number;
  deposit: number;
  /** Reasons this stay cannot be sold as asked. Empty when sellable. */
  violations: string[];
}

const roundRupee = (n: number) => Math.round(n);

/** Friday and Saturday nights are the weekend in hotel pricing. */
export function isWeekendNight(date: string) {
  const dow = dayOfWeek(date);
  return dow === 5 || dow === 6;
}

/** The season that sets a night's price, or null. */
export function seasonFor(
  date: string,
  roomTypeId: string,
  seasons: RateSeason[],
): RateSeason | null {
  const dow = dayOfWeek(date);
  const matching = seasons.filter(
    (s) =>
      s.is_active &&
      s.start_date <= date &&
      s.end_date >= date &&
      (s.room_type_id === null || s.room_type_id === roomTypeId) &&
      s.days_of_week.includes(dow),
  );
  if (matching.length === 0) return null;

  // Highest priority first; a season for this room type beats one for all
  // types; then the most recently created.
  matching.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.room_type_id !== null) - Number(a.room_type_id !== null) ||
      b.created_at.localeCompare(a.created_at),
  );
  return matching[0];
}

function applySeason(rate: number, season: RateSeason | null) {
  if (!season) return rate;
  const v = Number(season.adjustment_value);
  if (season.adjustment_kind === "fixed") return v;
  if (season.adjustment_kind === "amount") return rate + v;
  return rate * (1 + v / 100);
}

/**
 * The rate a live revenue rule has set for a night, or null.
 *
 * Only 'applied' rows sell. A proposal still waiting for a manager must not
 * reach a guest, which is the whole point of the approval threshold.
 */
export function liveAdjustmentFor(
  adjustments: LiveAdjustment[] | undefined,
  date: string,
  roomTypeId: string,
): number | null {
  const hit = adjustments?.find(
    (a) => a.status === "applied" && a.stay_date === date && a.room_type_id === roomTypeId,
  );
  return hit ? Number(hit.proposed_rate) : null;
}

function applyPlan(rate: number, plan: PricingPlan | null) {
  if (!plan) return rate;
  const v = Number(plan.adjustment_value);
  // A package is sold at one price, so 'fixed' sets the night's rate outright
  // rather than moving the room rate (Module 4).
  if (plan.adjustment_kind === "fixed") return v;
  return plan.adjustment_kind === "amount" ? rate + v : rate * (1 + v / 100);
}

/** Restrictions that apply to this room type and plan on a given night. */
function restrictionsOn(
  date: string,
  roomTypeId: string,
  planId: string | null,
  restrictions: RateRestriction[],
) {
  return restrictions.filter(
    (r) =>
      r.start_date <= date &&
      r.end_date >= date &&
      (r.room_type_id === null || r.room_type_id === roomTypeId) &&
      (r.rate_plan_id === null || r.rate_plan_id === planId),
  );
}

/** Everything that would stop this stay being sold, in plain words. */
export function checkRestrictions(input: QuoteInput): string[] {
  const { roomType, plan, checkIn, checkOut, restrictions } = input;
  const problems: string[] = [];
  const nights = eachNight(checkIn, checkOut);
  const los = nights.length;
  const planId = plan?.id ?? null;

  if (los < 1) return ["Check-out must be after check-in."];

  if (plan) {
    if (!plan.is_active) problems.push(`${plan.name} is not currently offered.`);
    if (plan.room_type_ids.length > 0 && !plan.room_type_ids.includes(roomType.id)) {
      problems.push(`${plan.name} is not available for ${roomType.name}.`);
    }
    if (plan.valid_from && checkIn < plan.valid_from) {
      problems.push(`${plan.name} is valid for arrivals from ${plan.valid_from}.`);
    }
    if (plan.valid_to && checkIn > plan.valid_to) {
      problems.push(`${plan.name} is valid for arrivals until ${plan.valid_to}.`);
    }
    if (plan.min_los && los < plan.min_los) {
      problems.push(`${plan.name} needs a stay of at least ${plan.min_los} night(s).`);
    }
    if (plan.max_los && los > plan.max_los) {
      problems.push(`${plan.name} allows at most ${plan.max_los} night(s).`);
    }
  }

  // Length-of-stay limits are judged on the arrival date, as channels do.
  for (const r of restrictionsOn(checkIn, roomType.id, planId, restrictions)) {
    if (r.closed_to_arrival) problems.push(`Closed to arrival on ${checkIn}.`);
    if (r.min_los && los < r.min_los) problems.push(`Minimum stay of ${r.min_los} night(s) for arrivals on ${checkIn}.`);
    if (r.max_los && los > r.max_los) problems.push(`Maximum stay of ${r.max_los} night(s) for arrivals on ${checkIn}.`);
  }

  for (const r of restrictionsOn(checkOut, roomType.id, planId, restrictions)) {
    if (r.closed_to_departure) problems.push(`Closed to departure on ${checkOut}.`);
  }

  const blackout = nights.find((night) =>
    restrictionsOn(night, roomType.id, planId, restrictions).some((r) => r.stop_sell),
  );
  if (blackout) problems.push(`Not for sale on ${blackout} (blackout).`);

  const maxAdults = roomType.max_adults * input.rooms;
  const maxChildren = roomType.max_children * input.rooms;
  if (input.adults > maxAdults) {
    problems.push(`${roomType.name} takes at most ${roomType.max_adults} adult(s) per room.`);
  }
  if (input.children > maxChildren) {
    problems.push(`${roomType.name} takes at most ${roomType.max_children} child(ren) per room.`);
  }

  return [...new Set(problems)];
}

export function quoteStay(input: QuoteInput): Quote {
  const { roomType, plan, checkIn, checkOut, seasons, extraCharges } = input;
  const rooms = Math.max(1, input.rooms);
  const nightDates = eachNight(checkIn, checkOut);
  const violations = checkRestrictions(input);

  const extraAdultCharge =
    extraCharges.find((c) => c.kind === "extra_adult" && c.is_active)?.amount ?? 0;
  const adultsPerRoom = Math.ceil(Math.max(1, input.adults) / rooms);
  const extraAdults = Math.max(0, adultsPerRoom - roomType.base_occupancy);

  const losDiscount =
    plan?.los_discount_min_nights &&
    plan.los_discount_percent &&
    nightDates.length >= plan.los_discount_min_nights
      ? Number(plan.los_discount_percent)
      : 0;

  const nights = nightDates.map((date) => {
    const base =
      isWeekendNight(date) && roomType.weekend_rate !== null
        ? Number(roomType.weekend_rate)
        : Number(roomType.base_rate);
    // A live revenue rule replaces the base-and-season figure it was built
    // from, rather than compounding with it.
    const dynamic = liveAdjustmentFor(input.adjustments, date, roomType.id);
    let rate = dynamic ?? applySeason(base, seasonFor(date, roomType.id, seasons));
    rate = applyPlan(rate, plan);
    rate = rate * (1 - losDiscount / 100);
    rate += extraAdults * Number(extraAdultCharge);
    return { date, rate: Math.max(0, roundRupee(rate)) };
  });

  const perRoom = nights.reduce((sum, n) => sum + n.rate, 0);
  const total = perRoom * rooms;
  const depositPercent = Number(plan?.deposit_percent ?? 0);

  return {
    nights,
    nightCount: nights.length,
    total,
    averageNightly: nights.length ? roundRupee(perRoom / nights.length) : 0,
    deposit: roundRupee((total * depositPercent) / 100),
    violations,
  };
}

/** A flat rate for every night, used when staff override the price. */
export function flatBreakdown(checkIn: string, checkOut: string, rate: number): NightRate[] {
  return eachNight(checkIn, checkOut).map((date) => ({ date, rate }));
}

/** Rate for a night from a stored breakdown, falling back to the flat rate. */
export function rateForNight(
  breakdown: NightRate[] | null | undefined,
  date: string,
  fallback: number | null,
): number {
  const hit = breakdown?.find((n) => n.date === date);
  return hit ? Number(hit.rate) : Number(fallback ?? 0);
}

