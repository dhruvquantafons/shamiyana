import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "../../../../lib/types";
import { Card, SectionTitle, StatCard, Tag, fmtDate, fmtDateTime, fmtMoney } from "../../../components/ui";
import PrintButton from "../../../components/PrintButton";

interface Report {
  rooms: { available: number; sold: number; occupancy_percent: number };
  revenue: { room: number; fees: number; extras: number; penalties: number; tax: number; total: number };
  kpis: { adr: number; revpar: number };
  payments: { by_method: Record<string, number>; by_cashier: Record<string, number>; total: number };
  movements: {
    arrivals: number;
    departures: number;
    cancellations: number;
    no_shows: { reference: string; guest: string; penalty: number }[];
    expired_holds: { reference: string; guest: string }[];
    pending_arrivals_left: { reference: string; guest: string }[];
  };
  exceptions: { overstays: { reference: string; guest: string; room: string; due_out: string }[] };
  housekeeping: { room_statuses_updated: number; tasks_created?: number };
  maintenance?: { preventive_created: number; escalated: number };
  compliance: { id_documents_purged: number };
  loyalty?: { points_expired: number; tiers_reviewed: number };
  outlets?: { bills: number; total: number; by_outlet: Record<string, number>; by_method: Record<string, number> };
  posted_room_charges: number;
}

export default async function NightAuditReportPage({ params }: { params: Promise<{ date: string }> }) {
  await requireAnyPermission(["frontdesk.night_audit", "folio.view"]);
  const { date } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase
    .from("night_audits")
    .select("*, staff:started_by(full_name, email)")
    .eq("business_date", date)
    .maybeSingle();
  if (!data) notFound();

  const r = data.report as Report;
  const who = (data.staff as { full_name: string; email: string } | null)?.full_name || "—";

  return (
    <>
      <div className="flex justify-between items-center mb-4 print:hidden">
        <Link href="/admin/night-audit" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
          <ArrowLeft className="w-3.5 h-3.5" /> Night audit
        </Link>
        <PrintButton />
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Daily report · {fmtDate(date)}</h1>
      <p className="text-xs text-slate-500 mt-1 mb-6">
        {settings.name} · run by {who}
        {data.completed_at ? ` · closed ${fmtDateTime(data.completed_at)}` : ""} ·{" "}
        <Tag tone={data.status === "completed" ? "green" : "red"}>{data.status}</Tag>
      </p>

      {!r?.rooms ? (
        <p className="text-sm text-rose-800">This audit did not complete. {data.error}</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Occupancy" value={`${r.rooms.occupancy_percent}%`} hint={`${r.rooms.sold} of ${r.rooms.available} rooms`} />
            <StatCard label="ADR" value={fmtMoney(r.kpis.adr)} hint="Room revenue ÷ rooms sold" />
            <StatCard label="RevPAR" value={fmtMoney(r.kpis.revpar)} hint="Room revenue ÷ rooms available" />
            <StatCard label="Total revenue" value={fmtMoney(r.revenue.total)} hint={`incl. ${settings.tax_label} ${fmtMoney(r.revenue.tax)}`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <SectionTitle>Revenue</SectionTitle>
              <dl className="text-sm space-y-1.5">
                {[
                  ["Rooms (net)", r.revenue.room],
                  ["Fees", r.revenue.fees],
                  ["Extras", r.revenue.extras],
                  ["Penalties", r.revenue.penalties],
                  [settings.tax_label, r.revenue.tax],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between">
                    <dt className="text-slate-700">{k}</dt>
                    <dd>{fmtMoney(v as number)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 font-medium">
                  <dt>Total</dt>
                  <dd>{fmtMoney(r.revenue.total)}</dd>
                </div>
              </dl>
            </Card>

            <Card className="p-5">
              <SectionTitle>Payments closed</SectionTitle>
              {Object.keys(r.payments.by_method).length === 0 ? (
                <p className="text-sm text-slate-500">No payments taken.</p>
              ) : (
                <dl className="text-sm space-y-1.5">
                  {Object.entries(r.payments.by_method).map(([m, v]) => (
                    <div key={m} className="flex justify-between">
                      <dt className="text-slate-700">{PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m}</dt>
                      <dd>{fmtMoney(v)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-medium">
                    <dt>Total</dt>
                    <dd>{fmtMoney(r.payments.total)}</dd>
                  </div>
                  <p className="text-xs text-slate-500 pt-3">By cashier</p>
                  {Object.entries(r.payments.by_cashier).map(([who, v]) => (
                    <div key={who} className="flex justify-between">
                      <dt className="text-slate-700">{who}</dt>
                      <dd>{fmtMoney(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <SectionTitle>Movements</SectionTitle>
            <p className="text-sm text-slate-700">
              {r.movements.arrivals} arrival(s) · {r.movements.departures} departure(s) · {r.movements.cancellations}{" "}
              cancellation(s) · {r.movements.no_shows.length} no-show(s) · {r.movements.expired_holds.length} expired
              hold(s) · {r.posted_room_charges} room charge(s) posted
            </p>
            {r.movements.no_shows.length > 0 && (
              <p className="text-xs text-slate-600 mt-2">
                No-shows:{" "}
                {r.movements.no_shows.map((n) => `${n.reference} ${n.guest}${n.penalty ? ` (${fmtMoney(n.penalty)})` : ""}`).join(", ")}
              </p>
            )}
            {r.movements.expired_holds.length > 0 && (
              <p className="text-xs text-slate-600 mt-1">
                Holds released: {r.movements.expired_holds.map((n) => `${n.reference} ${n.guest}`).join(", ")}
              </p>
            )}
            {r.movements.pending_arrivals_left.length > 0 && (
              <p className="text-xs text-amber-800 mt-1">
                Carried forward (not marked no-show):{" "}
                {r.movements.pending_arrivals_left.map((n) => `${n.reference} ${n.guest}`).join(", ")}
              </p>
            )}
            {r.exceptions.overstays.length > 0 && (
              <p className="text-xs text-rose-800 mt-1">
                Past departure but still in house:{" "}
                {r.exceptions.overstays.map((o) => `${o.reference} ${o.guest} (room ${o.room}, due ${o.due_out})`).join(", ")}
              </p>
            )}
            <p className="text-[11px] text-slate-500 mt-3">
              {r.housekeeping.room_statuses_updated} room status(es) synced with blocks ·{" "}
              {r.housekeeping.tasks_created ?? 0} housekeeping task(s) created for the next day ·{" "}
              {r.maintenance && `${r.maintenance.preventive_created} preventive maintenance ticket(s) raised, ${r.maintenance.escalated} overdue ticket(s) escalated · `}
              {r.outlets &&
                r.outlets.bills > 0 &&
                `${r.outlets.bills} outlet bill(s) settled for ${fmtMoney(r.outlets.total)} · `}
              {r.loyalty &&
                `${r.loyalty.points_expired} loyalty point(s) expired, ${r.loyalty.tiers_reviewed} member tier(s) reviewed · `}
              {r.compliance.id_documents_purged} identity
              document(s) purged under the {settings.id_document_retention_days}-day retention policy.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
