import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import type { BookingSource, ChannelAllocation, RoomType } from "../../../../lib/types";
import { BOOKING_SOURCE_LABELS } from "../../../../lib/types";
import { saveAllocations } from "../../../rates-actions";
import { Card, Field, Notice, inputClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/** Channels that sell without a person at the desk deciding. */
const CHANNELS: BookingSource[] = ["website", "ota", "travel_agent", "corporate", "mobile_app"];

export default async function AllocationsPage() {
  const session = await requireAnyPermission(["rates.view", "rates.manage"]);
  const supabase = await createClient();
  const manage = can(session, "rates.manage");

  const [{ data: types }, { data: allocations }, { data: rooms }] = await Promise.all([
    supabase.from("room_types").select("id, name").order("sort_order"),
    supabase.from("channel_allocations").select("*"),
    supabase.from("rooms").select("room_type_id"),
  ]);
  const allocs = (allocations ?? []) as ChannelAllocation[];
  const inventory = (typeId: string) => (rooms ?? []).filter((r) => r.room_type_id === typeId).length;

  return (
    <div className="space-y-6">
      <Notice>
        The most rooms of each type a channel may hold on any one night — e.g. 5 for the website, 3 for OTAs. Leave a
        channel blank for no limit beyond the physical inventory. Phone, email and walk-in bookings made by staff are
        always limited only by inventory. The website booking form enforces its allocation now; OTA allocations will
        be enforced by the channel manager (Module 9).
      </Notice>

      {((types ?? []) as Pick<RoomType, "id" | "name">[]).map((t) => (
        <Card key={t.id} className="p-5">
          <p className="text-base font-semibold mb-1">{t.name}</p>
          <p className="text-xs text-slate-600 mb-4">{inventory(t.id)} room(s) in inventory</p>
          {manage ? (
            <ActionForm action={saveAllocations} submitLabel="Save allocation" className="space-y-4">
              <input type="hidden" name="room_type_id" value={t.id} />
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {CHANNELS.map((c) => (
                  <Field key={c} label={BOOKING_SOURCE_LABELS[c]}>
                    <input
                      type="number"
                      name={`alloc_${c}`}
                      min={0}
                      max={inventory(t.id) || undefined}
                      placeholder="No limit"
                      defaultValue={allocs.find((a) => a.room_type_id === t.id && a.source === c)?.rooms ?? ""}
                      className={inputClass}
                    />
                  </Field>
                ))}
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">
              {CHANNELS.map((c) => {
                const a = allocs.find((x) => x.room_type_id === t.id && x.source === c);
                return `${BOOKING_SOURCE_LABELS[c]}: ${a ? a.rooms : "no limit"}`;
              }).join(" · ")}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
