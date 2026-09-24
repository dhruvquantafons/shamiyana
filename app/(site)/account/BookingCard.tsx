"use client";

import { useActionState, useState } from "react";
import {
  cancelGuestBooking,
  startGuestPayment,
  type GuestBooking,
  type PortalState,
} from "../../lib/guest-portal";
import { displayMoney, type DisplayCurrency } from "../../lib/portal-i18n";

const button =
  "bg-[#d4af37] text-[#0b131b] font-medium text-xs rounded-md px-3.5 py-2 hover:bg-[#c19f2e] disabled:opacity-60 transition-colors";
const quiet =
  "border border-white/15 text-slate-300 font-medium text-xs rounded-md px-3.5 py-2 hover:border-[#d4af37] hover:text-[#d4af37] disabled:opacity-60 transition-colors";
const danger =
  "border border-red-500/30 text-red-300 font-medium text-xs rounded-md px-3.5 py-2 hover:bg-red-500/10 disabled:opacity-60 transition-colors";

const STATUS: Record<string, { label: string; tone: string }> = {
  tentative: { label: "Awaiting confirmation", tone: "bg-amber-500/15 text-amber-300" },
  waitlisted: { label: "On the waiting list", tone: "bg-sky-500/15 text-sky-300" },
  confirmed: { label: "Confirmed", tone: "bg-emerald-500/15 text-emerald-300" },
  checked_in: { label: "You are with us", tone: "bg-emerald-500/15 text-emerald-300" },
  checked_out: { label: "Completed", tone: "bg-white/10 text-slate-400" },
  cancelled: { label: "Cancelled", tone: "bg-red-500/15 text-red-300" },
  no_show: { label: "Not arrived", tone: "bg-red-500/15 text-red-300" },
};

function Message({ state }: { state: PortalState }) {
  if (!state.error && !state.success) return null;
  return (
    <p
      role="status"
      className={`text-xs leading-relaxed rounded-md px-3 py-2 mt-3 ${
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
 * One stay on the account.
 *
 * What the guest may do depends on where the stay has got to: an upcoming
 * booking can be paid for and cancelled, a stay in progress or finished can
 * only be looked at. The cancellation terms are spelled out before the button
 * is offered, because a guest should know what cancelling costs before they
 * press it rather than after.
 */
export default function BookingCard({
  booking,
  currency,
  labels,
}: {
  booking: GuestBooking;
  /**
   * The currency the guest chose to read prices in, or null for the
   * property's own. A formatter cannot be passed in from a Server Component,
   * so the rate comes across as data and the conversion happens here.
   */
  currency: DisplayCurrency | null;
  labels: { payNow: string; cancelBooking: string; free: string };
}) {
  const money = (amount: number) => displayMoney(amount, currency);
  const [confirming, setConfirming] = useState(false);
  const [cancelState, cancelAction, cancelling] = useActionState<PortalState, FormData>(
    cancelGuestBooking,
    {},
  );
  const [payState, payAction, paying] = useActionState<PortalState, FormData>(startGuestPayment, {});

  const status = STATUS[booking.status] ?? { label: booking.status, tone: "bg-white/10 text-slate-400" };
  const upcoming = ["tentative", "confirmed", "waitlisted"].includes(booking.status);
  const plan = booking.rate_plans;

  const depositDue = Math.max(0, Number(booking.deposit_required ?? 0) - booking.paid);
  const canPay = upcoming && booking.outstanding > 0;

  const terms = !plan
    ? null
    : plan.is_refundable
      ? `Free cancellation until ${plan.free_cancellation_hours} hours before arrival. After that a charge applies.`
      : "This is a non-refundable rate, so cancelling will be charged.";

  return (
    <article className="bg-white/[0.04] border border-white/10 rounded-lg p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-lg text-white">
              {booking.room_types?.name ?? "Room"}
            </h3>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-mono">{booking.reference}</p>
        </div>
        <div className="sm:ml-auto text-left sm:text-right">
          <p className="text-sm text-white">
            {booking.check_in} &rarr; {booking.check_out}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {booking.rooms_count > 1 ? `${booking.rooms_count} rooms · ` : ""}
            {booking.adults} {booking.adults === 1 ? "adult" : "adults"}
            {booking.children > 0 ? `, ${booking.children} children` : ""}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-white/10 text-xs">
        <div>
          <dt className="text-slate-500">Rate</dt>
          <dd className="text-slate-200 mt-0.5">{plan?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Total</dt>
          <dd className="text-slate-200 mt-0.5">{money(Number(booking.total_amount ?? 0))}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Paid</dt>
          <dd className="text-slate-200 mt-0.5">
            {booking.paid > 0 ? money(booking.paid) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Still to pay</dt>
          <dd className="text-slate-200 mt-0.5">
            {booking.outstanding > 0 ? money(booking.outstanding) : labels.free}
          </dd>
        </div>
      </dl>

      {Number(booking.promo_discount ?? 0) > 0 && (
        <p className="text-xs text-emerald-300/90 mt-3">
          {booking.promo_code
            ? `Promo code ${booking.promo_code} saved you ${money(Number(booking.promo_discount))}.`
            : `A discount of ${money(Number(booking.promo_discount))} was applied.`}
        </p>
      )}

      {booking.status === "cancelled" && Number(booking.penalty_amount ?? 0) > 0 && !booking.penalty_waived && (
        <p className="text-xs text-red-300/90 mt-3">
          A cancellation charge of {money(Number(booking.penalty_amount))} applied to this booking.
        </p>
      )}

      {upcoming && (
        <div className="mt-5 pt-4 border-t border-white/10">
          {terms && <p className="text-[11px] text-slate-500 leading-relaxed mb-3">{terms}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {booking.openPaymentUrl ? (
              <a href={booking.openPaymentUrl} className={button} rel="noreferrer">
                Continue your payment
              </a>
            ) : (
              canPay && (
                <form action={payAction} className="contents">
                  <input type="hidden" name="booking_id" value={booking.id} />
                  {depositDue > 0 && depositDue < booking.outstanding ? (
                    <>
                      <button
                        type="submit"
                        name="amount_kind"
                        value="deposit"
                        disabled={paying}
                        className={button}
                      >
                        {paying ? "Opening…" : `${labels.payNow} — ${money(depositDue)}`}
                      </button>
                      <button
                        type="submit"
                        name="amount_kind"
                        value="full"
                        disabled={paying}
                        className={quiet}
                      >
                        Pay in full — {money(booking.outstanding)}
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      name="amount_kind"
                      value="full"
                      disabled={paying}
                      className={button}
                    >
                      {paying ? "Opening…" : `Pay now — ${money(booking.outstanding)}`}
                    </button>
                  )}
                </form>
              )
            )}

            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)} className={danger}>
                {labels.cancelBooking}
              </button>
            ) : (
              <form action={cancelAction} className="contents">
                <input type="hidden" name="booking_id" value={booking.id} />
                <input
                  name="reason"
                  placeholder="Reason (optional)"
                  aria-label="Reason for cancelling"
                  className="bg-white/5 border border-white/15 rounded-md px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#d4af37] focus:outline-none"
                />
                <button type="submit" disabled={cancelling} className={danger}>
                  {cancelling ? "Cancelling…" : "Yes, cancel it"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[11px] text-slate-400 hover:text-white transition-colors px-2"
                >
                  Keep it
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <Message state={payState} />
      <Message state={cancelState} />
    </article>
  );
}
