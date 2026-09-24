import type { CityLedgerEntry, Company } from "./types";

/**
 * City ledger / accounts receivable (SOW Module 7: "City ledger / accounts
 * receivable for corporate clients who pay later").
 *
 * A company's account is a list of movements: charges transferred off a stay,
 * payments received, credit notes and write-offs. The balance is simply
 * charges less everything else.
 *
 * Aging is the part worth explaining. Payments here are made against the
 * *account*, not against a named invoice — which is how a hotel is actually
 * paid, one cheque covering several stays. So to say how overdue the money
 * is, credits are applied to the oldest charge first (FIFO) and whatever
 * charge value is left unpaid is bucketed by how long ago it fell due. That
 * gives finance the standard current / 1-30 / 31-60 / 61-90 / 90+ statement
 * without asking the desk to allocate every receipt by hand.
 *
 * Pure functions, no database access — unit tested in tests/city-ledger.ts.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const live = (e: CityLedgerEntry) => !e.voided_at;

/** Charges less payments, credit notes and write-offs. */
export function accountBalance(entries: CityLedgerEntry[]): number {
  return round2(
    entries
      .filter(live)
      .reduce((sum, e) => sum + (e.kind === "charge" ? Number(e.amount) : -Number(e.amount)), 0),
  );
}

export function totalCharged(entries: CityLedgerEntry[]): number {
  return round2(entries.filter(live).filter((e) => e.kind === "charge").reduce((s, e) => s + Number(e.amount), 0));
}

export function totalCredited(entries: CityLedgerEntry[]): number {
  return round2(entries.filter(live).filter((e) => e.kind !== "charge").reduce((s, e) => s + Number(e.amount), 0));
}

export interface OpenCharge {
  entry: CityLedgerEntry;
  /** What is still unpaid on this charge after credits are applied FIFO. */
  outstanding: number;
  /** Days past its due date as at the report date. Negative means not yet due. */
  daysOverdue: number;
}

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Not yet due",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
};

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Applies every credit to the oldest charges first and returns what is left
 * open, oldest first. A credit larger than everything owed simply exhausts
 * the list — the surplus shows up as a negative account balance, which is
 * what an overpayment is.
 */
export function openCharges(entries: CityLedgerEntry[], asOf: string): OpenCharge[] {
  const charges = entries
    .filter(live)
    .filter((e) => e.kind === "charge")
    .slice()
    .sort((a, b) => (a.due_date ?? a.created_at).localeCompare(b.due_date ?? b.created_at));

  let credit = totalCredited(entries);
  const open: OpenCharge[] = [];

  for (const entry of charges) {
    const amount = Number(entry.amount);
    const paid = Math.min(credit, amount);
    credit = round2(credit - paid);
    const outstanding = round2(amount - paid);
    if (outstanding <= 0) continue;
    const due = entry.due_date ?? entry.created_at.slice(0, 10);
    open.push({ entry, outstanding, daysOverdue: daysBetween(due, asOf) });
  }

  return open;
}

export type Aging = Record<AgingBucket, number> & { total: number };

export function emptyAging(): Aging {
  return { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
}

/** The aging statement for one account. */
export function agingOf(entries: CityLedgerEntry[], asOf: string): Aging {
  const aging = emptyAging();
  for (const open of openCharges(entries, asOf)) {
    const bucket = bucketFor(open.daysOverdue);
    aging[bucket] = round2(aging[bucket] + open.outstanding);
    aging.total = round2(aging.total + open.outstanding);
  }
  return aging;
}

/** The same numbers added up across every account, for the overview page. */
export function agingTotals(perCompany: Aging[]): Aging {
  const total = emptyAging();
  for (const a of perCompany) {
    for (const b of AGING_BUCKETS) total[b] = round2(total[b] + a[b]);
    total.total = round2(total.total + a.total);
  }
  return total;
}

export interface CreditCheck {
  allowed: boolean;
  /** Owed before this charge. */
  balance: number;
  /** Owed after it. */
  projected: number;
  limit: number | null;
  reason: string;
}

/**
 * Whether a company can carry one more charge. A company with no limit set is
 * unlimited, which is deliberate: the hotel's own group accounts should not
 * be blocked by a field nobody filled in.
 */
export function creditCheck(
  company: Pick<Company, "name" | "credit_limit" | "is_active">,
  balance: number,
  charge: number,
): CreditCheck {
  const limit = company.credit_limit === null ? null : Number(company.credit_limit);
  const projected = round2(balance + charge);

  if (!company.is_active) {
    return { allowed: false, balance, projected, limit, reason: `${company.name}'s account is closed.` };
  }
  if (limit !== null && projected > limit) {
    return {
      allowed: false,
      balance,
      projected,
      limit,
      reason: `${company.name} would owe ${projected.toFixed(2)} against a credit limit of ${limit.toFixed(2)}.`,
    };
  }
  return { allowed: true, balance, projected, limit, reason: "" };
}

/** Accounts with anything past due, worst first — the chase list. */
export function overdueFirst<T extends { aging: Aging }>(rows: T[]): T[] {
  const overdue = (a: Aging) => round2(a.total - a.current);
  return rows.slice().sort((x, y) => overdue(y.aging) - overdue(x.aging) || y.aging.total - x.aging.total);
}
