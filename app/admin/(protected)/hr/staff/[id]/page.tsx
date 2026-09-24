import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import { getSettings } from "../../../../../lib/settings";
import { addDays, todayIn, zonedTime } from "../../../../../lib/dates";
import { payrollSummary, shiftLabel } from "../../../../../lib/hr";
import type { AttendanceRecord, Department, LeaveRequest, ShiftType, StaffFeedback, StaffShift } from "../../../../../lib/types";
import { WEEKDAY_LABELS } from "../../../../../lib/types";
import { addFeedback, saveHrProfile } from "../../../../hr-actions";
import { Card, EmptyState, Field, SectionTitle, Stat, inputClass, fmtDateTime } from "../../../../components/ui";
import ActionForm from "../../../../components/ActionForm";

export default async function HrStaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["hr.view", "hr.manage"]);
  const edit = can(session, "hr.manage");
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const from = addDays(today, -29);
  const since = zonedTime(from, "00:00", settings.timezone).toISOString();

  const { data: person } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  if (!person) notFound();

  const [
    { data: depts },
    { data: types },
    { data: att },
    { data: shifts },
    { data: leave },
    { data: hk },
    { data: mt },
    { data: fb },
  ] = await Promise.all([
    supabase.from("departments").select("*").order("sort_order"),
    supabase.from("shift_types").select("*").order("sort_order"),
    supabase.from("attendance").select("*").eq("staff_id", id).gte("work_date", from),
    supabase.from("staff_shifts").select("*").eq("staff_id", id).gte("shift_date", from),
    supabase.from("leave_requests").select("*").eq("staff_id", id).eq("status", "approved").gte("end_date", from),
    supabase.from("housekeeping_tasks").select("status, failed_count").eq("completed_by", id).gte("completed_at", since),
    supabase.from("maintenance_tickets").select("resolved_at, due_at").eq("resolved_by", id).eq("status", "resolved").gte("resolved_at", since),
    supabase.from("staff_feedback").select("*").eq("staff_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const departments = (depts ?? []) as Department[];
  const shiftTypes = (types ?? []) as ShiftType[];
  const [summary] = payrollSummary({
    staff: [{ id, full_name: person.full_name, job_title: person.job_title, employee_code: person.employee_code }],
    from,
    to: today,
    today,
    timeZone: settings.timezone,
    graceMinutes: settings.hr_late_grace_minutes,
    attendance: (att ?? []) as AttendanceRecord[],
    shifts: (shifts ?? []) as StaffShift[],
    shiftTypes,
    leave: (leave ?? []) as LeaveRequest[],
  });
  const cleans = hk ?? [];
  const fixes = mt ?? [];
  const feedback = (fb ?? []) as StaffFeedback[];
  const avg = feedback.length ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1) : null;

  const profile = (
    <fieldset disabled={!edit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Employee ID">
        <input name="employee_code" defaultValue={person.employee_code ?? ""} maxLength={30} placeholder="EMP-001" className={inputClass} />
      </Field>
      <Field label="Department">
        <select name="department_id" defaultValue={person.department_id ?? ""} className={inputClass}>
          <option value="">—</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Designation">
        <input name="job_title" defaultValue={person.job_title} maxLength={100} className={inputClass} />
      </Field>
      <Field label="Joining date">
        <input type="date" name="joining_date" defaultValue={person.joining_date ?? ""} className={inputClass} />
      </Field>
      <Field label="Usual shift" hint="Used to fill the roster.">
        <select name="default_shift_id" defaultValue={person.default_shift_id ?? ""} className={inputClass}>
          <option value="">—</option>
          {shiftTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({shiftLabel(t)})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Weekly day off">
        <select name="weekly_off" defaultValue={person.weekly_off ?? ""} className={inputClass}>
          <option value="">—</option>
          {WEEKDAY_LABELS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Phone">
        <input name="phone" type="tel" defaultValue={person.phone} className={inputClass} />
      </Field>
      <Field label="Emergency contact">
        <input name="emergency_contact" defaultValue={person.emergency_contact ?? ""} placeholder="Name, relation, number" className={inputClass} />
      </Field>
      <Field label="Email">
        <input value={person.email} disabled className={inputClass} />
      </Field>
      <div className="sm:col-span-3">
        <Field label="Address">
          <textarea name="address" rows={2} defaultValue={person.address ?? ""} className={inputClass} />
        </Field>
      </div>
    </fieldset>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/admin/hr/staff" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
        <ArrowLeft className="w-3.5 h-3.5" /> Staff
      </Link>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{person.full_name || person.email}</h2>
        <p className="text-sm text-slate-500">
          {[person.employee_code, person.job_title, departments.find((d) => d.id === person.department_id)?.name].filter(Boolean).join(" · ")}
        </p>
      </div>

      <Card className="p-5">
        <SectionTitle>Last 30 days</SectionTitle>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Shifts rostered">{summary.scheduled_shifts}</Stat>
          <Stat label="Days present">{summary.days_present}</Stat>
          <Stat label="Hours worked">{summary.hours_worked}</Stat>
          <Stat label="Late / absent">
            {summary.late_arrivals} / {summary.absent_days}
          </Stat>
          <Stat label="Rooms cleaned">
            {cleans.length}
            {cleans.length > 0 && (
              <span className="block text-xs text-slate-500">
                {cleans.filter((c) => c.status === "inspected" && c.failed_count === 0).length} passed first time
              </span>
            )}
          </Stat>
          <Stat label="Tickets resolved">
            {fixes.length}
            {fixes.length > 0 && (
              <span className="block text-xs text-slate-500">
                {fixes.filter((f) => f.resolved_at! <= f.due_at).length} within target
              </span>
            )}
          </Stat>
          <Stat label="Guest rating">{avg ? `${avg} ★ from ${feedback.length}` : "—"}</Stat>
          <Stat label="Leave taken">{Object.values(summary.leave).reduce((a, b) => a + b, 0)} days</Stat>
        </dl>
      </Card>

      <Card className="p-5">
        <SectionTitle>HR profile</SectionTitle>
        {edit ? (
          <ActionForm action={saveHrProfile} submitLabel="Save profile" className="space-y-3">
            <input type="hidden" name="staff_id" value={id} />
            {profile}
          </ActionForm>
        ) : (
          profile
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <SectionTitle>Feedback</SectionTitle>
        {(edit || can(session, "frontdesk.requests")) && (
          <ActionForm action={addFeedback} submitLabel="Record feedback" className="space-y-3">
            <input type="hidden" name="staff_id" value={id} />
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="From">
                <select name="source" defaultValue="guest" className={inputClass}>
                  <option value="guest">Guest</option>
                  <option value="manager">Manager</option>
                </select>
              </Field>
              <Field label="Rating">
                <select name="rating" defaultValue="5" className={inputClass}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {"★".repeat(n)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Comment">
                  <input name="comment" maxLength={1000} className={inputClass} />
                </Field>
              </div>
            </div>
          </ActionForm>
        )}
        {feedback.length === 0 ? (
          <EmptyState message="No feedback recorded." />
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {feedback.map((f) => (
              <li key={f.id} className="py-2.5 text-sm">
                <span className="text-yellow-600">{"★".repeat(f.rating)}</span>
                <span className="text-slate-300">{"★".repeat(5 - f.rating)}</span>{" "}
                <span className="text-xs text-slate-500">
                  {f.source === "guest" ? "Guest" : "Manager"} · {fmtDateTime(f.created_at)}
                </span>
                {f.comment && <p className="text-slate-700 mt-0.5">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
