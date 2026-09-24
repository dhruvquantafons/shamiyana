import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { getSettings } from "../../../../../lib/settings";
import { loadFolio, billLines } from "../../../../../lib/folio";
import type { Booking } from "../../../../../lib/types";
import { PAYMENT_METHOD_LABELS } from "../../../../../lib/types";
import { fmtDate, fmtDateTime, fmtMoney } from "../../../../components/ui";
import PrintButton from "../../../../components/PrintButton";

/**
 * Printable guest bill (pro-forma). Tax invoices with sequential numbering
 * belong to Module 7; this is the running folio the desk hands over.
 */
export default async function FolioPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["folio.view", "bookings.view"]);
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase
    .from("bookings")
    .select("*, rooms(room_number), room_types(name), companies(name, gstin, billing_address)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const booking = data as Booking & { companies: { name: string; gstin: string; billing_address: string } | null };
  const { entries, totals } = await loadFolio(supabase, id);
  const live = entries.filter((e) => !e.voided_at);

  return (
    <div className="max-w-3xl mx-auto bg-white print:shadow-none">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link href={`/admin/bookings/${id}`} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <PrintButton />
      </div>

      <div className="border border-slate-200 rounded-xl p-8 print:border-0 print:p-0 text-sm text-slate-900">
        <div className="flex justify-between gap-6 border-b border-slate-200 pb-5 mb-5">
          <div>
            <p className="text-xl font-semibold tracking-tight">{settings.name}</p>
            <p className="text-xs text-slate-700 mt-1 whitespace-pre-line">
              {[settings.legal_name, settings.address, [settings.city, settings.state, settings.postcode].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join("\n")}
            </p>
            <p className="text-xs text-slate-700">
              {[settings.phone, settings.email].filter(Boolean).join(" · ")}
              {settings.gstin && ` · GSTIN ${settings.gstin}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">Guest folio</p>
            <p className="font-mono">{booking.reference}</p>
            <p className="text-xs text-slate-700 mt-1">Printed {fmtDateTime(new Date().toISOString())}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6 text-xs">
          <div>
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Guest</p>
            <p className="text-sm">{booking.contact_name}</p>
            {booking.companies && (
              <p className="mt-1">
                {booking.companies.name}
                {booking.companies.gstin && ` · GSTIN ${booking.companies.gstin}`}
                <br />
                {booking.companies.billing_address}
              </p>
            )}
          </div>
          <div>
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Stay</p>
            <p className="text-sm">
              Room {booking.rooms?.room_number ?? "—"} · {booking.room_types?.name}
            </p>
            <p>
              {fmtDate(booking.check_in)} → {fmtDate(booking.check_out)}
            </p>
          </div>
        </div>

        <table className="w-full text-xs mb-6">
          <thead>
            <tr className="border-b border-slate-900 text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">{settings.tax_label}</th>
            </tr>
          </thead>
          <tbody>
            {live.map((e) => {
              const credit = e.kind === "payment" || e.kind === "adjustment";
              return (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-1.5">{fmtDate(e.stay_date ?? e.created_at.slice(0, 10))}</td>
                  <td className="py-1.5">
                    {e.description}
                    {e.method && ` (${PAYMENT_METHOD_LABELS[e.method]})`}
                    {e.fx_currency && e.fx_amount !== null && (
                      <span className="block text-[10px] text-slate-500">
                        {e.fx_currency} {Number(e.fx_amount).toLocaleString("en-IN")} at {Number(e.fx_rate)} per unit
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {credit ? "−" : ""}
                    {fmtMoney(e.amount)}
                  </td>
                  <td className="py-1.5 text-right">
                    {Number(e.tax_amount) ? `${fmtMoney(e.tax_amount)} @ ${Number(e.tax_rate)}%` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="ml-auto max-w-xs space-y-1 text-sm">
          {billLines(entries, settings.tax_label).map((l) => (
            <p key={l.label} className="flex justify-between">
              <span className="text-slate-700">{l.label}</span>
              <span>{fmtMoney(l.amount)}</span>
            </p>
          ))}
          <p className="flex justify-between border-t border-slate-900 pt-2 font-medium">
            <span>Balance</span>
            <span>{fmtMoney(totals.balance)}</span>
          </p>
        </div>

        {settings.tax_inclusive && (
          <p className="mt-6 text-[11px] text-slate-500">
            Room rates are inclusive of {settings.tax_label}; the tax portion is shown separately above.
          </p>
        )}
      </div>
    </div>
  );
}
