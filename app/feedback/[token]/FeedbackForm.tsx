"use client";

import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import { submitGuestFeedback, type FeedbackState } from "../../lib/feedback";
import { keepFormOnSubmit } from "../../admin/components/useKeepForm";

const ASPECTS = [
  { key: "room", label: "Room" },
  { key: "service", label: "Service" },
  { key: "cleanliness", label: "Cleanliness" },
  { key: "food", label: "Food" },
];

function Stars({ name, label, large = false }: { name: string; label: string; large?: boolean }) {
  const [value, setValue] = useState(0);
  return (
    <fieldset className="flex items-center justify-between gap-4 py-3 border-b border-[#ede9e2] last:border-0">
      <legend className="sr-only">{label}</legend>
      <span className={large ? "font-serif text-xl text-[#1c1b1a]" : "text-sm text-[#3a3935]"}>{label}</span>
      <span className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer" title={`${n} of 5`}>
            <input type="radio" name={name} value={n} className="sr-only peer" onChange={() => setValue(n)} />
            <Star
              aria-hidden
              className={`${large ? "w-8 h-8" : "w-6 h-6"} transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#a88956] ${
                n <= value ? "fill-[#a88956] text-[#a88956]" : "text-[#d9d3c9]"
              }`}
            />
            <span className="sr-only">
              {n} star{n > 1 ? "s" : ""}
            </span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

export default function FeedbackForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(submitGuestFeedback, {});

  if (state.done) {
    return (
      <p className="text-sm text-[#5a5854] leading-relaxed">
        Thank you — your feedback has reached our team. We hope to welcome you back to Srinagar soon.
      </p>
    );
  }

  return (
    <form action={action} onSubmit={keepFormOnSubmit(action)} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <div className="bg-white border border-[#ede9e2] rounded-xl px-5 py-2">
        <Stars name="overall" label="Overall" large />
      </div>
      <div className="bg-white border border-[#ede9e2] rounded-xl px-5 py-1">
        {ASPECTS.map((a) => (
          <Stars key={a.key} name={a.key} label={a.label} />
        ))}
      </div>
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-[#9a9490] font-semibold mb-1.5">
          Anything you would like to tell us?
        </span>
        <textarea
          name="comment"
          rows={4}
          maxLength={2000}
          className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#ede9e2] rounded-xl focus:outline-none focus:border-[#a88956]"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm bg-rose-50 text-rose-800 border border-rose-200 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full py-3.5 bg-[#1c1b1a] hover:bg-black text-white rounded-xl text-xs uppercase tracking-[0.2em] font-bold disabled:opacity-60 cursor-pointer"
      >
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
