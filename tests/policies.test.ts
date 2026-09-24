import { describe, expect, it } from "vitest";
import { splitRoomTax, parseTaxSlabs } from "../app/lib/tax";
import {
  cancellationPenalty,
  noShowPenalty,
  timingFee,
  folioTotals,
  isEarly,
  isLate,
} from "../app/lib/policies";
import { rankRooms, type AssignableRoom } from "../app/lib/room-assignment";
import { passwordProblems, describePasswordProblems, passwordExpired, isLockedOut } from "../app/lib/password-policy";
import { eachNight, addDays, zonedTime, daysBetween } from "../app/lib/dates";

const GST = [
  { up_to: 7500, rate: 5 },
  { up_to: null, rate: 18 },
];

describe("splitRoomTax", () => {
  it("takes 18% out of an inclusive rate above the ₹7,500 slab", () => {
    // 9499 / 1.18 = 8050 > 7500
    expect(splitRoomTax(9499, GST, true)).toEqual({ net: 8050, tax: 1449, rate: 18 });
  });

  it("takes 5% out of an inclusive rate within the lower slab", () => {
    // 6300 / 1.05 = 6000 ≤ 7500
    expect(splitRoomTax(6300, GST, true)).toEqual({ net: 6000, tax: 300, rate: 5 });
  });

  it("finds the slab from the net value, not the gross, when inclusive", () => {
    // 7800 gross is 7428.57 net at 5%, so it stays in the lower slab.
    expect(splitRoomTax(7800, GST, true).rate).toBe(5);
  });

  it("adds tax on top when prices are exclusive", () => {
    expect(splitRoomTax(8000, GST, false)).toEqual({ net: 8000, tax: 1440, rate: 18 });
    expect(splitRoomTax(7500, GST, false)).toEqual({ net: 7500, tax: 375, rate: 5 });
  });

  it("never charges tax on nothing, and survives bad configuration", () => {
    expect(splitRoomTax(0, GST, true).tax).toBe(0);
    expect(parseTaxSlabs("nonsense")).toEqual([]);
    expect(parseTaxSlabs([{ up_to: "x", rate: 5 }, { up_to: null, rate: 18 }])).toEqual([
      { up_to: null, rate: 18 },
    ]);
  });
});

const plan = {
  is_refundable: true,
  free_cancellation_hours: 48,
  cancellation_penalty: "first_night" as const,
  cancellation_penalty_percent: 0,
  no_show_penalty: "full_stay" as const,
  no_show_penalty_percent: 0,
};
const nights = [
  { date: "2026-10-05", rate: 9000 },
  { date: "2026-10-06", rate: 10000 },
];

describe("penalties", () => {
  it("is free outside the window and charges the first night inside it", () => {
    expect(cancellationPenalty(plan, nights, 1, 72).amount).toBe(0);
    expect(cancellationPenalty(plan, nights, 1, 24).amount).toBe(9000);
    expect(cancellationPenalty(plan, nights, 2, 24).amount).toBe(18000);
  });

  it("always charges on a non-refundable rate", () => {
    const nrf = { ...plan, is_refundable: false, cancellation_penalty: "full_stay" as const };
    expect(cancellationPenalty(nrf, nights, 1, 500).amount).toBe(19000);
  });

  it("charges a percentage when configured", () => {
    const pct = { ...plan, cancellation_penalty: "percent" as const, cancellation_penalty_percent: 25 };
    expect(cancellationPenalty(pct, nights, 1, 1).amount).toBe(4750);
  });

  it("charges the no-show policy", () => {
    expect(noShowPenalty(plan, nights, 1).amount).toBe(19000);
    expect(noShowPenalty(null, nights, 1).amount).toBe(0);
  });
});

describe("early / late fees", () => {
  it("computes percent and flat fees", () => {
    expect(timingFee("percent", 50, 9499)).toBe(4749.5);
    expect(timingFee("flat", 1500, 9499)).toBe(1500);
    expect(timingFee("none", 50, 9499)).toBe(0);
  });

  it("compares wall-clock times", () => {
    expect(isEarly("09:30", "14:00:00")).toBe(true);
    expect(isEarly("14:00", "14:00")).toBe(false);
    expect(isLate("15:10", "12:00")).toBe(true);
    expect(isLate("11:59", "12:00")).toBe(false);
  });
});

describe("folioTotals", () => {
  it("adds charges and tax, subtracts payments, ignores voids", () => {
    const totals = folioTotals([
      { kind: "room", amount: 8050, tax_amount: 1449, voided_at: null, is_deposit: false },
      { kind: "fee", amount: 1000, tax_amount: 0, voided_at: null, is_deposit: false },
      { kind: "payment", amount: 5000, tax_amount: 0, voided_at: null, is_deposit: true },
      { kind: "payment", amount: 999, tax_amount: 0, voided_at: "2026-10-05T10:00:00Z", is_deposit: false },
      { kind: "refund", amount: 100, tax_amount: 0, voided_at: null, is_deposit: false },
    ]);
    expect(totals).toEqual({ charges: 9150, tax: 1449, payments: 5000, deposits: 5000, balance: 5599 });
  });
});

const room = (over: Partial<AssignableRoom>): AssignableRoom => ({
  id: over.room_number ?? "x",
  room_number: "101",
  room_type_id: "premier",
  floor: 1,
  view: "",
  status: "available",
  housekeeping_status: "inspected",
  is_accessible: false,
  is_smoking: false,
  max_adults: null,
  ...over,
});

describe("rankRooms", () => {
  const request = {
    roomTypeId: "premier",
    checkIn: "2026-10-05",
    checkOut: "2026-10-07",
    adults: 2,
    preferredFloor: 3,
    preferredView: "river",
    isVip: false,
    forImmediateCheckIn: true,
  };

  it("only offers vacant, inspected, unblocked rooms of the booked type", () => {
    const rooms = [
      room({ room_number: "101" }),
      room({ room_number: "102", housekeeping_status: "clean" }),
      room({ room_number: "103", status: "occupied" }),
      room({ room_number: "104" }),
      room({ room_number: "105" }),
      room({ room_number: "201", room_type_id: "luxury" }),
    ];
    const { ranked, ineligible } = rankRooms(
      request,
      rooms,
      [{ room_id: "104", check_in: "2026-10-06", check_out: "2026-10-08" }],
      [{ room_id: "105", start_date: "2026-10-06", end_date: "2026-10-06" }],
    );
    expect(ranked.map((r) => r.room.room_number)).toEqual(["101"]);
    expect(ineligible.map((i) => i.room.room_number).sort()).toEqual(["102", "103", "104", "105"]);
  });

  it("does not treat a stay ending on arrival day as a clash", () => {
    const { ranked } = rankRooms(
      request,
      [room({ room_number: "101" })],
      [{ room_id: "101", check_in: "2026-10-03", check_out: "2026-10-05" }],
      [],
    );
    expect(ranked).toHaveLength(1);
  });

  it("ranks the requested floor and view first", () => {
    const { ranked } = rankRooms(
      request,
      [
        room({ room_number: "101", floor: 1 }),
        room({ room_number: "301", floor: 3 }),
        room({ room_number: "302", floor: 3, view: "River view" }),
      ],
      [],
      [],
    );
    expect(ranked.map((r) => r.room.room_number)).toEqual(["302", "301", "101"]);
  });

  it("allows future assignment of a room that is not yet cleaned", () => {
    const { ranked } = rankRooms(
      { ...request, forImmediateCheckIn: false },
      [room({ room_number: "101", housekeeping_status: "dirty", status: "occupied" })],
      [],
      [],
    );
    expect(ranked).toHaveLength(1);
  });
});

describe("password policy", () => {
  const policy = { minLength: 10, maxAgeDays: 90 };
  it("requires length and mixed character classes", () => {
    expect(passwordProblems("short", policy)).toContain("at least 10 characters");
    expect(passwordProblems("Shamiyana#Srinagar2026", policy)).toEqual([]);
    expect(passwordProblems("riviera#srinagar2026", policy)).toContain("an uppercase letter");
    const problems = passwordProblems("Asha#Admin2026", policy, "asha@x.test");
    expect(describePasswordProblems(problems)).toBe(
      "It must not contain “asha”, which is part of the email address — choose something harder to guess.",
    );
    expect(describePasswordProblems(passwordProblems("short", policy, "asha@x.test"))).toMatch(/^The password needs at least 10 characters/);
  });

  it("expires after the maximum age, and never when the age is 0", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(passwordExpired("2026-06-01T00:00:00Z", 90, now)).toBe(true);
    expect(passwordExpired("2026-09-01T00:00:00Z", 90, now)).toBe(false);
    expect(passwordExpired("2020-01-01T00:00:00Z", 0, now)).toBe(false);
  });

  it("locks out after repeated failures in the window, reset by a success", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const at = (min: number, ok = false) => ({
      attempted_at: new Date(now.getTime() - min * 60000).toISOString(),
      succeeded: ok,
    });
    expect(isLockedOut([at(1), at(2), at(3), at(4), at(5)], 5, 15, now)).toBe(true);
    expect(isLockedOut([at(1), at(2), at(3), at(4), at(20)], 5, 15, now)).toBe(false);
    expect(isLockedOut([at(1), at(2), at(3, true), at(4), at(5)], 5, 15, now)).toBe(false);
  });
});

describe("dates", () => {
  it("lists nights and adds days across month ends", () => {
    expect(eachNight("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(eachNight("", "2026-11-02")).toEqual([]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-05", "2026-10-07")).toBe(2);
  });

  it("finds 14:00 India time as 08:30 UTC", () => {
    expect(zonedTime("2026-10-05", "14:00", "Asia/Kolkata").toISOString()).toBe("2026-10-05T08:30:00.000Z");
  });
});
