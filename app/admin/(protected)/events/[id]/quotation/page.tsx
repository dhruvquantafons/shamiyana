import { notFound } from "next/navigation";
import { requireAnyPermission } from "../../../../../lib/auth";
import { getSettings } from "../../../../../lib/settings";
import { advanceDue, amountPaid, billablePax, eventBalance, hhmm } from "../../../../../lib/events";
import { EVENT_TYPE_LABELS, MEAL_PERIOD_LABELS } from "../../../../../lib/types";
import { fmtDate, fmtDateTime, fmtMoney } from "../../../../components/ui";
import { AddressedTo, ChargeTable, DocumentShell, loadEventDocument } from "../shared";

/**
 * The quotation the client is sent (SOW Module 10 "quotation generation").
 *
 * It is a proposal, not a bill: it says what is included, what it costs, what
 * deposit holds the date, and until when the price stands. A quotation above
 * the property's threshold is marked as subject to approval until it has one,
 * so nobody sends a number the hotel has not agreed to.
 */
export default async function EventQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["events.view", "events.quote", "events.book"]);
  const { id } = await params;
  const settings = await getSettings();
  const doc = await loadEventDocument(id);
  if (!doc) notFound();

  const { event, pkg, payments } = doc;
  const pax = billablePax(event);
  const deposit = advanceDue(Number(event.grand_total), settings.event_advance_percent);
  const paid = amountPaid(payments);
  const owing = eventBalance(event, payments);
  const awaitingApproval = event.approval_required && !event.approved_at;

  return (
    <DocumentShell
      eventId={id}
      settings={settings}
      kind="Quotation"
      reference={event.number}
      issued={event.quoted_at ? `Prepared ${fmtDateTime(event.quoted_at)}` : "Draft — not yet prepared"}
      aside={
        <p className="text-xs text-slate-700">
          {EVENT_TYPE_LABELS[event.event_type]} on {fmtDate(event.event_date)}
        </p>
      }
    >
      {awaitingApproval && (
        <p className="mb-5 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-2 text-xs font-medium">
          SUBJECT TO APPROVAL — this quotation is at or above {fmtMoney(settings.event_quote_approval_threshold)} and
          has not yet been approved. Do not send it to the client.
        </p>
      )}
      {event.status === "cancelled" && (
        <p className="mb-5 border border-rose-300 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 text-xs font-medium">
          CANCELLED — {event.cancel_reason}
        </p>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6 text-xs">
        <AddressedTo doc={doc} />
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px]">The function</p>
          <p className="text-sm">{event.title}</p>
          <p>
            {fmtDate(event.event_date)} · {hhmm(event.start_time)} to {hhmm(event.end_time)}
          </p>
          <p>
            {event.event_spaces?.name}
            {event.event_spaces?.floor !== null && event.event_spaces?.floor !== undefined
              ? `, floor ${event.event_spaces.floor}`
              : ""}
          </p>
          {event.event_layouts && (
            <p>
              {event.event_layouts.name} seating · seats {event.event_layouts.capacity}
            </p>
          )}
          <p className="mt-1">
            Quoted for {pax} {pax === 1 ? "guest" : "guests"}
            {event.pax_guaranteed > 0 ? ` (guaranteed ${event.pax_guaranteed})` : ""}
          </p>
        </div>
      </div>

      <ChargeTable doc={doc} settings={settings} pax={pax} />

      {pkg && pkg.inclusions.length > 0 && (
        <div className="mt-6 pt-4 border-t border-slate-100">
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">
            {pkg.name} includes ({MEAL_PERIOD_LABELS[pkg.meal_period]})
          </p>
          <ul className="text-xs list-disc pl-5 space-y-0.5">
            {pkg.inclusions.map((inc, i) => (
              <li key={i}>{inc}</li>
            ))}
          </ul>
          {pkg.min_pax > 0 && (
            <p className="mt-1 text-[11px] text-slate-600">
              This package is served for a minimum of {pkg.min_pax} guests.
            </p>
          )}
        </div>
      )}

      {event.menu_notes && (
        <div className="mt-4">
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Menu notes</p>
          <p className="text-xs whitespace-pre-line">{event.menu_notes}</p>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-slate-100 text-xs space-y-1">
        <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">To hold the date</p>
        {settings.event_advance_percent > 0 ? (
          <p>
            A deposit of {settings.event_advance_percent}% — {fmtMoney(deposit)} — confirms the booking. The hall is
            not held until the event is confirmed.
          </p>
        ) : (
          <p>The hall is held once this quotation is accepted and the event is confirmed.</p>
        )}
        {paid > 0 && (
          <p>
            {fmtMoney(paid)} has already been received, leaving {fmtMoney(owing)}.
          </p>
        )}
        <p className="text-slate-600">
          Prices are quoted for the head count above. The final bill is raised on the guaranteed number, or the number
          who attend if that is higher.
        </p>
      </div>

      {event.payment_terms && (
        <div className="mt-4 text-xs">
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Payment terms</p>
          <p className="whitespace-pre-line">{event.payment_terms}</p>
        </div>
      )}

      {settings.event_terms && (
        <p className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-600 whitespace-pre-line">
          {settings.event_terms}
        </p>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        This is a quotation, not a tax invoice. A GST invoice is issued when the event is billed.
      </p>
    </DocumentShell>
  );
}
