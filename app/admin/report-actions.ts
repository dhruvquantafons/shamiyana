"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { friendlyDbError } from "../lib/db-errors";
import { buildScheduledReport, sendScheduledReport } from "../lib/report-email";
import type { ReportSchedule } from "../lib/types";
import { type ActionState, str, bool, oneOf, uuidOrNull, lines as formLines } from "./form-utils";

/**
 * Module 13 — scheduled email reports.
 *
 * The schedule is only a row; the sending is done by the cron endpoint at
 * /api/cron/reports, so a report goes out whether or not anyone is signed in.
 * "Send now" exists because a manager who has just set one up wants to see
 * what it looks like before trusting it to a scheduler.
 */

const REPORTS_THAT_CAN_BE_SCHEDULED = [
  "daily_revenue",
  "kpi_summary",
  "outstanding",
  "outlet_sales",
  "housekeeping",
  "maintenance",
] as const;

const FREQUENCIES = ["daily", "weekly", "monthly"] as const;

/** Splits and tidies the recipient list, keeping only plausible addresses. */
function recipientsFrom(fd: FormData): { list: string[]; rejected: string[] } {
  const raw = formLines(fd, "recipients", 50).flatMap((line) => line.split(",").map((v) => v.trim()));
  const list: string[] = [];
  const rejected: string[] = [];
  for (const value of raw) {
    if (!value) continue;
    if (/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) list.push(value.toLowerCase());
    else rejected.push(value);
  }
  return { list: [...new Set(list)], rejected };
}

export async function saveReportSchedule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("reports.schedule");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  const report = oneOf(fd, "report", REPORTS_THAT_CAN_BE_SCHEDULED, "kpi_summary");
  if (!name) return { error: "Give the schedule a name, such as “Morning revenue to the owner”." };

  const { list, rejected } = recipientsFrom(fd);
  if (list.length === 0) {
    return { error: "Add at least one email address to send it to." };
  }

  const row = {
    name,
    report,
    frequency: oneOf(fd, "frequency", FREQUENCIES, "daily"),
    recipients: list.join(", "),
    is_active: bool(fd, "is_active"),
    created_by: session.staff.id,
  };

  const { error } = id
    ? await supabase.from("report_schedules").update(row).eq("id", id)
    : await supabase.from("report_schedules").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/reports/schedules");
  return {
    success:
      `“${name}” saved, going to ${list.length} recipient${list.length === 1 ? "" : "s"}.` +
      (rejected.length ? ` Ignored ${rejected.length} entr${rejected.length === 1 ? "y" : "ies"} that is not an email address.` : ""),
  };
}

export async function deleteReportSchedule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("reports.schedule");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Schedule not found." };

  const { error } = await supabase.from("report_schedules").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/reports/schedules");
  return { success: "Schedule removed." };
}

/**
 * Sends one schedule immediately. Reports what actually happened rather than
 * claiming success: with no email keys set the send is skipped, and the
 * manager needs to know that before they rely on it.
 */
export async function sendReportNow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("reports.schedule");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Schedule not found." };

  const { data } = await supabase.from("report_schedules").select("*").eq("id", id).maybeSingle();
  const schedule = data as ReportSchedule | null;
  if (!schedule) return { error: "Schedule not found." };

  const built = await buildScheduledReport(supabase, schedule);
  if (built.error) return { error: built.error };

  const result = await sendScheduledReport(supabase, schedule, built);

  revalidatePath("/admin/reports/schedules");
  if (result.status === "skipped") {
    return {
      success:
        "The report was built but not sent: email is not configured. Add RESEND_API_KEY and NOTIFY_FROM_EMAIL, then try again.",
    };
  }
  if (result.status === "failed") return { error: `The report could not be sent: ${result.error}` };
  return { success: `Sent to ${schedule.recipients}.` };
}
