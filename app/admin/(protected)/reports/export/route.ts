import { createClient } from "../../../../lib/supabase/server";
import { getSession } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import { toCsv } from "../../../../lib/hr";
import { exportFilename, reportByKind, resolveRange, toGrid, type RangePreset } from "../../../../lib/reports";
import { runReport } from "../../../../lib/report-data";

/**
 * CSV export for any report (SOW Module 13 "Report Formats": Excel/CSV).
 *
 * Built from the same definition the screen renders, so an export can never
 * show different columns from the page it was taken off. Permission is
 * checked here and again by the report function itself.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const url = new URL(request.url);
  const definition = reportByKind(url.searchParams.get("kind") ?? "");
  if (!definition) return new Response("No such report.", { status: 404 });

  const permitted = definition.financial
    ? can(session, "reports.financial")
    : can(session, "reports.view") || can(session, "reports.financial");
  if (!permitted) return new Response("Your role does not allow this report.", { status: 403 });

  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const range = resolveRange(
    (url.searchParams.get("preset") ?? "custom") as RangePreset,
    today,
    url.searchParams.get("from") ?? "",
    url.searchParams.get("to") ?? "",
  );

  const supabase = await createClient();
  const { rows, error } = await runReport(supabase, definition, range);
  if (error) return new Response(error, { status: 403 });

  const grid = toGrid(definition, rows);
  const csv = toCsv([
    [definition.label],
    [`${settings.name} — ${definition.ranged ? `${range.from} to ${range.to}` : `as at ${today}`}`],
    [],
    grid.header,
    ...grid.body,
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(definition.kind, range.from, range.to)}"`,
      // A report is a point-in-time document; never let a proxy serve a stale one.
      "Cache-Control": "no-store",
    },
  });
}
