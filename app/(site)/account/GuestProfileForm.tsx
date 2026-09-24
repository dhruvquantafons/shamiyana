"use client";

import { useActionState } from "react";
import { updateGuestProfile, type PortalState } from "../../lib/guest-portal";
import { LANGUAGES, type Guest } from "../../lib/types";

const input =
  "w-full bg-white/5 border border-white/15 rounded-md px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40 transition-colors";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

/**
 * The fields a guest owns.
 *
 * Deliberately short: the tags, loyalty tier and notes on the same record are
 * the hotel's, and guest_update_profile() will not write them however this
 * form is tampered with.
 */
export default function GuestProfileForm({
  guest,
  languages,
  labels,
}: {
  guest: Guest;
  /** The languages the property has switched on. */
  languages: string[];
  labels: { yourName: string; yourPhone: string };
}) {
  const [state, action, pending] = useActionState<PortalState, FormData>(updateGuestProfile, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="full_name">{labels.yourName}</Label>
          <input
            id="full_name"
            name="full_name"
            required
            defaultValue={guest.full_name}
            className={input}
          />
        </div>
        <div>
          <Label htmlFor="phone">{labels.yourPhone}</Label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={guest.phone ?? ""}
            className={input}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="language">Preferred language</Label>
          <select
            id="language"
            name="language"
            defaultValue={guest.language}
            className={input}
          >
            {languages.map((code) => (
              <option key={code} value={code} className="bg-[#0b131b]">
                {LANGUAGES[code] ?? code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="dietary">Dietary needs</Label>
          <input
            id="dietary"
            name="dietary"
            defaultValue={guest.dietary}
            placeholder="Vegetarian, no nuts…"
            className={input}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="preferences">Anything else we should know</Label>
        <textarea
          id="preferences"
          name="preferences"
          rows={2}
          defaultValue={guest.preferences}
          placeholder="A high floor, away from the lift, extra pillows…"
          className={input}
        />
      </div>

      <label className="flex items-start gap-2.5 text-xs text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          name="marketing_opt_in"
          defaultChecked={guest.marketing_opt_in}
          className="mt-0.5 accent-[#d4af37] w-4 h-4 shrink-0 rounded"
        />
        <span>Email me occasional offers from the hotel. You can turn this off at any time.</span>
      </label>

      {(state.error || state.success) && (
        <p
          role="status"
          className={`text-xs leading-relaxed rounded-md px-3 py-2 ${
            state.error
              ? "bg-red-500/10 text-red-300 border border-red-500/20"
              : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
          }`}
        >
          {state.error ?? state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-[#d4af37] text-[#0b131b] font-medium text-sm rounded-md px-5 py-2.5 hover:bg-[#c19f2e] disabled:opacity-60 transition-colors"
      >
        {pending ? "Saving…" : "Save my details"}
      </button>
    </form>
  );
}
