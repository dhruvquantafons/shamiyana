import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { requireSession } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { todayIn, minutesSince } from "../../../lib/dates";
import type { HousekeepingTask, Room, Staff } from "../../../lib/types";
import { HK_KIND_LABELS, HK_STATUS_LABELS } from "../../../lib/types";
import { generateTasks, createTask, reassignTask, inspectTask, setDnd } from "../../housekeeping-actions";
import {
  Card,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  EmptyState,
  inputClass,
  secondaryButtonClass,
  dangerButtonClass,
  tableHeadClass,
  fmtDate,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";

type BoardTask = HousekeepingTask & { rooms: Pick<Room, "id" | "room_number" | "floor" | "status" | "housekeeping_status" | "dnd"> };

const STATUS_TONE = { pending: "neutral", in_progress: "blue", cleaned: "amber", inspected: "green", cancelled: "red" } as const;

export default async function HousekeepingBoard() {
  const session = await requireSession();
  if (!can(session, "housekeeping.assign") && !can(session, "housekeeping.inspect")) {
    redirect(can(session, "housekeeping.tasks") ? "/admin/housekeeping/my-tasks" : "/admin/housekeeping/lost-found");
  }
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const assign = can(session, "housekeeping.assign");
  const inspect = can(session, "housekeeping.inspect");

  const [{ data: taskRows }, { data: staffRows }, { data: perms }, { data: roomRows }] = await Promise.all([
    supabase
      .from("housekeeping_tasks")
      .select("*, rooms(id, room_number, floor, status, housekeeping_status, dnd)")
      .or(`task_date.eq.${today},and(task_date.lt.${today},status.in.(pending,in_progress,cleaned))`)
      .neq("status", "cancelled")
      .order("priority")
      .order("created_at"),
    supabase.from("staff").select("id, full_name, email, role, on_duty, is_active").eq("is_active", true).order("full_name"),
    supabase.from("role_permissions").select("role_key, permission").in("permission", ["housekeeping.tasks", "housekeeping.assign"]),
    supabase.from("rooms").select("id, room_number, floor, status, dnd").order("room_number"),
  ]);

  const tasks = (taskRows ?? []) as BoardTask[];
  const rolesWith = (p: string) => new Set((perms ?? []).filter((r) => r.permission === p).map((r) => r.role_key));
  const cleaners = ((staffRows ?? []) as Pick<Staff, "id" | "full_name" | "email" | "role" | "on_duty">[]).filter(
    (s) => rolesWith("housekeeping.tasks").has(s.role) && !rolesWith("housekeeping.assign").has(s.role),
  );
  const nameOf = (id: string | null) => cleaners.find((c) => c.id === id)?.full_name || (id ? "Staff" : "Unassigned");
  const rooms = (roomRows ?? []) as Pick<Room, "id" | "room_number" | "floor" | "status" | "dnd">[];

  const overdue = (t: BoardTask) => t.status === "in_progress" && t.started_at && minutesSince(t.started_at) > t.target_minutes;
  const pending = tasks.filter((t) => t.status === "pending");
  const cleaning = tasks.filter((t) => t.status === "in_progress");
  const toInspect = tasks.filter((t) => t.status === "cleaned");
  const ready = tasks.filter((t) => t.status === "inspected");
  const late = cleaning.filter(overdue);
  const unassigned = pending.filter((t) => !t.assigned_to);
  const dndRooms = rooms.filter((r) => r.dnd);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="To do" value={pending.length} hint={unassigned.length ? `${unassigned.length} unassigned` : undefined} />
        <StatCard label="Cleaning now" value={cleaning.length} hint={late.length ? `${late.length} over target` : undefined} />
        <StatCard label="Awaiting inspection" value={toInspect.length} />
        <StatCard label="Ready today" value={ready.length} />
      </div>

      {late.length > 0 && (
        <Notice tone="error">
          Over the turnaround target:{" "}
          {late.map((t) => `${t.rooms.room_number} (${minutesSince(t.started_at!)} of ${t.target_minutes} min, ${nameOf(t.assigned_to)})`).join(" · ")}
        </Notice>
      )}
      {cleaners.filter((c) => c.on_duty).length === 0 && assign && (
        <Notice tone="warn">No housekeeper is marked on duty, so new tasks cannot be auto-assigned. Set duty on the Setup tab.</Notice>
      )}

      {assign && (
        <Card className="p-4 flex flex-wrap items-start gap-4">
          <ActionForm action={generateTasks} submitLabel="Schedule due deep cleans" pendingLabel="Scheduling…" className="space-y-2">
            <p className="text-sm text-slate-600 max-w-md">
              Check-out cleans are created automatically when a guest leaves. Deep cleans fall due every{" "}
              {settings.hk_deep_clean_days} days; night audit schedules them, or do it now.
            </p>
          </ActionForm>
          <details className="ml-auto">
            <summary className={`${secondaryButtonClass} list-none`}>Add a task</summary>
            <div className="mt-3 w-80">
              <ActionForm action={createTask} submitLabel="Add task" className="space-y-3">
                <Field label="Room">
                  <select name="room_id" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.room_number}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select name="kind" defaultValue="checkout" className={inputClass}>
                    {Object.entries(HK_KIND_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assign to" hint="Blank: automatic by zone and workload.">
                  <select name="assigned_to" defaultValue="" className={inputClass}>
                    <option value="">Automatic</option>
                    {cleaners.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name || c.email}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {inspect && (
        <Card>
          <div className="px-4 py-3 border-b border-slate-100">
            <SectionTitle>Awaiting inspection ({toInspect.length})</SectionTitle>
          </div>
          {toInspect.length === 0 ? (
            <EmptyState message="Nothing to inspect." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {toInspect.map((t) => (
                <li key={t.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className="text-base font-semibold w-14">{t.rooms.room_number}</span>
                  <span className="text-sm text-slate-600 flex-1 min-w-[180px]">
                    {HK_KIND_LABELS[t.kind]} by {nameOf(t.assigned_to)}
                    {t.failed_count > 0 && <span className="text-rose-700"> · re-clean #{t.failed_count}</span>}
                  </span>
                  <ActionForm action={inspectTask} submitLabel="Pass" className="">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="result" value="pass" />
                  </ActionForm>
                  <details className="relative">
                    <summary className={`${dangerButtonClass} list-none`}>Fail</summary>
                    <div className="absolute right-0 z-10 mt-2 w-72 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                      <ActionForm action={inspectTask} submitLabel="Send back" submitClassName={dangerButtonClass} className="space-y-2">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="result" value="fail" />
                        <input name="note" required placeholder="What needs redoing?" className={inputClass} />
                      </ActionForm>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-slate-100">
          <SectionTitle>Tasks · {fmtDate(today)}</SectionTitle>
        </div>
        {tasks.length === 0 ? (
          <EmptyState message="No tasks yet today." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2.5 font-medium">Room</th>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold">{t.rooms.room_number}</span>
                      <span className="block text-xs text-slate-500">Floor {t.rooms.floor ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {HK_KIND_LABELS[t.kind]} {t.priority === "high" && <Tag tone="red">Arrival today</Tag>}{" "}
                      {t.rooms.dnd && <Tag tone="violet">DND</Tag>}
                      {t.task_date < today && <span className="block text-xs text-amber-700">from {fmtDate(t.task_date)}</span>}
                      {t.inspection_note && t.status === "pending" && (
                        <span className="block text-xs text-rose-700">Redo: {t.inspection_note}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {assign && ["pending", "in_progress"].includes(t.status) ? (
                        <form action={reassignTask} className="flex gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <select name="assigned_to" defaultValue={t.assigned_to ?? ""} className={`${inputClass} !py-1 !text-xs max-w-[150px]`}>
                            <option value="">Unassigned</option>
                            {cleaners.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name || c.email}
                                {c.on_duty ? "" : " (off)"}
                              </option>
                            ))}
                          </select>
                          <button className="text-xs text-yellow-800 cursor-pointer">Save</button>
                        </form>
                      ) : (
                        <span className={t.assigned_to ? "" : "text-amber-700"}>{nameOf(t.assigned_to)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Tag tone={STATUS_TONE[t.status]}>{HK_STATUS_LABELS[t.status]}</Tag>
                    </td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${overdue(t) ? "text-rose-700 font-medium" : "text-slate-600"}`}>
                      {t.status === "in_progress" && t.started_at
                        ? `${minutesSince(t.started_at)} / ${t.target_minutes} min`
                        : t.status === "pending"
                          ? `target ${t.target_minutes} min`
                          : t.completed_at && t.started_at
                            ? `took ${Math.max(0, Math.round((Date.parse(t.completed_at) - Date.parse(t.started_at)) / 60000))} min`
                            : ""}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle>Do Not Disturb</SectionTitle>
        {dndRooms.length === 0 ? (
          <p className="text-sm text-slate-500 mb-3">No rooms on DND.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-3">
            {dndRooms.map((r) => (
              <form key={r.id} action={setDnd} className="inline-flex items-center gap-2 border border-violet-200 bg-violet-50 rounded-md px-2.5 py-1 text-sm">
                <input type="hidden" name="room_id" value={r.id} />
                <input type="hidden" name="dnd" value="false" />
                {r.room_number}
                <button className="text-xs text-violet-800 cursor-pointer">clear</button>
              </form>
            ))}
          </div>
        )}
        <form action={setDnd} className="flex items-center gap-2">
          <input type="hidden" name="dnd" value="true" />
          <select name="room_id" defaultValue="" className={`${inputClass} max-w-[160px]`}>
            <option value="" disabled>
              Room…
            </option>
            {rooms
              .filter((r) => r.status === "occupied" && !r.dnd)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                </option>
              ))}
          </select>
          <button className={secondaryButtonClass}>Set DND</button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          In-room controls can also set this through the room-controls integration endpoint.
        </p>
      </Card>
    </div>
  );
}
