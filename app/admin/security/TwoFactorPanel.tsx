"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  startTotpEnrolment,
  confirmTotpEnrolment,
  removeTotp,
  type EnrolState,
} from "../security-actions";
import type { ActionState } from "../form-utils";
import { Banner, Field, inputClass, buttonClass, secondaryButtonClass } from "../components/ui";
import { keepFormOnSubmit } from "../components/useKeepForm";

export default function TwoFactorPanel({
  enabled,
  required,
  demoCode,
}: {
  enabled: boolean;
  required: boolean;
  /** Set in demo mode: no authenticator app, this fixed code is used. */
  demoCode: string | null;
}) {
  const router = useRouter();
  const [enrol, startAction, starting] = useActionState<EnrolState>(startTotpEnrolment, {});
  const [confirmed, confirmAction, confirming] = useActionState<EnrolState, FormData>(
    async (prev, fd) => {
      const result = await confirmTotpEnrolment({ ...enrol, ...prev }, fd);
      if (result.success) router.refresh();
      return result;
    },
    {},
  );
  const [removed, removeAction, removing] = useActionState<ActionState>(async () => {
    const result = await removeTotp();
    if (result.success) router.refresh();
    return result;
  }, {});

  if (confirmed.success) return <Banner success={confirmed.success} />;

  if (enabled) {
    return (
      <div className="space-y-3">
        {!required && (
          <form action={removeAction}>
            <button disabled={removing} className={secondaryButtonClass}>
              {removing ? "Removing…" : "Turn off two-factor"}
            </button>
          </form>
        )}
        <Banner error={removed.error} success={removed.success} />
      </div>
    );
  }

  if (demoCode) {
    return (
      <form action={confirmAction} onSubmit={keepFormOnSubmit(confirmAction)} className="space-y-3">
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          Demo mode — no authenticator app. The code is always{" "}
          <strong className="font-mono tracking-widest">{demoCode}</strong>.
        </p>
        <input type="hidden" name="factor_id" value="demo" />
        <Field label="Enter the code to turn it on">
          <input name="code" inputMode="numeric" required className={`${inputClass} max-w-[180px] tracking-[0.3em]`} />
        </Field>
        <Banner error={confirmed.error} />
        <button disabled={confirming} className={buttonClass}>
          {confirming ? "Checking…" : "Turn on"}
        </button>
      </form>
    );
  }

  if (!enrol.qr) {
    return (
      <div className="space-y-3">
        <form action={startAction}>
          <button disabled={starting} className={buttonClass}>
            {starting ? "Preparing…" : "Set up two-factor"}
          </button>
        </form>
        <Banner error={enrol.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
      {/* Supabase returns the QR code as an SVG data URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrol.qr} alt="Authenticator QR code" className="w-44 h-44 border border-slate-200 rounded-lg bg-white p-2" />
      <p className="text-[11px] text-slate-600">
        Can&apos;t scan? Enter this key: <code className="font-mono break-all">{enrol.secret}</code>
      </p>
      <form action={confirmAction} onSubmit={keepFormOnSubmit(confirmAction)} className="space-y-3">
        <input type="hidden" name="factor_id" value={enrol.factorId} />
        <Field label="Code from the app">
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={`${inputClass} max-w-[180px] tracking-[0.3em]`}
          />
        </Field>
        <Banner error={confirmed.error} />
        <button disabled={confirming} className={buttonClass}>
          {confirming ? "Checking…" : "Turn on"}
        </button>
      </form>
    </div>
  );
}
