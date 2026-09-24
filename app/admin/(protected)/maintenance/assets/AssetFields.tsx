import type { Asset, AssetCategory, Room } from "../../../../lib/types";
import { ASSET_CATEGORY_LABELS } from "../../../../lib/types";
import { Field, inputClass } from "../../../components/ui";

export default function AssetFields({ asset, rooms }: { asset?: Asset; rooms: Pick<Room, "id" | "room_number">[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Name">
        <input name="name" required defaultValue={asset?.name} placeholder="Split AC, Room 101" className={inputClass} />
      </Field>
      <Field label="Category">
        <select name="category" defaultValue={asset?.category ?? "hvac"} className={inputClass}>
          {(Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[]).map((c) => (
            <option key={c} value={c}>
              {ASSET_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Room">
        <select name="room_id" defaultValue={asset?.room_id ?? ""} className={inputClass}>
          <option value="">Not in a room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room_number}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Location">
        <input name="location" defaultValue={asset?.location} placeholder="Roof, basement…" className={inputClass} />
      </Field>
      <Field label="Make">
        <input name="make" defaultValue={asset?.make} className={inputClass} />
      </Field>
      <Field label="Model">
        <input name="model" defaultValue={asset?.model} className={inputClass} />
      </Field>
      <Field label="Serial number">
        <input name="serial_number" defaultValue={asset?.serial_number} className={inputClass} />
      </Field>
      <Field label="Installed on">
        <input type="date" name="installed_on" defaultValue={asset?.installed_on ?? ""} className={inputClass} />
      </Field>
      <Field label="Warranty until">
        <input type="date" name="warranty_until" defaultValue={asset?.warranty_until ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-3">
        <Field label="Notes">
          <textarea name="notes" rows={2} defaultValue={asset?.notes} className={inputClass} />
        </Field>
      </div>
    </div>
  );
}
