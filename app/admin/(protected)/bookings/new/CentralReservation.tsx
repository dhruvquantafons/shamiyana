"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";
import { switchProperty } from "../../../property-actions";
import type { GroupAvailability } from "../../../../lib/types";
import type { ActionState } from "../../../form-utils";

/**
 * Taking a booking at whichever hotel in the group has room (SOW Module 14:
 * "Central reservation option — book any property from one screen").
 *
 * Deliberately not a second booking engine. It answers one question — who has
 * space on these dates — and then moves the desk to that hotel, where the
 * booking is made by the same availability rules, rate plans and overbooking
 * checks as any other. One booking engine, asked about several hotels.
 */
export default function CentralReservation({
  availability,
  current,
  checkIn,
  checkOut,
}: {
  availability: GroupAvailability[];
  current: string | null;
  checkIn: string;
  checkOut: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(switchProperty, {});

  // One entry per property: the desk wants to know who has space before
  // caring which room type it is.
  const byProperty = new Map<string, { code: string; name: string; free: number }>();
  for (const row of availability) {
    const seen = byProperty.get(row.property_id);
    byProperty.set(row.property_id, {
      code: row.code,
      name: row.name,
      free: (seen?.free ?? 0) + Math.max(0, Number(row.free)),
    });
  }
  const properties = [...byProperty.entries()];
  if (properties.length < 2) return null;

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-slate-700 mb-3">
        <Building2 className="w-3.5 h-3.5" />
        Rooms free across the group, {checkIn} to {checkOut}
      </p>

      <div className="flex flex-wrap gap-2">
        {properties.map(([id, p]) => {
          const here = id === current;
          return (
            <form key={id} action={formAction}>
              <input type="hidden" name="property_id" value={id} />
              <button
                type="submit"
                disabled={pending || here || p.free === 0}
                title={
                  here
                    ? "You are already taking bookings here"
                    : p.free === 0
                      ? "Nothing free on these dates"
                      : `Take this booking at ${p.name}`
                }
                className={`text-left rounded-md border px-3 py-2 transition-colors disabled:cursor-default ${
                  here
                    ? "border-yellow-300 bg-yellow-50"
                    : p.free === 0
                      ? "border-slate-200 bg-white opacity-60"
                      : "border-slate-200 bg-white hover:border-yellow-400 cursor-pointer"
                }`}
              >
                <span className="block text-sm text-slate-900">{p.name}</span>
                <span className="block text-[11px] text-slate-500">
                  {p.free === 0 ? "Full" : `${p.free} free`}
                  {here ? " · booking here" : ""}
                </span>
              </button>
            </form>
          );
        })}
      </div>

      {state.error && <p className="text-[11px] text-red-600 mt-2">{state.error}</p>}
      <p className="text-[11px] text-slate-500 mt-3">
        Choosing a hotel moves this screen to it. The rest of the form — rates, availability and
        overbooking — then belongs to that hotel.
      </p>
    </div>
  );
}
