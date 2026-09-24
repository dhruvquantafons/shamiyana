import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { financialYearOf } from "../../../../lib/invoices";
import { todayIn } from "../../../../lib/dates";
import type { Invoice } from "../../../../lib/types";
import {
  Card,
  EmptyState,
  StatCard,
  Tag,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  tableHeadClass,
} from "../../../components/ui";

/**
 * Every tax invoice raised, newest first (SOW Module 7). Cancelled invoices
 * stay listed with their number: an invoice series has to be continuous for
 * the auditor, so nothing is ever removed or renumbered.
 */
export default async function InvoicesPage() {
  await requireAnyPermission(["folio.view", "folio.invoice"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const fy = financialYearOf(todayIn(settings.timezone));

  const { data } = await supabase
    .from("invoices")
    .select("*, bookings(reference, check_in, check_out), event_bookings(number, title, event_date)")
    .order("issued_at", { ascending: false })
    .limit(300);
  const invoices = (data ?? []) as Invoice[];

  const thisYear = invoices.filter((i) => i.financial_year === fy);
  const issued = thisYear.filter((i) => i.status === "issued");
  const billed = issued.reduce((s, i) => s + Number(i.grand_total), 0);
  const tax = issued.reduce((s, i) => s + Number(i.tax_total), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Financial year" value={fy} hint="1 April to 31 March" />
        <StatCard label="Invoices issued" value={issued.length} hint={`${thisYear.length - issued.length} cancelled`} />
        <StatCard label="Billed" value={fmtMoney(billed)} hint="Including tax" />
        <StatCard label={settings.tax_label} value={fmtMoney(tax)} hint="Collected this year" />
      </div>

      <Card>
        {invoices.length === 0 ? (
          <EmptyState message="No invoices have been issued yet. Raise one from a booking's Folio tab, or from an event." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Number</th>
                  <th className="py-2 pr-3 font-semibold">Issued</th>
                  <th className="py-2 pr-3 font-semibold">Billed to</th>
                  <th className="py-2 pr-3 font-semibold">Booking or event</th>
                  <th className="py-2 pr-3 font-semibold">Stay or function</th>
                  <th className="py-2 pr-3 font-semibold text-right">Taxable</th>
                  <th className="py-2 pr-3 font-semibold text-right">{settings.tax_label}</th>
                  <th className="py-2 pr-3 font-semibold text-right">Total</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {invoices.map((i) => (
                  <tr key={i.id} className={i.status === "cancelled" ? "text-slate-400" : ""}>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <Link
                        href={
                          i.event_id
                            ? `/admin/events/${i.event_id}/invoice/${i.id}`
                            : `/admin/bookings/${i.booking_id}/invoice/${i.id}`
                        }
                        className="font-mono text-yellow-700 hover:underline"
                      >
                        {i.number}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(i.issued_at)}</td>
                    <td className="py-2 pr-3">
                      {i.bill_to_name}
                      {i.bill_to_gstin && <span className="block text-[11px] text-slate-500">GSTIN {i.bill_to_gstin}</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {i.event_id ? (
                        <Link href={`/admin/events/${i.event_id}`} className="font-mono text-yellow-700 hover:underline">
                          {i.event_bookings?.number ?? "Event"}
                        </Link>
                      ) : (
                        <Link href={`/admin/bookings/${i.booking_id}`} className="font-mono text-yellow-700 hover:underline">
                          {i.bookings?.reference ?? "—"}
                        </Link>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {i.event_bookings
                        ? `${i.event_bookings.title} · ${fmtDate(i.event_bookings.event_date)}`
                        : i.bookings
                          ? `${fmtDate(i.bookings.check_in)} → ${fmtDate(i.bookings.check_out)}`
                          : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtMoney(i.net_total)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtMoney(i.tax_total)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">{fmtMoney(i.grand_total)}</td>
                    <td className="py-2 pr-4">
                      <Tag tone={i.status === "issued" ? "green" : "red"}>
                        {i.status === "issued" ? "Issued" : "Cancelled"}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
