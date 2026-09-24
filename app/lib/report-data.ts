import type { SupabaseClient } from "@supabase/supabase-js";
import { reportByKind, type ReportDefinition } from "./reports";

/**
 * Running a report (SOW Module 13).
 *
 * Every report is a permission-checked database function, so this is a thin,
 * uniform way to call whichever one was asked for. The permission check lives
 * in the function rather than here — a report must refuse the same way
 * whether it was asked for by a page, an export or the scheduler.
 *
 * `report_outstanding` takes no dates, which is why the definition carries a
 * `ranged` flag; money owed is owed now, not over a period.
 */
export async function runReport(
  db: SupabaseClient,
  definition: ReportDefinition,
  range: { from: string; to: string },
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const { data, error } = definition.ranged
    ? await db.rpc(definition.fn, { p_from: range.from, p_to: range.to })
    : await db.rpc(definition.fn);

  if (error) {
    // A refusal from the function is about permission, not a broken report.
    const message = /not permitted/i.test(error.message)
      ? "Your role does not allow this report."
      : error.message;
    return { rows: [], error: message };
  }

  // A function returning a single row hands back an object, not an array.
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { rows: rows as Record<string, unknown>[], error: null };
}

export async function runReportByKind(
  db: SupabaseClient,
  kind: string,
  range: { from: string; to: string },
) {
  const definition = reportByKind(kind);
  if (!definition) return { definition: null, rows: [], error: "No such report." };
  const { rows, error } = await runReport(db, definition, range);
  return { definition, rows, error };
}
