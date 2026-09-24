"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState } from "react";
import type { ExtraCharge } from "../../../lib/types";
import { updateExtraCharge } from "../../rates-actions";
import type { ActionState } from "../../form-utils";
import { inputClass, secondaryButtonClass, Banner } from "../../components/ui";

export default function ExtraChargeForm({ charge }: { charge: ExtraCharge }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateExtraCharge,
    {},
  );

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-2">
      <input type="hidden" name="id" value={charge.id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Charge label</span>
          <input name="label" defaultValue={charge.label} required className={inputClass} />
        </label>
        <label className="w-32">
          <span className="sr-only">Amount in rupees</span>
          <input
            type="number"
            name="amount"
            min={0}
            step="1"
            defaultValue={Number(charge.amount)}
            required
            className={inputClass}
          />
        </label>
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "…" : "Save"}
        </button>
      </div>
      <Banner error={state.error} success={state.success} />
    </form>
  );
}
