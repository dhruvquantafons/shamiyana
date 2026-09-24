"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState } from "react";
import type { RoomType } from "../../../lib/types";
import { updateRoomType } from "../../rates-actions";
import type { ActionState } from "../../form-utils";
import { Field, inputClass, buttonClass, Banner } from "../../components/ui";

export default function RoomTypeForm({ roomType }: { roomType: RoomType }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateRoomType,
    {},
  );

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-4">
      <input type="hidden" name="id" value={roomType.id} />

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">{roomType.name}</h2>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={roomType.is_active}
            className="accent-yellow-500 w-4 h-4"
          />
          <span>Show on website</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Display name">
          <input name="name" defaultValue={roomType.name} required className={inputClass} />
        </Field>
        <Field label="Nightly rate (₹)" hint="CPAI, inclusive of taxes">
          <input
            type="number"
            name="base_rate"
            min={0}
            step="1"
            defaultValue={Number(roomType.base_rate)}
            required
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Weekend rate (₹)" hint="Fri & Sat nights. Blank: same.">
          <input type="number" name="weekend_rate" min={0} step="1" defaultValue={roomType.weekend_rate ?? ""} className={inputClass} />
        </Field>
        <Field label="Adults included">
          <input type="number" name="base_occupancy" min={1} max={20} defaultValue={roomType.base_occupancy} className={inputClass} />
        </Field>
        <Field label="Max adults">
          <input type="number" name="max_adults" min={1} max={20} defaultValue={roomType.max_adults} className={inputClass} />
        </Field>
        <Field label="Max children">
          <input type="number" name="max_children" min={0} max={20} defaultValue={roomType.max_children} className={inputClass} />
        </Field>
      </div>

      <Field label="Cleaning target (minutes)" hint="Housekeeping turnaround for this room type. Blank: the property default.">
        <input type="number" name="cleaning_minutes" min={5} max={480} defaultValue={roomType.cleaning_minutes ?? ""} className={`${inputClass} max-w-[160px]`} />
      </Field>

      <Field label="Tagline">
        <input name="tagline" defaultValue={roomType.tagline} className={inputClass} />
      </Field>

      <Field label="Category" hint="Groups the filter tabs on the website.">
        <input name="category" defaultValue={roomType.category} className={inputClass} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Size">
          <input name="size" defaultValue={roomType.size} className={inputClass} />
        </Field>
        <Field label="Occupancy">
          <input name="occupancy" defaultValue={roomType.occupancy} className={inputClass} />
        </Field>
        <Field label="View">
          <input name="view" defaultValue={roomType.view} className={inputClass} />
        </Field>
      </div>

      <Field label="Highlights" hint="One per line, up to six. The ticked list on the card.">
        <textarea
          name="highlights"
          rows={4}
          defaultValue={roomType.highlights.join("\n")}
          className={inputClass}
        />
      </Field>

      <Field label="Amenities" hint="One per line.">
        <textarea name="amenities" rows={3} defaultValue={roomType.amenities.join("\n")} className={inputClass} />
      </Field>

      <Field label="Description">
        <textarea
          name="description"
          rows={3}
          defaultValue={roomType.description}
          className={inputClass}
        />
      </Field>

      <Banner error={state.error} success={state.success} />

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
