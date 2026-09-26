import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { todayIn } from "../../../lib/dates";
import { runNightAudit } from "../../night-audit-actions";
import {
  PageHeader,
  Card,
  Check,
  Notice,
  SectionTitle,
  Tag,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
} from "../../components/ui";

/** A fortnight of closed days per page of history. */
const HISTORY_PAGE = 14;
import ActionForm from "../../components/ActionForm";

export default async function NightAuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requirePermission("frontdesk.night_audit");
  const page = pageParam((await searchParams).page);
  const supabase = await createClient();
  const settings = await getSettings();
  const day = settings.business_date;
  const today = todayIn(settings.timezone);

  const [{ data: due }, { data: overstays }, { data: unassigned }, { count: inHouse }, { data: history, error: historyError, count: historyCount }, { data: current }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("id, reference, contact_name, status")
        .in("status", ["tentative", "confirmed"])
        .lte("check_in", day),
      supabase.from("bookings").select("id, reference, contact_name, check_out").eq("status", "checked_in").lte("check_out", day),
      supabase
        .from("bookings")
        .select("id, reference, contact_name")
        .eq("status", "checked_in")
        .is("room_id", null),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "checked_in"),
      supabase
        .from("night_audits")
        .select("business_date, status, completed_at, report", { count: "exact" })
        .order("business_date", { ascending: false })
        .range(...pageRange(page, HISTORY_PAGE)),
      supabase.from("night_audits").select("status, error").eq("business_date", day).maybeSingle(),
    ]);

  if (outOfRange(historyError)) redirect(pageHref("/admin/night-audit", {}, 1));
  const pending = due ?? [];

  return (
    <>
      <PageHeader
        title="Night audit"
        description={`Closes the business day: posts room charges and tax, handles no-shows and expired holds, closes the day's payments and produces the daily revenue report.`}
      />

      <div className="space-y-6">
        <Card className="p-5">
          <SectionTitle>Close {fmtDate(day)}</SectionTitle>

          {day > today && (
            <div className="mb-4">
              <Notice tone="warn">
                The business date is ahead of the calendar date — {fmtDate(day)} has not started yet. Run the audit after
                the day ends.
              </Notice>
            </div>
          )}
          {current?.status === "failed" && (
            <div className="mb-4">
              <Notice tone="error">The last attempt stopped: {current.error}. It is safe to run again.</Notice>
            </div>
          )}

          <ul className="space-y-2 text-sm mb-5">
            <li>
              <strong className="font-medium">{inHouse ?? 0}</strong> in-house booking(s) will be charged for the night of{" "}
              {fmtDate(day)}.
            </li>
            <li className={pending.length ? "text-amber-800" : ""}>
              <strong className="font-medium">{pending.length}</strong> expected arrival(s) have not checked in
              {pending.length > 0 && (
                <span className="block text-xs text-slate-600">
                  {pending.map((b) => (
                    <Link key={b.id} href={`/admin/bookings/${b.id}`} className="mr-2 text-yellow-700">
                      {b.reference} {b.contact_name}
                    </Link>
                  ))}
                </span>
              )}
            </li>
            <li className={(overstays ?? []).length ? "text-rose-800" : ""}>
              <strong className="font-medium">{(overstays ?? []).length}</strong> guest(s) were due out and are still
              checked in
              {(overstays ?? []).length > 0 && (
                <span className="block text-xs text-slate-600">
                  {(overstays ?? []).map((b) => (
                    <Link key={b.id} href={`/admin/bookings/${b.id}`} className="mr-2 text-yellow-700">
                      {b.reference} {b.contact_name}
                    </Link>
                  ))}
                  — check them out or extend their stay first, or they will not be charged for tonight.
                </span>
              )}
            </li>
            {(unassigned ?? []).length > 0 && (
              <li className="text-rose-800">{(unassigned ?? []).length} in-house booking(s) have no room.</li>
            )}
          </ul>

          <ActionForm action={runNightAudit} submitLabel={`Run night audit for ${fmtDate(day)}`} pendingLabel="Running…">
            {can(session, "bookings.cancel") && (
              <Check
                name="mark_no_shows"
                defaultChecked={pending.length > 0}
                label="Mark arrivals who did not come as no-shows and post their no-show charge"
                hint="Untick to carry them into tomorrow (e.g. a confirmed late arrival)."
              />
            )}
            <Check name="confirm" label={`I have reviewed the day and want to close ${fmtDate(day)}. The business date will move to the next day.`} />
          </ActionForm>
        </Card>

        <Card className="p-5">
          <SectionTitle>Recent audits</SectionTitle>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No audits yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(history ?? []).map((a) => {
                const r = a.report as { revenue?: { total?: number }; rooms?: { occupancy_percent?: number } };
                return (
                  <li key={a.business_date}>
                    <Link href={`/admin/night-audit/${a.business_date}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-slate-50 text-sm">
                      <span className="w-32 font-medium">{fmtDate(a.business_date)}</span>
                      <Tag tone={a.status === "completed" ? "green" : a.status === "failed" ? "red" : "amber"}>{a.status}</Tag>
                      {r.rooms && <span className="text-slate-700">{r.rooms.occupancy_percent}% occupancy</span>}
                      {r.revenue && <span className="text-slate-700">{fmtMoney(r.revenue.total ?? 0)} revenue</span>}
                      {a.completed_at && <span className="ml-auto text-[11px] text-slate-500">{fmtDateTime(a.completed_at)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination
            page={page}
            total={historyCount ?? 0}
            pageSize={HISTORY_PAGE}
            path="/admin/night-audit"
            className="pt-4 mt-4 border-t border-slate-100"
          />
        </Card>
      </div>
    </>
  );
}
