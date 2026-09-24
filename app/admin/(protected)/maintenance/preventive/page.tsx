import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type { Asset, MaintenanceSchedule, Room } from "../../../../lib/types";
import { MT_PRIORITIES, MT_PRIORITY_LABELS } from "../../../../lib/types";
import { deleteSchedule, generatePreventive, saveSchedule } from "../../../maintenance-actions";
import { Card, Check, EmptyState, Field, Tag, inputClass, secondaryButtonClass, fmtDate } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { nameOf, staffWith, type StaffOption } from "../shared";

function ScheduleFields({
  s,
  rooms,
  assets,
  engineers,
  today,
}: {
  s?: MaintenanceSchedule;
  rooms: Pick<Room, "id" | "room_number">[];
  assets: Pick<Asset, "id" | "code" | "name">[];
  engineers: StaffOption[];
  today: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Job">
        <input name="title" required defaultValue={s?.title} placeholder="AC servicing" className={inputClass} />
      </Field>
      <Field label="Every (days)" hint="90 = every 3 months.">
        <input type="number" name="interval_days" min={1} max={3650} defaultValue={s?.interval_days ?? 90} className={inputClass} />
      </Field>
      <Field label="Next due">
        <input type="date" name="next_due_on" required defaultValue={s?.next_due_on ?? today} className={inputClass} />
      </Field>
      <Field label="Asset">
        <select name="asset_id" defaultValue={s?.asset_id ?? ""} className={inputClass}>
          <option value="">None</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Room">
        <select name="room_id" defaultValue={s?.room_id ?? ""} className={inputClass}>
          <option value="">None</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room_number}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Or where">
        <input name="location" defaultValue={s?.location} placeholder="All floors" className={inputClass} />
      </Field>
      <Field label="Priority">
        <select name="priority" defaultValue={s?.priority ?? "medium"} className={inputClass}>
          {MT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {MT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assign to">
        <select name="assigned_to" defaultValue={s?.assigned_to ?? ""} className={inputClass}>
          <option value="">Unassigned</option>
          {engineers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name || e.email}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Instructions">
        <input name="description" defaultValue={s?.description} placeholder="Clean filters, check gas" className={inputClass} />
      </Field>
    </div>
  );
}

export default async function PreventivePage() {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const manage = can(session, "maintenance.manage");
  const supabase = await createClient();
  const today = todayIn((await getSettings()).timezone);

  const [{ data }, { data: rooms }, { data: assets }, engineers] = await Promise.all([
    supabase.from("maintenance_schedules").select("*, rooms(room_number), assets(code, name)").order("next_due_on"),
    supabase.from("rooms").select("id, room_number").order("room_number"),
    supabase.from("assets").select("id, code, name").eq("is_active", true).order("name"),
    staffWith(supabase, "maintenance.work"),
  ]);
  const schedules = (data ?? []) as MaintenanceSchedule[];
  const roomList = (rooms ?? []) as Pick<Room, "id" | "room_number">[];
  const assetList = (assets ?? []) as Pick<Asset, "id" | "code" | "name">[];

  return (
    <div className="space-y-6">
      {manage && (
        <Card className="p-4 flex flex-wrap items-start gap-4">
          <ActionForm action={generatePreventive} submitLabel="Raise due tickets now" pendingLabel="Checking…" className="space-y-2">
            <p className="text-sm text-slate-600 max-w-md">
              Night audit raises a ticket for every job that falls due. A job with an open ticket waits until that one is resolved.
            </p>
          </ActionForm>
          <details className="ml-auto w-full lg:w-auto">
            <summary className={`${secondaryButtonClass} list-none w-fit`}>Add a schedule</summary>
            <Card className="p-4 mt-3">
              <ActionForm action={saveSchedule} submitLabel="Add schedule" className="space-y-3">
                <ScheduleFields rooms={roomList} assets={assetList} engineers={engineers} today={today} />
              </ActionForm>
            </Card>
          </details>
        </Card>
      )}

      <Card>
        {schedules.length === 0 ? (
          <EmptyState message="No preventive schedules yet." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {schedules.map((s) => (
              <li key={s.id} className={`px-4 py-3 ${s.is_active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-medium text-slate-900">
                      {s.title} <span className="font-normal text-slate-500">· every {s.interval_days} days</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {[s.assets && `${s.assets.code} ${s.assets.name}`, s.rooms && `Room ${s.rooms.room_number}`, s.location]
                        .filter(Boolean)
                        .join(" · ")}{" "}
                      · {nameOf(engineers, s.assigned_to)}
                    </p>
                  </div>
                  {!s.is_active ? (
                    <Tag>Paused</Tag>
                  ) : s.next_due_on <= today ? (
                    <Tag tone="red">Due {fmtDate(s.next_due_on)}</Tag>
                  ) : (
                    <Tag tone="neutral">Next {fmtDate(s.next_due_on)}</Tag>
                  )}
                </div>
                {manage && (
                  <details className="mt-2">
                    <summary className="text-xs text-yellow-800 cursor-pointer">Edit</summary>
                    <div className="mt-3 space-y-3">
                      <ActionForm action={saveSchedule} submitLabel="Save" className="space-y-3">
                        <input type="hidden" name="id" value={s.id} />
                        <ScheduleFields s={s} rooms={roomList} assets={assetList} engineers={engineers} today={today} />
                        <Check name="is_active" label="Active" defaultChecked={s.is_active} />
                      </ActionForm>
                      <form action={deleteSchedule}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs text-rose-700 cursor-pointer">Delete schedule</button>
                      </form>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
