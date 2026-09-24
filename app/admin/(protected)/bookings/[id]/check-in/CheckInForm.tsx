"use client";

import { useActionState, useState } from "react";
import { checkIn } from "../../../../frontdesk-actions";
import type { ActionState } from "../../../../form-utils";
import { ID_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "../../../../../lib/types";
import { Field, Check, Banner, inputClass, buttonClass } from "../../../../components/ui";
import { keepFormOnSubmit } from "../../../../components/useKeepForm";
import SignaturePad from "../../../../components/SignaturePad";

const legend = "text-xs font-medium text-yellow-700 mb-2 pt-3";

export default function CheckInForm({
  bookingId,
  guestName,
  nationality,
  address,
  rooms,
  notReady,
  suggestedRoom,
  depositRequired,
  paid,
  guaranteed,
  earlyFee,
  earlyTime,
  canTakePayment,
  fmt,
}: {
  bookingId: string;
  guestName: string;
  nationality: string;
  address: string;
  rooms: { id: string; label: string }[];
  notReady: string[];
  suggestedRoom: string;
  depositRequired: number;
  paid: number;
  guaranteed: boolean;
  earlyFee: number;
  earlyTime: string | null;
  canTakePayment: boolean;
  fmt: { deposit: string; paid: string; earlyFee: string };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(checkIn, {});
  const [nation, setNation] = useState(nationality);
  const foreign = !/^indian?$/i.test(nation.trim());
  const depositShort = !guaranteed && paid < depositRequired;

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-5">
      <input type="hidden" name="booking_id" value={bookingId} />

      <fieldset className="space-y-4">
        <legend className={legend}>1 · Room</legend>
        {rooms.length === 0 ? (
          <p className="text-sm text-rose-800">
            No room of this type is vacant and inspected. Ask housekeeping to inspect one, or move the guest to another type.
          </p>
        ) : (
          <Field label="Room" hint="Vacant and inspected only. Ranked by the guest's floor and view preference and VIP status.">
            <select name="room_id" defaultValue={suggestedRoom} required className={inputClass}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {notReady.length > 0 && (
          <details>
            <summary className="text-[11px] text-slate-500 cursor-pointer">{notReady.length} room(s) of this type not ready</summary>
            <p className="text-xs text-slate-600 mt-1">{notReady.join(" · ")}</p>
          </details>
        )}
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>2 · Identity</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Nationality">
            <input name="nationality" value={nation} onChange={(e) => setNation(e.target.value)} required className={inputClass} />
          </Field>
          <Field label="ID type">
            <select name="id_type" required defaultValue={foreign ? "passport" : ""} key={foreign ? "f" : "d"} className={inputClass}>
              <option value="" disabled>
                Choose…
              </option>
              {Object.entries(ID_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ID number">
            <input name="id_number" required autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Issuing country">
            <input name="issuing_country" defaultValue={foreign ? "" : "India"} key={foreign ? "fc" : "dc"} className={inputClass} />
          </Field>
        </div>
        {foreign && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Passport expiry">
              <input type="date" name="id_expiry" className={inputClass} />
            </Field>
            <Field label="Visa number" hint="Foreign nationals are reported on Form C.">
              <input name="visa_number" required className={inputClass} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="ID — front" hint="Photo or scan, up to 5 MB.">
            <input type="file" name="id_front" accept="image/*,application/pdf" capture="environment" className="text-xs" />
          </Field>
          <Field label="ID — back">
            <input type="file" name="id_back" accept="image/*,application/pdf" capture="environment" className="text-xs" />
          </Field>
          {foreign && (
            <Field label="Visa page">
              <input type="file" name="visa" accept="image/*,application/pdf" capture="environment" required className="text-xs" />
            </Field>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>3 · Registration card</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name as on ID">
            <input name="guest_name" defaultValue={guestName} required className={inputClass} />
          </Field>
          <Field label="Home address">
            <input name="address" defaultValue={address} required className={inputClass} />
          </Field>
        </div>
        <Check
          name="terms_accepted"
          label="The guest has read and accepts the house rules, check-out time and cancellation terms."
        />
        <SignaturePad name="signature" />
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>4 · Payment</legend>
        <p className="text-sm text-slate-700">
          Deposit required {fmt.deposit} · received {fmt.paid}
          {guaranteed && " · guaranteed by company billing or OTA prepayment"}
        </p>
        {canTakePayment && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Take payment now (₹)">
              <input
                type="number"
                name="payment_amount"
                min={0}
                step="0.01"
                defaultValue={depositShort ? depositRequired - paid : undefined}
                className={inputClass}
              />
            </Field>
            <Field label="Method">
              <select name="payment_method" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference">
              <input name="payment_reference" className={inputClass} />
            </Field>
          </div>
        )}
        {depositShort && (
          <Check name="guarantee_confirmed" label="Card pre-authorisation or other guarantee taken instead of a deposit" />
        )}
        {earlyTime && earlyFee > 0 && (
          <Check
            name="apply_early_fee"
            defaultChecked
            label={`Charge early check-in (${earlyTime}): ${fmt.earlyFee}`}
            hint="Untick to waive; the waiver is recorded in the audit log."
          />
        )}
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>5 · Keys</legend>
        <Field label="Key cards to issue" hint="Sent to the door lock system if one is connected.">
          <input type="number" name="key_cards" min={0} max={10} defaultValue={2} className={`${inputClass} w-24`} />
        </Field>
      </fieldset>

      <Banner error={state.error} />

      <button type="submit" disabled={pending || rooms.length === 0} className={buttonClass}>
        {pending ? "Checking in…" : "Complete check-in"}
      </button>
    </form>
  );
}
