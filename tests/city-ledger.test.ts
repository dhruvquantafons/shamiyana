import { describe, it, expect } from "vitest";
import {
  accountBalance,
  agingOf,
  agingTotals,
  bucketFor,
  creditCheck,
  emptyAging,
  openCharges,
  overdueFirst,
  totalCharged,
  totalCredited,
} from "../app/lib/city-ledger";
import type { CityLedgerEntry, CityLedgerKind } from "../app/lib/types";

/** Module 7 — the city ledger's balance and aging arithmetic. */

let seq = 0;
const entry = (kind: CityLedgerKind, amount: number, e: Partial<CityLedgerEntry> = {}): CityLedgerEntry => ({
  id: `e${++seq}`,
  company_id: "c1",
  kind,
  amount,
  description: "",
  booking_id: null,
  folio_id: null,
  invoice_id: null,
  folio_entry_id: null,
  due_date: null,
  method: kind === "payment" ? "bank_transfer" : null,
  reference: "",
  voided_at: null,
  void_reason: "",
  created_at: "2026-09-01T10:00:00.000Z",
  ...e,
});

const charge = (amount: number, due: string, e: Partial<CityLedgerEntry> = {}) =>
  entry("charge", amount, { due_date: due, ...e });

describe("account balance", () => {
  it("is charges less every kind of credit", () => {
    const entries = [
      charge(10000, "2026-09-30"),
      charge(5000, "2026-10-15"),
      entry("payment", 6000),
      entry("adjustment", 1000),
      entry("writeoff", 500),
    ];
    expect(accountBalance(entries)).toBe(7500);
    expect(totalCharged(entries)).toBe(15000);
    expect(totalCredited(entries)).toBe(7500);
  });

  it("ignores voided entries on both sides", () => {
    const entries = [
      charge(10000, "2026-09-30"),
      charge(4000, "2026-09-30", { voided_at: "2026-09-05T00:00:00.000Z" }),
      entry("payment", 2000, { voided_at: "2026-09-06T00:00:00.000Z" }),
    ];
    expect(accountBalance(entries)).toBe(10000);
  });

  it("goes negative when a company overpays", () => {
    expect(accountBalance([charge(1000, "2026-09-30"), entry("payment", 1500)])).toBe(-500);
  });

  it("is zero for an account that has never been used", () => {
    expect(accountBalance([])).toBe(0);
    expect(agingOf([], "2026-10-01")).toEqual(emptyAging());
  });
});

describe("aging buckets", () => {
  it("puts a charge in the bucket its due date earns", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
    expect(bucketFor(1)).toBe("1-30");
    expect(bucketFor(30)).toBe("1-30");
    expect(bucketFor(31)).toBe("31-60");
    expect(bucketFor(60)).toBe("31-60");
    expect(bucketFor(61)).toBe("61-90");
    expect(bucketFor(90)).toBe("61-90");
    expect(bucketFor(91)).toBe("90+");
  });

  it("ages each open charge from its own due date", () => {
    const aging = agingOf(
      [
        charge(1000, "2026-11-30"), // not yet due
        charge(2000, "2026-10-20"), // 12 days over
        charge(3000, "2026-09-01"), // 61 days over
        charge(4000, "2026-06-01"), // 153 days over
      ],
      "2026-11-01",
    );
    expect(aging.current).toBe(1000);
    expect(aging["1-30"]).toBe(2000);
    expect(aging["61-90"]).toBe(3000);
    expect(aging["90+"]).toBe(4000);
    expect(aging.total).toBe(10000);
  });
});

describe("applying credits oldest first", () => {
  it("clears the oldest charge before touching the next", () => {
    const entries = [charge(1000, "2026-09-01"), charge(2000, "2026-10-01"), entry("payment", 1200)];
    const open = openCharges(entries, "2026-11-01");
    expect(open).toHaveLength(1);
    expect(open[0].entry.due_date).toBe("2026-10-01");
    expect(open[0].outstanding).toBe(1800);
  });

  it("moves overdue money out of the aging report as it is paid", () => {
    const charges = [charge(5000, "2026-09-01"), charge(5000, "2026-10-25")];
    const before = agingOf(charges, "2026-11-01");
    expect(before["90+"]).toBe(0);
    expect(before["61-90"]).toBe(5000);
    expect(before["1-30"]).toBe(5000);

    const after = agingOf([...charges, entry("payment", 5000)], "2026-11-01");
    expect(after["61-90"]).toBe(0);
    expect(after["1-30"]).toBe(5000);
    expect(after.total).toBe(5000);
  });

  it("leaves nothing open when credits cover everything", () => {
    const entries = [charge(1000, "2026-09-01"), charge(2000, "2026-10-01"), entry("payment", 4000)];
    expect(openCharges(entries, "2026-11-01")).toHaveLength(0);
    expect(agingOf(entries, "2026-11-01").total).toBe(0);
  });

  it("orders undated charges by when they were raised", () => {
    const open = openCharges(
      [
        entry("charge", 100, { created_at: "2026-09-20T10:00:00.000Z" }),
        entry("charge", 200, { created_at: "2026-09-10T10:00:00.000Z" }),
        entry("payment", 200),
      ],
      "2026-10-01",
    );
    expect(open).toHaveLength(1);
    expect(open[0].outstanding).toBe(100);
  });

  it("adds accounts up across the property", () => {
    const a = agingOf([charge(1000, "2026-10-20")], "2026-11-01");
    const b = agingOf([charge(2500, "2026-06-01")], "2026-11-01");
    const total = agingTotals([a, b]);
    expect(total["1-30"]).toBe(1000);
    expect(total["90+"]).toBe(2500);
    expect(total.total).toBe(3500);
  });

  it("sorts the chase list by how much is overdue, not how much is owed", () => {
    const big = { name: "Big", aging: { ...emptyAging(), current: 90000, total: 90000 } };
    const late = { name: "Late", aging: { ...emptyAging(), "90+": 4000, total: 4000 } };
    expect(overdueFirst([big, late]).map((r) => r.name)).toEqual(["Late", "Big"]);
  });
});

describe("credit limit", () => {
  const company = { name: "Dal Travels", credit_limit: 50000, is_active: true };

  it("allows a charge that stays within the limit", () => {
    const check = creditCheck(company, 30000, 15000);
    expect(check.allowed).toBe(true);
    expect(check.projected).toBe(45000);
  });

  it("allows a charge that lands exactly on the limit", () => {
    expect(creditCheck(company, 30000, 20000).allowed).toBe(true);
  });

  it("refuses a charge that would go over, and says by how much", () => {
    const check = creditCheck(company, 45000, 10000);
    expect(check.allowed).toBe(false);
    expect(check.projected).toBe(55000);
    expect(check.reason).toContain("50000.00");
  });

  it("treats no limit as unlimited", () => {
    expect(creditCheck({ ...company, credit_limit: null }, 900000, 100000).allowed).toBe(true);
  });

  it("refuses a closed account whatever the limit", () => {
    const check = creditCheck({ ...company, is_active: false }, 0, 100);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("closed");
  });
});
