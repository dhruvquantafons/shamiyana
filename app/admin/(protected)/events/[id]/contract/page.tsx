import { notFound } from "next/navigation";
import { requireAnyPermission } from "../../../../../lib/auth";
import { getSettings } from "../../../../../lib/settings";
import { advanceDue, amountPaid, billablePax, hhmm } from "../../../../../lib/events";
import { EVENT_TYPE_LABELS } from "../../../../../lib/types";
import { fmtDate, fmtMoney } from "../../../../components/ui";
import { AddressedTo, ChargeTable, DocumentShell, loadEventDocument } from "../shared";

/**
 * The contract the client signs (SOW Module 10 "contract generation").
 *
 * The same figures as the quotation, with the terms the hotel actually holds
 * the client to and a place for both signatures. The terms come from property
 * settings so the hotel writes them once, in its own words, rather than
 * having them hard-coded into a document nobody can change.
 */
export default async function EventContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["events.view", "events.book"]);
  const { id } = await params;
  const settings = await getSettings();
  const doc = await loadEventDocument(id);
  if (!doc) notFound();

  const { event, payments } = doc;
  const pax = billablePax(event);
  const deposit = advanceDue(Number(event.grand_total), settings.event_advance_percent);
  const paid = amountPaid(payments);

  return (
    <DocumentShell
      eventId={id}
      settings={settings}
      kind="Function contract"
      reference={event.number}
      issued={
        event.contract_signed_on
          ? `Signed ${fmtDate(event.contract_signed_on)} by ${event.contract_signed_name}`
          : "Not yet signed"
      }
      aside={
        <p className="text-xs text-slate-700">
          {EVENT_TYPE_LABELS[event.event_type]} on {fmtDate(event.event_date)}
        </p>
      }
    >
      {event.status !== "confirmed" && event.status !== "completed" && (
        <p className="mb-5 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-2 text-xs font-medium">
          NOT YET CONFIRMED — the hall is not held until this event is confirmed in the system.
        </p>
      )}
      {event.status === "cancelled" && (
        <p className="mb-5 border border-rose-300 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 text-xs font-medium">
          CANCELLED — {event.cancel_reason}
        </p>
      )}

      <p className="text-xs text-slate-700 mb-5">
        This agreement is made between {settings.legal_name || settings.name} (&ldquo;the hotel&rdquo;) and the client
        named below (&ldquo;the client&rdquo;) for the function described, on the terms set out at the end.
      </p>

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
          {event.event_layouts && <p>{event.event_layouts.name} seating</p>}
          <p className="mt-1">
            Guaranteed for {event.pax_guaranteed > 0 ? event.pax_guaranteed : pax} guests
          </p>
          <p className="text-slate-600">
            The hall is held from {hhmm(event.setup_from)} for setting up until {hhmm(event.teardown_to)} for clearing.
          </p>
        </div>
      </div>

      <ChargeTable doc={doc} settings={settings} pax={pax} />

      <div className="mt-6 pt-4 border-t border-slate-100 text-xs space-y-2">
        <p className="text-slate-500 uppercase tracking-wider text-[10px]">Payment</p>
        {settings.event_advance_percent > 0 && (
          <p>
            A deposit of {settings.event_advance_percent}% ({fmtMoney(deposit)}) is payable to confirm this booking.
            {paid > 0 ? ` ${fmtMoney(paid)} has been received.` : ""}
          </p>
        )}
        <p>
          The balance of {fmtMoney(Number(event.grand_total) - paid)} is payable as agreed. Where the hotel has
          extended credit to a company, the amount falls due on that company&rsquo;s own terms.
        </p>
        <p>
          The final bill is raised on the guaranteed head count of{" "}
          {event.pax_guaranteed > 0 ? event.pax_guaranteed : pax}, or on the number who attend if that is higher.
        </p>
        {event.payment_terms && (
          <p className="whitespace-pre-line">
            <strong>Agreed terms:</strong> {event.payment_terms}
          </p>
        )}
      </div>

      {settings.event_terms ? (
        <div className="mt-6 pt-4 border-t border-slate-100">
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Terms</p>
          <p className="text-[11px] text-slate-700 whitespace-pre-line">{settings.event_terms}</p>
        </div>
      ) : (
        <p className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-amber-800 print:hidden">
          No event terms have been set. Add the hotel&rsquo;s cancellation terms, head-count deadline and damage terms
          under Settings → Events, and they will print here.
        </p>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
        <div>
          <div className="h-16 border-b border-slate-400" />
          <p className="mt-1">For the client</p>
          <p className="text-slate-500">
            {event.contract_signed_name || "Name"}
            {event.contract_signed_on ? ` · ${fmtDate(event.contract_signed_on)}` : " · Date"}
          </p>
        </div>
        <div>
          <div className="h-16 border-b border-slate-400" />
          <p className="mt-1">For {settings.name}</p>
          <p className="text-slate-500">Name · Date</p>
        </div>
      </div>
    </DocumentShell>
  );
}
