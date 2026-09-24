"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signOutIdle } from "../actions";

const WARN_SECONDS = 60;
const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * Signs the desk out after a period without input (SOW Module 15:
 * "auto-logout after inactivity"). A minute before, it warns and offers to
 * stay signed in. Activity in any tab of the panel counts, via storage events.
 */
export default function IdleTimer({ minutes }: { minutes: number }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActivity = useRef(0);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const limit = minutes * 60 * 1000;
    const mark = () => {
      const now = Date.now();
      // Scrolling fires constantly; recording once every few seconds is enough.
      if (now - lastActivity.current < 5000) return;
      lastActivity.current = now;
      try {
        localStorage.setItem("admin:lastActivity", String(lastActivity.current));
      } catch {
        // Storage can be unavailable; the timer still works in this tab.
      }
      setSecondsLeft(null);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "admin:lastActivity" && e.newValue) lastActivity.current = Number(e.newValue);
    };

    mark();
    EVENTS.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    window.addEventListener("storage", onStorage);

    const tick = setInterval(() => {
      const remaining = Math.round((lastActivity.current + limit - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(tick);
        startTransition(() => signOutIdle());
      } else if (remaining <= WARN_SECONDS) {
        setSecondsLeft(remaining);
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      EVENTS.forEach((ev) => window.removeEventListener(ev, mark));
      window.removeEventListener("storage", onStorage);
    };
  }, [minutes]);

  if (secondsLeft === null) return null;

  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-sm w-full shadow-2xl text-center">
        <p className="text-base font-semibold text-slate-900">Still there?</p>
        <p className="text-sm text-slate-700 mt-2">
          For security you will be signed out in <strong>{secondsLeft}</strong> seconds.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            lastActivity.current = Date.now();
            setSecondsLeft(null);
          }}
          className="mt-5 px-4 py-2 text-xs font-medium rounded-lg bg-yellow-400 text-slate-900 hover:bg-yellow-500 cursor-pointer"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
