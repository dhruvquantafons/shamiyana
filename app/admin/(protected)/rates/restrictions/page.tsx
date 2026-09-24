import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type { RatePlan, RateRestriction, RoomType } from "../../../../lib/types";
import { saveRestriction, deleteRestriction } from "../../../rates-actions";
import { Card, Field, Check, Tag, Notice, inputClass, fmtDate, tableHeadClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function RestrictionsPage() {
  const session = await requireAnyPermission(["rates.view", "rates.manage"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const manage = can(session, "rates.manage");
  const today = todayIn(settings.timezone);

  const [{ data: restrictions }, { data: types }, { data: plans }] = await Promise.all([
    supabase.from("rate_restrictions").select("*").gte("end_date", today).order("start_date"),
    supabase.from("room_types").select("id, name").order("sort_order"),
    supabase.from("rate_plans").select("id, name, code").order("sort_order"),
  ]);
  const list = (restrictions ?? []) as RateRestriction[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];
  const planList = (plans ?? []) as Pick<RatePlan, "id" | "name" | "code">[];

  return (
    <div className="space-y-6">
      <Notice>
        <strong className="font-medium">MinLOS / MaxLOS</strong> apply to stays arriving on these dates.{" "}
        <strong className="font-medium">Closed to arrival</strong> and{" "}
        <strong className="font-medium">closed to departure</strong> stop check-in or check-out on these dates.{" "}
        <strong className="font-medium">Blackout</strong> stops any stay that includes one of these nights. Staff
        with the overbooking permission can override on a booking.
      </Notice>

      {manage && (
        <Card className="p-5">
          <ActionForm action={saveRestriction} submitLabel="Add restriction">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
              <Field label="From">
                <input type="date" name="start_date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label="To">
                <input type="date" name="end_date" className={inputClass} />
              </Field>
              <Field label="Room type">
                <select name="room_type_id" defaultValue="" className={inputClass}>
                  <option value="">All</option>
                  {typeList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rate plan">
                <select name="rate_plan_id" defaultValue="" className={inputClass}>
                  <option value="">All</option>
                  {planList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Min nights">
                <input type="number" name="min_los" min={1} className={inputClass} />
              </Field>
              <Field label="Max nights">
                <input type="number" name="max_los" min={1} className={inputClass} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <Check name="closed_to_arrival" label="Closed to arrival (CTA)" />
              <Check name="closed_to_departure" label="Closed to departure (CTD)" />
              <Check name="stop_sell" label="Blackout (stop sell)" />
            </div>
            <Field label="Note">
              <input name="note" placeholder="Why — e.g. Independence Day minimum stay" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      )}

      <Card>
        {list.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No current or future restrictions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-5 py-3 font-semibold">Dates</th>
                  <th className="px-5 py-3 font-semibold">Applies to</th>
                  <th className="px-5 py-3 font-semibold">Rule</th>
                  <th className="px-5 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {fmtDate(r.start_date)}
                      {r.end_date !== r.start_date && ` → ${fmtDate(r.end_date)}`}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {r.room_type_id ? typeList.find((t) => t.id === r.room_type_id)?.name : "All rooms"} ·{" "}
                      {r.rate_plan_id ? planList.find((p) => p.id === r.rate_plan_id)?.code : "all plans"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.min_los && <Tag tone="gold">Min {r.min_los}</Tag>}
                        {r.max_los && <Tag tone="gold">Max {r.max_los}</Tag>}
                        {r.closed_to_arrival && <Tag tone="amber">CTA</Tag>}
                        {r.closed_to_departure && <Tag tone="amber">CTD</Tag>}
                        {r.stop_sell && <Tag tone="red">Blackout</Tag>}
                      </div>
                      {r.note && <p className="text-[11px] text-slate-500 mt-1">{r.note}</p>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {manage && (
                        <ActionForm
                          action={deleteRestriction}
                          submitLabel="Remove"
                          submitClassName="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer"
                          className=""
                        >
                          <input type="hidden" name="id" value={r.id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
