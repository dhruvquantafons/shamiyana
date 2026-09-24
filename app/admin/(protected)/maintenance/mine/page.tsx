import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import type { MaintenanceTicket, MtPriority } from "../../../../lib/types";
import { MT_PRIORITY_LABELS, MT_STATUS_LABELS } from "../../../../lib/types";
import { startTicket } from "../../../maintenance-actions";
import { Card, EmptyState, SectionTitle, Tag, buttonClass, secondaryButtonClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { DueTag, OPEN_STATUSES, PRIORITY_TONE, STATUS_TONE, whereOf } from "../shared";

const RANK: Record<MtPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** The engineer's list, for a phone: own tickets first, then unassigned ones to pick up. */
export default async function MyTicketsPage() {
  const session = await requirePermission("maintenance.work");
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_tickets")
    .select("*, rooms(room_number), assets(code, name)")
    .in("status", OPEN_STATUSES)
    .or(`assigned_to.eq.${session.staff.id},assigned_to.is.null`)
    .order("due_at");
  const tickets = ((data ?? []) as MaintenanceTicket[]).sort(
    (a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress") || RANK[a.priority] - RANK[b.priority],
  );
  const mine = tickets.filter((t) => t.assigned_to === session.staff.id);
  const unassigned = tickets.filter((t) => t.assigned_to === null);

  const card = (t: MaintenanceTicket) => (
    <Card key={t.id} className={`p-4 ${t.status === "in_progress" ? "border-yellow-400 ring-1 ring-yellow-400" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/admin/maintenance/${t.id}`} className="text-lg font-semibold text-slate-900 hover:text-yellow-800">
            {t.title}
          </Link>
          <p className="text-sm text-slate-600">
            {whereOf(t)} · {t.reference}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Tag tone={PRIORITY_TONE[t.priority]}>{MT_PRIORITY_LABELS[t.priority]}</Tag>
          <Tag tone={STATUS_TONE[t.status]}>{MT_STATUS_LABELS[t.status]}</Tag>
        </div>
      </div>
      {t.description && <p className="text-sm text-slate-700 mt-2 line-clamp-3">{t.description}</p>}
      <div className="mt-2">
        <DueTag ticket={t} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {t.status !== "in_progress" && (
          <ActionForm
            action={startTicket}
            submitLabel={t.assigned_to ? (t.status === "on_hold" ? "Resume" : "Start work") : "Take this job"}
            submitClassName={`${buttonClass} !py-2.5`}
            className=""
          >
            <input type="hidden" name="id" value={t.id} />
          </ActionForm>
        )}
        <Link href={`/admin/maintenance/${t.id}`} className={`${secondaryButtonClass} !py-2.5`}>
          {t.status === "in_progress" ? "Resolve / add photos" : "Open"}
        </Link>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-4">
        <SectionTitle>Assigned to me ({mine.length})</SectionTitle>
        {mine.length === 0 ? (
          <Card>
            <EmptyState message="Nothing assigned to you." />
          </Card>
        ) : (
          mine.map(card)
        )}
      </div>
      {unassigned.length > 0 && (
        <div className="space-y-4">
          <SectionTitle>Not yet assigned ({unassigned.length})</SectionTitle>
          {unassigned.map(card)}
        </div>
      )}
    </div>
  );
}
