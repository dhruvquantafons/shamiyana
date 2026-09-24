import { describe, expect, it } from "vitest";
import {
  displayMoney,
  hasTranslation,
  isConverted,
  isRtl,
  stringsFor,
  type DisplayCurrency,
} from "../app/lib/portal-i18n";

const inr: DisplayCurrency = { code: "INR", symbol: "₹", rate_to_base: 1, decimals: 2 };
// One US dollar buys 83 rupees.
const usd: DisplayCurrency = { code: "USD", symbol: "$", rate_to_base: 83, decimals: 2 };
const jpy: DisplayCurrency = { code: "JPY", symbol: "¥", rate_to_base: 0.55, decimals: 0 };

describe("stringsFor", () => {
  it("gives English by default", () => {
    expect(stringsFor("en").checkIn).toBe("Check-in");
  });

  it("translates a language it knows", () => {
    expect(stringsFor("hi").checkIn).toBe("आगमन");
    expect(stringsFor("ur").checkIn).toBe("آمد");
  });

  it("falls back to English for a language with no translation", () => {
    // The hotel may offer French before anyone has written the French
    // strings; the portal must still be usable rather than blank.
    expect(stringsFor("fr").checkIn).toBe("Check-in");
  });

  it("returns every key even when a translation is partial", () => {
    const en = stringsFor("en");
    const hi = stringsFor("hi");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(hi[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("refuses a language the property has not switched on", () => {
    // Otherwise a hand-typed ?lang= would put the portal into a language the
    // desk cannot answer the phone in.
    expect(stringsFor("hi", ["en", "ur"]).checkIn).toBe("Check-in");
    expect(stringsFor("ur", ["en", "ur"]).checkIn).toBe("آمد");
  });

  it("ignores the enabled list when it is empty", () => {
    expect(stringsFor("hi", []).checkIn).toBe("आगमन");
  });
});

describe("isRtl", () => {
  it("knows which scripts run right to left", () => {
    expect(isRtl("ur")).toBe(true);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("hi")).toBe(false);
  });
});

describe("hasTranslation", () => {
  it("reports what is actually translated", () => {
    expect(hasTranslation("en")).toBe(true);
    expect(hasTranslation("hi")).toBe(true);
    expect(hasTranslation("de")).toBe(false);
  });
});

describe("displayMoney", () => {
  it("shows rupees when no currency is chosen", () => {
    expect(displayMoney(9499, null)).toBe("₹9,499");
  });

  it("leaves the base currency alone", () => {
    expect(displayMoney(9499, inr)).toBe("₹9,499.00");
  });

  it("converts by dividing by the rate to base", () => {
    // 8300 rupees at 83 to the dollar is $100.
    expect(displayMoney(8300, usd)).toBe("$100.00");
  });

  it("honours a currency with no minor unit", () => {
    // Yen is never shown with decimals.
    expect(displayMoney(5500, jpy)).toBe("¥10,000");
  });

  it("falls back to the code when a currency has no symbol", () => {
    const aed: DisplayCurrency = { code: "AED", symbol: "", rate_to_base: 22.6, decimals: 2 };
    expect(displayMoney(2260, aed)).toBe("AED 100.00");
  });

  it("does not divide by zero on a broken rate", () => {
    const broken: DisplayCurrency = { code: "XXX", symbol: "¤", rate_to_base: 0, decimals: 2 };
    expect(displayMoney(1000, broken)).toBe("¤0.00");
  });
});

describe("isConverted", () => {
  it("is true only when the figure is not the property's own money", () => {
    expect(isConverted(usd, "INR")).toBe(true);
    expect(isConverted(inr, "INR")).toBe(false);
    expect(isConverted(null, "INR")).toBe(false);
  });
});
