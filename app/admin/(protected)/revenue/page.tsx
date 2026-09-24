import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { addDays, dayOfWeek, todayIn } from "../../../lib/dates";
import { occupancyPercent, undynamicRate } from "../../../lib/revenue";
import type {
  CompetitorRate,
  ForecastRow,
  PricingAdjustment,
  RateSeason,
  RoomType,
} from "../../../lib/types";
import { runPricingRules } from "../../revenue-actions";
import {
  Card,
  EmptyState,
  Notice,
  StatCard,
  Tag,
  fmtMoney,
  inputClass,
  tableHeadClass,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Green when quiet, amber as it fills, red when nearly gone. */
function occupancyTone(pct: number) {
  if (pct >= 85) return "red" as const;
  if (pct >= 60) return "amber" as const;
  return "green" as const;
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; type?: string }>;
}) {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const params = await searchParams;

  const manage = can(session, "revenue.manage");
  const today = todayIn(settings.timezone);
  const horizon = Math.min(180, Math.max(7, Number(params.days) || settings.revenue_forecast_days));
  const until = addDays(today, horizon);

  const [forecast, types, seasons, adjustments, competitors] = await Promise.all([
    supabase.rpc("revenue_forecast", { p_from: today, p_to: until }),
    supabase.from("room_types").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("rate_seasons").select("*").gte("end_date", today),
    supabase
      .from("pricing_adjustments")
      .select("*")
      .in("status", ["pending", "applied"])
      .gte("stay_date", today)
      .lte("stay_date", until),
    supabase
      .from("competitor_rates")
      .select("*")
      .gte("stay_date", today)
      .lte("stay_date", until)
      .eq("sold_out", false),
  ]);

  const roomTypes = ((types.data ?? []) as RoomType[]).filter(
    (t) => !params.type || t.id === params.type,
  );
  const rows = (forecast.data ?? []) as ForecastRow[];
  const seasonList = (seasons.data ?? []) as RateSeason[];
  const live = (adjustments.data ?? []) as PricingAdjustment[];
  const comps = (competitors.data ?? []) as CompetitorRate[];

  if (forecast.error) {
    return <Notice tone="error">The forecast could not be loaded: {forecast.error.message}</Notice>;
  }

  // One line per night, across the room types being shown.
  const dates = [...new Set(rows.map((r) => r.stay_date))].sort();
  const byKey = new Map(rows.map((r) => [`${r.stay_date}|${r.room_type_id}`, r]));
  const liveByKey = new Map(live.map((a) => [`${a.stay_date}|${a.room_type_id}`, a]));

  const compByDate = new Map<string, number[]>();
  for (const c of comps) {
    compByDate.set(c.stay_date, [...(compByDate.get(c.stay_date) ?? []), Number(c.rate)]);
  }
  const compMedian = (date: string) => {
    const list = (compByDate.get(date) ?? []).sort((a, b) => a - b);
    if (list.length === 0) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
  };

  // Headline numbers across the whole window.
  const capacity = rows.reduce((s, r) => s + Number(r.capacity), 0);
  const sold = rows.reduce((s, r) => s + Number(r.rooms_sold), 0);
  const revenue = rows.reduce((s, r) => s + Number(r.revenue_on_books), 0);
  const pending = live.filter((a) => a.status === "pending").length;
  const applied = live.filter((a) => a.status === "applied").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={`Occupancy to ${until}`} value={`${occupancyPercent(sold, capacity)}%`} />
        <StatCard label="Rooms on the books" value={`${sold} of ${capacity}`} />
        <StatCard label="Room revenue on the books" value={fmtMoney(revenue)} />
        <StatCard
          label="Rates set by rules"
          value={`${applied} live`}
          hint={pending > 0 ? `${pending} waiting for approval` : "nothing waiting"}
        />
      </div>

      <Notice>
        Occupancy counts rooms held by a tentative, confirmed or checked-in booking, the same three the overbooking
        guard counts. &ldquo;Selling now&rdquo; is the rate before any rate-plan discount: a rule&apos;s rate where one
        is live, the seasonal rate otherwise.
      </Notice>

      <Card className="p-5">
        <form className="flex flex-wrap items-end gap-4">
          <label className="text-xs font-medium text-slate-600">
            Look ahead
            <select name="days" defaultValue={String(horizon)} className={`${inputClass} mt-1`}>
              {[14, 30, 60, 90, 180].map((d) => (
                <option key={d} value={d}>
                  {d} nights
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Room type
            <select name="type" defaultValue={params.type ?? ""} className={`${inputClass} mt-1`}>
              <option value="">All room types</option>
              {((types.data ?? []) as RoomType[]).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="px-4 py-2 text-sm rounded-md border border-slate-300 hover:border-yellow-500">
            Show
          </button>
        </form>
      </Card>

      {manage && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-1">Run the pricing rules</h2>
          <p className="text-xs text-slate-600 mb-4">
            Prices every night to {until} with the active rules. Changes within{" "}
            {settings.revenue_auto_approve_percent}% go live straight away; anything larger waits on the Approvals tab.
            Rates already approved are left alone unless a rule now asks for a different number.
          </p>
          <ActionForm action={runPricingRules} submitLabel="Run the rules" pendingLabel="Pricing…" className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="days" value={horizon} />
          </ActionForm>
        </Card>
      )}

      {roomTypes.length === 0 ? (
        <EmptyState message="No active room types to forecast." />
      ) : (
        roomTypes.map((type) => (
          <Card key={type.id} className="p-0 overflow-x-auto">
            <h2 className="text-sm font-semibold px-5 pt-5 pb-3">{type.name}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="text-left px-5 py-2">Night</th>
                  <th className="text-right px-3 py-2">Sold</th>
                  <th className="text-right px-3 py-2">Occupancy</th>
                  <th className="text-right px-3 py-2">Ordinary rate</th>
                  <th className="text-right px-3 py-2">Selling now</th>
                  <th className="text-right px-3 py-2">Competitors</th>
                  <th className="text-left px-5 py-2">Rule</th>
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => {
                  const row = byKey.get(`${date}|${type.id}`);
                  if (!row) return null;
                  const adjustment = liveByKey.get(`${date}|${type.id}`);
                  const ordinary = undynamicRate(date, type, seasonList);
                  const selling =
                    adjustment?.status === "applied" ? Number(adjustment.proposed_rate) : ordinary;
                  const pct = occupancyPercent(Number(row.rooms_sold), Number(row.capacity));
                  const median = compMedian(date);
                  const weekend = [5, 6].includes(dayOfWeek(date));

                  return (
                    <tr
                      key={date}
                      className={`border-t border-slate-100 ${weekend ? "bg-slate-50/60" : ""}`}
                    >
                      <td className="px-5 py-2 whitespace-nowrap">
                        <span className="text-slate-500 text-xs mr-2">{DAYS[dayOfWeek(date)]}</span>
                        {date}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.rooms_sold}/{row.capacity}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Tag tone={occupancyTone(pct)}>{pct}%</Tag>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {fmtMoney(ordinary)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmtMoney(selling)}
                        {selling !== ordinary && (
                          <span className={`ml-1 text-xs ${selling > ordinary ? "text-green-700" : "text-red-700"}`}>
                            {selling > ordinary ? "▲" : "▼"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {median === null ? "—" : fmtMoney(median)}
                      </td>
                      <td className="px-5 py-2 text-xs">
                        {adjustment ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-slate-600">{adjustment.rule_name}</span>
                            {adjustment.status === "pending" && <Tag tone="amber">Waiting</Tag>}
                            {adjustment.occasion && <Tag tone="violet">{adjustment.occasion}</Tag>}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
