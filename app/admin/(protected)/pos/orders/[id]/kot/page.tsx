import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../../lib/auth";
import { getSettings } from "../../../../../../lib/settings";
import { zonedTime } from "../../../../../../lib/dates";
import type { Outlet, PosOrder, PosOrderLine } from "../../../../../../lib/types";
import { fmtDateTime } from "../../../../../components/ui";
import PrintButton from "../../../../../components/PrintButton";

/**
 * The Kitchen Order Ticket (SOW Module 6).
 *
 * Printed for the kitchen, so it carries no prices — only what to cook, how
 * many, and anything the guest asked for. Deliberately large type: this is
 * read at arm's length in a hot kitchen.
 *
 * Every line is shown, with the ones already fired marked, so a chef can see
 * the whole table rather than only the latest addition. Posting to a kitchen
 * display is a separate hook (KOT_WEBHOOK_URL); POS hardware is out of scope
 * per SOW §2.2, so printing is always available as the fallback.
 */
export default async function KotPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission(["pos.view", "pos.order"]);
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

  const { data: lineRows } = await supabase
    .from("pos_order_lines")
    .select("*")
    .eq("order_id", id)
    .is("voided_at", null)
    .order("created_at");
  const lines = (lineRows ?? []) as PosOrderLine[];

  return (
    <div className="max-w-sm mx-auto bg-white print:shadow-none">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <Link
          href={`/admin/pos/orders/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <PrintButton />
      </div>

      <div className="border border-slate-200 rounded-xl p-5 print:border-0 print:p-0 text-slate-900">
        <div className="text-center border-b-2 border-slate-900 pb-2 mb-3">
          <p className="text-base font-bold uppercase tracking-wide">Kitchen order</p>
          <p className="font-mono text-lg">{order.number}</p>
          <p className="text-xs text-slate-700">{order.pos_outlets.name}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
          {order.table_no && (
            <p>
              <span className="text-slate-500">Table</span>{" "}
              <span className="text-lg font-bold">{order.table_no}</span>
            </p>
          )}
          {order.rooms?.room_number && (
            <p>
              <span className="text-slate-500">Room</span>{" "}
              <span className="text-lg font-bold">{order.rooms.room_number}</span>
            </p>
          )}
          <p>
            <span className="text-slate-500">Covers</span> <span className="font-bold">{order.covers}</span>
          </p>
          <p className="text-xs text-slate-600">
            {fmtDateTime(zonedTime(settings.business_date, "00:00", settings.timezone).toISOString()).split(",")[0]}
          </p>
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing ordered yet.</p>
        ) : (
          <ul className="divide-y-2 divide-slate-200 border-t-2 border-slate-900">
            {lines.map((l) => (
              <li key={l.id} className={`py-2.5 ${l.kot_sent_at ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl font-bold leading-none w-10 shrink-0">{Number(l.qty)}×</span>
                  <div className="min-w-0">
                    <p className="text-base font-semibold leading-tight">{l.name}</p>
                    {l.modifiers.length > 0 && (
                      <p className="text-sm font-medium text-slate-700">{l.modifiers.map((m) => m.name).join(" · ")}</p>
                    )}
                    {l.notes && <p className="text-sm font-bold uppercase">{l.notes}</p>}
                    {l.kot_sent_at && <p className="text-[10px] text-slate-500">already fired</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {order.notes && (
          <p className="mt-3 pt-3 border-t-2 border-slate-900 text-sm font-bold uppercase">{order.notes}</p>
        )}

        <p className="mt-4 text-center text-[10px] text-slate-500">Printed {fmtDateTime(new Date().toISOString())}</p>
      </div>
    </div>
  );
}
