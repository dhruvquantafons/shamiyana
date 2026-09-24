"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";
import { switchProperty } from "../property-actions";
import type { ActionState } from "../form-utils";

/**
 * Moves between the hotels in the group (SOW Module 14).
 *
 * Submits on change rather than behind a button: this is navigation, not an
 * edit, and a "Go" button next to a list of two hotels is a step for nothing.
 *
 * Rendered only when there is more than one property, so a single hotel never
 * sees a control with one option in it.
 */
export default function PropertySwitcher({
  properties,
  current,
}: {
  properties: { id: string; code: string; name: string }[];
  current: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(switchProperty, {});

  if (properties.length < 2) return null;

  return (
    <form action={formAction} className="px-3 pb-1">
      <label htmlFor="property-switch" className="sr-only">
        Property
      </label>
      <div className="relative">
        <Building2 className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <select
          id="property-switch"
          name="property_id"
          defaultValue={current ?? ""}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full appearance-none bg-slate-100 border border-slate-200 rounded-md pl-8 pr-2 py-1.5 text-xs text-slate-700 hover:border-slate-300 focus:border-yellow-500 focus:outline-none disabled:opacity-60 cursor-pointer"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </div>
      {state.error && <p className="text-[11px] text-red-600 mt-1">{state.error}</p>}
    </form>
  );
}
