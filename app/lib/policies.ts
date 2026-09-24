/**
 * Hotel policy calculations: cancellation and no-show penalties, early
 * check-in and late check-out fees, deposits, and folio balances.
 *
 * Pure functions so they can be unit tested and shown to staff as a preview
 * before anything is posted.
 */
import type { FolioEntry, NightRate, PenaltyKind, RatePlan } from "./types";

type PenaltyPlan = Pick<
  RatePlan,
  | "is_refundable"
  | "free_cancellation_hours"
  | "cancellation_penalty"
  | "cancellation_penalty_percent"
  | "no_show_penalty"
  | "no_show_penalty_percent"
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

function penaltyAmount(
  kind: PenaltyKind,
  percent: number,
  nights: NightRate[],
  rooms: number,
): number {
  const stay = nights.reduce((s, n) => s + Number(n.rate), 0) * rooms;
  switch (kind) {
    case "none":
      return 0;
    case "first_night":
      return round2(Number(nights[0]?.rate ?? 0) * rooms);
    case "full_stay":
      return round2(stay);
    case "percent":
      return round2((stay * Number(percent)) / 100);
  }
}

export interface PenaltyResult {
  amount: number;
  /** Plain-language reason shown to staff. */
  explanation: string;
  withinFreeWindow: boolean;
}

/**
 * What cancelling now costs.
 *
 * `hoursBeforeArrival` is measured to the property's check-in time on the
 * arrival date. Non-refundable plans always charge; refundable ones charge
 * only once inside the free-cancellation window.
 */
export function cancellationPenalty(
  plan: PenaltyPlan | null,
  nights: NightRate[],
  rooms: number,
  hoursBeforeArrival: number,
): PenaltyResult {
  if (!plan) {
    return { amount: 0, explanation: "No rate plan, so no cancellation policy applies.", withinFreeWindow: true };
  }

  const free = plan.is_refundable && hoursBeforeArrival >= plan.free_cancellation_hours;
  if (free) {
    return {
      amount: 0,
      explanation: `Free: cancelled more than ${plan.free_cancellation_hours} hours before arrival.`,
      withinFreeWindow: true,
    };
  }

  const amount = penaltyAmount(
    plan.cancellation_penalty,
    plan.cancellation_penalty_percent,
    nights,
    rooms,
  );
  const why = plan.is_refundable
    ? `Inside the ${plan.free_cancellation_hours}-hour free-cancellation window`
    : "Non-refundable rate";
  return { amount, explanation: `${why}: ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)}.`, withinFreeWindow: false };
}

export function noShowPenalty(plan: PenaltyPlan | null, nights: NightRate[], rooms: number): PenaltyResult {
  if (!plan) return { amount: 0, explanation: "No rate plan, so no no-show policy applies.", withinFreeWindow: false };
  const amount = penaltyAmount(plan.no_show_penalty, plan.no_show_penalty_percent, nights, rooms);
  return {
    amount,
    explanation: `No-show: ${describePenalty(plan.no_show_penalty, plan.no_show_penalty_percent)}.`,
    withinFreeWindow: false,
  };
}

export function describePenalty(kind: PenaltyKind, percent: number) {
  switch (kind) {
    case "none":
      return "no charge";
    case "first_night":
      return "first night charged";
    case "full_stay":
      return "full stay charged";
    case "percent":
      return `${Number(percent)}% of the stay charged`;
  }
}

// ── Early check-in / late check-out ─────────────────────────────────────────

export type FeeType = "none" | "percent" | "flat";

/** Fee for arriving early or leaving late, from the nightly rate. */
export function timingFee(type: FeeType, value: number, nightlyRate: number): number {
  if (type === "none" || value <= 0) return 0;
  if (type === "flat") return round2(Number(value));
  return round2((Number(nightlyRate) * Number(value)) / 100);
}

/** Minutes past midnight for an HH:MM[:SS] string. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Whether a local wall-clock time is before the policy time. */
export function isEarly(localTime: string, policyTime: string) {
  return minutesOf(localTime) < minutesOf(policyTime);
}

export function isLate(localTime: string, policyTime: string) {
  return minutesOf(localTime) > minutesOf(policyTime);
}

// ── Folio ──────────────────────────────────────────────────────────────────

const CHARGE_KINDS = new Set(["room", "fee", "penalty", "extra", "refund"]);

export interface FolioTotals {
  charges: number;
  tax: number;
  payments: number;
  balance: number;
  deposits: number;
}

/** Mirrors the folio_balance() SQL function. Voided entries do not count. */
export function folioTotals(entries: Pick<FolioEntry, "kind" | "amount" | "tax_amount" | "voided_at" | "is_deposit">[]): FolioTotals {
  let charges = 0;
  let tax = 0;
  let payments = 0;
  let deposits = 0;

  for (const e of entries) {
    if (e.voided_at) continue;
    if (CHARGE_KINDS.has(e.kind)) {
      charges += Number(e.amount);
      tax += Number(e.tax_amount);
    } else {
      payments += Number(e.amount);
      if (e.is_deposit) deposits += Number(e.amount);
    }
  }

  return {
    charges: round2(charges),
    tax: round2(tax),
    payments: round2(payments),
    deposits: round2(deposits),
    balance: round2(charges + tax - payments),
  };
}
