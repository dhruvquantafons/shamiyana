import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { minutesSince, todayIn, zonedTime } from "../../../lib/dates";
import type { Asset, MaintenanceTicket, MtPriority, MtStatus, Room } from "../../../lib/types";
import { MT_PRIORITIES, MT_PRIORITY_LABELS, MT_STATUS_LABELS } from "../../../lib/types";
import { assignTicket } from "../../maintenance-actions";
import {
  Card,
  EmptyState,
  Notice,
  StatCard,
  Tag,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
  fmtDateTime,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
  clampPage,
} from "../../components/ui";
import { DueTag, OPEN_STATUSES, PRIORITY_TONE, ReportTicketForm, STATUS_TONE, nameOf, staffWith, whereOf } from "./shared";

const VIEWS = { open: "Open", resolved: "Resolved", all: "All" } as const;
type View = keyof typeof VIEWS;

export default async function MaintenanceBoard({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; priority?: string; report?: string; room?: string; page?: string }>;
}) {
  const session = await requireAnyPermission(["maintenance.report", "maintenance.work", "maintenance.manage"]);
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "open";
  const priority = MT_PRIORITIES.includes(params.priority as MtPriority) ? (params.priority as MtPriority) : null;
  const requestedPage = pageParam(params.page);
  const manage = can(session, "maintenance.manage");
  const supabase = await createClient();
  const settings = await getSettings();
  const dayStart = zonedTime(todayIn(settings.timezone), "00:00", settings.timezone).toISOString();

  // The open view is sorted by urgency below, so it loads every open ticket
  // and pages in memory; the other views page in the database.
  let query = supabase
    .from("maintenance_tickets")
    .select("*, rooms(room_number), assets(code, name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (view !== "open") query = query.range(...pageRange(requestedPage));
  if (view === "open") query = query.in("status", OPEN_STATUSES);
  if (view === "resolved") query = query.in("status", ["resolved", "cancelled"]);
  if (priority) query = query.eq("priority", priority);

  const [{ data, error, count }, { data: openRows }, { count: resolvedToday }, { data: rooms }, { data: assets }, engineers] = await Promise.all([
    query,
    supabase.from("maintenance_tickets").select("id, priority, status, due_at, assigned_to, affects_room").in("status", OPEN_STATUSES),
    supabase.from("maintenance_tickets").select("id", { count: "exact", head: true }).eq("status", "resolved").gte("resolved_at", dayStart),
    supabase.from("rooms").select("id, room_number").order("room_number"),
    supabase.from("assets").select("id, code, name").eq("is_active", true).order("name"),
    staffWith(supabase, "maintenance.work"),
  ]);

  const listParams = { view: view !== "open" ? view : null, priority };
  if (outOfRange(error)) redirect(pageHref("/admin/maintenance", listParams, 1));
  let tickets = (data ?? []) as MaintenanceTicket[];
  const total = count ?? tickets.length;
  const page = view === "open" ? clampPage(requestedPage, total) : requestedPage;
  // Open view: urgent first, then soonest due.
  const rank: Record<MtPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  if (view === "open") {
    const [from, to] = pageRange(page);
    tickets = tickets.sort((a, b) => rank[a.priority] - rank[b.priority] || a.due_at.localeCompare(b.due_at)).slice(from, to + 1);
  }

  const open = (openRows ?? []) as Pick<MaintenanceTicket, "id" | "priority" | "status" | "due_at" | "assigned_to" | "affects_room">[];
  const overdue = open.filter((t) => minutesSince(t.due_at) > 0);
  const urgentUnassigned = open.filter((t) => t.priority === "urgent" && !t.assigned_to);
  const link = (v: View, p: MtPriority | null) => {
    const q = new URLSearchParams();
    if (v !== "open") q.set("view", v);
    if (p) q.set("priority", p);
    return `/admin/maintenance${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open" value={open.length} hint={`${open.filter((t) => !t.assigned_to).length} unassigned`} />
        <StatCard label="Urgent" value={open.filter((t) => t.priority === "urgent").length} />
        <StatCard label="Over target" value={overdue.length} />
        <StatCard label="Resolved today" value={resolvedToday ?? 0} hint={`${open.filter((t) => t.affects_room).length} room(s) out of order`} />
      </div>

      {urgentUnassigned.length > 0 && (
        <Notice tone="error">
          {urgentUnassigned.length} urgent ticket(s) waiting for an engineer{manage ? " — assign below." : "."}
        </Notice>
      )}

      <details className="group" open={params.report === "1"}>
        <summary className={`${secondaryButtonClass} list-none w-fit`}>Report a problem</summary>
        <Card className="p-4 mt-3 max-w-2xl">
          <ReportTicketForm
            rooms={(rooms ?? []) as Pick<Room, "id" | "room_number">[]}
            assets={(assets ?? []) as Pick<Asset, "id" | "code" | "name">[]}
            engineers={manage ? engineers : undefined}
            defaultRoom={params.room ?? ""}
          />
        </Card>
      </details>

      <Card>
        <div className="px-4 pt-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <Link
              key={v}
              href={link(v, priority)}
              className={`text-xs px-2.5 py-1 rounded-md border ${v === view ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {VIEWS[v]}
            </Link>
          ))}
          <span className="mx-2 h-4 w-px bg-slate-200" />
          {MT_PRIORITIES.map((p) => (
            <Link
              key={p}
              href={link(view, priority === p ? null : p)}
              className={`text-xs px-2.5 py-1 rounded-md border ${p === priority ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {MT_PRIORITY_LABELS[p]}
            </Link>
          ))}
        </div>
        {tickets.length === 0 ? (
          <EmptyState message={view === "open" ? "No open tickets." : "Nothing here."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2.5 font-medium">Ticket</th>
                  <th className="px-4 py-2.5 font-medium">Where</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Engineer</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/maintenance/${t.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                        {t.title}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {t.reference} · {fmtDateTime(t.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {whereOf(t)}
                      {t.affects_room && OPEN_STATUSES.includes(t.status) && (
                        <span className="block mt-0.5">
                          <Tag tone="red">Out of order</Tag>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Tag tone={PRIORITY_TONE[t.priority]}>{MT_PRIORITY_LABELS[t.priority]}</Tag>
                    </td>
                    <td className="px-4 py-2.5">
                      <Tag tone={STATUS_TONE[t.status as MtStatus]}>{MT_STATUS_LABELS[t.status]}</Tag>
                    </td>
                    <td className="px-4 py-2.5">
                      {manage && OPEN_STATUSES.includes(t.status) ? (
                        <form action={assignTicket} className="flex gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <select name="assigned_to" defaultValue={t.assigned_to ?? ""} className={`${inputClass} !py-1 !text-xs max-w-[150px]`}>
                            <option value="">Unassigned</option>
                            {engineers.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.full_name || e.email}
                              </option>
                            ))}
                          </select>
                          <button className="text-xs text-yellow-800 cursor-pointer">Save</button>
                        </form>
                      ) : (
                        <span className={t.assigned_to ? "" : "text-amber-700"}>{nameOf(engineers, t.assigned_to)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <DueTag ticket={t} />
                      {t.escalated_at && OPEN_STATUSES.includes(t.status) && (
                        <span className="block text-[11px] text-rose-700 mt-0.5">Escalated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} path="/admin/maintenance" params={listParams} />
      </Card>

      <p className="text-xs text-slate-500">
        Targets: Urgent {settings.mt_sla_urgent_hours} h · High {settings.mt_sla_high_hours} h · Medium{" "}
        {settings.mt_sla_medium_hours} h · Low {settings.mt_sla_low_hours} h. Tickets past their target are escalated to the
        engineering supervisor.
      </p>
    </div>
  );
}
