import type { Currency } from "./types";

/**
 * Multi-currency support (SOW Module 7: "Currency conversion support for
 * international guests").
 *
 * The property keeps one base currency and every stored amount — folio lines,
 * invoices, the city ledger, every report — is in it. A foreign currency is
 * only ever a *presentation and settlement* layer on top: we show a guest
 * what a bill comes to in their own money, and when they pay we record what
 * they handed over alongside the base-currency amount it converted to.
 *
 * `rate_to_base` reads "how much base currency one unit of this buys", so
 * conversion is a multiplication one way and a division the other. Keeping
 * the rate on the transaction is what makes a receipt reproducible years
 * later, after the rate has moved.
 *
 * Pure functions, no database access — the arithmetic is unit tested in
 * tests/currency.test.ts.
 */

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** How much base currency `amount` of `currency` is worth. */
export function toBase(amount: number, currency: Pick<Currency, "rate_to_base">): number {
  return round(amount * Number(currency.rate_to_base), 2);
}

/** How much of `currency` a base-currency `amount` comes to. */
export function fromBase(amount: number, currency: Pick<Currency, "rate_to_base" | "decimals">): number {
  const rate = Number(currency.rate_to_base);
  if (!(rate > 0)) return 0;
  return round(amount / rate, currency.decimals);
}

/**
 * The rate to store on a settlement: what the guest handed over against what
 * it was worth. Derived from the two amounts rather than from the rate table,
 * so a desk that agrees a different rate with the guest is recorded honestly.
 */
export function impliedRate(foreignAmount: number, baseAmount: number): number {
  if (!(foreignAmount > 0)) return 0;
  return round(baseAmount / foreignAmount, 6);
}

/**
 * Formats an amount in a given currency. Falls back to the plain number when
 * the currency is unknown to the browser's formatter, so a newly added code
 * can never break a page.
 */
export function formatIn(
  amount: number,
  currency: Pick<Currency, "code" | "symbol" | "decimals"> | null | undefined,
): string {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    }).format(amount);
  } catch {
    const shown = amount.toFixed(currency.decimals);
    return currency.symbol ? `${currency.symbol}${shown}` : `${currency.code} ${shown}`;
  }
}

/** The rate table as a lookup, ready for a page that renders many amounts. */
export function currencyMap(currencies: Currency[]): Map<string, Currency> {
  return new Map(currencies.map((c) => [c.code, c]));
}

export interface SettlementQuote {
  /** What the guest pays, in their currency. */
  foreign: number;
  /** What it is worth to the hotel. */
  base: number;
  rate: number;
  currency: Currency;
}

/**
 * What to collect in a foreign currency to settle a base-currency balance.
 * Rounded up to the currency's smallest unit, because collecting a fraction
 * of a cent is not possible and short-paying a bill by rounding is worse than
 * over-collecting by one unit.
 */
export function quoteSettlement(baseOwed: number, currency: Currency): SettlementQuote {
  const rate = Number(currency.rate_to_base);
  const f = 10 ** currency.decimals;
  const foreign = rate > 0 ? Math.ceil((baseOwed / rate) * f) / f : 0;
  return {
    foreign,
    base: round(baseOwed, 2),
    rate: round(rate, 6),
    currency,
  };
}
