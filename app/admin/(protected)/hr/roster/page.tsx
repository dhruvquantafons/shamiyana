import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { addDays, eachNight, isIsoDate, mondayOf, todayIn } from "../../../../lib/dates";
import { shiftLabel } from "../../../../lib/hr";
import type { Department, LeaveRequest, ShiftType, StaffShift } from "../../../../lib/types";
import { copyPreviousWeek, fillRosterFromPatterns, saveRoster } from "../../../hr-actions";
import { Card, EmptyState, secondaryButtonClass, fmtDate } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { HR_STAFF_COLUMNS, SHIFT_COLOR_CLASS, type HrStaff } from "../shared";

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ week?: string; dept?: string }> }) {
  const session = await requireAnyPermission(["hr.view", "hr.manage"]);
  const edit = can(session, "hr.manage");
  const params = await searchParams;
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const week = mondayOf(params.week && isIsoDate(params.week) ? params.week : today);
  const days = eachNight(week, addDays(week, 7));
  const supabase = await createClient();

  let staffQuery = supabase.from("staff").select(HR_STAFF_COLUMNS).eq("is_active", true).order("full_name");
  if (params.dept) staffQuery = staffQuery.eq("department_id", params.dept);

  const [{ data: staffRows }, { data: depts }, { data: types }, { data: shifts }, { data: leave }] = await Promise.all([
    staffQuery,
    supabase.from("departments").select("*").order("sort_order"),
    supabase.from("shift_types").select("*").order("sort_order"),
    supabase.from("staff_shifts").select("*").gte("shift_date", week).lt("shift_date", addDays(week, 7)),
    supabase
      .from("leave_requests")
      .select("staff_id, kind, start_date, end_date, status")
      .eq("status", "approved")
      .lte("start_date", addDays(week, 6))
      .gte("end_date", week),
  ]);
  const staff = (staffRows ?? []) as HrStaff[];
  const departments = (depts ?? []) as Department[];
  const shiftTypes = (types ?? []) as ShiftType[];
  const active = shiftTypes.filter((t) => t.is_active);
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const cellOf = new Map(((shifts ?? []) as StaffShift[]).map((s) => [`${s.staff_id}:${s.shift_date}`, s]));
  const leaveOn = (staffId: string, d: string) =>
    ((leave ?? []) as Pick<LeaveRequest, "staff_id" | "start_date" | "end_date">[]).some(
      (l) => l.staff_id === staffId && l.start_date <= d && l.end_date >= d,
    );
  const coverage = (d: string, typeId: string) =>
    staff.filter((p) => cellOf.get(`${p.id}:${d}`)?.shift_type_id === typeId && !leaveOn(p.id, d)).length;

  const href = (w: string, dept = params.dept) => {
    const q = new URLSearchParams({ week: w });
    if (dept) q.set("dept", dept);
    return `/admin/hr/roster?${q}`;
  };

  const grid = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-2.5 font-medium sticky left-0 bg-slate-50 min-w-[160px]">Staff</th>
            {days.map((d) => (
              <th key={d} className={`px-2 py-2.5 font-medium min-w-[110px] ${d === today ? "text-yellow-800" : ""}`}>
                {new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {staff.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 sticky left-0 bg-white">
                <span className="font-medium text-slate-900">{p.full_name || p.email}</span>
                <span className="block text-[11px] text-slate-500">{p.job_title || departments.find((d) => d.id === p.department_id)?.name || ""}</span>
              </td>
              {days.map((d) => {
                const cell = cellOf.get(`${p.id}:${d}`);
                const type = cell?.shift_type_id ? typeById.get(cell.shift_type_id) : null;
                if (leaveOn(p.id, d)) {
                  return (
                    <td key={d} className="px-2 py-2">
                      <span className="block text-center text-xs rounded px-2 py-1.5 bg-rose-50 text-rose-800 border border-rose-200">Leave</span>
                    </td>
                  );
                }
                return (
                  <td key={d} className="px-2 py-2">
                    {edit ? (
                      <select
                        name={`cell:${p.id}:${d}`}
                        defaultValue={cell ? (cell.shift_type_id ?? "off") : ""}
                        aria-label={`${p.full_name} on ${fmtDate(d)}`}
                        className={`w-full text-xs rounded border border-slate-200 px-1.5 py-1.5 ${type ? SHIFT_COLOR_CLASS[type.color] : cell ? "bg-slate-50 text-slate-500" : "bg-white text-slate-400"}`}
                      >
                        <option value="">—</option>
                        {active.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                        <option value="off">Off</option>
                      </select>
                    ) : (
                      <span className={`block text-center text-xs rounded px-2 py-1.5 ${type ? SHIFT_COLOR_CLASS[type.color] : "text-slate-400"}`}>
                        {type ? type.name : cell ? "Off" : "—"}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="bg-slate-50 text-xs text-slate-600">
            <td className="px-3 py-2 sticky left-0 bg-slate-50 font-medium">On duty</td>
            {days.map((d) => (
              <td key={d} className="px-2 py-2">
                {active.map((t) => (
                  <span key={t.id} className="block">
                    {t.name}: {coverage(d, t.id)}
                  </span>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(addDays(week, -7))} className={secondaryButtonClass} aria-label="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <span className="text-sm font-medium text-slate-900 px-2">
          {fmtDate(week)} – {fmtDate(addDays(week, 6))}
        </span>
        <Link href={href(addDays(week, 7))} className={secondaryButtonClass} aria-label="Next week">
          <ChevronRight className="w-4 h-4" />
        </Link>
        <Link href={href(mondayOf(today))} className="text-xs text-yellow-800 ml-1">
          This week
        </Link>
        <div className="ml-auto flex flex-wrap gap-1">
          <Link
            href={href(week, "")}
            className={`text-xs px-2.5 py-1 rounded-md border ${!params.dept ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600"}`}
          >
            All
          </Link>
          {departments.map((d) => (
            <Link
              key={d.id}
              href={href(week, d.id)}
              className={`text-xs px-2.5 py-1 rounded-md border ${params.dept === d.id ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600"}`}
            >
              {d.name}
            </Link>
          ))}
        </div>
      </div>

      {edit && (
        <div className="flex flex-wrap gap-3">
          <ActionForm action={fillRosterFromPatterns} submitLabel="Fill from shift patterns" submitClassName={secondaryButtonClass} className="">
            <input type="hidden" name="week" value={week} />
          </ActionForm>
          <ActionForm action={copyPreviousWeek} submitLabel="Copy last week" submitClassName={secondaryButtonClass} className="">
            <input type="hidden" name="week" value={week} />
          </ActionForm>
        </div>
      )}

      <Card>
        {staff.length === 0 ? (
          <EmptyState message="No staff in this department." />
        ) : edit ? (
          <ActionForm action={saveRoster} submitLabel="Save roster" className="space-y-3 pb-4 [&>div:last-child]:px-4">
            {grid}
          </ActionForm>
        ) : (
          grid
        )}
      </Card>

      <p className="text-xs text-slate-500">
        {active.map((t) => `${t.name} ${shiftLabel(t)}`).join(" · ")}. Approved leave shows automatically. Housekeeping auto-assignment
        skips anyone rostered off or on leave.
      </p>
    </div>
  );
}
