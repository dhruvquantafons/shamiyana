/**
 * Revenue management: the pricing rule engine and the promo code engine.
 *
 * Pure functions, like pricing.ts, so the rule engine can be run against a
 * forecast without touching the database and the booking form can check a
 * promo code in the browser before the server checks it again on submit.
 *
 * The rule engine does not price a stay. It proposes one night's selling rate
 * for one room type, starting from the rate the ordinary build-up would have
 * produced (base or weekend rate, season applied) and asking a rule to move
 * it. What comes out is a proposal; whether it goes live without a manager is
 * settled by the approval threshold, not here.
 */
import type {
  ForecastRow,
  NightRate,
  PackageComponent,
  PricingAdjustment,
  PricingRule,
  PromoCode,
  RateSeason,
} from "./types";
import { daysBetween, dayOfWeek, eachNight } from "./dates";
import { type PricingRoomType, isWeekendNight, seasonFor } from "./pricing";

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundRupee = (n: number) => Math.round(n);

// ── The rule engine ─────────────────────────────────────────────────────────

/** The property-wide guard rails. Zero means "no limit", as in the schema. */
export interface RuleLimits {
  floorRate: number;
  ceilingRate: number;
  /** Changes of at most this many percent, either way, go live unapproved. */
  autoApprovePercent: number;
}

export interface RuleContext {
  /** The night being priced. */
  date: string;
  roomType: PricingRoomType;
  /** Rooms on the books and rooms sellable, for the occupancy trigger. */
  roomsSold: number;
  capacity: number;
  /** The date the rules are being run, for the lead-time trigger. */
  today: string;
}

export interface RuleProposal {
  stay_date: string;
  room_type_id: string;
  rule_id: string;
  rule_name: string;
  occasion: string;
  base_rate: number;
  proposed_rate: number;
  change_percent: number;
  occupancy_percent: number;
  rooms_sold: number;
  capacity: number;
  /** Whether it may go live without a manager looking at it. */
  autoApproves: boolean;
}

/** Percent of sellable rooms already taken. A closed room type is 100% full. */
export function occupancyPercent(roomsSold: number, capacity: number): number {
  if (capacity <= 0) return 100;
  return round2((roomsSold / capacity) * 100);
}

/**
 * Whether every one of a rule's conditions holds for this night.
 *
 * Each condition is optional and they are ANDed, so a rule with no conditions
 * matches every night — which is how a straight tariff shift is expressed.
 */
export function ruleMatches(rule: PricingRule, ctx: RuleContext): boolean {
  if (!rule.is_active) return false;

  if (rule.room_type_id !== null && rule.room_type_id !== ctx.roomType.id) return false;

  // Occupancy. Bounds are inclusive, so "80% and above" is min_occupancy 80.
  const occupancy = occupancyPercent(ctx.roomsSold, ctx.capacity);
  if (rule.min_occupancy !== null && occupancy < Number(rule.min_occupancy)) return false;
  if (rule.max_occupancy !== null && occupancy > Number(rule.max_occupancy)) return false;

  // Day of week.
  if (!rule.days_of_week.includes(dayOfWeek(ctx.date))) return false;

  // Special event or holiday window.
  if (rule.start_date && ctx.date < rule.start_date) return false;
  if (rule.end_date && ctx.date > rule.end_date) return false;

  // Booking lead time: how far ahead of the night we are standing now.
  const lead = daysBetween(ctx.today, ctx.date);
  if (lead < 0) return false;
  if (rule.min_lead_days !== null && lead < rule.min_lead_days) return false;
  if (rule.max_lead_days !== null && lead > rule.max_lead_days) return false;

  return true;
}

/**
 * The rule that sets a night's rate, or null.
 *
 * Rates do not stack. When two rules both match, the highest priority wins,
 * then the more specific one (a rule for this room type beats one for all),
 * then the older — so re-running the engine is stable.
 */
export function ruleFor(rules: PricingRule[], ctx: RuleContext): PricingRule | null {
  const matching = rules.filter((r) => ruleMatches(r, ctx));
  if (matching.length === 0) return null;

  matching.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.room_type_id !== null) - Number(a.room_type_id !== null) ||
      a.created_at.localeCompare(b.created_at),
  );
  return matching[0];
}

/** The rate a night would sell at before any rule touches it. */
export function undynamicRate(
  date: string,
  roomType: PricingRoomType,
  seasons: RateSeason[],
): number {
  const base =
    isWeekendNight(date) && roomType.weekend_rate !== null
      ? Number(roomType.weekend_rate)
      : Number(roomType.base_rate);
  const season = seasonFor(date, roomType.id, seasons);
  if (!season) return roundRupee(base);

  const v = Number(season.adjustment_value);
  if (season.adjustment_kind === "fixed") return roundRupee(v);
  if (season.adjustment_kind === "amount") return roundRupee(base + v);
  return roundRupee(base * (1 + v / 100));
}

function applyRule(rate: number, rule: PricingRule): number {
  const v = Number(rule.adjustment_value);
  if (rule.adjustment_kind === "fixed") return v;
  if (rule.adjustment_kind === "amount") return rate + v;
  return rate * (1 + v / 100);
}

/** Clamp to the rule's own limits first, then the property's. Zero = no limit. */
function clamp(rate: number, rule: PricingRule, limits: RuleLimits): number {
  let out = rate;
  if (Number(rule.floor_rate) > 0) out = Math.max(out, Number(rule.floor_rate));
  if (Number(rule.ceiling_rate) > 0) out = Math.min(out, Number(rule.ceiling_rate));
  if (limits.floorRate > 0) out = Math.max(out, limits.floorRate);
  if (limits.ceilingRate > 0) out = Math.min(out, limits.ceilingRate);
  return Math.max(0, out);
}

/**
 * What one night should sell for, or null when no rule applies or the rule
 * asks for the rate it already has.
 */
export function proposeForNight(
  rules: PricingRule[],
  ctx: RuleContext,
  seasons: RateSeason[],
  limits: RuleLimits,
): RuleProposal | null {
  const rule = ruleFor(rules, ctx);
  if (!rule) return null;

  const baseRate = undynamicRate(ctx.date, ctx.roomType, seasons);
  const proposed = roundRupee(clamp(applyRule(baseRate, rule), rule, limits));
  if (proposed === baseRate) return null;

  // A rule moving a zero rate has no percentage to speak of; treat it as a
  // full change so it is never waved through as "small".
  const changePercent = baseRate > 0 ? round2(((proposed - baseRate) / baseRate) * 100) : 100;

  return {
    stay_date: ctx.date,
    room_type_id: ctx.roomType.id,
    rule_id: rule.id,
    rule_name: rule.name,
    occasion: rule.occasion,
    base_rate: baseRate,
    proposed_rate: proposed,
    change_percent: changePercent,
    occupancy_percent: occupancyPercent(ctx.roomsSold, ctx.capacity),
    rooms_sold: ctx.roomsSold,
    capacity: ctx.capacity,
    autoApproves: Math.abs(changePercent) <= limits.autoApprovePercent,
  };
}

/** Runs the rules over a forecast and returns one proposal per night per type. */
export function proposeRates(
  forecast: ForecastRow[],
  rules: PricingRule[],
  roomTypes: PricingRoomType[],
  seasons: RateSeason[],
  limits: RuleLimits,
  today: string,
): RuleProposal[] {
  const byId = new Map(roomTypes.map((t) => [t.id, t]));
  const active = rules.filter((r) => r.is_active);
  const out: RuleProposal[] = [];

  for (const row of forecast) {
    const roomType = byId.get(row.room_type_id);
    if (!roomType) continue;

    const proposal = proposeForNight(
      active,
      {
        date: row.stay_date,
        roomType,
        roomsSold: Number(row.rooms_sold),
        capacity: Number(row.capacity),
        today,
      },
      seasons,
      limits,
    );
    if (proposal) out.push(proposal);
  }

  return out;
}

// ── Packages ────────────────────────────────────────────────────────────────

/**
 * What a package's contents would cost bought separately, for a given stay.
 *
 * Used to show the guest what the bundle saves. It is never billed: a package
 * is sold at the plan's own price, which is the point of bundling.
 */
export function packageRetailValue(
  components: PackageComponent[],
  nights: number,
  guests: number,
): number {
  const people = Math.max(1, guests);
  const stays = Math.max(1, nights);

  return round2(
    components
      .filter((c) => c.is_active)
      .reduce((sum, c) => {
        const unit = Number(c.retail_value) * c.quantity;
        switch (c.basis) {
          case "per_night":
            return sum + unit * stays;
          case "per_person_per_stay":
            return sum + unit * people;
          case "per_person_per_night":
            return sum + unit * people * stays;
          default:
            return sum + unit;
        }
      }, 0),
  );
}

// ── The promo code engine ───────────────────────────────────────────────────

export interface PromoCheck {
  /** The stay the code is being used against. */
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  ratePlanId: string | null;
  /** The stay total before the discount. */
  amount: number;
  /** Today, for the validity window. */
  today: string;
  /** How many times this guest has already used it, when known. */
  guestRedemptions?: number;
  /** A guest typing the code on the public site cannot use a private one. */
  publicOnly?: boolean;
}

export interface PromoResult {
  ok: boolean;
  /** Money off the stay. Zero when the code does not apply. */
  discount: number;
  /** Why it was refused, in words a guest can read. */
  reason?: string;
}

/**
 * Whether a code may be used for this stay, and what it takes off.
 *
 * The discount is money off the stay total, applied after the rate plan and
 * its length-of-stay discount — a promo is the last thing to touch the price,
 * so that "10% off" means 10% off what the guest was about to pay.
 */
export function checkPromo(promo: PromoCode | null, stay: PromoCheck): PromoResult {
  const refuse = (reason: string): PromoResult => ({ ok: false, discount: 0, reason });

  if (!promo) return refuse("That promo code was not recognised.");
  if (!promo.is_active) return refuse(`${promo.code} is no longer available.`);
  if (stay.publicOnly && !promo.is_public) return refuse("That promo code was not recognised.");

  // Expiry: when the booking may be made.
  if (promo.valid_from && stay.today < promo.valid_from) {
    return refuse(`${promo.code} can be used from ${promo.valid_from}.`);
  }
  if (promo.valid_to && stay.today > promo.valid_to) {
    return refuse(`${promo.code} expired on ${promo.valid_to}.`);
  }

  // Which nights it covers. Every night of the stay has to be inside it.
  if (promo.stay_from && stay.checkIn < promo.stay_from) {
    return refuse(`${promo.code} applies to stays from ${promo.stay_from}.`);
  }
  // check_out is the morning after the last night, so the last night is the
  // day before it — comparing check_out against stay_to would refuse a code
  // on its own final night.
  const nights = eachNight(stay.checkIn, stay.checkOut);
  const lastNight = nights[nights.length - 1];
  if (promo.stay_to && lastNight && lastNight > promo.stay_to) {
    return refuse(`${promo.code} applies to stays up to ${promo.stay_to}.`);
  }

  if (nights.length === 0) return refuse("Check-out must be after check-in.");
  if (promo.min_nights && nights.length < promo.min_nights) {
    return refuse(`${promo.code} needs a stay of at least ${promo.min_nights} night(s).`);
  }
  if (Number(promo.min_amount) > 0 && stay.amount < Number(promo.min_amount)) {
    return refuse(`${promo.code} applies to bookings of ₹${Number(promo.min_amount).toLocaleString("en-IN")} or more.`);
  }

  if (promo.room_type_ids.length > 0 && !promo.room_type_ids.includes(stay.roomTypeId)) {
    return refuse(`${promo.code} does not apply to this room type.`);
  }
  if (
    promo.rate_plan_ids.length > 0 &&
    (stay.ratePlanId === null || !promo.rate_plan_ids.includes(stay.ratePlanId))
  ) {
    return refuse(`${promo.code} does not apply to this rate plan.`);
  }

  if (promo.max_redemptions !== null && promo.redemption_count >= promo.max_redemptions) {
    return refuse(`${promo.code} has been fully redeemed.`);
  }
  if (promo.max_per_guest !== null && (stay.guestRedemptions ?? 0) >= promo.max_per_guest) {
    return refuse(`${promo.code} has already been used on this account.`);
  }

  return { ok: true, discount: promoDiscount(promo, stay.amount) };
}

/** Money off an amount, honouring the cap on a percentage code. */
export function promoDiscount(promo: PromoCode, amount: number): number {
  if (amount <= 0) return 0;
  const raw =
    promo.discount_kind === "percent"
      ? (amount * Number(promo.discount_value)) / 100
      : Number(promo.discount_value);

  const capped = Number(promo.max_discount) > 0 ? Math.min(raw, Number(promo.max_discount)) : raw;
  // A code can never take more off than the stay is worth.
  return roundRupee(Math.max(0, Math.min(capped, amount)));
}

/**
 * Spreads a stay-level discount back across the nights of the stay.
 *
 * The folio bills a guest from the stored nightly breakdown, one line per
 * night, and the tax on each line is worked out from that line. A discount
 * held only as a total would therefore never reach the bill — the guest would
 * be charged the full rate — and, where it did, the tax would have been
 * charged on a price nobody paid. Pushing it into the nightly rates instead
 * means the folio, the tax split, ADR and the invoice all see one discounted
 * figure and need to know nothing about promotions.
 *
 * Rates are whole rupees, so the remainder is spread a rupee at a time across
 * the earliest nights rather than being lost to rounding.
 */
export function discountNights(
  nights: NightRate[],
  discount: number,
  rooms: number,
): NightRate[] {
  const roomCount = Math.max(1, rooms);
  if (!(discount > 0) || nights.length === 0) return nights;

  // The breakdown is per room per night, so only this room's share comes off.
  const perRoom = discount / roomCount;
  const total = nights.reduce((s, n) => s + Number(n.rate), 0);
  if (total <= 0) return nights;

  // Never give away more than the stay is worth.
  const toGive = Math.min(Math.round(perRoom), total);
  const base = Math.floor(toGive / nights.length);
  let remainder = toGive - base * nights.length;

  return nights.map((n) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...n, rate: Math.max(0, Number(n.rate) - base - extra) };
  });
}

/** What a discounted breakdown actually comes to, all rooms, all nights. */
export function nightsTotal(nights: NightRate[], rooms: number): number {
  return nights.reduce((s, n) => s + Number(n.rate), 0) * Math.max(1, rooms);
}

// ── Reading applied adjustments ─────────────────────────────────────────────

/** The live selling rate a rule has set for a night, or null. */
export function adjustedRate(
  adjustments: Pick<PricingAdjustment, "stay_date" | "room_type_id" | "proposed_rate" | "status">[],
  date: string,
  roomTypeId: string,
): number | null {
  const hit = adjustments.find(
    (a) => a.status === "applied" && a.stay_date === date && a.room_type_id === roomTypeId,
  );
  return hit ? Number(hit.proposed_rate) : null;
}
