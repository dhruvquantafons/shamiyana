import { createServiceClient } from "../../../lib/supabase/server";
import { hasBearer } from "../../../lib/bearer";
import { buildScheduledReport, isDue, sendScheduledReport } from "../../../lib/report-email";
import type { ReportSchedule } from "../../../lib/types";

/**
 * Scheduled report job (SOW Module 13: "Scheduled email reports
 * (daily/weekly/monthly) to management").
 *
 * Call it once a morning from a scheduler (e.g. Vercel Cron, which sends
 * "Authorization: Bearer <CRON_SECRET>"). Disabled until CRON_SECRET is set.
 *
 * Safe to call more than once a day: a schedule that has already gone out
 * today is skipped, so a retry cannot send the owner the same report twice.
 * Daily reports cover yesterday, weekly go out on Monday for the last seven
 * days, and monthly on the 1st for the whole of last month — a report covers
 * a period that has finished, never a half-finished one.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "The scheduled report job is not configured." }, { status: 503 });
  }
  if (!hasBearer(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createServiceClient();
  const { data: settings } = await supabase.from("property_settings").select("timezone").maybeSingle();
  const timezone = settings?.timezone ?? "Asia/Kolkata";

  // The property's own day and weekday, not the server's.
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const weekday = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
      .format(now)
      .replace(/Sun/, "0")
      .replace(/Mon/, "1")
      .replace(/Tue/, "2")
      .replace(/Wed/, "3")
      .replace(/Thu/, "4")
      .replace(/Fri/, "5")
      .replace(/Sat/, "6"),
  );

  const { data } = await supabase.from("report_schedules").select("*").eq("is_active", true);
  const schedules = (data ?? []) as ReportSchedule[];
  const due = schedules.filter((s) => isDue(s, today, weekday));

  const results: { name: string; status: string }[] = [];
  for (const schedule of due) {
    const built = await buildScheduledReport(supabase, schedule);
    if (built.error) {
      await supabase
        .from("report_schedules")
        .update({ last_sent_at: new Date().toISOString(), last_status: built.error })
        .eq("id", schedule.id);
      results.push({ name: schedule.name, status: `not built: ${built.error}` });
      continue;
    }
    const sent = await sendScheduledReport(supabase, schedule, built);
    results.push({ name: schedule.name, status: sent.status });
  }

  return Response.json({ date: today, active: schedules.length, due: due.length, results });
}
