import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import type { RateSeason, RoomType } from "../../../../lib/types";
import { saveSeason, deleteSeason } from "../../../rates-actions";
import { Card, Field, Check, Tag, Notice, inputClass, fmtDate, dangerButtonClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describe(s: RateSeason) {
  const v = Number(s.adjustment_value);
  if (s.adjustment_kind === "fixed") return `₹${v.toLocaleString("en-IN")} per night`;
  if (s.adjustment_kind === "amount") return `${v >= 0 ? "+" : "−"}₹${Math.abs(v).toLocaleString("en-IN")} per night`;
  return `${v >= 0 ? "+" : ""}${v}%`;
}

function Fields({ s, typeList }: { s?: RateSeason; typeList: Pick<RoomType, "id" | "name">[] }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="sm:col-span-2">
          <Field label="Name">
            <input name="name" required defaultValue={s?.name} placeholder="Tulip season, Christmas & New Year…" className={inputClass} />
          </Field>
        </div>
        <Field label="From">
          <input type="date" name="start_date" required defaultValue={s?.start_date} className={inputClass} />
        </Field>
        <Field label="To (inclusive)">
          <input type="date" name="end_date" required defaultValue={s?.end_date} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Room type">
          <select name="room_type_id" defaultValue={s?.room_type_id ?? ""} className={inputClass}>
            <option value="">All room types</option>
            {typeList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Change">
          <select name="adjustment_kind" defaultValue={s?.adjustment_kind ?? "percent"} className={inputClass}>
            <option value="percent">Percent of base</option>
            <option value="amount">Add / subtract ₹</option>
            <option value="fixed">Fixed rate ₹</option>
          </select>
        </Field>
        <Field label="Value" hint="20 = +20%; -15 = 15% off.">
          <input type="number" name="adjustment_value" step="0.01" required defaultValue={s?.adjustment_value} className={inputClass} />
        </Field>
        <Field label="Priority" hint="Higher wins where seasons overlap.">
          <input type="number" name="priority" defaultValue={s?.priority ?? 0} className={inputClass} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium text-slate-600">Nights</span>
        {DAYS.map((d, i) => (
          <Check key={d} name="days_of_week" value={String(i)} defaultChecked={s ? s.days_of_week.includes(i) : true} label={d} />
        ))}
        <Check name="is_active" defaultChecked={s?.is_active ?? true} label="Active" />
      </div>
    </>
  );
}

export default async function SeasonsPage() {
  const session = await requireAnyPermission(["rates.view", "rates.manage"]);
  const supabase = await createClient();
  const manage = can(session, "rates.manage");

  const [{ data: seasons }, { data: types }] = await Promise.all([
    supabase.from("rate_seasons").select("*").order("start_date", { ascending: false }),
    supabase.from("room_types").select("id, name").order("sort_order"),
  ]);
  const list = (seasons ?? []) as RateSeason[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];

  return (
    <div className="space-y-6">
      <Notice>
        A season changes the base (or weekend) rate for the nights it covers, before any rate-plan discount. Tick only
        Fri and Sat to make a weekend-only uplift.
      </Notice>

      {manage && (
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Add a season</summary>
            <div className="mt-5">
              <ActionForm action={saveSeason} submitLabel="Add season">
                <Fields typeList={typeList} />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {list.length === 0 && <p className="text-sm text-slate-500">No seasons yet — the base rates apply all year.</p>}

      {list.map((s) => (
        <Card key={s.id} className="p-5">
          <details>
            <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{s.name}</span>
              <Tag tone="gold">{describe(s)}</Tag>
              {!s.is_active && <Tag tone="red">Inactive</Tag>}
              <span className="text-xs text-slate-600">
                {fmtDate(s.start_date)} → {fmtDate(s.end_date)} ·{" "}
                {s.room_type_id ? typeList.find((t) => t.id === s.room_type_id)?.name : "all room types"} ·{" "}
                {s.days_of_week.length === 7 ? "every night" : s.days_of_week.map((d) => DAYS[d]).join(", ")}
              </span>
              {manage && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
            </summary>
            {manage && (
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                <ActionForm action={saveSeason} submitLabel="Save season">
                  <input type="hidden" name="id" value={s.id} />
                  <Fields s={s} typeList={typeList} />
                </ActionForm>
                <ActionForm action={deleteSeason} submitLabel="Delete season" submitClassName={dangerButtonClass} confirmMessage="Delete this season?" className="">
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              </div>
            )}
          </details>
        </Card>
      ))}
    </div>
  );
}
