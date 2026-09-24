import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { todayIn } from "../../../lib/dates";
import {
  bookingKpis,
  kpisFrom,
  repeatGuestRatio,
  reportByKind,
  resolveRange,
  type BookingRow,
  type DailyRow,
  type RangePreset,
} from "../../../lib/reports";
import { runReport } from "../../../lib/report-data";
import { Card, Notice, SectionTitle, StatCard, fmtMoney } from "../../components/ui";
import LiveRefresh from "../../components/LiveRefresh";
import { RangePicker, ReportTable, SourceNote } from "./shared";

/**
 * The management overview: the SOW's Core KPIs for a chosen period, with a
 * day-by-day breakdown underneath.
 *
 * Occupancy, ADR and RevPAR are the three a hotelier reads together — a high
 * ADR on an empty hotel is not a good week, and RevPAR is what shows that.
 */
export default async function ReportsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const session = await requireAnyPermission(["reports.view", "reports.financial"]);
  const { preset: presetParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const financial = can(session, "reports.financial");

  const preset = (presetParam ?? "last30") as RangePreset;
  const range = resolveRange(preset, today, fromParam ?? "", toParam ?? "");

  const dailyDef = reportByKind("daily_revenue")!;
  const bookingsDef = reportByKind("bookings")!;
  const guestsDef = reportByKind("guests")!;

  const [daily, bookings, guests] = await Promise.all([
    runReport(supabase, dailyDef, range),
    runReport(supabase, bookingsDef, range),
    runReport(supabase, guestsDef, range),
  ]);

  const dailyRows = daily.rows as unknown as DailyRow[];
  const kpis = kpisFrom(dailyRows, Number(settings.monthly_operating_cost));
  const booking = bookingKpis(bookings.rows as unknown as BookingRow[]);
  const guestRow = (guests.rows[0] ?? {}) as Record<string, number | null>;
  const repeatRatio = repeatGuestRatio(
    Number(guestRow.distinct_guests ?? 0),
    Number(guestRow.repeat_guests ?? 0),
  );

  return (
    <div className="space-y-6">
      <LiveRefresh tables={["folio_entries", "bookings", "night_audits"]} />

      <RangePicker basePath="/admin/reports" preset={preset} from={fromParam ?? ""} to={toParam ?? ""} resolved={range} />

      {/* ── Core KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Occupancy"
          value={`${kpis.occupancy}%`}
          hint={`${kpis.roomsSold} of ${kpis.availableRoomNights} room-nights`}
        />
        <StatCard label="ADR" value={fmtMoney(kpis.adr)} hint="Room revenue ÷ rooms sold" />
        <StatCard label="RevPAR" value={fmtMoney(kpis.revpar)} hint="Room revenue ÷ rooms available" />
        <StatCard
          label="GOPPAR"
          value={kpis.goppar === null ? "—" : fmtMoney(kpis.goppar)}
          hint={kpis.goppar === null ? "Set a monthly operating cost" : "After operating cost"}
        />
      </div>

      {financial && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total revenue" value={fmtMoney(kpis.totalRevenue)} hint="Including tax" />
          <StatCard label="Room revenue" value={fmtMoney(kpis.roomRevenue)} hint={`Other ${fmtMoney(kpis.otherRevenue)}`} />
          <StatCard label={settings.tax_label} value={fmtMoney(kpis.taxTotal)} hint="Charged in this period" />
          <StatCard
            label="Operating cost"
            value={kpis.operatingCost === null ? "—" : fmtMoney(kpis.operatingCost)}
            hint={kpis.operatingCost === null ? "Not set" : `${kpis.days} day(s) prorated`}
          />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Bookings" value={booking.bookings} hint={`${booking.roomNights} room nights`} />
        <StatCard label="Cancellation rate" value={`${booking.cancellationRate}%`} hint={`${booking.cancelled} cancelled`} />
        <StatCard label="No-show rate" value={`${booking.noShowRate}%`} hint={`${booking.noShows} no-shows`} />
        <StatCard
          label="Repeat guests"
          value={`${repeatRatio}%`}
          hint={`${guestRow.repeat_guests ?? 0} of ${guestRow.distinct_guests ?? 0} guests`}
        />
      </div>

      <SourceNote audited={kpis.auditedDays} days={kpis.days} />

      {kpis.goppar === null && financial && (
        <Notice tone="info">
          GOPPAR needs the hotel&apos;s monthly running cost, which this system does not hold — it has no expense
          ledger, and the SOW leaves accounting to the hotel&apos;s own software. Enter the figure under{" "}
          <strong>Settings → Reporting</strong> and GOPPAR is reported from then on.
        </Notice>
      )}

      {/* ── Day by day ── */}
      {financial ? (
        <ReportTable definition={dailyDef} rows={daily.rows} from={range.from} to={range.to} error={daily.error} />
      ) : (
        <Card className="p-5">
          <SectionTitle>Day by day</SectionTitle>
          <p className="text-xs text-slate-500">
            Revenue by day is a financial report, restricted to management and finance.
          </p>
        </Card>
      )}

      <ReportTable definition={bookingsDef} rows={bookings.rows} from={range.from} to={range.to} error={bookings.error} />
    </div>
  );
}
