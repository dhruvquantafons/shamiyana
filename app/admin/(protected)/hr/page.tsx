import { createClient } from "../../../lib/supabase/server";
import { requireSession } from "../../../lib/auth";
import { getSettings } from "../../../lib/settings";
import { addDays, eachNight, mondayOf, nowTimeIn, todayIn } from "../../../lib/dates";
import { shiftLabel, workedHours } from "../../../lib/hr";
import type { AttendanceRecord, LeaveRequest, ShiftType, StaffShift } from "../../../lib/types";
import { LEAVE_KIND_LABELS, LEAVE_STATUS_LABELS } from "../../../lib/types";
import { cancelLeave, requestLeave } from "../../hr-actions";
import { Card, EmptyState, Field, SectionTitle, Tag, inputClass, tableHeadClass, fmtDate } from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import ClockButton from "./ClockButton";

const LEAVE_TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "neutral" } as const;

/** Every staff member's own page: clock in/out, this week's shifts, leave. */
export default async function MyWorkPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayIn(tz);
  const week = mondayOf(today);
  const days = eachNight(week, addDays(week, 7));

  const [{ data: open }, { data: recent }, { data: shifts }, { data: types }, { data: leave }] = await Promise.all([
    supabase.from("attendance").select("*").eq("staff_id", session.staff.id).is("clock_out", null).maybeSingle(),
    supabase
      .from("attendance")
      .select("*")
      .eq("staff_id", session.staff.id)
      .gte("work_date", addDays(today, -13))
      .order("clock_in", { ascending: false }),
    supabase.from("staff_shifts").select("*").eq("staff_id", session.staff.id).gte("shift_date", week).lt("shift_date", addDays(week, 7)),
    supabase.from("shift_types").select("*"),
    supabase.from("leave_requests").select("*").eq("staff_id", session.staff.id).order("start_date", { ascending: false }).limit(20),
  ]);
  const openRecord = open as AttendanceRecord | null;
  const records = (recent ?? []) as AttendanceRecord[];
  const typeById = new Map(((types ?? []) as ShiftType[]).map((t) => [t.id, t]));
  const myShifts = (shifts ?? []) as StaffShift[];
  const myLeave = (leave ?? []) as LeaveRequest[];
  const onLeave = (d: string) => myLeave.find((l) => l.status === "approved" && l.start_date <= d && l.end_date >= d);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5 space-y-3">
          <SectionTitle>Attendance</SectionTitle>
          <p className="text-sm text-slate-700">
            {openRecord ? `Clocked in at ${nowTimeIn(tz, new Date(openRecord.clock_in))}.` : "You are not clocked in."}
          </p>
          <ClockButton clockedIn={!!openRecord} needsLocation={settings.hr_require_geofence} />
        </Card>

        <Card className="lg:col-span-2">
          <div className="px-4 pt-4">
            <SectionTitle>My shifts this week</SectionTitle>
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-7 border-t border-slate-100">
            {days.map((d) => {
              const s = myShifts.find((x) => x.shift_date === d);
              const type = s?.shift_type_id ? typeById.get(s.shift_type_id) : null;
              const leaveDay = onLeave(d);
              return (
                <li key={d} className={`p-3 border-b sm:border-b-0 sm:border-r border-slate-100 ${d === today ? "bg-yellow-50" : ""}`}>
                  <p className="text-xs text-slate-500">{new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</p>
                  <p className="text-sm font-medium text-slate-900 mt-1">
                    {leaveDay ? "Leave" : type ? type.name : s ? "Off" : "—"}
                  </p>
                  {type && !leaveDay && <p className="text-[11px] text-slate-500">{shiftLabel(type)}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="px-4 pt-4">
            <SectionTitle>Last two weeks · {workedHours(records)} h</SectionTitle>
          </div>
          {records.length === 0 ? (
            <EmptyState message="No attendance recorded." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2 font-medium">Day</th>
                  <th className="px-4 py-2 font-medium">In</th>
                  <th className="px-4 py-2 font-medium">Out</th>
                  <th className="px-4 py-2 font-medium">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{fmtDate(r.work_date)}</td>
                    <td className="px-4 py-2">{nowTimeIn(tz, new Date(r.clock_in))}</td>
                    <td className="px-4 py-2">{r.clock_out ? nowTimeIn(tz, new Date(r.clock_out)) : "—"}</td>
                    <td className="px-4 py-2">{r.clock_out ? workedHours([r]) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5 space-y-5">
          <SectionTitle>Leave</SectionTitle>
          <ActionForm action={requestLeave} submitLabel="Request leave" className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Type">
                <select name="kind" defaultValue="casual" className={inputClass}>
                  {Object.entries(LEAVE_KIND_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="From">
                <input type="date" name="start_date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label="To">
                <input type="date" name="end_date" defaultValue={today} className={inputClass} />
              </Field>
            </div>
            <Field label="Reason">
              <input name="reason" maxLength={500} className={inputClass} />
            </Field>
          </ActionForm>

          {myLeave.length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {myLeave.map((l) => (
                <li key={l.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 min-w-[180px]">
                    {LEAVE_KIND_LABELS[l.kind]} · {fmtDate(l.start_date)}
                    {l.end_date !== l.start_date && ` – ${fmtDate(l.end_date)}`}
                    {l.decision_note && <span className="block text-xs text-slate-500">{l.decision_note}</span>}
                  </span>
                  <Tag tone={LEAVE_TONE[l.status]}>{LEAVE_STATUS_LABELS[l.status]}</Tag>
                  {l.status === "pending" && (
                    <form action={cancelLeave}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-xs text-rose-700 cursor-pointer">Cancel</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
