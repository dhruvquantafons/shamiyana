import { describe, it, expect } from "vitest";
import {
  REPORTS,
  bookingKpis,
  daysInRange,
  describeRange,
  exportFilename,
  kpisFrom,
  proratedOperatingCost,
  repeatGuestRatio,
  reportByKind,
  reportsFor,
  resolveRange,
  toGrid,
  type BookingRow,
  type DailyRow,
} from "../app/lib/reports";

/** Module 13 — the hotel KPIs and the date ranges behind every report. */

const day = (d: Partial<DailyRow> & Pick<DailyRow, "day">): DailyRow => ({
  source: "audit",
  rooms_available: 10,
  rooms_sold: 0,
  room_revenue: 0,
  other_revenue: 0,
  tax_total: 0,
  total_revenue: 0,
  ...d,
});

describe("core KPIs", () => {
  const rows = [
    day({ day: "2026-09-01", rooms_available: 10, rooms_sold: 5, room_revenue: 25000, total_revenue: 30000 }),
    day({ day: "2026-09-02", rooms_available: 10, rooms_sold: 8, room_revenue: 44000, total_revenue: 52000 }),
  ];

  it("divides ADR by rooms sold and RevPAR by rooms available", () => {
    const k = kpisFrom(rows);
    expect(k.roomsSold).toBe(13);
    expect(k.availableRoomNights).toBe(20);
    expect(k.adr).toBe(5307.69); // 69,000 / 13
    expect(k.revpar).toBe(3450); // 69,000 / 20
  });

  it("keeps RevPAR equal to ADR times occupancy", () => {
    const k = kpisFrom(rows);
    expect(k.revpar).toBeCloseTo(k.adr * (k.occupancy / 100), 0);
  });

  it("reports occupancy to one decimal", () => {
    expect(kpisFrom(rows).occupancy).toBe(65);
    expect(kpisFrom([day({ day: "2026-09-01", rooms_available: 3, rooms_sold: 1 })]).occupancy).toBe(33.3);
  });

  it("adds the revenue columns up", () => {
    const k = kpisFrom([
      day({ day: "2026-09-01", room_revenue: 1000, other_revenue: 500, tax_total: 75, total_revenue: 1575 }),
    ]);
    expect(k.roomRevenue).toBe(1000);
    expect(k.otherRevenue).toBe(500);
    expect(k.taxTotal).toBe(75);
    expect(k.totalRevenue).toBe(1575);
  });

  it("does not divide by zero on a hotel with no rooms", () => {
    const k = kpisFrom([day({ day: "2026-09-01", rooms_available: 0, rooms_sold: 0 })]);
    expect(k.occupancy).toBe(0);
    expect(k.adr).toBe(0);
    expect(k.revpar).toBe(0);
    expect(k.goppar).toBeNull();
  });

  it("is all zeroes for an empty range", () => {
    const k = kpisFrom([]);
    expect(k.days).toBe(0);
    expect(k.totalRevenue).toBe(0);
    expect(k.auditedDays).toBe(0);
  });

  it("counts how many days are closed by a night audit", () => {
    const k = kpisFrom([day({ day: "2026-09-01" }), day({ day: "2026-09-02", source: "live" })]);
    expect(k.auditedDays).toBe(1);
    expect(k.days).toBe(2);
  });
});

describe("GOPPAR and the operating cost", () => {
  it("prorates the monthly cost over the days reported", () => {
    // 304,400 a month is 10,000 a day at 30.44 days.
    expect(proratedOperatingCost(304_400, 1)).toBe(10000);
    expect(proratedOperatingCost(304_400, 7)).toBe(70000);
  });

  it("is not reported at all when no cost has been entered", () => {
    expect(proratedOperatingCost(0, 30)).toBeNull();
    const k = kpisFrom([day({ day: "2026-09-01", rooms_available: 10, total_revenue: 50000 })]);
    expect(k.goppar).toBeNull();
    expect(k.operatingCost).toBeNull();
  });

  it("takes the cost off revenue before dividing by available rooms", () => {
    const k = kpisFrom([day({ day: "2026-09-01", rooms_available: 10, total_revenue: 50000 })], 304_400);
    // (50,000 − 10,000) / 10
    expect(k.operatingCost).toBe(10000);
    expect(k.goppar).toBe(4000);
  });

  it("goes negative on a day that lost money, rather than clamping", () => {
    const k = kpisFrom([day({ day: "2026-09-01", rooms_available: 10, total_revenue: 1000 })], 304_400);
    expect(k.goppar).toBe(-900);
  });

  it("is always at or below RevPAR once a cost is set", () => {
    const rows = [day({ day: "2026-09-01", rooms_available: 10, rooms_sold: 6, room_revenue: 60000, total_revenue: 60000 })];
    const k = kpisFrom(rows, 60_880);
    expect(k.goppar!).toBeLessThan(k.revpar);
  });
});

describe("booking KPIs", () => {
  const rows: BookingRow[] = [
    { source: "website", bookings: 80, room_nights: 200, cancelled: 8, no_shows: 4, revenue: 400000 },
    { source: "ota", bookings: 20, room_nights: 40, cancelled: 2, no_shows: 1, revenue: 90000 },
  ];

  it("reports cancellation and no-show rates over all bookings", () => {
    const k = bookingKpis(rows);
    expect(k.bookings).toBe(100);
    expect(k.cancellationRate).toBe(10);
    expect(k.noShowRate).toBe(5);
    expect(k.roomNights).toBe(240);
  });

  it("does not divide by zero with no bookings", () => {
    const k = bookingKpis([]);
    expect(k.cancellationRate).toBe(0);
    expect(k.noShowRate).toBe(0);
  });
});

describe("repeat guest ratio", () => {
  it("is repeat guests over distinct guests", () => {
    expect(repeatGuestRatio(50, 12)).toBe(24);
  });

  it("is zero when nobody stayed", () => {
    expect(repeatGuestRatio(0, 0)).toBe(0);
  });
});

describe("date ranges", () => {
  const today = "2026-09-22";

  it("resolves the everyday presets", () => {
    expect(resolveRange("today", today)).toEqual({ from: "2026-09-22", to: "2026-09-22" });
    expect(resolveRange("yesterday", today)).toEqual({ from: "2026-09-21", to: "2026-09-21" });
    expect(resolveRange("last7", today)).toEqual({ from: "2026-09-16", to: "2026-09-22" });
    expect(resolveRange("last30", today)).toEqual({ from: "2026-08-24", to: "2026-09-22" });
    expect(resolveRange("this_month", today)).toEqual({ from: "2026-09-01", to: "2026-09-22" });
  });

  it("gives last month its own full length", () => {
    expect(resolveRange("last_month", "2026-09-22")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(resolveRange("last_month", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // A leap February.
    expect(resolveRange("last_month", "2028-03-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("rolls last month back across a year boundary", () => {
    expect(resolveRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("starts the financial year on 1 April, matching invoice numbering", () => {
    expect(resolveRange("this_financial_year", "2026-09-22").from).toBe("2026-04-01");
    expect(resolveRange("this_financial_year", "2026-03-31").from).toBe("2025-04-01");
    expect(resolveRange("this_financial_year", "2026-04-01").from).toBe("2026-04-01");
  });

  it("crosses a month boundary correctly on last 7 days", () => {
    // 7 days inclusive of today: 25, 26, 27, 28 Feb then 1, 2, 3 March.
    expect(resolveRange("last7", "2026-03-03")).toEqual({ from: "2026-02-25", to: "2026-03-03" });
    expect(daysInRange("2026-02-25", "2026-03-03")).toBe(7);
  });

  it("accepts a custom range and swaps it if it was entered backwards", () => {
    expect(resolveRange("custom", today, "2026-01-01", "2026-01-31")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(resolveRange("custom", today, "2026-01-31", "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("falls back to this month on a malformed custom range", () => {
    expect(resolveRange("custom", today, "nonsense", "")).toEqual({ from: "2026-09-01", to: "2026-09-22" });
  });

  it("counts days inclusively", () => {
    expect(daysInRange("2026-09-22", "2026-09-22")).toBe(1);
    expect(daysInRange("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInRange("2026-02-01", "2026-03-01")).toBe(29);
  });

  it("describes a single day as itself", () => {
    expect(describeRange("2026-09-22", "2026-09-22")).toBe("2026-09-22");
    expect(describeRange("2026-09-01", "2026-09-22")).toContain("to");
  });
});

describe("the report catalogue", () => {
  it("knows every report by kind", () => {
    for (const r of REPORTS) expect(reportByKind(r.kind)?.label).toBe(r.label);
    expect(reportByKind("nope")).toBeNull();
  });

  it("gives every report a database function and at least one column", () => {
    for (const r of REPORTS) {
      expect(r.fn).toMatch(/^report_/);
      expect(r.columns.length).toBeGreaterThan(0);
    }
  });

  it("hides financial reports from someone who may only see operations", () => {
    const operational = reportsFor({ financial: false, view: true });
    expect(operational.every((r) => !r.financial)).toBe(true);
    expect(operational.map((r) => r.kind)).toContain("housekeeping");
    expect(operational.map((r) => r.kind)).not.toContain("tax_summary");
  });

  it("gives finance everything", () => {
    expect(reportsFor({ financial: true, view: true })).toHaveLength(REPORTS.length);
  });

  it("gives someone with no reporting permission nothing", () => {
    expect(reportsFor({ financial: false, view: false })).toHaveLength(0);
  });

  it("marks the money reports as financial and the rest as not", () => {
    expect(reportByKind("tax_summary")?.financial).toBe(true);
    expect(reportByKind("outlet_sales")?.financial).toBe(true);
    expect(reportByKind("outstanding")?.financial).toBe(true);
    expect(reportByKind("housekeeping")?.financial).toBe(false);
    expect(reportByKind("attendance")?.financial).toBe(false);
  });

  it("marks outstanding money as not date-ranged, since it is owed now", () => {
    expect(reportByKind("outstanding")?.ranged).toBe(false);
    expect(reportByKind("daily_revenue")?.ranged).toBe(true);
  });
});

describe("turning rows into a grid for export", () => {
  const definition = reportByKind("tax_summary")!;

  it("uses the column order, so the export matches the screen", () => {
    const grid = toGrid(definition, [
      { rate: 5, net: 1000, tax: 50, entries: 3 },
      { rate: 18, net: 800, tax: 144, entries: 1 },
    ]);
    expect(grid.header).toEqual(["Rate %", "Taxable value", "Tax", "Charges"]);
    expect(grid.body).toEqual([
      [5, 1000, 50, 3],
      [18, 800, 144, 1],
    ]);
  });

  it("renders a missing value as blank rather than 'null'", () => {
    const grid = toGrid(definition, [{ rate: 5, net: 1000, tax: null, entries: undefined }]);
    expect(grid.body[0]).toEqual([5, 1000, "", ""]);
  });

  it("copes with no rows", () => {
    expect(toGrid(definition, []).body).toEqual([]);
  });

  it("names the download after the report and its range", () => {
    expect(exportFilename("tax_summary", "2026-09-01", "2026-09-30")).toBe("tax_summary_2026-09-01_2026-09-30.csv");
    expect(exportFilename("outstanding", "2026-09-22", "2026-09-22")).toBe("outstanding_2026-09-22.csv");
  });
});
