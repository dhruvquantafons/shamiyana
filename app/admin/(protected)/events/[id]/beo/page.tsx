import { notFound } from "next/navigation";
import { requireAnyPermission } from "../../../../../lib/auth";
import { getSettings } from "../../../../../lib/settings";
import { billablePax, clientName, hhmm } from "../../../../../lib/events";
import { EVENT_LINE_KIND_LABELS, EVENT_TYPE_LABELS, MEAL_PERIOD_LABELS } from "../../../../../lib/types";
import { fmtDate } from "../../../../components/ui";
import { DocumentShell, loadEventDocument } from "../shared";

/**
 * The Banquet Event Order (SOW Module 10 "BEO generation").
 *
 * This one is not for the client. It goes on the kitchen wall and into the
 * stewards' folder, so it leads with the head count and the times and carries
 * no prices at all — a department reading it needs to know what to do, and a
 * price on a kitchen sheet is only a way of leaking the contract.
 */
export default async function EventOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["events.view", "events.book"]);
  const { id } = await params;
  const settings = await getSettings();
  const doc = await loadEventDocument(id);
  if (!doc) notFound();

  const { event, lines, pkg } = doc;
  const pax = billablePax(event);
  const equipment = lines.filter((l) => l.kind === "equipment");
  const extras = lines.filter((l) => l.kind !== "equipment");

  const section = (title: string, body: string, fallback: string) => (
    <div>
      <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">{title}</p>
      {body ? (
        <p className="text-xs whitespace-pre-line">{body}</p>
      ) : (
        <p className="text-xs text-slate-400">{fallback}</p>
      )}
    </div>
  );

  return (
    <DocumentShell
      eventId={id}
      settings={settings}
      kind="Banquet event order"
      reference={event.number}
      issued={`${fmtDate(event.event_date)} · ${hhmm(event.start_time)} to ${hhmm(event.end_time)}`}
      aside={<p className="text-xs text-slate-700">{EVENT_TYPE_LABELS[event.event_type]}</p>}
    >
      {event.status === "cancelled" && (
        <p className="mb-5 border border-rose-300 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 text-xs font-semibold">
          CANCELLED — do not set up. {event.cancel_reason}
        </p>
      )}
      {event.status !== "confirmed" && event.status !== "completed" && event.status !== "cancelled" && (
        <p className="mb-5 border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-2 text-xs font-semibold">
          NOT CONFIRMED — this is a plan, not a booking. Do not order stock against it.
        </p>
      )}

      {/* The four things every department needs before anything else. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 pb-5 border-b border-slate-200">
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px]">Covers</p>
          <p className="text-2xl font-semibold leading-tight">{pax}</p>
          <p className="text-[11px] text-slate-600">
            {event.pax_actual !== null
              ? "attended"
              : event.pax_guaranteed > 0
                ? "guaranteed"
                : "expected"}
          </p>
        </div>
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px]">Serving</p>
          <p className="text-lg font-semibold leading-tight">
            {hhmm(event.start_time)}–{hhmm(event.end_time)}
          </p>
          <p className="text-[11px] text-slate-600">
            Room from {hhmm(event.setup_from)}, cleared by {hhmm(event.teardown_to)}
          </p>
        </div>
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px]">Room</p>
          <p className="text-sm font-medium leading-tight">{event.event_spaces?.name}</p>
          <p className="text-[11px] text-slate-600">
            {[
              event.event_spaces?.floor !== null && event.event_spaces?.floor !== undefined
                ? `Floor ${event.event_spaces.floor}`
                : null,
              event.event_layouts ? `${event.event_layouts.name} seating` : "Seating not chosen",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px]">Host</p>
          <p className="text-sm font-medium leading-tight">{clientName(event)}</p>
          <p className="text-[11px] text-slate-600">
            {[event.contact_name, event.contact_phone].filter(Boolean).join(" · ") || "No contact given"}
          </p>
        </div>
      </div>

      <p className="text-base font-semibold mb-5">{event.title}</p>

      <div className="space-y-5">
        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Catering</p>
          {pkg ? (
            <>
              <p className="text-xs">
                {pkg.name} ({MEAL_PERIOD_LABELS[pkg.meal_period]}) for {pax} covers
              </p>
              {pkg.inclusions.length > 0 && (
                <ul className="mt-1 text-xs list-disc pl-5 space-y-0.5">
                  {pkg.inclusions.map((inc, i) => (
                    <li key={i}>{inc}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400">No catering package on this function.</p>
          )}
          {extras.length > 0 && (
            <ul className="mt-2 text-xs list-disc pl-5 space-y-0.5">
              {extras.map((l) => (
                <li key={l.id}>
                  {l.description} — {l.qty} ({EVENT_LINE_KIND_LABELS[l.kind]})
                </li>
              ))}
            </ul>
          )}
        </div>

        {section("Menu and dietary notes", event.menu_notes, "Nothing recorded — check with the host.")}
        {section("Setting up", event.beo_setup_notes, "Nothing recorded.")}
        {section("Service", event.beo_service_notes, "Nothing recorded.")}

        <div>
          <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Equipment</p>
          {equipment.length === 0 ? (
            <p className="text-xs text-slate-400">None ordered.</p>
          ) : (
            <ul className="text-xs list-disc pl-5 space-y-0.5">
              {equipment.map((l) => (
                <li key={l.id}>
                  {l.description} × {l.qty}
                </li>
              ))}
            </ul>
          )}
        </div>

        {section("Audio-visual", event.beo_av_notes, "Nothing recorded.")}
        {event.notes ? section("Other notes", event.notes, "") : null}
      </div>

      <div className="mt-8 pt-4 border-t border-slate-200 grid grid-cols-3 gap-6 text-[11px]">
        {["Kitchen", "Banquets", "Audio-visual"].map((dept) => (
          <div key={dept}>
            <div className="h-10 border-b border-slate-300" />
            <p className="mt-1 text-slate-600">{dept} — read and understood</p>
          </div>
        ))}
      </div>

      <p className="mt-5 text-[11px] text-slate-500">
        Covers shown are what the function is billed for. Any change to the head count after the hotel&rsquo;s deadline
        has to go through the banquet office, not the kitchen. Prices are deliberately not printed on this sheet.
      </p>
    </DocumentShell>
  );
}
