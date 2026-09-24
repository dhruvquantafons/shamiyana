import type { SupabaseClient } from "@supabase/supabase-js";
import { minutesSince } from "../../../lib/dates";
import type { Asset, MaintenanceTicket, MtPriority, MtStatus, Room } from "../../../lib/types";
import { MT_PRIORITIES, MT_PRIORITY_LABELS } from "../../../lib/types";
import { createTicket } from "../../maintenance-actions";
import { Check, Field, Tag, inputClass } from "../../components/ui";
import ActionForm from "../../components/ActionForm";

export const PRIORITY_TONE: Record<MtPriority, "neutral" | "blue" | "amber" | "red"> = {
  low: "neutral",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

export const STATUS_TONE: Record<MtStatus, "neutral" | "blue" | "amber" | "green" | "red"> = {
  open: "neutral",
  in_progress: "blue",
  on_hold: "amber",
  resolved: "green",
  cancelled: "red",
};

export const OPEN_STATUSES: MtStatus[] = ["open", "in_progress", "on_hold"];

export type StaffOption = { id: string; full_name: string; email: string };

/** Active staff whose role explicitly holds a permission, e.g. the engineers. */
export async function staffWith(supabase: SupabaseClient, permission: string): Promise<StaffOption[]> {
  const { data: perms } = await supabase.from("role_permissions").select("role_key").eq("permission", permission);
  const keys = [...new Set((perms ?? []).map((r) => r.role_key as string))];
  if (keys.length === 0) return [];
  const { data } = await supabase.from("staff").select("id, full_name, email").in("role", keys).eq("is_active", true).order("full_name");
  return (data ?? []) as StaffOption[];
}

export const nameOf = (people: StaffOption[], id: string | null, fallback = "Unassigned") =>
  id ? people.find((p) => p.id === id)?.full_name || people.find((p) => p.id === id)?.email || "Staff" : fallback;

/** Where the problem is: room, asset or place. */
export function whereOf(t: Pick<MaintenanceTicket, "rooms" | "assets" | "location">) {
  return [t.rooms?.room_number && `Room ${t.rooms.room_number}`, t.assets?.name, t.location].filter(Boolean).join(" · ") || "—";
}

function fmtSpan(minutes: number) {
  const m = Math.abs(minutes);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 6) / 10} h`;
  return `${Math.round(m / 1440)} days`;
}

/** Time left to the resolution target, or how far past it. */
export function DueTag({ ticket }: { ticket: Pick<MaintenanceTicket, "due_at" | "status" | "resolved_at"> }) {
  if (!OPEN_STATUSES.includes(ticket.status)) {
    if (ticket.status !== "resolved" || !ticket.resolved_at) return null;
    const late = Date.parse(ticket.resolved_at) > Date.parse(ticket.due_at);
    return <Tag tone={late ? "amber" : "green"}>{late ? "Resolved late" : "Within target"}</Tag>;
  }
  const over = minutesSince(ticket.due_at);
  return over > 0 ? (
    <Tag tone="red">{fmtSpan(over)} over target</Tag>
  ) : (
    <span className="text-xs text-slate-600">{fmtSpan(over)} left</span>
  );
}

export function ReportTicketForm({
  rooms,
  assets,
  engineers,
  defaultRoom = "",
}: {
  rooms: Pick<Room, "id" | "room_number">[];
  assets: Pick<Asset, "id" | "code" | "name">[];
  /** Given to supervisors, who may assign as they report. */
  engineers?: StaffOption[];
  defaultRoom?: string;
}) {
  return (
    <ActionForm action={createTicket} submitLabel="Raise ticket" pendingLabel="Sending…" className="space-y-3">
      <Field label="What is wrong?">
        <input name="title" required maxLength={150} placeholder="Tap leaking in bathroom" className={inputClass} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Room">
          <select name="room_id" defaultValue={defaultRoom} className={inputClass}>
            <option value="">Not a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.room_number}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Asset">
          <select name="asset_id" defaultValue="" className={inputClass}>
            <option value="">None</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Or where">
          <input name="location" maxLength={200} placeholder="Lobby, kitchen…" className={inputClass} />
        </Field>
      </div>
      <Field label="Details">
        <textarea name="description" rows={2} maxLength={4000} className={inputClass} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Priority" hint="Urgent alerts the engineering supervisor at once.">
          <select name="priority" defaultValue="medium" className={inputClass}>
            {MT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {MT_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        {engineers && (
          <Field label="Assign to">
            <select name="assigned_to" defaultValue="" className={inputClass}>
              <option value="">Later</option>
              {engineers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name || e.email}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Photos" hint="Up to 5, 5 MB each.">
        <input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="text-sm" />
      </Field>
      <Check
        name="affects_room"
        label="The room cannot be sold until this is fixed"
        hint="Takes the room out of order now; it comes back when the ticket is resolved."
      />
    </ActionForm>
  );
}
