import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { addDays, eachNight, todayIn } from "../../../../lib/dates";
import type { LeaveRequest } from "../../../../lib/types";
import { LEAVE_KIND_LABELS, LEAVE_STATUS_LABELS } from "../../../../lib/types";
import { decideLeave } from "../../../hr-actions";
import { Card, EmptyState, SectionTitle, Tag, inputClass, dangerButtonClass, fmtDate, fmtDateTime } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

type Row = LeaveRequest & { staff: { full_name: string; email: string } | null; decider: { full_name: string } | null };

const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "neutral" } as const;
const days = (l: LeaveRequest) => eachNight(l.start_date, addDays(l.end_date, 1)).length;

export default async function LeavePage() {
  const session = await requireAnyPermission(["hr.approve_leave", "hr.view"]);
  const approver = can(session, "hr.approve_leave");
  const supabase = await createClient();
  const today = todayIn((await getSettings()).timezone);

  const select = "*, staff:staff_id(full_name, email), decider:decided_by(full_name)";
  const [{ data: pending }, { data: decided }] = await Promise.all([
    supabase.from("leave_requests").select(select).eq("status", "pending").order("start_date"),
    supabase
      .from("leave_requests")
      .select(select)
      .neq("status", "pending")
      .gte("end_date", addDays(today, -30))
      .order("start_date", { ascending: false })
      .limit(100),
  ]);
  const waiting = (pending ?? []) as Row[];
  const recent = (decided ?? []) as Row[];
  const who = (r: Row) => r.staff?.full_name || r.staff?.email || "Staff";
  const span = (r: Row) =>
    `${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ""} · ${days(r)} day${days(r) !== 1 ? "s" : ""}`;

  return (
    <div className="space-y-6">
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Waiting for approval ({waiting.length})</SectionTitle>
        </div>
        {waiting.length === 0 ? (
          <EmptyState message="No leave requests waiting." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {waiting.map((r) => (
              <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-medium text-slate-900">
                    {who(r)} · {LEAVE_KIND_LABELS[r.kind]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {span(r)} · asked {fmtDateTime(r.created_at)}
                  </p>
                  {r.reason && <p className="text-sm text-slate-700 mt-1">{r.reason}</p>}
                </div>
                {approver && r.staff_id !== session.staff.id && (
                  <>
                    <ActionForm action={decideLeave} submitLabel="Approve" className="">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                    </ActionForm>
                    <details className="relative">
                      <summary className={`${dangerButtonClass} list-none`}>Decline</summary>
                      <div className="absolute right-0 z-10 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                        <ActionForm action={decideLeave} submitLabel="Decline" submitClassName={dangerButtonClass} className="space-y-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="decision" value="reject" />
                          <input name="note" required placeholder="Reason" className={inputClass} />
                        </ActionForm>
                      </div>
                    </details>
                  </>
                )}
                {r.staff_id === session.staff.id && <span className="text-xs text-slate-500">Your own request — another approver decides.</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Recent decisions</SectionTitle>
        </div>
        {recent.length === 0 ? (
          <EmptyState message="Nothing in the last 30 days." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => (
              <li key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
                <span className="flex-1 min-w-[220px]">
                  {who(r)} · {LEAVE_KIND_LABELS[r.kind]}
                  <span className="block text-xs text-slate-500">
                    {span(r)}
                    {r.decider?.full_name && ` · ${r.decider.full_name}`}
                    {r.decision_note && ` · ${r.decision_note}`}
                  </span>
                </span>
                <Tag tone={TONE[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</Tag>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
