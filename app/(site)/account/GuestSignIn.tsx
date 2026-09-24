"use client";

import { useActionState, useState } from "react";
import {
  requestGuestCode,
  confirmGuestCode,
  guestPasswordAuth,
  type PortalState,
} from "../../lib/guest-portal";

const input =
  "w-full bg-white/5 border border-white/15 rounded-md px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none focus:ring-1 focus:ring-[#d4af37]/40 transition-colors";
const button =
  "w-full bg-[#d4af37] text-[#0b131b] font-medium text-sm rounded-md px-4 py-2.5 hover:bg-[#c19f2e] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

function Message({ state }: { state: PortalState }) {
  if (!state.error && !state.success) return null;
  return (
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
  );
}

/**
 * Two steps in one card: ask for the address, then for the code that was
 * emailed to it. The email is carried into the second step as a hidden field
 * so the guest does not type it twice, and stays editable by going back.
 */
export default function GuestSignIn({
  labels,
  passwordLogin = false,
}: {
  labels: { emailCode: string; enterCode: string };
  /** Offers a password as well. A staging affordance; off in production. */
  passwordLogin?: boolean;
}) {
  const [sent, setSent] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sendState, sendAction, sending] = useActionState<PortalState, FormData>(
    async (prev, fd) => {
      const result = await requestGuestCode(prev, fd);
      if (result.success) setSent(String(fd.get("email") ?? "").trim().toLowerCase());
      return result;
    },
    {},
  );
  const [confirmState, confirmAction, confirming] = useActionState<PortalState, FormData>(
    confirmGuestCode,
    {},
  );
  const [passwordState, passwordAction, authenticating] = useActionState<PortalState, FormData>(
    guestPasswordAuth,
    {},
  );

  if (passwordLogin && usePassword) {
    return (
      <form action={passwordAction} className="space-y-4">
        <div>
          <label htmlFor="pw-email" className="block text-xs text-slate-400 mb-1.5">
            Email address
          </label>
          <input
            id="pw-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={input}
          />
        </div>
        <div>
          <label htmlFor="pw-password" className="block text-xs text-slate-400 mb-1.5">
            Password
          </label>
          <input
            id="pw-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            placeholder="At least 8 characters"
            className={input}
          />
        </div>
        <Message state={passwordState} />
        <button type="submit" disabled={authenticating} className={button}>
          {authenticating ? "Please wait…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={() => setUsePassword(false)}
          className="w-full text-[11px] text-slate-400 hover:text-[#d4af37] transition-colors"
        >
          Email me a sign-in code instead
        </button>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          For testing. An account opened with a password starts empty — it does not pick up
          bookings made earlier under the same address, because a password does not prove the
          address belongs to you. Use the emailed code for that.
        </p>
      </form>
    );
  }

  if (!sent) {
    return (
      <form action={sendAction} className="space-y-4">
        <div>
          <label htmlFor="guest-email" className="block text-xs text-slate-400 mb-1.5">
            Email address
          </label>
          <input
            id="guest-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={input}
          />
        </div>
        <Message state={sendState} />
        <button type="submit" disabled={sending} className={button}>
          {sending ? "Sending…" : labels.emailCode}
        </button>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          No password needed. We email you a sign-in code each time. If you have stayed
          with us before under this address, your past bookings will be here waiting.
        </p>
        {passwordLogin && (
          <button
            type="button"
            onClick={() => setUsePassword(true)}
            className="w-full text-[11px] text-slate-400 hover:text-[#d4af37] transition-colors"
          >
            Use a password instead
          </button>
        )}
      </form>
    );
  }

  return (
    <form action={confirmAction} className="space-y-4">
      <input type="hidden" name="email" value={sent} />
      <p className="text-xs text-slate-400 leading-relaxed">
        We emailed your sign-in code to <span className="text-white">{sent}</span>.
      </p>
      <div>
        <label htmlFor="guest-code" className="block text-xs text-slate-400 mb-1.5">
          {labels.enterCode}
        </label>
        <input
          id="guest-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          // Supabase decides how long the code is (6 to 10 digits, set per
          // project), so this must not assume six or it would silently refuse
          // the last digits of a longer one.
          maxLength={10}
          required
          placeholder="••••••"
          className={`${input} tracking-[0.4em] text-center font-mono`}
        />
      </div>
      <Message state={confirmState} />
      <button type="submit" disabled={confirming} className={button}>
        {confirming ? "Checking…" : "Sign in"}
      </button>
      <button
        type="button"
        onClick={() => setSent("")}
        className="w-full text-[11px] text-slate-400 hover:text-[#d4af37] transition-colors"
      >
        Use a different email address
      </button>
    </form>
  );
}
