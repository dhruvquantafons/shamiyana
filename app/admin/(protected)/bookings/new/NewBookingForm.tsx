"use client";

import { useActionState, useState } from "react";
import type {
  Company,
  ExtraCharge,
  RatePlan,
  RateRestriction,
  RateSeason,
  RoomType,
} from "../../../../lib/types";
import {
  BOOKING_SOURCE_LABELS,
  PAYMENT_METHOD_LABELS,
  ID_TYPE_LABELS,
  MEAL_PLAN_LABELS,
  RATE_TYPE_LABELS,
} from "../../../../lib/types";
import { quoteStay, type LiveAdjustment } from "../../../../lib/pricing";
import { createBooking } from "../../../booking-actions";
import type { ActionState } from "../../../form-utils";
import { Field, inputClass, buttonClass, Banner, Check, fmtMoney, fmtDate } from "../../../components/ui";
import { keepFormOnSubmit } from "../../../components/useKeepForm";

const legend = "text-xs font-medium text-yellow-700 mb-2 pt-3";

export default function NewBookingForm({
  roomTypes,
  plans,
  seasons,
  restrictions,
  extraCharges,
  adjustments,
  companies,
  defaults,
  canOverbook,
  canOverrideRate,
  canTakePayment,
}: {
  roomTypes: RoomType[];
  plans: RatePlan[];
  seasons: RateSeason[];
  restrictions: RateRestriction[];
  extraCharges: ExtraCharge[];
  adjustments: LiveAdjustment[];
  companies: Company[];
  defaults: { checkIn: string; checkOut: string; source: string; roomTypeId: string; walkIn: boolean };
  canOverbook: boolean;
  canOverrideRate: boolean;
  canTakePayment: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBooking, {});

  const [roomTypeId, setRoomTypeId] = useState(defaults.roomTypeId || roomTypes[0]?.id || "");
  const [companyId, setCompanyId] = useState("");
  const [planId, setPlanId] = useState(plans.find((p) => p.rate_type === "bar")?.id ?? plans[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(defaults.checkIn);
  const [checkOut, setCheckOut] = useState(defaults.checkOut);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [rateOverride, setRateOverride] = useState("");
  const [status, setStatus] = useState("confirmed");

  const roomType = roomTypes.find((t) => t.id === roomTypeId) ?? null;
  // Corporate plans only for their own company.
  const availablePlans = plans.filter(
    (p) =>
      (p.room_type_ids.length === 0 || p.room_type_ids.includes(roomTypeId)) &&
      (p.rate_type !== "corporate" || p.company_id === companyId),
  );
  const plan = availablePlans.find((p) => p.id === planId) ?? null;

  const quote =
    !roomType || !checkIn || !checkOut || checkOut <= checkIn
      ? null
      : quoteStay({
      roomType,
      plan,
      checkIn,
      checkOut,
      adults,
      children,
      rooms,
      seasons,
      restrictions,
          extraCharges,
          adjustments,
        });

  const override = rateOverride.trim() === "" ? null : Number(rateOverride);
  const total =
    quote && override !== null && Number.isFinite(override)
      ? override * quote.nightCount * rooms
      : (quote?.total ?? 0);
  const deposit = plan ? Math.round((total * Number(plan.deposit_percent)) / 100) : 0;

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-5">
      <fieldset className="space-y-4">
        <legend className={legend}>Guest</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Full name">
            <input name="contact_name" required autoFocus className={inputClass} />
          </Field>
          <Field label="Contact number">
            <input name="contact_phone" type="tel" required className={inputClass} />
          </Field>
          <Field label="Email">
            <input name="contact_email" type="email" required className={inputClass} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="ID type">
            <select name="id_type" className={inputClass} defaultValue="">
              <option value="">Collect at check-in</option>
              {Object.entries(ID_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ID / passport number" hint="Stored securely; only authorised roles can read it back.">
            <input name="id_number" autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Nationality">
            <input name="nationality" defaultValue="Indian" className={inputClass} />
          </Field>
          <Field label="Company">
            <select
              name="company_id"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputClass}
            >
              <option value="">Individual</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Check name="is_vip" label="VIP guest" hint="Gets the best-ranked room at assignment." />
        <Check name="blacklist_ok" label="Book even though the guest is blacklisted" hint="Only needed if the booking is refused for that reason." />
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>Stay</legend>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Field label="Arrival">
            <input
              type="date"
              name="check_in"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Departure">
            <input
              type="date"
              name="check_out"
              value={checkOut}
              min={checkIn}
              onChange={(e) => setCheckOut(e.target.value)}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Adults">
            <input type="number" name="adults" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value) || 1)} className={inputClass} />
          </Field>
          <Field label="Children">
            <input type="number" name="children" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value) || 0)} className={inputClass} />
          </Field>
          <Field label="Rooms">
            <input type="number" name="rooms_count" min={1} value={rooms} onChange={(e) => setRooms(Number(e.target.value) || 1)} className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Room type">
            <select name="room_type_id" value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} required className={inputClass}>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rate plan" hint={plan ? MEAL_PLAN_LABELS[plan.meal_plan] : undefined}>
            <select name="rate_plan_id" value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)} required className={inputClass}>
              {availablePlans.length === 0 && <option value="">No plan for this room type</option>}
              {availablePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({RATE_TYPE_LABELS[p.rate_type]})
                </option>
              ))}
            </select>
          </Field>
          {canOverrideRate && (
            <Field label="Override nightly rate (₹)" hint="Leave blank to use the calculated rate.">
              <input
                type="number"
                name="rate_override"
                min={0}
                step="1"
                value={rateOverride}
                onChange={(e) => setRateOverride(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>

        {quote && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            {quote.violations.length > 0 && (
              <ul className="mb-3 text-rose-800 text-xs space-y-1">
                {quote.violations.map((v) => (
                  <li key={v}>⚠ {v}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <p>
                <span className="text-slate-600">Nights</span> <strong className="font-medium">{quote.nightCount}</strong>
              </p>
              <p>
                <span className="text-slate-600">Average per room / night</span>{" "}
                <strong className="font-medium">{fmtMoney(override ?? quote.averageNightly)}</strong>
              </p>
              <p>
                <span className="text-slate-600">Total</span> <strong className="font-medium">{fmtMoney(total)}</strong>
              </p>
              {deposit > 0 && (
                <p>
                  <span className="text-slate-600">Deposit due</span> <strong className="font-medium">{fmtMoney(deposit)}</strong>
                </p>
              )}
            </div>
            {override === null && quote.nights.length > 1 && quote.nights.length <= 14 && (
              <p className="mt-2 text-[11px] text-slate-500">
                {quote.nights.map((n) => `${fmtDate(n.date).slice(0, 6)} ${fmtMoney(n.rate)}`).join(" · ")}
              </p>
            )}
            {plan && (
              <p className="mt-2 text-[11px] text-slate-600">
                {plan.is_refundable
                  ? `Free cancellation until ${plan.free_cancellation_hours}h before arrival.`
                  : "Non-refundable."}
                {plan.inclusions.length > 0 && ` Includes: ${plan.inclusions.join(", ")}.`}
              </p>
            )}
            {quote.violations.length > 0 && canOverbook && (
              <div className="mt-3">
                <Check name="override_restrictions" label="Sell anyway (override restrictions)" />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Preferred floor">
            <input type="number" name="preferred_floor" className={inputClass} />
          </Field>
          <Field label="Preferred view">
            <input name="preferred_view" placeholder="River" className={inputClass} />
          </Field>
          <Field label="Expected arrival time">
            <input type="time" name="eta" className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 border-t border-slate-100">
        <legend className={legend}>Booking</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Source">
            <select name="source" defaultValue={defaults.source} className={inputClass}>
              {Object.entries(BOOKING_SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              <option value="confirmed">Confirmed</option>
              <option value="tentative">Tentative (held)</option>
              <option value="waitlisted">Waitlisted</option>
            </select>
          </Field>
          <Field label="Payment method">
            <select name="payment_method" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Choose…
              </option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Promo code">
            <input name="promo_code" className={inputClass} />
          </Field>
        </div>

        <Field label="Special requests">
          <textarea name="special_requests" rows={2} className={inputClass} />
        </Field>

        {canTakePayment && status !== "waitlisted" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Deposit received now (₹)" hint={deposit > 0 ? `Plan asks for ${fmtMoney(deposit)}.` : undefined}>
              <input type="number" name="deposit_amount" min={0} step="0.01" className={inputClass} />
            </Field>
            <Field label="Deposit method">
              <select name="deposit_method" defaultValue="" className={inputClass}>
                <option value="">Same as payment method</option>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Transaction reference">
              <input name="deposit_reference" className={inputClass} />
            </Field>
          </div>
        )}

        {status === "confirmed" && (
          <Check name="send_confirmation" defaultChecked label="Email and text the confirmation to the guest" />
        )}
      </fieldset>

      <Banner error={state.error} />

      {state.overbooked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm text-amber-900">
          <p>
            Choose <strong>Waitlisted</strong> above to hold the request without a room
            {canOverbook ? ", or sell beyond capacity with a reason (recorded in the audit log):" : "."}
          </p>
          {canOverbook && (
            <Field label="Overbooking reason">
              <input name="overbook_reason" placeholder="e.g. owner's guest; expect a cancellation" className={inputClass} />
            </Field>
          )}
        </div>
      )}

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Creating…" : "Create booking"}
      </button>
    </form>
  );
}
