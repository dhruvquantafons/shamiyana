import { describe, it, expect } from "vitest";
import { fromBase, impliedRate, quoteSettlement, toBase, currencyMap, formatIn } from "../app/lib/currency";
import type { Currency } from "../app/lib/types";

/** Module 7 — currency conversion for international guests. */

const currency = (c: Partial<Currency> & Pick<Currency, "code" | "rate_to_base">): Currency => ({
  name: c.code,
  symbol: "",
  decimals: 2,
  is_active: true,
  updated_at: "2026-09-01T00:00:00.000Z",
  ...c,
});

const usd = currency({ code: "USD", rate_to_base: 88, symbol: "$" });
const jpy = currency({ code: "JPY", rate_to_base: 0.58, symbol: "¥", decimals: 0 });
const inr = currency({ code: "INR", rate_to_base: 1, symbol: "₹" });

describe("converting to and from the base currency", () => {
  it("multiplies into the base currency", () => {
    expect(toBase(100, usd)).toBe(8800);
  });

  it("divides out of it", () => {
    expect(fromBase(8800, usd)).toBe(100);
  });

  it("is a no-op for the property's own currency", () => {
    expect(toBase(1234.56, inr)).toBe(1234.56);
    expect(fromBase(1234.56, inr)).toBe(1234.56);
  });

  it("rounds to each currency's own minor units", () => {
    // JPY has none, so a converted price must not show a fraction.
    expect(fromBase(10000, jpy)).toBe(17241);
    expect(fromBase(10000, usd)).toBe(113.64);
  });

  it("round-trips within the currency's precision", () => {
    const base = toBase(fromBase(50000, usd), usd);
    expect(Math.abs(base - 50000)).toBeLessThan(1);
  });

  it("refuses to divide by a broken rate rather than returning Infinity", () => {
    expect(fromBase(100, currency({ code: "XXX", rate_to_base: 0 }))).toBe(0);
  });
});

describe("the rate stored on a settlement", () => {
  it("is derived from what was handed over and what it was worth", () => {
    expect(impliedRate(100, 8800)).toBe(88);
  });

  it("records an agreed rate faithfully, not the table rate", () => {
    // The desk settled $100 at ₹86 by agreement.
    expect(impliedRate(100, 8600)).toBe(86);
  });

  it("is zero rather than Infinity when nothing was paid", () => {
    expect(impliedRate(0, 8800)).toBe(0);
  });
});

describe("quoting a settlement", () => {
  it("rounds up, so the bill is actually cleared", () => {
    // ₹10,000 / 88 = $113.6363…; collecting $113.63 would leave a rupee owed.
    const quote = quoteSettlement(10000, usd);
    expect(quote.foreign).toBe(113.64);
    expect(toBase(quote.foreign, usd)).toBeGreaterThanOrEqual(10000);
  });

  it("rounds up to whole units for a currency without minor units", () => {
    const quote = quoteSettlement(10000, jpy);
    expect(Number.isInteger(quote.foreign)).toBe(true);
    expect(toBase(quote.foreign, jpy)).toBeGreaterThanOrEqual(10000);
  });

  it("keeps the base amount and the rate it used", () => {
    const quote = quoteSettlement(5000, usd);
    expect(quote.base).toBe(5000);
    expect(quote.rate).toBe(88);
    expect(quote.currency.code).toBe("USD");
  });
});

describe("display", () => {
  it("indexes the rate table by code", () => {
    const map = currencyMap([usd, jpy, inr]);
    expect(map.get("USD")?.rate_to_base).toBe(88);
    expect(map.has("EUR")).toBe(false);
  });

  it("never throws on an unknown currency code", () => {
    const made_up = currency({ code: "ZZZ", rate_to_base: 2, symbol: "Z" });
    expect(() => formatIn(10, made_up)).not.toThrow();
    expect(formatIn(10, null)).toBe("10.00");
  });

  it("shows a currency without minor units to no decimal places", () => {
    expect(formatIn(1240, jpy)).not.toContain(".");
  });
});
