import { describe, expect, it } from "vitest";
import { lateMinutes, leaveDaysIn, payrollSummary, shiftHours, shiftLabel, toCsv, workedHours } from "../app/lib/hr";
import { mondayOf } from "../app/lib/dates";
import type { AttendanceRecord, LeaveRequest, ShiftType, StaffShift } from "../app/lib/types";

const shift = (over: Partial<ShiftType>): ShiftType => ({
  id: "m",
  name: "Morning",
  start_time: "07:00:00",
  end_time: "15:00:00",
  start_time_2: null,
  end_time_2: null,
  color: "yellow",
  sort_order: 1,
  is_active: true,
  ...over,
});

describe("shifts", () => {
  it("measures day, overnight and split shifts", () => {
    expect(shiftHours(shift({}))).toBe(8);
    expect(shiftHours(shift({ start_time: "23:00", end_time: "07:00" }))).toBe(8);
    expect(shiftHours(shift({ start_time: "07:00", end_time: "11:00", start_time_2: "17:00", end_time_2: "21:00" }))).toBe(8);
    expect(shiftLabel(shift({ start_time: "07:00:00", end_time: "11:00:00", start_time_2: "17:00:00", end_time_2: "21:00:00" }))).toBe(
      "07:00–11:00, 17:00–21:00",
    );
  });

  it("counts lateness against the shift start in hotel time", () => {
    // 07:12 in Kolkata is 01:42 UTC.
    expect(lateMinutes("2026-09-19T01:42:00Z", "2026-09-19", shift({}), "Asia/Kolkata")).toBe(12);
    expect(lateMinutes("2026-09-19T01:25:00Z", "2026-09-19", shift({}), "Asia/Kolkata")).toBe(-5);
  });

  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-09-19")).toBe("2026-09-14");
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
  });
});

describe("attendance", () => {
  it("adds closed records and ignores open ones", () => {
    expect(
      workedHours([
        { clock_in: "2026-09-19T01:30:00Z", clock_out: "2026-09-19T09:45:00Z" },
        { clock_in: "2026-09-20T01:30:00Z", clock_out: null },
      ]),
    ).toBe(8.25);
  });

  it("clips leave to the period", () => {
    expect(leaveDaysIn({ start_date: "2026-08-30", end_date: "2026-09-02" }, "2026-09-01", "2026-09-30")).toEqual(["2026-09-01", "2026-09-02"]);
    expect(leaveDaysIn({ start_date: "2026-10-01", end_date: "2026-10-02" }, "2026-09-01", "2026-09-30")).toEqual([]);
  });
});

describe("payrollSummary", () => {
  const rec = (date: string, inUtc: string, outUtc: string | null): AttendanceRecord => ({
    id: date,
    staff_id: "a",
    work_date: date,
    clock_in: `${date}T${inUtc}Z`,
    clock_out: outUtc ? `${date}T${outUtc}Z` : null,
    method: "self",
    in_distance_m: null,
    out_distance_m: null,
    notes: "",
    recorded_by: null,
    created_at: "",
  });
  const rostered = (date: string, type: string | null = "m"): StaffShift => ({ id: date, staff_id: "a", shift_date: date, shift_type_id: type, notes: "" });
  const leave: LeaveRequest = {
    id: "l",
    staff_id: "a",
    kind: "sick",
    start_date: "2026-09-17",
    end_date: "2026-09-17",
    reason: "",
    status: "approved",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    created_at: "",
  };

  it("counts presence, hours, lateness, absence and leave", () => {
    const [row] = payrollSummary({
      staff: [{ id: "a", full_name: "Hana", job_title: "Room Attendant", employee_code: "EMP-3" }],
      from: "2026-09-14",
      to: "2026-09-20",
      today: "2026-09-19",
      timeZone: "Asia/Kolkata",
      graceMinutes: 10,
      attendance: [rec("2026-09-14", "01:30:00", "09:30:00"), rec("2026-09-15", "01:50:00", "09:30:00")],
      shifts: [
        rostered("2026-09-14"),
        rostered("2026-09-15"),
        rostered("2026-09-16"),
        rostered("2026-09-17"),
        rostered("2026-09-18", null),
        rostered("2026-09-20"),
      ],
      shiftTypes: [shift({})],
      leave: [leave],
    });
    expect(row).toMatchObject({
      employee_code: "EMP-3",
      scheduled_shifts: 5,
      days_present: 2,
      hours_worked: 15.67,
      // 07:20 on the 15th is past the 10-minute grace.
      late_arrivals: 1,
      // The 16th: rostered, no attendance, no leave. The 20th is still to come.
      absent_days: 1,
    });
    expect(row.leave.sick).toBe(1);
  });
});

describe("toCsv", () => {
  it("quotes and neutralises spreadsheet formulas", () => {
    expect(toCsv([["a,b", 'say "hi"', "=SUM(A1)", 3]])).toBe('"a,b","say ""hi""","\'=SUM(A1)",3');
  });
});
