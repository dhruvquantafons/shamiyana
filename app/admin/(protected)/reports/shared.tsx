import Link from "next/link";
import { Download } from "lucide-react";
import {
  RANGE_LABELS,
  describeRange,
  toGrid,
  type RangePreset,
  type ReportDefinition,
} from "../../../lib/reports";
import { Card, EmptyState, Notice, SectionTitle, Tag, fmtMoney, tableHeadClass } from "../../components/ui";

/**
 * The pieces every report page shares: choosing a period, and rendering a
 * report's rows from its own column definition so the screen and the CSV can
 * never drift apart.
 */

export const PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "this_month",
  "last_month",
  "this_financial_year",
];

/**
 * The period picker. A plain GET form, so a chosen range lives in the URL and
 * can be bookmarked, shared with the owner, or reloaded after an export.
 */
export function RangePicker({
  basePath,
  preset,
  from,
  to,
  resolved,
}: {
  basePath: string;
  preset: RangePreset;
  from: string;
  to: string;
  resolved: { from: string; to: string };
}) {
  return (
    <Card className="p-4">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Link
              key={p}
              href={`${basePath}?preset=${p}`}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                preset === p
                  ? "border-yellow-500 bg-yellow-50 text-yellow-800"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {RANGE_LABELS[p]}
            </Link>
          ))}
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <input type="hidden" name="preset" value="custom" />
          <label className="text-[11px] text-slate-500">
            From
            <input
              type="date"
              name="from"
              defaultValue={preset === "custom" ? from : resolved.from}
              className="block px-2 py-1 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
            />
          </label>
          <label className="text-[11px] text-slate-500">
            To
            <input
              type="date"
              name="to"
              defaultValue={preset === "custom" ? to : resolved.to}
              className="block px-2 py-1 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
            />
          </label>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Apply
          </button>
        </div>
      </form>
      <p className="mt-2 text-[11px] text-slate-500">Showing {describeRange(resolved.from, resolved.to)}.</p>
    </Card>
  );
}

/** A link that downloads the same report as CSV. */
export function ExportLink({ kind, from, to }: { kind: string; from: string; to: string }) {
  return (
    <Link
      href={`/admin/reports/export?kind=${kind}&from=${from}&to=${to}`}
      prefetch={false}
      className="inline-flex items-center gap-1.5 text-[11px] text-yellow-700 hover:underline"
    >
      <Download className="w-3.5 h-3.5" /> CSV
    </Link>
  );
}

/**
 * Renders any report from its definition. Money columns are formatted and
 * right-aligned; everything else is left as it came, because a report that
 * quietly reinterprets its own numbers is worse than a plain one.
 */
export function ReportTable({
  definition,
  rows,
  from,
  to,
  error,
  showExport = true,
}: {
  definition: ReportDefinition;
  rows: Record<string, unknown>[];
  from: string;
  to: string;
  error?: string | null;
  showExport?: boolean;
}) {
  const grid = toGrid(definition, rows);

  return (
    <Card>
      <div className="px-4 pt-4">
        <SectionTitle
          action={showExport && rows.length > 0 ? <ExportLink kind={definition.kind} from={from} to={to} /> : undefined}
        >
          {definition.label}
        </SectionTitle>
        <p className="text-[11px] text-slate-500 -mt-2 mb-3">{definition.description}</p>
      </div>

      {error ? (
        <div className="px-4 pb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message="Nothing to report for this period." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={tableHeadClass}>
                {definition.columns.map((c) => (
                  <th key={c.key} className={`py-2 px-3 font-semibold ${c.money ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {grid.body.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/60">
                  {row.map((value, j) => {
                    const column = definition.columns[j];
                    const isSource = column.key === "source" && definition.kind === "daily_revenue";
                    return (
                      <td key={column.key} className={`py-2 px-3 ${column.money ? "text-right" : ""}`}>
                        {isSource ? (
                          <Tag tone={value === "audit" ? "green" : "neutral"}>
                            {value === "audit" ? "Closed" : "Live"}
                          </Tag>
                        ) : column.money && typeof value === "number" ? (
                          fmtMoney(value)
                        ) : (
                          String(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * The note that explains a mixed report. Dates the night audit has closed are
 * fixed for ever; dates it has not are still moving, and a manager should know
 * which is which before quoting a figure to an owner.
 */
export function SourceNote({ audited, days }: { audited: number; days: number }) {
  if (days === 0) return null;
  if (audited === days) {
    return (
      <p className="text-[11px] text-slate-500">
        Every day in this period is closed by a night audit, so these figures will not change.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-slate-500">
      {audited} of {days} day(s) are closed by a night audit and fixed. The rest are computed live and may still
      change as charges are posted.
    </p>
  );
}
