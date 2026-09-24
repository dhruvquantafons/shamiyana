/**
 * Module 12 calculations: shift lengths, lateness, hours worked and the
 * payroll summary. Pure functions, shared by the HR pages and the export.
 */
import { addDays, eachNight, zonedTime } from "./dates";
import type { AttendanceRecord, LeaveKind, LeaveRequest, ShiftType, StaffShift } from "./types";

type ShiftTimes = Pick<ShiftType, "start_time" | "end_time" | "start_time_2" | "end_time_2">;

const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/** Minutes from start to end, across midnight when the end is earlier. */
const span = (start: string, end: string) => {
  const d = minutesOf(end) - minutesOf(start);
  return d > 0 ? d : d + 24 * 60;
};

export function shiftHours(s: ShiftTimes): number {
  let minutes = span(s.start_time, s.end_time);
  if (s.start_time_2 && s.end_time_2) minutes += span(s.start_time_2, s.end_time_2);
  return minutes / 60;
}

export function shiftLabel(s: ShiftTimes): string {
  const part = (a: string, b: string) => `${a.slice(0, 5)}–${b.slice(0, 5)}`;
  return s.start_time_2 && s.end_time_2
    ? `${part(s.start_time, s.end_time)}, ${part(s.start_time_2, s.end_time_2)}`
    : part(s.start_time, s.end_time);
}

/** Minutes after the shift's start that someone clocked in (negative if early). */
export function lateMinutes(clockIn: string, workDate: string, shift: ShiftTimes, timeZone: string): number {
  const start = zonedTime(workDate, shift.start_time.slice(0, 5), timeZone).getTime();
  return Math.round((new Date(clockIn).getTime() - start) / 60000);
}

/** Hours between clock-in and clock-out; open records count for nothing. */
export function workedHours(records: Pick<AttendanceRecord, "clock_in" | "clock_out">[]): number {
  const ms = records.reduce(
    (sum, r) => sum + (r.clock_out ? Math.max(0, new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime()) : 0),
    0,
  );
  return Math.round((ms / 3600000) * 100) / 100;
}

/** Days of a leave request that fall between from and to, inclusive. */
export function leaveDaysIn(leave: Pick<LeaveRequest, "start_date" | "end_date">, from: string, to: string): string[] {
  const start = leave.start_date > from ? leave.start_date : from;
  const end = leave.end_date < to ? leave.end_date : to;
  return start > end ? [] : eachNight(start, addDays(end, 1));
}

export type DayStatus = "present" | "leave" | "off" | "absent" | "scheduled" | "none";

export interface PayrollStaff {
  id: string;
  full_name: string;
  employee_code?: string | null;
  job_title: string;
  department?: string;
}

export interface PayrollRow {
  staff_id: string;
  employee_code: string;
  name: string;
  department: string;
  designation: string;
  scheduled_shifts: number;
  days_present: number;
  hours_worked: number;
  late_arrivals: number;
  absent_days: number;
  leave: Record<LeaveKind, number>;
}

/**
 * One row per person for a period: what was rostered, attended and taken as
 * approved leave. A rostered day with no attendance and no leave, up to
 * today, is absent.
 */
export function payrollSummary(input: {
  staff: PayrollStaff[];
  from: string;
  to: string;
  today: string;
  timeZone: string;
  graceMinutes: number;
  attendance: AttendanceRecord[];
  shifts: StaffShift[];
  shiftTypes: ShiftType[];
  leave: LeaveRequest[];
}): PayrollRow[] {
  const days = eachNight(input.from, addDays(input.to, 1));
  const typeById = new Map(input.shiftTypes.map((t) => [t.id, t]));

  return input.staff.map((person) => {
    const mine = input.attendance.filter((a) => a.staff_id === person.id && a.work_date >= input.from && a.work_date <= input.to);
    const presentDays = new Set(mine.map((a) => a.work_date));
    const leaveByDay = new Map<string, LeaveKind>();
    for (const l of input.leave) {
      if (l.staff_id !== person.id || l.status !== "approved") continue;
      for (const d of leaveDaysIn(l, input.from, input.to)) leaveByDay.set(d, l.kind);
    }
    const rostered = input.shifts.filter((s) => s.staff_id === person.id && s.shift_type_id && s.shift_date >= input.from && s.shift_date <= input.to);

    let late = 0;
    for (const s of rostered) {
      const type = typeById.get(s.shift_type_id!);
      const first = mine
        .filter((a) => a.work_date === s.shift_date)
        .sort((a, b) => a.clock_in.localeCompare(b.clock_in))[0];
      if (type && first && lateMinutes(first.clock_in, s.shift_date, type, input.timeZone) > input.graceMinutes) late += 1;
    }

    const leave: Record<LeaveKind, number> = { casual: 0, sick: 0, earned: 0, unpaid: 0, other: 0 };
    for (const d of days) {
      const kind = leaveByDay.get(d);
      if (kind) leave[kind] += 1;
    }

    const absent = rostered.filter(
      (s) => s.shift_date <= input.today && !presentDays.has(s.shift_date) && !leaveByDay.has(s.shift_date),
    ).length;

    return {
      staff_id: person.id,
      employee_code: person.employee_code ?? "",
      name: person.full_name,
      department: person.department ?? "",
      designation: person.job_title,
      scheduled_shifts: rostered.length,
      days_present: presentDays.size,
      hours_worked: workedHours(mine),
      late_arrivals: late,
      absent_days: absent,
      leave,
    };
  });
}

/** Comma-separated values, quoted, with spreadsheet formulas neutralised. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) || s !== String(v) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
