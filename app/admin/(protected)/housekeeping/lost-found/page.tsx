import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type { LostFoundItem, Room } from "../../../../lib/types";
import { logLostItem } from "../../../housekeeping-actions";
import { Card, Field, SectionTitle, EmptyState, inputClass, fmtDate } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function LostFoundPage() {
  await requirePermission("housekeeping.lost_found");
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const [{ data }, { data: rooms }] = await Promise.all([
    supabase
      .from("lost_found_items")
      .select("*, rooms(room_number), staff:found_by(full_name)")
      .order("found_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("rooms").select("id, room_number").order("room_number"),
  ]);
  const items = (data ?? []) as (LostFoundItem & { staff: { full_name: string } | null })[];

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <SectionTitle>Log a found item</SectionTitle>
        <ActionForm action={logLostItem} submitLabel="Log item" className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Room">
              <select name="room_id" defaultValue="" className={inputClass}>
                <option value="">Not in a room</option>
                {((rooms ?? []) as Pick<Room, "id" | "room_number">[]).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.room_number}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Or found at">
              <input name="location" placeholder="Lobby, restaurant…" className={inputClass} />
            </Field>
            <Field label="Found on">
              <input type="date" name="found_on" defaultValue={today} className={inputClass} />
            </Field>
          </div>
          <Field label="Description">
            <input name="description" required placeholder="Black phone charger, Samsung" className={inputClass} />
          </Field>
        </ActionForm>
      </Card>

      <Card>
        {items.length === 0 ? (
          <EmptyState message="Nothing here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.id} className="px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  <span className="font-mono text-xs text-slate-500 mr-2">{i.reference}</span>
                  {i.description}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {i.rooms?.room_number ? `Room ${i.rooms.room_number}` : i.location} · found {fmtDate(i.found_on)}
                  {i.staff?.full_name && ` by ${i.staff.full_name}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
