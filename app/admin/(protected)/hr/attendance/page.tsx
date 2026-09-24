import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can, canAny } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { addDays, isIsoDate, monthStartOf, nowTimeIn, todayIn } from "../../../../lib/dates";
import { lateMinutes, workedHours } from "../../../../lib/hr";
import type { AttendanceRecord, LeaveRequest, ShiftType, StaffShift } from "../../../../lib/types";
import { ATTENDANCE_METHOD_LABELS, LEAVE_KIND_LABELS } from "../../../../lib/types";
import { deleteAttendance, saveAttendance } from "../../../hr-actions";
import { Card, Field, SectionTitle, StatCard, Tag, inputClass, secondaryButtonClass, buttonClass, tableHeadClass, fmtDate } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { HR_STAFF_COLUMNS, type HrStaff } from "../shared";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireAnyPermission(["hr.view", "hr.manage", "hr.export"]);
  const edit = can(session, "hr.manage");
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayIn(tz);
  const params = await searchParams;
  const date = params.date && isIsoDate(params.date) && params.date <= today ? params.date : today;
  const supabase = await createClient();

  const view = canAny(session, ["hr.view", "hr.manage"]);
  const [{ data: staffRows }, { data: records }, { data: shifts }, { data: types }, { data: leave }] = view
    ? await Promise.all([
        supabase.from("staff").select(HR_STAFF_COLUMNS).eq("is_active", true).order("full_name"),
        supabase.from("attendance").select("*").eq("work_date", date).order("clock_in"),
        supabase.from("staff_shifts").select("*").eq("shift_date", date),
        supabase.from("shift_types").select("*"),
        supabase.from("leave_requests").select("staff_id, kind").eq("status", "approved").lte("start_date", date).gte("end_date", date),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const staff = (staffRows ?? []) as HrStaff[];
  const recs = (records ?? []) as AttendanceRecord[];
  const typeById = new Map(((types ?? []) as ShiftType[]).map((t) => [t.id, t]));
  const shiftOf = (id: string) => ((shifts ?? []) as StaffShift[]).find((s) => s.staff_id === id);
  const leaveOf = (id: string) => ((leave ?? []) as Pick<LeaveRequest, "staff_id" | "kind">[]).find((l) => l.staff_id === id);

  const rows = staff.map((p) => {
    const mine = recs.filter((r) => r.staff_id === p.id);
    const shift = shiftOf(p.id);
    const type = shift?.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
    const late = type && mine[0] ? lateMinutes(mine[0].clock_in, date, type, tz) : null;
    const onLeave = leaveOf(p.id);
    const status = mine.length
      ? mine.some((r) => !r.clock_out) ? "in" : "done"
      : onLeave ? "leave" : type ? (date < today ? "absent" : "expected") : shift ? "off" : "none";
    return { p, mine, type, late, onLeave, status };
  });
  const present = rows.filter((r) => r.mine.length).length;
  const expected = rows.filter((r) => r.type).length;
  const absent = rows.filter((r) => r.status === "absent" || r.status === "expected").length;
  const lateCount = rows.filter((r) => r.late !== null && r.late > settings.hr_late_grace_minutes).length;

  const nav = (d: string) => `/admin/hr/attendance?date=${d}`;
  const t = (iso: string | null) => (iso ? nowTimeIn(tz, new Date(iso)) : "");

  return (
    <div className="space-y-6">
      {view && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={nav(addDays(date, -1))} className={secondaryButtonClass} aria-label="Previous day">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <span className="text-sm font-medium text-slate-900 px-2">{fmtDate(date)}</span>
            {date < today && (
              <Link href={nav(addDays(date, 1))} className={secondaryButtonClass} aria-label="Next day">
                <ChevronRight className="w-4 h-4" />
              </Link>
            )}
            {date !== today && (
              <Link href={nav(today)} className="text-xs text-yellow-800 ml-1">
                Today
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Present" value={present} hint={`${expected} rostered`} />
            <StatCard label={date < today ? "Absent" : "Not in yet"} value={absent} />
            <StatCard label="Late" value={lateCount} hint={`over ${settings.hr_late_grace_minutes} min`} />
            <StatCard label="On leave" value={rows.filter((r) => r.onLeave).length} />
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableHeadClass}>
                    <th className="px-4 py-2.5 font-medium">Staff</th>
                    <th className="px-4 py-2.5 font-medium">Shift</th>
                    <th className="px-4 py-2.5 font-medium">In</th>
                    <th className="px-4 py-2.5 font-medium">Out</th>
                    <th className="px-4 py-2.5 font-medium">Hours</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows
                    .filter((r) => r.status !== "none" || r.mine.length)
                    .map(({ p, mine, type, late, onLeave, status }) => (
                      <tr key={p.id} className="align-top">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-slate-900">{p.full_name || p.email}</span>
                          {p.employee_code && <span className="block text-[11px] text-slate-500">{p.employee_code}</span>}
                        </td>
                        <td className="px-4 py-2.5">{type ? type.name : status === "off" ? "Off" : "—"}</td>
                        <td className="px-4 py-2.5">
                          {mine.map((r) => (
                            <span key={r.id} className="block" title={ATTENDANCE_METHOD_LABELS[r.method]}>
                              {t(r.clock_in)}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2.5">
                          {mine.map((r) => (
                            <span key={r.id} className="block">
                              {t(r.clock_out) || "—"}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2.5">{mine.length ? workedHours(mine) : ""}</td>
                        <td className="px-4 py-2.5 space-x-1">
                          {status === "in" && <Tag tone="green">Clocked in</Tag>}
                          {status === "done" && <Tag>Done</Tag>}
                          {status === "leave" && <Tag tone="violet">{onLeave ? LEAVE_KIND_LABELS[onLeave.kind] : "Leave"}</Tag>}
                          {status === "absent" && <Tag tone="red">Absent</Tag>}
                          {status === "expected" && <Tag tone="amber">Not in yet</Tag>}
                          {late !== null && late > settings.hr_late_grace_minutes && <Tag tone="amber">{late} min late</Tag>}
                          {edit &&
                            mine.map((r) => (
                              <details key={r.id} className="mt-1">
                                <summary className="text-xs text-yellow-800 cursor-pointer">Edit {t(r.clock_in)}</summary>
                                <div className="mt-2 w-64 space-y-2">
                                  <ActionForm action={saveAttendance} submitLabel="Save" className="space-y-2">
                                    <input type="hidden" name="id" value={r.id} />
                                    <input type="hidden" name="staff_id" value={p.id} />
                                    <input type="hidden" name="work_date" value={r.work_date} />
                                    <div className="grid grid-cols-2 gap-2">
                                      <input type="time" name="in_time" defaultValue={t(r.clock_in)} required className={inputClass} />
                                      <input type="time" name="out_time" defaultValue={t(r.clock_out)} className={inputClass} />
                                    </div>
                                    <input name="notes" defaultValue={r.notes} placeholder="Note" className={inputClass} />
                                  </ActionForm>
                                  <form action={deleteAttendance}>
                                    <input type="hidden" name="id" value={r.id} />
                                    <button className="text-xs text-rose-700 cursor-pointer">Delete record</button>
                                  </form>
                                </div>
                              </details>
                            ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {edit && (
          <Card className="p-5">
            <SectionTitle>Manual entry</SectionTitle>
            <ActionForm action={saveAttendance} submitLabel="Add record" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Staff">
                  <select name="staff_id" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {staff.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" name="work_date" required defaultValue={date} max={today} className={inputClass} />
                </Field>
                <Field label="In">
                  <input type="time" name="in_time" required className={inputClass} />
                </Field>
                <Field label="Out" hint="Earlier than In = next morning.">
                  <input type="time" name="out_time" className={inputClass} />
                </Field>
              </div>
              <Field label="Note">
                <input name="notes" maxLength={300} placeholder="Forgot to clock in" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        )}

        {can(session, "hr.export") && (
          <Card className="p-5">
            <SectionTitle>Payroll export</SectionTitle>
            <p className="text-sm text-slate-600 mb-3">
              A spreadsheet (CSV) per person: shifts rostered, days present, hours, late arrivals, absences and approved leave by
              type — ready for your payroll software.
            </p>
            <form action="/admin/hr/export" method="get" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <input type="date" name="from" required defaultValue={monthStartOf(today)} className={inputClass} />
                </Field>
                <Field label="To">
                  <input type="date" name="to" required defaultValue={today} className={inputClass} />
                </Field>
              </div>
              <button className={buttonClass}>Download CSV</button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
