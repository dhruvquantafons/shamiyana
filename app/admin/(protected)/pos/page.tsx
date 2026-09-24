import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { todayIn, zonedTime } from "../../../lib/dates";
import { outletSummary } from "../../../lib/pos";
import type { Outlet, PosOrder } from "../../../lib/types";
import { OUTLET_KIND_LABELS, POS_ORDER_STATUS_LABELS } from "../../../lib/types";
import {
  Card,
  EmptyState,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDateTime,
  fmtMoney,
  tableHeadClass,
} from "../../components/ui";
import LiveRefresh from "../../components/LiveRefresh";

/**
 * The till's landing page: which outlets are busy, what is open on each, and
 * every bill still to be settled. Busiest outlet first, because on a Saturday
 * night that is the one the cashier needs.
 */
export default async function PosPage() {
  const session = await requireAnyPermission(["pos.view", "pos.order", "pos.pay", "pos.manage"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const since = zonedTime(today, "00:00", settings.timezone).toISOString();

  const [{ data: outletRows }, { data: orderRows }] = await Promise.all([
    supabase.from("pos_outlets").select("*").order("sort_order"),
    supabase
      .from("pos_orders")
      .select("*, pos_outlets(name, code, kind, sends_kot), rooms(room_number), bookings(reference, contact_name, status)")
      .or(`status.in.(open,billed),opened_at.gte.${since}`)
      .order("opened_at", { ascending: false })
      .limit(200),
  ]);

  const outlets = (outletRows ?? []) as Outlet[];
  const orders = (orderRows ?? []) as unknown as PosOrder[];
  const open = orders.filter((o) => o.status === "open" || o.status === "billed");
  const summary = outletSummary(outlets, orders);
  const takings = summary.reduce((s, r) => s + r.takings, 0);
  const openValue = summary.reduce((s, r) => s + r.openValue, 0);
  const order = can(session, "pos.order");

  return (
    <div className="space-y-6">
      <LiveRefresh tables={["pos_orders", "pos_order_lines", "pos_payments"]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open bills" value={open.length} hint={fmtMoney(openValue)} />
        <StatCard label="Settled today" value={fmtMoney(takings)} hint={todayIn(settings.timezone)} />
        <StatCard label="Outlets open" value={summary.length} hint={`${outlets.length} set up`} />
        <StatCard
          label="Outlet limit per stay"
          value={settings.pos_room_charge_limit > 0 ? fmtMoney(settings.pos_room_charge_limit) : "None"}
          hint="Unpaid room charges"
        />
      </div>

      {outlets.length === 0 && (
        <Notice tone="warn">
          No outlets are set up. Add them under <strong>Outlets &amp; menus</strong>.
        </Notice>
      )}

      {/* ── Outlets ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {summary.map(({ outlet, openBills, openValue: value, takings: taken }) => (
          <Link
            key={outlet.id}
            href={order ? `/admin/pos/${outlet.id}` : "/admin/pos"}
            className="block border border-slate-200 rounded-xl p-4 bg-white hover:border-yellow-400 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{outlet.name}</p>
                <p className="text-[11px] text-slate-500">
                  {OUTLET_KIND_LABELS[outlet.kind]} · <span className="font-mono">{outlet.code}</span>
                </p>
              </div>
              {openBills > 0 ? <Tag tone="amber">{openBills} open</Tag> : <Tag tone="neutral">Quiet</Tag>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-slate-500">Open</dt>
                <dd className="text-slate-900">{fmtMoney(value)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Settled today</dt>
                <dd className="text-slate-900">{fmtMoney(taken)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-slate-500">
              {outlet.tax_rate}% tax
              {outlet.tax_inclusive ? ", included in menu prices" : ""}
              {outlet.service_charge_percent > 0 ? ` · ${outlet.service_charge_percent}% service` : ""}
            </p>
          </Link>
        ))}
      </div>

      {/* ── Open bills ── */}
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Bills to settle</SectionTitle>
        </div>
        {open.length === 0 ? (
          <EmptyState message="Nothing open. Choose an outlet above to start a bill." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Bill</th>
                  <th className="py-2 pr-3 font-semibold">Outlet</th>
                  <th className="py-2 pr-3 font-semibold">Table / room</th>
                  <th className="py-2 pr-3 font-semibold">Guest</th>
                  <th className="py-2 pr-3 font-semibold">Opened</th>
                  <th className="py-2 pr-3 font-semibold text-right">Total</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {open.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <Link href={`/admin/pos/orders/${o.id}`} className="font-mono text-yellow-700 hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{o.pos_outlets?.name ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {o.table_no ? `Table ${o.table_no}` : ""}
                      {o.rooms?.room_number ? `${o.table_no ? " · " : ""}Room ${o.rooms.room_number}` : ""}
                      {!o.table_no && !o.rooms?.room_number && "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {o.guest_name || o.bookings?.contact_name || "—"}
                      {o.bookings?.reference && (
                        <span className="block text-[10px] text-slate-500">{o.bookings.reference}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{fmtDateTime(o.opened_at)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-slate-900">{fmtMoney(o.grand_total)}</td>
                    <td className="py-2 pr-4">
                      <Tag tone={o.status === "open" ? "neutral" : "amber"}>{POS_ORDER_STATUS_LABELS[o.status]}</Tag>
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
