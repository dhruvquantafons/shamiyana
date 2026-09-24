import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import type {
  EventBooking,
  EventLine,
  EventPackage,
  EventPayment,
  EventSpace,
  PropertySettings,
} from "../../../../lib/types";
import PrintButton from "../../../components/PrintButton";
import { fmtMoney } from "../../../components/ui";

/**
 * The parts the quotation, the contract and the event order share: the same
 * letterhead, the same way of loading an event, and the same table of what is
 * being charged. Three documents that disagree about the price are worse than
 * one, so they are all drawn from one place.
 */

export interface EventDocument {
  event: EventBooking & { event_spaces: EventSpace | null };
  lines: EventLine[];
  payments: EventPayment[];
  pkg: EventPackage | null;
}

export async function loadEventDocument(id: string): Promise<EventDocument | null> {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("event_bookings")
    .select(
      "*, event_spaces(*), event_layouts(name, capacity), event_packages(*), companies(name, gstin, billing_address), guests(full_name, phone, email), bookings(reference, check_in, check_out)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;

  const event = row as EventBooking & {
    event_spaces: EventSpace | null;
    event_packages: EventPackage | null;
  };

  const [{ data: lineRows }, { data: payRows }] = await Promise.all([
    supabase.from("event_lines").select("*").eq("event_id", id).order("sort_order").order("created_at"),
    supabase.from("event_payments").select("*").eq("event_id", id).is("voided_at", null).order("created_at"),
  ]);

  return {
    event,
    lines: (lineRows ?? []) as EventLine[],
    payments: (payRows ?? []) as EventPayment[],
    pkg: event.event_packages ?? null,
  };
}

/** The letterhead and the frame every event document is printed on. */
export function DocumentShell({
  eventId,
  settings,
  kind,
  reference,
  issued,
  aside,
  children,
}: {
  eventId: string;
  settings: PropertySettings;
  kind: string;
  reference: string;
  issued: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto bg-white print:shadow-none">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link
          href={`/admin/events/${eventId}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the event
        </Link>
        <PrintButton />
      </div>

      <div className="border border-slate-200 rounded-xl p-8 print:border-0 print:p-0 text-sm text-slate-900">
        <div className="flex justify-between gap-6 border-b border-slate-200 pb-5 mb-5">
          <div>
            <p className="text-xl font-semibold tracking-tight">{settings.name}</p>
            <p className="text-xs text-slate-700 mt-1 whitespace-pre-line">
              {[
                settings.legal_name,
                settings.address,
                [settings.city, settings.state, settings.postcode].filter(Boolean).join(", "),
              ]
                .filter(Boolean)
                .join("\n")}
            </p>
            <p className="text-xs text-slate-700">
              {[settings.phone, settings.email].filter(Boolean).join(" · ")}
              {settings.gstin && ` · GSTIN ${settings.gstin}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{kind}</p>
            <p className="font-mono text-base">{reference}</p>
            <p className="text-xs text-slate-700 mt-1">{issued}</p>
            {aside}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** What is being charged, as the client reads it. */
export function ChargeTable({
  doc,
  settings,
  pax,
}: {
  doc: EventDocument;
  settings: PropertySettings;
  pax: number;
}) {
  const { event, lines, pkg } = doc;

  const rows: { what: string; detail: string; net: number; rate: number; tax: number }[] = [];

  if (Number(event.rental_net) !== 0) {
    rows.push({
      what: `${event.event_spaces?.name ?? "Hall"} hire`,
      detail:
        event.rental_basis === "hourly"
          ? `${event.rental_hours} hours`
          : event.rental_basis === "half_day"
            ? "Half day"
            : event.rental_basis === "custom"
              ? "As agreed"
              : "Full day",
      net: Number(event.rental_net),
      rate: Number(event.event_spaces?.tax_rate ?? 0),
      tax: Number(event.rental_tax),
    });
  }

  if (pkg && Number(event.catering_net) !== 0) {
    rows.push({
      what: pkg.name,
      detail: `${fmtMoney(pkg.price_per_head)} per head × ${pax}`,
      net: Number(event.catering_net),
      rate: Number(pkg.tax_rate),
      tax: Number(event.catering_tax),
    });
  }

  const keep = 1 - Number(event.discount_percent) / 100;
  for (const l of lines) {
    rows.push({
      what: l.description,
      detail: `${l.qty} × ${fmtMoney(l.unit_price)}`,
      net: Math.round(Number(l.net_amount) * keep * 100) / 100,
      rate: Number(l.tax_rate),
      tax: Math.round(Number(l.tax_amount) * keep * 100) / 100,
    });
  }

  if (Number(event.service_net) !== 0) {
    rows.push({
      what: "Service charge",
      detail: `${settings.event_service_charge_percent}%`,
      net: Number(event.service_net),
      rate: Number(event.event_spaces?.tax_rate ?? 0),
      tax: Number(event.service_tax),
    });
  }

  return (
    <>
      <table className="w-full text-xs mb-5">
        <thead>
          <tr className="border-b border-slate-900 text-left">
            <th className="py-2">Item</th>
            <th className="py-2">Basis</th>
            <th className="py-2 text-right">Taxable value</th>
            <th className="py-2 text-right">{settings.tax_label}</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1.5">{r.what}</td>
              <td className="py-1.5 text-slate-600">{r.detail}</td>
              <td className="py-1.5 text-right">{fmtMoney(r.net)}</td>
              <td className="py-1.5 text-right">{r.tax ? `${fmtMoney(r.tax)} @ ${r.rate}%` : "—"}</td>
              <td className="py-1.5 text-right">{fmtMoney(r.net + r.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {Number(event.discount_amount) > 0 && (
        <p className="text-[11px] text-slate-600 mb-3">
          A discount of {event.discount_percent}% ({fmtMoney(event.discount_amount)}) has already been applied to
          every line above.
        </p>
      )}

      <div className="flex flex-wrap justify-between gap-8">
        {event.tax_breakdown.length > 0 && (
          <div className="text-xs">
            <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">{settings.tax_label} summary</p>
            <table>
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pr-6 font-medium">Rate</th>
                  <th className="pr-6 font-medium">Taxable value</th>
                  <th className="font-medium">Tax</th>
                </tr>
              </thead>
              <tbody>
                {event.tax_breakdown.map((b) => (
                  <tr key={b.rate}>
                    <td className="pr-6 py-0.5">{b.rate}%</td>
                    <td className="pr-6 py-0.5">{fmtMoney(b.net)}</td>
                    <td className="py-0.5">{fmtMoney(b.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ml-auto min-w-[14rem] space-y-1 text-sm">
          <p className="flex justify-between">
            <span className="text-slate-700">Taxable value</span>
            <span>{fmtMoney(event.net_total)}</span>
          </p>
          <p className="flex justify-between">
            <span className="text-slate-700">{settings.tax_label}</span>
            <span>{fmtMoney(event.tax_total)}</span>
          </p>
          <p className="flex justify-between border-t border-slate-900 pt-2 font-semibold">
            <span>Total</span>
            <span>{fmtMoney(event.grand_total)}</span>
          </p>
        </div>
      </div>
    </>
  );
}

/** Who the document is addressed to. */
export function AddressedTo({ doc }: { doc: EventDocument }) {
  const { event } = doc;
  const lines = [
    event.companies?.name,
    event.guests?.full_name,
    event.contact_name && event.contact_name !== event.guests?.full_name ? event.contact_name : null,
    event.companies?.billing_address,
    event.contact_phone,
    event.contact_email,
    event.companies?.gstin ? `GSTIN ${event.companies.gstin}` : null,
  ].filter(Boolean) as string[];

  return (
    <div>
      <p className="text-slate-500 uppercase tracking-wider text-[10px]">For the attention of</p>
      {lines.length === 0 ? (
        <p className="text-sm">—</p>
      ) : (
        lines.map((l, i) => (
          <p key={i} className={i === 0 ? "text-sm" : "text-xs whitespace-pre-line"}>
            {l}
          </p>
        ))
      )}
    </div>
  );
}
