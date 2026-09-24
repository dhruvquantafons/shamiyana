"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";
import { signIn } from "../security-actions";
import type { ActionState } from "../form-utils";
import { Field, inputClass, buttonClass, Banner } from "../components/ui";
import { keepFormOnSubmit } from "../components/useKeepForm";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signIn, {});
  const idle = searchParams.get("reason") === "idle";
  const ended = searchParams.get("reason") === "ended";

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-4">
      <input type="hidden" name="next" value={searchParams.get("next") ?? "/admin"} />
      {idle && !state.error && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          You were signed out after a period of inactivity.
        </p>
      )}
      {ended && !state.error && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          An administrator ended your session. Sign in again to continue.
        </p>
      )}
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" autoFocus className={inputClass} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Banner error={state.error} />
      <button type="submit" disabled={pending} className={`${buttonClass} w-full flex items-center justify-center gap-2`}>
        <LogIn className="w-3.5 h-3.5" />
        <span>{pending ? "Signing in…" : "Sign in"}</span>
      </button>
    </form>
  );
}
