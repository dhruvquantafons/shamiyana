import { describe, expect, it } from "vitest";
import { PAGE_SIZE, clampPage, outOfRange, pageHref, pageList, pageParam, pageRange } from "../app/admin/components/paging";

describe("pageParam", () => {
  it("reads a positive page number", () => {
    expect(pageParam("3")).toBe(3);
  });
  it("falls back to page 1 for anything else", () => {
    for (const v of [undefined, "", "0", "-2", "abc", "Infinity"]) expect(pageParam(v)).toBe(1);
  });
  it("drops a fraction", () => {
    expect(pageParam("2.7")).toBe(2);
  });
});

describe("pageRange", () => {
  it("gives inclusive offsets for Supabase .range()", () => {
    expect(pageRange(1)).toEqual([0, PAGE_SIZE - 1]);
    expect(pageRange(3, 10)).toEqual([20, 29]);
  });
});

describe("clampPage", () => {
  it("keeps a page that exists", () => {
    expect(clampPage(2, 60, 25)).toBe(2);
  });
  it("pulls a page past the end back to the last page", () => {
    expect(clampPage(9, 60, 25)).toBe(3);
  });
  it("is page 1 for an empty list", () => {
    expect(clampPage(4, 0)).toBe(1);
  });
});

describe("outOfRange", () => {
  it("recognises PostgREST's range-not-satisfiable error only", () => {
    expect(outOfRange({ code: "PGRST103" })).toBe(true);
    expect(outOfRange({ code: "42501" })).toBe(false);
    expect(outOfRange(null)).toBe(false);
  });
});

describe("pageHref", () => {
  it("keeps filters, drops empty ones, and omits page 1", () => {
    expect(pageHref("/admin/bookings", { status: "confirmed", q: "" }, 1)).toBe("/admin/bookings?status=confirmed");
    expect(pageHref("/admin/bookings", { status: null, q: "203" }, 4)).toBe("/admin/bookings?q=203&page=4");
  });
  it("never carries a stale page param from the filters", () => {
    expect(pageHref("/admin/guests", { page: "7" }, 2)).toBe("/admin/guests?page=2");
    expect(pageHref("/admin/guests", {}, 1)).toBe("/admin/guests");
  });
});

describe("pageList", () => {
  it("lists every page when there are few", () => {
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4]);
  });
  it("collapses distant pages into gaps", () => {
    expect(pageList(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });
  it("fills a one-page gap with the page instead of an ellipsis", () => {
    expect(pageList(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
  });
  it("handles the first and last page", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 8)).toEqual([1, 2, "gap", 8]);
    expect(pageList(8, 8)).toEqual([1, "gap", 7, 8]);
  });
});
