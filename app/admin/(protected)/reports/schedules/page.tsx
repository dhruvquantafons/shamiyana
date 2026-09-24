import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { emailConfigured } from "../../../../lib/integrations";
import { reportByKind } from "../../../../lib/reports";
import type { ReportSchedule } from "../../../../lib/types";
import { REPORT_FREQUENCY_LABELS } from "../../../../lib/types";
import { saveReportSchedule, deleteReportSchedule, sendReportNow } from "../../../report-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  Tag,
  fmtDateTime,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/** What a schedule may send. "kpi_summary" is the headline figures in the body
 *  of the email rather than a table, which is what a GM actually reads. */
const SENDABLE = [
  { value: "kpi_summary", label: "Performance summary (occupancy, ADR, RevPAR)" },
  { value: "daily_revenue", label: "Daily revenue" },
  { value: "outstanding", label: "Outstanding payments" },
  { value: "outlet_sales", label: "Outlet-wise sales" },
  { value: "housekeeping", label: "Housekeeping performance" },
  { value: "maintenance", label: "Maintenance turnaround" },
];

/**
 * Scheduled email reports (SOW Module 13). The sending is done by
 * /api/cron/reports so a report goes out whether or not anyone is signed in.
 */
export default async function ReportSchedulesPage() {
  await requirePermission("reports.schedule");
  const supabase = await createClient();

  const { data } = await supabase.from("report_schedules").select("*").order("created_at");
  const schedules = (data ?? []) as ReportSchedule[];
  const emailReady = emailConfigured();
  const cronReady = Boolean(process.env.CRON_SECRET);

  const label = (kind: string) => SENDABLE.find((s) => s.value === kind)?.label ?? reportByKind(kind)?.label ?? kind;

  return (
    <div className="space-y-6">
      {!emailReady && (
        <Notice tone="warn">
          Email is not configured, so nothing will actually be sent. Add <code>RESEND_API_KEY</code> and{" "}
          <code>NOTIFY_FROM_EMAIL</code>. Schedules can be set up now and will start sending the moment the keys are
          in place — every attempt until then is recorded as skipped rather than lost.
        </Notice>
      )}
      {!cronReady && (
        <Notice tone="info">
          The scheduler is not connected. Set <code>CRON_SECRET</code> and point a daily job at{" "}
          <code>/api/cron/reports</code> (e.g. Vercel Cron). Until then, use <strong>Send now</strong>.
        </Notice>
      )}

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Scheduled reports</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-3">
            A daily report covers yesterday, a weekly one goes out on Monday for the last seven days, and a monthly
            one on the 1st for the whole of last month — so a report always covers a period that has finished.
          </p>
        </div>
        {schedules.length === 0 ? (
          <EmptyState message="Nothing scheduled. Set the first one up below." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Report</th>
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="py-2 pr-3 font-semibold">To</th>
                  <th className="py-2 pr-3 font-semibold">Last sent</th>
                  <th className="py-2 pr-4 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {schedules.map((s) => (
                  <tr key={s.id} className={s.is_active ? "" : "text-slate-400"}>
                    <td className="py-2 px-4">
                      {s.name}
                      {!s.is_active && (
                        <>
                          {" "}
                          <Tag tone="neutral">Paused</Tag>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3">{label(s.report)}</td>
                    <td className="py-2 pr-3">{REPORT_FREQUENCY_LABELS[s.frequency]}</td>
                    <td className="py-2 pr-3 text-slate-500">{s.recipients}</td>
                    <td className="py-2 pr-3 text-slate-500">
                      {s.last_sent_at ? (
                        <>
                          {fmtDateTime(s.last_sent_at)}
                          {s.last_status && <span className="block text-[10px]">{s.last_status}</span>}
                        </>
                      ) : (
                        "Never"
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <ActionForm action={sendReportNow} submitLabel="Send now" submitClassName={secondaryButtonClass}>
                          <input type="hidden" name="id" value={s.id} />
                        </ActionForm>
                        <details className="relative inline-block text-left">
                          <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                            Remove
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                            <ActionForm action={deleteReportSchedule} submitLabel="Remove schedule" submitClassName={secondaryButtonClass}>
                              <input type="hidden" name="id" value={s.id} />
                              <p className="text-[10px] text-slate-500 mb-2">This cannot be undone.</p>
                            </ActionForm>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Add or edit a schedule</SectionTitle>
        <ActionForm action={saveReportSchedule} submitLabel="Save schedule" submitClassName={secondaryButtonClass} className="space-y-3">
          <Field label="Editing" hint="Leave blank to add a new one.">
            <select name="id" defaultValue="" className={inputClass}>
              <option value="">New schedule</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Name">
              <input name="name" required maxLength={80} placeholder="Morning figures to the owner" className={inputClass} />
            </Field>
            <Field label="Report">
              <select name="report" defaultValue="kpi_summary" className={inputClass}>
                {SENDABLE.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How often">
              <select name="frequency" defaultValue="daily" className={inputClass}>
                {Object.entries(REPORT_FREQUENCY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Send to" hint="One address per line, or comma separated.">
            <textarea name="recipients" rows={3} placeholder={"owner@example.com\ngm@example.com"} className={inputClass} />
          </Field>
          <Check name="is_active" defaultChecked label="Active" />
          <p className="text-[11px] text-slate-500">
            Financial reports go out to whoever is listed here, so keep the list to people who should see revenue.
          </p>
        </ActionForm>
      </Card>
    </div>
  );
}
