import type { Room, RoomType } from "../../../lib/types";
import { Field, Check, inputClass } from "../../components/ui";

/** The room attributes the SOW lists (Module 3 "Room Attributes"). */
export default function RoomFields({
  room,
  roomTypes,
  rooms,
}: {
  room?: Room;
  roomTypes: RoomType[];
  rooms: Room[];
}) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Room number">
          <input name="room_number" required defaultValue={room?.room_number} placeholder="101" className={inputClass} />
        </Field>
        <Field label="Room type">
          <select name="room_type_id" required defaultValue={room?.room_type_id ?? ""} className={inputClass}>
            <option value="" disabled>
              Select…
            </option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Floor">
          <input type="number" name="floor" defaultValue={room?.floor ?? ""} className={inputClass} />
        </Field>
        <Field label="View">
          <input name="view" defaultValue={room?.view} placeholder="River" className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Beds">
          <input name="bed_configuration" defaultValue={room?.bed_configuration} placeholder="1 King / 2 Twin" className={inputClass} />
        </Field>
        <Field label="Max adults" hint="Blank: room type's limit.">
          <input type="number" name="max_adults" min={1} max={20} defaultValue={room?.max_adults ?? ""} className={inputClass} />
        </Field>
        <Field label="Max children">
          <input type="number" name="max_children" min={0} max={20} defaultValue={room?.max_children ?? ""} className={inputClass} />
        </Field>
        <Field label="Connecting room">
          <select name="connecting_room_id" defaultValue={room?.connecting_room_id ?? ""} className={inputClass}>
            <option value="">None</option>
            {rooms
              .filter((r) => r.id !== room?.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <Check name="is_accessible" defaultChecked={room?.is_accessible} label="Accessible room" />
        <Check name="is_smoking" defaultChecked={room?.is_smoking} label="Smoking permitted" />
      </div>
      <Field label="Notes">
        <input name="notes" defaultValue={room?.notes} className={inputClass} />
      </Field>
    </>
  );
}
