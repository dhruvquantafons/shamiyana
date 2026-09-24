import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import { reportByKind, resolveRange, type RangePreset } from "../../../../lib/reports";
import { runReport } from "../../../../lib/report-data";
import { StatCard } from "../../../components/ui";
import { RangePicker, ReportTable } from "../shared";

/**
 * Operational reports (SOW Module 13): how housekeeping, engineering and the
 * roster actually performed. No money here, so `reports.view` is enough.
 */
export default async function OperationsReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("reports.view");
  const { preset: presetParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const preset = (presetParam ?? "last30") as RangePreset;
  const range = resolveRange(preset, today, fromParam ?? "", toParam ?? "");

  const housekeeping = reportByKind("housekeeping")!;
  const maintenance = reportByKind("maintenance")!;
  const attendance = reportByKind("attendance")!;

  const [hk, mt, att] = await Promise.all([
    runReport(supabase, housekeeping, range),
    runReport(supabase, maintenance, range),
    runReport(supabase, attendance, range),
  ]);

  const tasks = hk.rows.reduce((s, r) => s + Number(r.tasks ?? 0), 0);
  const failed = hk.rows.reduce((s, r) => s + Number(r.failed ?? 0), 0);
  const raised = mt.rows.reduce((s, r) => s + Number(r.raised ?? 0), 0);
  const breached = mt.rows.reduce((s, r) => s + Number(r.breached ?? 0), 0);
  const hours = att.rows.reduce((s, r) => s + Number(r.hours ?? 0), 0);
  const absences = att.rows.reduce((s, r) => s + Number(r.absent ?? 0), 0);

  return (
    <div className="space-y-6">
      <RangePicker
        basePath="/admin/reports/operations"
        preset={preset}
        from={fromParam ?? ""}
        to={toParam ?? ""}
        resolved={range}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Rooms cleaned"
          value={tasks}
          hint={failed > 0 ? `${failed} failed inspection` : "None failed inspection"}
        />
        <StatCard
          label="Tickets raised"
          value={raised}
          hint={breached > 0 ? `${breached} past their target` : "All within target"}
        />
        <StatCard label="Hours worked" value={hours.toFixed(1)} hint={`${att.rows.length} staff`} />
        <StatCard label="Absences" value={absences} hint="Rostered but no clock-in" />
      </div>

      <ReportTable definition={housekeeping} rows={hk.rows} from={range.from} to={range.to} error={hk.error} />
      <ReportTable definition={maintenance} rows={mt.rows} from={range.from} to={range.to} error={mt.error} />
      <ReportTable definition={attendance} rows={att.rows} from={range.from} to={range.to} error={att.error} />

      <p className="text-[11px] text-slate-500">
        Turnaround is measured from when an attendant started a room to when they finished it, so a room left
        waiting is not counted against them. Maintenance hours run from when a ticket was raised, which is what an
        SLA measures.
      </p>
    </div>
  );
}
