import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn, zonedTime } from "../../../../lib/dates";
import type { Booking, Outlet, PosCategory, PosItem, PosOrder, Room } from "../../../../lib/types";
import { OUTLET_KIND_LABELS, POS_ORDER_STATUS_LABELS } from "../../../../lib/types";
import { openOrder } from "../../../pos-actions";
import {
  Card,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDateTime,
  fmtMoney,
  inputClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import LiveRefresh from "../../../components/LiveRefresh";

/**
 * One outlet's till: open a new bill, pick up an open one, and see the menu
 * as the guest sees it. Orders are added on the bill itself, so this page
 * stays a short step rather than a long form.
 */
export default async function OutletTillPage({ params }: { params: Promise<{ outletId: string }> }) {
  const session = await requireAnyPermission(["pos.view", "pos.order", "pos.pay"]);
  const { outletId } = await params;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const since = zonedTime(today, "00:00", settings.timezone).toISOString();

  const { data: outletRow } = await supabase.from("pos_outlets").select("*").eq("id", outletId).maybeSingle();
  if (!outletRow) notFound();
  const outlet = outletRow as Outlet;
  const order = can(session, "pos.order");

  const [{ data: catRows }, { data: itemRows }, { data: orderRows }, { data: inHouseRows }, { data: roomRows }] =
    await Promise.all([
      supabase.from("pos_categories").select("*").eq("outlet_id", outletId).order("sort_order"),
      supabase.from("pos_items").select("*").eq("outlet_id", outletId).eq("is_active", true).order("sort_order"),
      supabase
        .from("pos_orders")
        .select("*, rooms(room_number), bookings(reference, contact_name, status)")
        .eq("outlet_id", outletId)
        .or(`status.in.(open,billed),opened_at.gte.${since}`)
        .order("opened_at", { ascending: false })
        .limit(100),
      // Only a guest who is in the hotel can have a bill charged to them.
      supabase
        .from("bookings")
        .select("id, reference, contact_name, room_id, rooms(room_number)")
        .eq("status", "checked_in")
        .order("check_in"),
      supabase.from("rooms").select("id, room_number").order("room_number"),
    ]);

  const categories = (catRows ?? []) as PosCategory[];
  const items = (itemRows ?? []) as PosItem[];
  const orders = (orderRows ?? []) as unknown as PosOrder[];
  const inHouse = (inHouseRows ?? []) as unknown as (Pick<Booking, "id" | "reference" | "contact_name" | "room_id"> & {
    rooms: { room_number: string } | null;
  })[];
  const rooms = (roomRows ?? []) as Pick<Room, "id" | "room_number">[];

  const open = orders.filter((o) => o.status === "open" || o.status === "billed");
  const settled = orders.filter((o) => o.status === "settled");
  const takings = settled.reduce((s, o) => s + Number(o.grand_total), 0);
  const uncategorised = items.filter((i) => !i.category_id);

  return (
    <div className="space-y-6">
      <LiveRefresh tables={["pos_orders", "pos_order_lines", "pos_payments"]} />

      <Link href="/admin/pos" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
        <ArrowLeft className="w-3.5 h-3.5" /> All outlets
      </Link>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={outlet.name} value={OUTLET_KIND_LABELS[outlet.kind]} hint={outlet.code} />
        <StatCard label="Open bills" value={open.length} hint={fmtMoney(open.reduce((s, o) => s + Number(o.grand_total), 0))} />
        <StatCard label="Settled today" value={fmtMoney(takings)} hint={`${settled.length} bills`} />
        <StatCard
          label="Tax"
          value={`${outlet.tax_rate}%`}
          hint={outlet.tax_inclusive ? "Included in menu prices" : "Added to menu prices"}
        />
      </div>

      {!outlet.is_active && <Notice tone="warn">This outlet is marked closed, so no new bill can be opened.</Notice>}

      {/* ── Start a bill ── */}
      {order && outlet.is_active && (
        <Card className="p-5">
          <SectionTitle>Start a bill</SectionTitle>
          {items.length === 0 ? (
            <Notice tone="warn">
              This outlet has no menu yet. Add items under <strong>Outlets &amp; menus</strong> before taking an order.
            </Notice>
          ) : (
            <ActionForm action={openOrder} submitLabel="Open bill" className="space-y-3">
              <input type="hidden" name="outlet_id" value={outlet.id} />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {outlet.orders_by !== "room" && (
                  <Field label="Table" hint="Optional.">
                    <input name="table_no" maxLength={20} placeholder="7" className={inputClass} />
                  </Field>
                )}
                {outlet.orders_by !== "table" && (
                  <Field label="Room" hint="Optional.">
                    <select name="room_id" defaultValue="" className={inputClass}>
                      <option value="">—</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.room_number}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="In-house guest" hint="Needed to charge the bill to a room.">
                  <select name="booking_id" defaultValue="" className={inputClass}>
                    <option value="">Not a resident</option>
                    {inHouse.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.rooms?.room_number ? `${b.rooms.room_number} — ` : ""}
                        {b.contact_name} ({b.reference})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Covers" hint="How many guests.">
                  <input type="number" name="covers" min={0} max={200} defaultValue={1} className={inputClass} />
                </Field>
              </div>
              <Field label="Name on the bill" hint="Optional — for a walk-in.">
                <input name="guest_name" maxLength={120} className={inputClass} />
              </Field>
              {inHouse.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Nobody is checked in at the moment, so bills here will have to be settled at the outlet.
                </p>
              )}
            </ActionForm>
          )}
        </Card>
      )}

      {/* ── Open bills ── */}
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Bills</SectionTitle>
        </div>
        {orders.length === 0 ? (
          <EmptyState message="No bills at this outlet today." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Bill</th>
                  <th className="py-2 pr-3 font-semibold">Table / room</th>
                  <th className="py-2 pr-3 font-semibold">Guest</th>
                  <th className="py-2 pr-3 font-semibold">Opened</th>
                  <th className="py-2 pr-3 font-semibold text-right">Total</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {orders.map((o) => (
                  <tr key={o.id} className={`hover:bg-slate-50/60 ${o.status === "void" ? "text-slate-400" : ""}`}>
                    <td className="py-2 px-4">
                      <Link href={`/admin/pos/orders/${o.id}`} className="font-mono text-yellow-700 hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {o.table_no ? `Table ${o.table_no}` : ""}
                      {o.rooms?.room_number ? `${o.table_no ? " · " : ""}Room ${o.rooms.room_number}` : ""}
                      {!o.table_no && !o.rooms?.room_number && "—"}
                    </td>
                    <td className="py-2 pr-3">{o.guest_name || o.bookings?.contact_name || "—"}</td>
                    <td className="py-2 pr-3 text-slate-500">{fmtDateTime(o.opened_at)}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(o.grand_total)}</td>
                    <td className="py-2 pr-4">
                      <Tag
                        tone={
                          o.status === "settled" ? "green" : o.status === "void" ? "red" : o.status === "billed" ? "amber" : "neutral"
                        }
                      >
                        {POS_ORDER_STATUS_LABELS[o.status]}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── The menu, for reference at the till ── */}
      <Card className="p-5">
        <SectionTitle>Menu</SectionTitle>
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing on the menu yet.</p>
        ) : (
          <div className="space-y-4">
            {[...categories.filter((c) => c.is_active), null].map((category) => {
              const own = category ? items.filter((i) => i.category_id === category.id) : uncategorised;
              if (own.length === 0) return null;
              return (
                <div key={category?.id ?? "none"}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                    {category?.name ?? "Other"}
                    {category?.tax_rate !== null && category?.tax_rate !== undefined && (
                      <span className="normal-case tracking-normal"> · {category.tax_rate}% tax</span>
                    )}
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                    {own.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                        <span className="text-slate-700">
                          {i.name}
                          {i.tax_rate !== null && <span className="text-slate-400"> · {i.tax_rate}%</span>}
                        </span>
                        <span className="text-slate-900">{fmtMoney(i.price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
