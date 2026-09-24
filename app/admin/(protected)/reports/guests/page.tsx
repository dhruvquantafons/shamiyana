import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import { repeatGuestRatio, reportByKind, resolveRange, type RangePreset } from "../../../../lib/reports";
import { runReport } from "../../../../lib/report-data";
import type { GuestFeedback, LoyaltyTier } from "../../../../lib/types";
import { Card, EmptyState, SectionTitle, StatCard, Tag, fmtMoney, tableHeadClass } from "../../../components/ui";
import { RangePicker, ReportTable } from "../shared";

/**
 * Guest reports (SOW Module 13): repeat guest ratio, loyalty performance and
 * feedback scores — the three that say whether guests come back.
 */
export default async function GuestReportsPage({
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

  const guests = reportByKind("guests")!;
  const [guestRows, { data: tierRows }, { data: memberRows }, { data: feedbackRows }] = await Promise.all([
    runReport(supabase, guests, range),
    supabase.from("loyalty_tiers").select("*").order("sort_order"),
    supabase.from("guests").select("loyalty_tier").eq("loyalty_opt_in", true).is("erased_at", null),
    supabase
      .from("guest_feedback")
      .select("overall, room, service, cleanliness, food, comment, submitted_at")
      .not("submitted_at", "is", null)
      .gte("submitted_at", `${range.from}T00:00:00Z`)
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);

  const row = (guestRows.rows[0] ?? {}) as Record<string, number | null>;
  const tiers = (tierRows ?? []) as LoyaltyTier[];
  const members = (memberRows ?? []) as { loyalty_tier: string | null }[];
  const feedback = (feedbackRows ?? []) as GuestFeedback[];

  const ratio = repeatGuestRatio(Number(row.distinct_guests ?? 0), Number(row.repeat_guests ?? 0));
  const byTier = tiers.map((t) => ({
    tier: t,
    members: members.filter((m) => m.loyalty_tier === t.key).length,
  }));

  const average = (field: keyof GuestFeedback) => {
    const scored = feedback.map((f) => Number(f[field])).filter((n) => Number.isFinite(n) && n > 0);
    return scored.length ? (scored.reduce((s, n) => s + n, 0) / scored.length).toFixed(2) : "—";
  };

  return (
    <div className="space-y-6">
      <RangePicker
        basePath="/admin/reports/guests"
        preset={preset}
        from={fromParam ?? ""}
        to={toParam ?? ""}
        resolved={range}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Repeat guest ratio" value={`${ratio}%`} hint={`${row.repeat_guests ?? 0} had stayed before`} />
        <StatCard label="Stays" value={Number(row.stays ?? 0)} hint={`${row.distinct_guests ?? 0} distinct guests`} />
        <StatCard
          label="Average rating"
          value={row.avg_overall === null || row.avg_overall === undefined ? "—" : `${row.avg_overall} ★`}
          hint={`${row.feedback_count ?? 0} responses`}
        />
        <StatCard
          label="Loyalty members"
          value={Number(row.loyalty_members ?? 0)}
          hint={`${Number(row.points_earned ?? 0).toLocaleString("en-IN")} points earned`}
        />
      </div>

      <ReportTable definition={guests} rows={guestRows.rows} from={range.from} to={range.to} error={guestRows.error} />

      {/* ── Loyalty performance ── */}
      <Card className="p-5">
        <SectionTitle>Loyalty programme</SectionTitle>
        {!settings.loyalty_enabled ? (
          <p className="text-xs text-slate-500">
            {settings.loyalty_program_name} is switched off, so no points are being earned.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <dt className="text-slate-500">Points earned</dt>
                <dd className="text-slate-900">{Number(row.points_earned ?? 0).toLocaleString("en-IN")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Points redeemed</dt>
                <dd className="text-slate-900">{Number(row.points_redeemed ?? 0).toLocaleString("en-IN")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Redemption rate</dt>
                <dd className="text-slate-900">
                  {Number(row.points_earned ?? 0) > 0
                    ? `${Math.round((Number(row.points_redeemed ?? 0) / Number(row.points_earned)) * 100)}%`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Members</dt>
                <dd className="text-slate-900">{Number(row.loyalty_members ?? 0)}</dd>
              </div>
            </dl>
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs">
              {byTier.map(({ tier, members: count }) => (
                <span key={tier.key}>
                  <Tag tone="gold">{tier.name}</Tag> <span className="text-slate-700">{count}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              A point is worth {fmtMoney(Number(tiers[0]?.redeem_rate ?? 0))} at the entry tier, so the outstanding
              balance is a real liability — redemption rate is how much of it guests are actually using.
            </p>
          </>
        )}
      </Card>

      {/* ── Feedback ── */}
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Feedback scores</SectionTitle>
        </div>
        {feedback.length === 0 ? (
          <EmptyState message="No feedback submitted in this period." />
        ) : (
          <>
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(["overall", "room", "service", "cleanliness", "food"] as const).map((field) => (
                <div key={field} className="border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{field}</p>
                  <p className="text-sm font-medium text-slate-900">{average(field)}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className={tableHeadClass}>
                    <th className="py-2 px-4 font-semibold">Overall</th>
                    <th className="py-2 pr-3 font-semibold">Comment</th>
                    <th className="py-2 pr-4 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {feedback
                    .filter((f) => f.comment)
                    .slice(0, 20)
                    .map((f, i) => (
                      <tr key={i}>
                        <td className="py-2 px-4">{f.overall ? "★".repeat(f.overall) : "—"}</td>
                        <td className="py-2 pr-3">{f.comment}</td>
                        <td className="py-2 pr-4 text-slate-500">{f.submitted_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
