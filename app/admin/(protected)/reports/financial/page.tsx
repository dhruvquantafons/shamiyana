import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import { agingOf, agingTotals, AGING_BUCKETS, AGING_LABELS } from "../../../../lib/city-ledger";
import { reportByKind, resolveRange, type RangePreset } from "../../../../lib/reports";
import { runReport } from "../../../../lib/report-data";
import type { CityLedgerEntry } from "../../../../lib/types";
import { Card, SectionTitle, StatCard, fmtMoney } from "../../../components/ui";
import { RangePicker, ReportTable } from "../shared";

/**
 * The money reports (SOW Module 13). Restricted to management and finance by
 * `reports.financial`, which the database functions check as well — so this
 * page cannot be the only thing standing between a cashier and the P&L.
 *
 * Corporate debt is summarised from the city ledger's own aging rather than
 * recomputed here, so there is one definition of "overdue" in the system.
 */
export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("reports.financial");
  const { preset: presetParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const preset = (presetParam ?? "this_month") as RangePreset;
  const range = resolveRange(preset, today, fromParam ?? "", toParam ?? "");

  const tax = reportByKind("tax_summary")!;
  const payments = reportByKind("payments")!;
  const outletSales = reportByKind("outlet_sales")!;
  const outletPayments = reportByKind("outlet_payments")!;
  const events = reportByKind("events")!;
  const outstanding = reportByKind("outstanding")!;

  const [taxRows, payRows, outletRows, outletPayRows, eventRows, owedRows, { data: ledgerRows }] =
    await Promise.all([
      runReport(supabase, tax, range),
      runReport(supabase, payments, range),
      runReport(supabase, outletSales, range),
      runReport(supabase, outletPayments, range),
      runReport(supabase, events, range),
      runReport(supabase, outstanding, range),
      supabase.from("city_ledger_entries").select("*").order("created_at"),
    ]);

  const taxTotal = taxRows.rows.reduce((s, r) => s + Number(r.tax ?? 0), 0);
  const outletTotal = outletRows.rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const eventTotal = eventRows.rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const eventCount = eventRows.rows.reduce((s, r) => s + Number(r.events ?? 0), 0);
  const guestOwed = owedRows.rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // Corporate receivables, aged by the city ledger's own rules.
  const entries = (ledgerRows ?? []) as CityLedgerEntry[];
  const byCompany = new Map<string, CityLedgerEntry[]>();
  for (const e of entries) {
    const list = byCompany.get(e.company_id);
    if (list) list.push(e);
    else byCompany.set(e.company_id, [e]);
  }
  const aging = agingTotals([...byCompany.values()].map((own) => agingOf(own, today)));

  return (
    <div className="space-y-6">
      <RangePicker
        basePath="/admin/reports/financial"
        preset={preset}
        from={fromParam ?? ""}
        to={toParam ?? ""}
        resolved={range}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={`${settings.tax_label} charged`} value={fmtMoney(taxTotal)} hint="In this period" />
        <StatCard label="Outlet takings" value={fmtMoney(outletTotal)} hint={`${outletRows.rows.length} outlet(s)`} />
        <StatCard label="Event revenue" value={fmtMoney(eventTotal)} hint={`${eventCount} function(s)`} />
        <StatCard label="Owed by guests" value={fmtMoney(guestOwed)} hint={`${owedRows.rows.length} stay(s)`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Owed by companies"
          value={fmtMoney(aging.total)}
          hint={`${fmtMoney(aging.total - aging.current)} overdue`}
        />
      </div>

      <ReportTable definition={tax} rows={taxRows.rows} from={range.from} to={range.to} error={taxRows.error} />
      <ReportTable definition={payments} rows={payRows.rows} from={range.from} to={range.to} error={payRows.error} />
      <ReportTable definition={outletSales} rows={outletRows.rows} from={range.from} to={range.to} error={outletRows.error} />
      <ReportTable
        definition={outletPayments}
        rows={outletPayRows.rows}
        from={range.from}
        to={range.to}
        error={outletPayRows.error}
      />
      <ReportTable definition={events} rows={eventRows.rows} from={range.from} to={range.to} error={eventRows.error} />
      <ReportTable definition={outstanding} rows={owedRows.rows} from={range.from} to={range.to} error={owedRows.error} />

      {/* ── Corporate receivables ── */}
      <Card className="p-5">
        <SectionTitle
          action={
            <Link href="/admin/billing/city-ledger" className="text-[11px] text-yellow-700 hover:underline">
              City ledger →
            </Link>
          }
        >
          Corporate receivables
        </SectionTitle>
        <p className="text-[11px] text-slate-500 -mt-2 mb-3">
          Aged by the city ledger&apos;s own rules, with receipts applied to the oldest charge first.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="border border-slate-200 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{AGING_LABELS[b]}</p>
              <p className={`text-sm font-medium ${aging[b] > 0 && (b === "90+" || b === "61-90") ? "text-rose-700" : "text-slate-900"}`}>
                {fmtMoney(aging[b])}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
