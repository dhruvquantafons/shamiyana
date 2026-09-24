import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../../lib/auth";
import { getSettings } from "../../../../../../lib/settings";
import { amountPaid, orderBalance, taxBands } from "../../../../../../lib/pos";
import type { Outlet, PosOrder, PosOrderLine, PosPayment } from "../../../../../../lib/types";
import { POS_PAYMENT_KIND_LABELS } from "../../../../../../lib/types";
import { fmtDateTime, fmtMoney } from "../../../../../components/ui";
import PrintButton from "../../../../../components/PrintButton";

/**
 * The printable outlet bill the guest signs or pays against.
 *
 * This is not a tax invoice: those are numbered sequentially per financial
 * year and belong to Module 7. When an outlet bill is charged to a room it
 * becomes part of the stay's folio, and the guest's tax invoice is issued
 * from there at check-out.
 */
export default async function PosBillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["pos.view", "pos.order", "pos.pay"]);
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data: orderRow } = await supabase
    .from("pos_orders")
    .select("*, pos_outlets(*), rooms(room_number), bookings(reference, contact_name, status)")
    .eq("id", id)
    .maybeSingle();
  if (!orderRow) notFound();
  const order = orderRow as unknown as PosOrder & { pos_outlets: Outlet };
  const outlet = order.pos_outlets;

  const [{ data: lineRows }, { data: payRows }] = await Promise.all([
    supabase.from("pos_order_lines").select("*").eq("order_id", id).is("voided_at", null).order("created_at"),
    supabase.from("pos_payments").select("*").eq("order_id", id).is("voided_at", null).order("created_at"),
  ]);
  const lines = (lineRows ?? []) as PosOrderLine[];
  const payments = (payRows ?? []) as PosPayment[];
  const bands = taxBands(lines);
  const balance = orderBalance(order, payments);
  const paid = amountPaid(payments);

  return (
    <div className="max-w-md mx-auto bg-white print:shadow-none">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link
          href={`/admin/pos/orders/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <PrintButton />
      </div>

      <div className="border border-slate-200 rounded-xl p-6 print:border-0 print:p-0 text-sm text-slate-900">
        <div className="text-center border-b border-slate-200 pb-4 mb-4">
          <p className="text-lg font-semibold tracking-tight">{settings.name}</p>
          <p className="text-xs text-slate-700 mt-0.5">{outlet.name}</p>
          <p className="text-[11px] text-slate-600 mt-1">
            {[settings.address, [settings.city, settings.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
          </p>
          {settings.gstin && <p className="text-[11px] text-slate-600">GSTIN {settings.gstin}</p>}
        </div>

        <div className="flex justify-between text-[11px] text-slate-700 mb-4">
          <div>
            <p className="font-mono text-slate-900">{order.number}</p>
            <p>{fmtDateTime(order.opened_at)}</p>
          </div>
          <div className="text-right">
            {order.table_no && <p>Table {order.table_no}</p>}
            {order.rooms?.room_number && <p>Room {order.rooms.room_number}</p>}
            {(order.guest_name || order.bookings?.contact_name) && (
              <p>{order.guest_name || order.bookings?.contact_name}</p>
            )}
            {order.covers > 0 && <p>{order.covers} cover(s)</p>}
          </div>
        </div>

        <table className="w-full text-xs mb-4">
          <thead>
            <tr className="border-b border-slate-900 text-left">
              <th className="py-1.5">Item</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-1.5">
                  {l.name}
                  {l.modifiers.length > 0 && (
                    <span className="block text-[10px] text-slate-500">
                      {l.modifiers.map((m) => m.name).join(", ")}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right">{Number(l.qty)}</td>
                <td className="py-1.5 text-right">{fmtMoney(Number(l.net_amount) + Number(l.tax_amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 text-xs">
          <p className="flex justify-between">
            <span className="text-slate-700">Items</span>
            <span>{fmtMoney(order.net_total)}</span>
          </p>
          {Number(order.service_net) > 0 && (
            <p className="flex justify-between">
              <span className="text-slate-700">Service charge ({outlet.service_charge_percent}%)</span>
              <span>{fmtMoney(order.service_net)}</span>
            </p>
          )}
          {bands.map((b) => (
            <p key={b.rate} className="flex justify-between text-slate-600">
              <span>
                {settings.tax_label} at {b.rate}%
              </span>
              <span>{fmtMoney(b.tax)}</span>
            </p>
          ))}
          {Number(order.service_tax) > 0 && (
            <p className="flex justify-between text-slate-600">
              <span>
                {settings.tax_label} on service ({outlet.tax_rate}%)
              </span>
              <span>{fmtMoney(order.service_tax)}</span>
            </p>
          )}
          {Number(order.tip_amount) > 0 && (
            <p className="flex justify-between">
              <span className="text-slate-700">Tip</span>
              <span>{fmtMoney(order.tip_amount)}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-slate-900 pt-1.5 text-sm font-semibold">
            <span>Total</span>
            <span>{fmtMoney(order.grand_total)}</span>
          </p>

          {payments.map((p) => (
            <p key={p.id} className="flex justify-between text-slate-700">
              <span>
                {POS_PAYMENT_KIND_LABELS[p.kind]}
                {p.points ? ` (${p.points.toLocaleString("en-IN")} pts)` : ""}
                {p.kind === "room_charge" && order.bookings?.reference ? ` — ${order.bookings.reference}` : ""}
              </span>
              <span>−{fmtMoney(p.amount)}</span>
            </p>
          ))}
          {paid > 0 && (
            <p className="flex justify-between border-t border-slate-200 pt-1.5 font-medium">
              <span>{balance > 0 ? "Still owed" : "Settled"}</span>
              <span>{fmtMoney(balance)}</span>
            </p>
          )}
        </div>

        {order.notes && <p className="mt-4 text-[11px] text-slate-600">{order.notes}</p>}

        <p className="mt-6 text-center text-[11px] text-slate-500">
          {payments.some((p) => p.kind === "room_charge")
            ? "Charged to your room. A tax invoice will be issued with your final bill at check-out."
            : "Thank you. Please retain this bill."}
        </p>
      </div>
    </div>
  );
}
