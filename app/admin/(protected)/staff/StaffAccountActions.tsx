"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState, useState } from "react";
import { KeyRound, Trash2, ShieldOff } from "lucide-react";
import type { Staff } from "../../../lib/types";
import { resetStaffPassword, deleteStaffMember, resetStaffTwoFactor } from "../../actions";
import type { ActionState } from "../../form-utils";
import { inputClass, secondaryButtonClass, Banner } from "../../components/ui";

/** Password reset and account removal, for someone other than yourself. */
export default function StaffAccountActions({ member }: { member: Staff }) {
  const [resetState, resetAction, resetting] = useActionState<ActionState, FormData>(
    resetStaffPassword,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionState, FormData>(
    deleteStaffMember,
    {},
  );
  const [tfaState, tfaAction, tfaPending] = useActionState<ActionState, FormData>(
    resetStaffTwoFactor,
    {},
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-yellow-700 transition-colors cursor-pointer"
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>Set a new password</span>
        </button>

        <form
          action={tfaAction}
          onSubmit={keepFormOnSubmit(tfaAction, `Remove ${member.full_name || member.email}'s authenticator? Use this if they lost their phone.`)}
        >
          <input type="hidden" name="id" value={member.id} />
          <button
            type="submit"
            disabled={tfaPending}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-yellow-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <ShieldOff className="w-3.5 h-3.5" />
            <span>{tfaPending ? "Resetting…" : "Reset 2FA"}</span>
          </button>
        </form>

        <form
          action={deleteAction}
          onSubmit={keepFormOnSubmit(deleteAction, `Remove ${member.full_name || member.email}'s account? Suspending them instead keeps their notes attributed.`)}
        >
          <input type="hidden" name="id" value={member.id} />
          <button
            type="submit"
            disabled={deleting}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-rose-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{deleting ? "Removing…" : "Remove account"}</span>
          </button>
        </form>
      </div>

      {open && (
        <form action={resetAction} onSubmit={keepFormOnSubmit(resetAction)} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={member.id} />
          <label className="flex-1 min-w-[200px]">
            <span className="block text-xs font-medium text-slate-600 mb-1.5">
              New password
            </span>
            <input
              name="password"
              type="text"
              required
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={resetting} className={secondaryButtonClass}>
            {resetting ? "Saving…" : "Set password"}
          </button>
        </form>
      )}

      <Banner
        error={resetState.error ?? deleteState.error ?? tfaState.error}
        success={resetState.success ?? tfaState.success}
      />
    </div>
  );
}
