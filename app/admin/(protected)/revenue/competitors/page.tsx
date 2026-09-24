import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { addDays, todayIn } from "../../../../lib/dates";
import { undynamicRate } from "../../../../lib/revenue";
import { MEAL_PLAN_LABELS } from "../../../../lib/types";
import type {
  CompetitorProperty,
  CompetitorRate,
  RateSeason,
  RoomType,
} from "../../../../lib/types";
import {
  saveCompetitor,
  deleteCompetitor,
  saveCompetitorRate,
  deleteCompetitorRate,
} from "../../../revenue-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  Tag,
  dangerButtonClass,
  fmtMoney,
  inputClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const params = await searchParams;

  const manage = can(session, "revenue.manage");
  const today = todayIn(settings.timezone);
  const horizon = Math.min(90, Math.max(7, Number(params.days) || 30));
  const until = addDays(today, horizon);

  const [{ data: properties }, { data: rates }, { data: types }, { data: seasons }] =
    await Promise.all([
      supabase.from("competitor_properties").select("*").order("sort_order").order("name"),
      supabase
        .from("competitor_rates")
        .select("*, competitor_properties(id, name)")
        .gte("stay_date", today)
        .lte("stay_date", until)
        .order("stay_date"),
      supabase.from("room_types").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("rate_seasons").select("*").gte("end_date", today),
    ]);

  const props = (properties ?? []) as CompetitorProperty[];
  const readings = (rates ?? []) as CompetitorRate[];
  const typeList = (types ?? []) as RoomType[];
  const seasonList = (seasons ?? []) as RateSeason[];
  const leadType = typeList[0] ?? null;

  return (
    <div className="space-y-6">
      <Notice>
        Rates are entered by hand from wherever you read them — an OTA listing, the hotel&apos;s own site, a phone call.
        Record what the number includes, because a rate with breakfast and tax in it is not comparable with one without.
        Our rate shown beside each reading is {leadType ? leadType.name : "the lead room type"} before any rate-plan
        discount.
      </Notice>

      {manage && (
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Add a property to track</summary>
            <div className="mt-5">
              <ActionForm action={saveCompetitor} submitLabel="Add property">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Name">
                    <input name="name" required placeholder="The Lalit, Vivanta…" className={inputClass} />
                  </Field>
                  <Field label="Where you read the rate" hint="Booking.com, their website, phone.">
                    <input name="source" className={inputClass} />
                  </Field>
                  <Field label="Order">
                    <input type="number" name="sort_order" defaultValue={0} className={inputClass} />
                  </Field>
                </div>
                <Field label="Notes">
                  <input name="notes" placeholder="Comparable on location; 5-star, so rates run higher." className={inputClass} />
                </Field>
                <Check name="is_active" defaultChecked label="Active" />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {props.length === 0 ? (
        <EmptyState message="No competitors tracked yet. Add one above, then record what it is charging night by night." />
      ) : (
        <>
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Properties tracked</h2>
            <div className="space-y-3">
              {props.map((p) => (
                <details key={p.id} className="border-b border-slate-100 pb-3 last:border-0">
                  <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    {!p.is_active && <Tag tone="red">Inactive</Tag>}
                    {p.source && <span className="text-xs text-slate-500">{p.source}</span>}
                    <span className="text-xs text-slate-400">
                      {readings.filter((r) => r.competitor_id === p.id).length} reading(s) ahead
                    </span>
                    {manage && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
                  </summary>
                  {manage && (
                    <div className="mt-4 space-y-3">
                      <ActionForm action={saveCompetitor} submitLabel="Save">
                        <input type="hidden" name="id" value={p.id} />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <Field label="Name">
                            <input name="name" required defaultValue={p.name} className={inputClass} />
                          </Field>
                          <Field label="Where you read the rate">
                            <input name="source" defaultValue={p.source} className={inputClass} />
                          </Field>
                          <Field label="Order">
                            <input type="number" name="sort_order" defaultValue={p.sort_order} className={inputClass} />
                          </Field>
                        </div>
                        <Field label="Notes">
                          <input name="notes" defaultValue={p.notes} className={inputClass} />
                        </Field>
                        <Check name="is_active" defaultChecked={p.is_active} label="Active" />
                      </ActionForm>
                      <ActionForm
                        action={deleteCompetitor}
                        submitLabel="Remove property"
                        submitClassName={dangerButtonClass}
                        confirmMessage="Remove this property and every rate recorded against it?"
                        className=""
                      >
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                    </div>
                  )}
                </details>
              ))}
            </div>
          </Card>

          {manage && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold mb-1">Record a rate</h2>
              <p className="text-xs text-slate-600 mb-4">
                Reading the same property and night again replaces the earlier figure.
              </p>
              <ActionForm action={saveCompetitorRate} submitLabel="Record rate">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <Field label="Property">
                    <select name="competitor_id" required className={inputClass}>
                      {props
                        .filter((p) => p.is_active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Night">
                    <input type="date" name="stay_date" required defaultValue={today} className={inputClass} />
                  </Field>
                  <Field label="Comparable with" hint="Which of our room types it sits against.">
                    <select name="room_type_id" className={inputClass}>
                      <option value="">Their lead-in rate</option>
                      {typeList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Rate ₹">
                    <input type="number" name="rate" min="0" step="1" className={inputClass} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="What it includes">
                    <select name="meal_plan" defaultValue="EP" className={inputClass}>
                      {Object.entries(MEAL_PLAN_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Note">
                    <input name="note" placeholder="Flash sale; refundable only." className={inputClass} />
                  </Field>
                  <div className="flex items-end gap-4 pb-2">
                    <Check name="tax_inclusive" label="Tax included" />
                    <Check name="sold_out" label="Sold out" hint="Record the night as unavailable." />
                  </div>
                </div>
              </ActionForm>
            </Card>
          )}

          <Card className="p-0 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
              <h2 className="text-sm font-semibold">Rates read, next {horizon} nights</h2>
              <form className="ml-auto">
                <select name="days" defaultValue={String(horizon)} className={inputClass} aria-label="Nights ahead">
                  {[7, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} nights
                    </option>
                  ))}
                </select>
                <noscript>
                  <button type="submit">Show</button>
                </noscript>
              </form>
            </div>

            {readings.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState message="Nothing recorded for the nights ahead." />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableHeadClass}>
                    <th className="text-left px-5 py-2">Night</th>
                    <th className="text-left px-3 py-2">Property</th>
                    <th className="text-left px-3 py-2">Comparable with</th>
                    <th className="text-right px-3 py-2">Their rate</th>
                    <th className="text-right px-3 py-2">Ours</th>
                    <th className="text-left px-3 py-2">Includes</th>
                    <th className="text-left px-5 py-2">Note</th>
                    {manage && <th className="w-10 px-5 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => {
                    const against =
                      typeList.find((t) => t.id === r.room_type_id) ?? leadType;
                    const ours = against ? undynamicRate(r.stay_date, against, seasonList) : null;
                    const gap = ours !== null && !r.sold_out ? Number(r.rate) - ours : null;

                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-5 py-2 whitespace-nowrap">{r.stay_date}</td>
                        <td className="px-3 py-2">{r.competitor_properties?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {r.room_type_id ? against?.name : "Lead-in"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.sold_out ? <Tag tone="neutral">Sold out</Tag> : fmtMoney(r.rate)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {ours === null ? "—" : fmtMoney(ours)}
                          {gap !== null && (
                            <span className={`ml-1 text-xs ${gap > 0 ? "text-green-700" : "text-red-700"}`}>
                              {gap > 0 ? "we're under" : gap < 0 ? "we're over" : "level"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {MEAL_PLAN_LABELS[r.meal_plan]}
                          {r.tax_inclusive ? ", tax in" : ""}
                        </td>
                        <td className="px-5 py-2 text-xs text-slate-500">{r.note || "—"}</td>
                        {manage && (
                          <td className="px-5 py-2">
                            <ActionForm
                              action={deleteCompetitorRate}
                              submitLabel="×"
                              submitClassName="text-slate-400 hover:text-red-600 text-base leading-none"
                              confirmMessage="Remove this reading?"
                              className=""
                            >
                              <input type="hidden" name="id" value={r.id} />
                            </ActionForm>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
