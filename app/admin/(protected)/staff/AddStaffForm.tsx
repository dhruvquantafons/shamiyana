"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState, useState } from "react";
import { UserPlus, RefreshCw, CheckCircle2 } from "lucide-react";
import type { Property, Role, StaffRole } from "../../../lib/types";
import { createStaffMember } from "../../actions";
import type { ActionState } from "../../form-utils";
import { Field, inputClass, buttonClass, Banner, Check } from "../../components/ui";

/**
 * Readable starting password that satisfies the complexity policy: it always
 * contains a lowercase letter, an uppercase letter, a digit and a symbol.
 */
function suggestPassword() {
  const pick = (set: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]);
  const chars = [
    ...pick("abcdefghijkmnpqrstuvwxyz", 6),
    ...pick("ABCDEFGHJKLMNPQRSTUVWXYZ", 4),
    ...pick("23456789", 3),
    ...pick("#@%+=!?", 1),
  ];
  // Shuffle so the classes are not in a fixed order.
  const order = crypto.getRandomValues(new Uint32Array(chars.length));
  return chars.map((c, i) => [order[i], c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c).join("");
}

export default function AddStaffForm({
  roles,
  properties = [],
  currentProperty = null,
}: {
  roles: Role[];
  /** The hotels the administrator may assign to (SOW Module 14). */
  properties?: Pick<Property, "id" | "code" | "name">[];
  currentProperty?: string | null;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createStaffMember,
    {},
  );

  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("front_desk");
  // Bumping this remounts the form, which clears every field at once.
  const [formKey, setFormKey] = useState(0);

  const startAnother = () => {
    setPassword("");
    setRole("front_desk");
    setFormKey((n) => n + 1);
  };

  return (
    <details className="group">
      <summary className="flex items-center gap-2 cursor-pointer list-none text-sm font-medium text-yellow-700 hover:text-yellow-800 transition-colors">
        <span className="w-6 h-6 rounded-full bg-yellow-50 flex items-center justify-center">
          <UserPlus className="w-3.5 h-3.5" />
        </span>
        <span>Add a staff member</span>
      </summary>

      {state.success ? (
        <div className="mt-5 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-start gap-2 text-sm text-emerald-900">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{state.success}</span>
          </p>
          <p className="text-xs text-emerald-800">
            The password is not shown again — pass it on now. You can set a new one from
            their card below at any time.
          </p>
          <button type="button" onClick={startAnother} className={buttonClass}>
            Add another
          </button>
        </div>
      ) : (
      <form key={formKey} action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-4 mt-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name">
            <input name="full_name" required placeholder="Imran Ahmad" className={inputClass} />
          </Field>
          <Field label="Job title" hint="Free text — Waiter, Head Chef, Night Manager.">
            <input name="job_title" placeholder="Waiter" className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email" hint="They sign in with this.">
            <input name="email" type="email" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" className={inputClass} />
          </Field>
        </div>

        <Field label="Temporary password" hint="Must meet the password policy (Settings). They choose their own at first sign-in.">
          <div className="flex gap-2">
            <input
              name="password"
              type="text"
              required
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setPassword(suggestPassword())}
              title="Generate a password"
              className="px-3 rounded-lg border border-slate-200 text-slate-700 hover:border-yellow-500 hover:text-yellow-700 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </Field>

        <Field label="Role" hint={roles.find((r) => r.key === role)?.description}>
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className={inputClass}
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
                {r.requires_2fa ? " (2FA)" : ""}
              </option>
            ))}
          </select>
        </Field>

        {properties.length > 1 && (
          <>
            <Field label="Works at" hint="Which hotel this person's screens and reports are about.">
              <select name="property_id" defaultValue={currentProperty ?? ""} className={inputClass}>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Check
              name="all_properties"
              value="true"
              label="Head office — sees every hotel in the group"
              hint="For owners and group roles. Everyone else is held to the hotel above."
            />
          </>
        )}

        <Banner error={state.error} />

        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>
      )}
    </details>
  );
}
