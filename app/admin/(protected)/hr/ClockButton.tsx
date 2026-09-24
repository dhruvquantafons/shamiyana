"use client";

import { startTransition, useActionState, useState } from "react";
import { clock } from "../../hr-actions";
import type { ActionState } from "../../form-utils";
import { Banner, buttonClass, secondaryButtonClass } from "../../components/ui";

/**
 * Clock in or out. The phone's location is sent when the browser allows it,
 * so the hotel can require clock-ins from on site (geofence).
 */
export default function ClockButton({ clockedIn, needsLocation }: { clockedIn: boolean; needsLocation: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(clock, {});
  const [locating, setLocating] = useState(false);

  const submit = (coords?: GeolocationCoordinates) => {
    const fd = new FormData();
    fd.set("mode", clockedIn ? "out" : "in");
    if (coords) {
      fd.set("lat", String(coords.latitude));
      fd.set("lng", String(coords.longitude));
    }
    startTransition(() => action(fd));
  };

  const onClick = () => {
    if (!("geolocation" in navigator)) return submit();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        submit(pos.coords);
      },
      () => {
        setLocating(false);
        // Without a location the server decides: fine unless the geofence is required.
        submit();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || locating}
        className={`${clockedIn ? secondaryButtonClass : buttonClass} w-full sm:w-auto !px-8 !py-3 !text-base`}
      >
        {locating ? "Finding your location…" : pending ? "Saving…" : clockedIn ? "Clock out" : "Clock in"}
      </button>
      {needsLocation && <p className="text-xs text-slate-500">Clocking in needs your location — allow it when your phone asks.</p>}
      <Banner error={state.error} success={state.success} />
    </div>
  );
}
