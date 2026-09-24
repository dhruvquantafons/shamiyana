import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { daysBetween, isIsoDate, todayIn } from "../../../../lib/dates";
import { payrollSummary, toCsv } from "../../../../lib/hr";
import type { AttendanceRecord, Department, LeaveRequest, ShiftType, StaffShift } from "../../../../lib/types";

/**
 * Payroll export (SOW Module 12: "export-ready data for payroll systems").
 * GET /admin/hr/export?from=yyyy-mm-dd&to=yyyy-mm-dd → CSV.
 */
export async function GET(request: Request) {
  const session = await requirePermission("hr.export");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to) || to < from || daysBetween(from, to) > 92) {
    return new Response("Choose a period of up to three months.", { status: 400 });
  }

  const supabase = await createClient();
  const settings = await getSettings();
  const [{ data: staff }, { data: depts }, { data: attendance }, { data: shifts }, { data: types }, { data: leave }] = await Promise.all([
    supabase.from("staff").select("id, full_name, employee_code, job_title, department_id").eq("is_active", true).order("full_name"),
    supabase.from("departments").select("*"),
    supabase.from("attendance").select("*").gte("work_date", from).lte("work_date", to),
    supabase.from("staff_shifts").select("*").gte("shift_date", from).lte("shift_date", to),
    supabase.from("shift_types").select("*"),
    supabase.from("leave_requests").select("*").eq("status", "approved").lte("start_date", to).gte("end_date", from),
  ]);
  const deptName = new Map(((depts ?? []) as Department[]).map((d) => [d.id, d.name]));

  const rows = payrollSummary({
    staff: (staff ?? []).map((s) => ({ ...s, department: s.department_id ? deptName.get(s.department_id) : "" })),
    from,
    to,
    today: todayIn(settings.timezone),
    timeZone: settings.timezone,
    graceMinutes: settings.hr_late_grace_minutes,
    attendance: (attendance ?? []) as AttendanceRecord[],
    shifts: (shifts ?? []) as StaffShift[],
    shiftTypes: (types ?? []) as ShiftType[],
    leave: (leave ?? []) as LeaveRequest[],
  });

  const csv = toCsv([
    ["Employee ID", "Name", "Department", "Designation", "Period from", "Period to", "Shifts rostered", "Days present",
      "Hours worked", "Late arrivals", "Absent days", "Casual leave", "Sick leave", "Earned leave", "Unpaid leave", "Other leave"],
    ...rows.map((r) => [
      r.employee_code, r.name, r.department, r.designation, from, to, r.scheduled_shifts, r.days_present, r.hours_worked,
      r.late_arrivals, r.absent_days, r.leave.casual, r.leave.sick, r.leave.earned, r.leave.unpaid, r.leave.other,
    ]),
  ]);

  await supabase.rpc("log_event", {
    p_module: "hr",
    p_action: "payroll_export",
    p_record_id: `${from}..${to}`,
    p_summary: `Payroll data exported for ${from} to ${to} (${rows.length} staff) by ${session.staff.full_name || session.staff.email}`,
  });

  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
