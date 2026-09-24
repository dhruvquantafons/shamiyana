import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import { reportByKind, reportsFor, resolveRange, type RangePreset } from "../../../../lib/reports";
import { runReport } from "../../../../lib/report-data";
import { Card, Notice, SectionTitle } from "../../../components/ui";
import PrintButton from "../../../components/PrintButton";
import { RangePicker, ReportTable } from "../shared";

/**
 * The custom report builder (SOW Module 13: "Custom report builder with
 * export to Excel/PDF").
 *
 * Deliberately a chooser over the reports the system knows how to produce,
 * not an open query tool: every report already carries its own access rule,
 * and the front desk should not be able to write SQL against the folio.
 * Pick a report and a period, then export as CSV — which Excel opens — or
 * print to PDF.
 */
export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; preset?: string; from?: string; to?: string }>;
}) {
  const session = await requireAnyPermission(["reports.view", "reports.financial"]);
  const { kind: kindParam, preset: presetParam, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const available = reportsFor({
    financial: can(session, "reports.financial"),
    view: can(session, "reports.view"),
  });

  const chosen = kindParam ? reportByKind(kindParam) : null;
  const allowed = chosen && available.some((r) => r.kind === chosen.kind) ? chosen : null;

  const preset = (presetParam ?? "this_month") as RangePreset;
  const range = resolveRange(preset, today, fromParam ?? "", toParam ?? "");
  const result = allowed ? await runReport(supabase, allowed, range) : null;

  const query = (k: string) =>
    `/admin/reports/builder?kind=${k}&preset=${preset}` +
    (preset === "custom" ? `&from=${range.from}&to=${range.to}` : "");

  return (
    <div className="space-y-6">
      <Card className="p-5 print:hidden">
        <SectionTitle>Choose a report</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
          {available.map((r) => (
            <Link
              key={r.kind}
              href={query(r.kind)}
              className={`block border rounded-lg px-3 py-2 transition-colors ${
                allowed?.kind === r.kind
                  ? "border-yellow-500 bg-yellow-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <p className="text-xs font-medium text-slate-900">{r.label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{r.description}</p>
            </Link>
          ))}
        </div>
        {available.length === 0 && (
          <Notice tone="warn">Your role does not allow any reports yet.</Notice>
        )}
      </Card>

      {allowed?.ranged && (
        <div className="print:hidden">
          <RangePicker
            basePath="/admin/reports/builder"
            preset={preset}
            from={fromParam ?? ""}
            to={toParam ?? ""}
            resolved={range}
          />
        </div>
      )}

      {!allowed ? (
        <Card className="p-5">
          <p className="text-xs text-slate-500">Pick a report above to run it.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <p className="text-[11px] text-slate-500">
              {allowed.ranged ? `${range.from} to ${range.to}` : "As at today"} ·{" "}
              {result?.rows.length ?? 0} row(s)
            </p>
            <div className="flex items-center gap-3">
              <PrintButton />
            </div>
          </div>

          {/* Only the chosen report prints, so a PDF is the report and nothing else. */}
          <ReportTable
            definition={allowed}
            rows={result?.rows ?? []}
            from={range.from}
            to={range.to}
            error={result?.error}
          />

          <p className="text-[11px] text-slate-500">
            CSV opens in Excel. Use Print for a PDF — choose &ldquo;Save as PDF&rdquo; as the destination.
          </p>
        </>
      )}
    </div>
  );
}
