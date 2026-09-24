import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../../lib/auth";
import { getSettings } from "../../../../../../lib/settings";
import { hhmm } from "../../../../../../lib/events";
import type { EventBooking, Invoice } from "../../../../../../lib/types";
import { fmtDate, fmtDateTime, fmtMoney } from "../../../../../components/ui";
import PrintButton from "../../../../../components/PrintButton";

/**
 * A GST invoice for an event.
 *
 * It comes from the property's own invoice series — the same run of numbers a
 * room invoice takes — because the tax law wants one continuous series for
 * the whole business, not one per department. Everything printed here is read
 * from the invoice row rather than the live event, so a document already given
 * to a client keeps saying what it said.
 */
export default async function EventInvoicePage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  await requireAnyPermission(["folio.view", "events.view", "events.bill"]);
  const { id, invoiceId } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase
    .from("invoices")
    .select("*, event_bookings(number, title, event_date, start_time, end_time, event_spaces(name))")
    .eq("id", invoiceId)
    .eq("event_id", id)
    .maybeSingle();
  if (!data) notFound();

  const invoice = data as Invoice & {
    event_bookings:
      | (Pick<EventBooking, "number" | "title" | "event_date" | "start_time" | "end_time"> & {
          event_spaces: { name: string } | null;
        })
      | null;
  };
  const event = invoice.event_bookings;
  const cancelled = invoice.status === "cancelled";

  return (
    <div className="max-w-3xl mx-auto bg-white print:shadow-none">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link
          href={`/admin/events/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the event
        </Link>
        <PrintButton />
      </div>

      <div
        className={`border rounded-xl p-8 print:border-0 print:p-0 text-sm text-slate-900 ${
          cancelled ? "border-rose-300" : "border-slate-200"
        }`}
      >
        {cancelled && (
          <p className="mb-5 border border-rose-300 bg-rose-50 text-rose-800 rounded-lg px-4 py-2 text-xs font-medium">
            CANCELLED — {invoice.cancel_reason}. This invoice is void; the number stays on record and is not reused.
          </p>
        )}

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
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Tax invoice</p>
            <p className="font-mono text-base">{invoice.number}</p>
            <p className="text-xs text-slate-700 mt-1">Issued {fmtDateTime(invoice.issued_at)}</p>
            <p className="text-xs text-slate-700">Event {event?.number}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6 text-xs">
          <div>
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Billed to</p>
            <p className="text-sm">{invoice.bill_to_name}</p>
            {invoice.bill_to_address && <p className="whitespace-pre-line">{invoice.bill_to_address}</p>}
            {invoice.bill_to_gstin && <p>GSTIN {invoice.bill_to_gstin}</p>}
            {invoice.place_of_supply && <p className="mt-1">Place of supply: {invoice.place_of_supply}</p>}
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">The function</p>
            {event && (
              <>
                <p className="text-sm">{event.title}</p>
                <p>
                  {fmtDate(event.event_date)} · {hhmm(event.start_time)} to {hhmm(event.end_time)}
                </p>
                <p>{event.event_spaces?.name}</p>
              </>
            )}
          </div>
        </div>

        <table className="w-full text-xs mb-6">
          <thead>
            <tr className="border-b border-slate-900 text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Taxable value</th>
              <th className="py-2 text-right">{settings.tax_label}</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 whitespace-nowrap">{fmtDate(l.date)}</td>
                <td className="py-1.5">{l.description}</td>
                <td className="py-1.5 text-right">{fmtMoney(l.net)}</td>
                <td className="py-1.5 text-right">{l.tax ? `${fmtMoney(l.tax)} @ ${l.tax_rate}%` : "—"}</td>
                <td className="py-1.5 text-right">{fmtMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap justify-between gap-8">
          {invoice.tax_breakdown.length > 0 && (
            <div className="text-xs">
              <p className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">
                {settings.tax_label} summary
              </p>
              <table>
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pr-6 font-medium">Rate</th>
                    <th className="pr-6 font-medium">Taxable value</th>
                    <th className="font-medium">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.tax_breakdown.map((b) => (
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
              <span>{fmtMoney(invoice.net_total)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-700">{settings.tax_label}</span>
              <span>{fmtMoney(invoice.tax_total)}</span>
            </p>
            <p className="flex justify-between border-t border-slate-900 pt-2 font-semibold">
              <span>Invoice total</span>
              <span>{fmtMoney(invoice.grand_total)}</span>
            </p>
          </div>
        </div>

        {settings.invoice_terms && (
          <p className="mt-8 pt-4 border-t border-slate-100 text-[11px] text-slate-600 whitespace-pre-line">
            {settings.invoice_terms}
          </p>
        )}
        <p className="mt-4 text-[11px] text-slate-500">
          This is a computer-generated invoice. Deposits and payments received against this event are recorded on the
          event itself.
        </p>
      </div>
    </div>
  );
}
