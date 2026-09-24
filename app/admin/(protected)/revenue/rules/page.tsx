import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import type { PricingRule, RoomType } from "../../../../lib/types";
import { savePricingRule, deletePricingRule } from "../../../revenue-actions";
import {
  Card,
  Check,
  Field,
  Notice,
  Tag,
  dangerButtonClass,
  inputClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeChange(r: PricingRule) {
  const v = Number(r.adjustment_value);
  if (r.adjustment_kind === "fixed") return `₹${v.toLocaleString("en-IN")} per night`;
  if (r.adjustment_kind === "amount") {
    return `${v >= 0 ? "+" : "−"}₹${Math.abs(v).toLocaleString("en-IN")} per night`;
  }
  return `${v >= 0 ? "+" : ""}${v}%`;
}

/** The rule's conditions in plain words, for the list. */
function describeConditions(r: PricingRule): string {
  const parts: string[] = [];

  if (r.min_occupancy !== null && r.max_occupancy !== null) {
    parts.push(`${r.min_occupancy}–${r.max_occupancy}% full`);
  } else if (r.min_occupancy !== null) {
    parts.push(`${r.min_occupancy}% full or more`);
  } else if (r.max_occupancy !== null) {
    parts.push(`up to ${r.max_occupancy}% full`);
  }

  if (r.days_of_week.length < 7) parts.push(r.days_of_week.map((d) => DAYS[d]).join(", "));
  if (r.start_date || r.end_date) {
    parts.push(`${r.start_date ?? "any date"} → ${r.end_date ?? "any date"}`);
  }

  if (r.min_lead_days !== null && r.max_lead_days !== null) {
    parts.push(`${r.min_lead_days}–${r.max_lead_days} days ahead`);
  } else if (r.min_lead_days !== null) {
    parts.push(`${r.min_lead_days}+ days ahead`);
  } else if (r.max_lead_days !== null) {
    parts.push(`within ${r.max_lead_days} days`);
  }

  return parts.length > 0 ? parts.join(" · ") : "every night";
}

function Fields({ r, typeList }: { r?: PricingRule; typeList: Pick<RoomType, "id" | "name">[] }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={r?.name}
              placeholder="Busy nights, Last-minute fill, Diwali…"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Room type">
          <select name="room_type_id" defaultValue={r?.room_type_id ?? ""} className={inputClass}>
            <option value="">All room types</option>
            {typeList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-md p-4 space-y-4">
        <legend className="text-xs font-medium text-slate-600 px-1">
          When it applies — leave a box empty to ignore that condition
        </legend>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Occupancy from %" hint="80 = when 80% full or more.">
            <input type="number" name="min_occupancy" min="0" max="100" defaultValue={r?.min_occupancy ?? ""} className={inputClass} />
          </Field>
          <Field label="Occupancy to %" hint="40 = only while under 40% full.">
            <input type="number" name="max_occupancy" min="0" max="100" defaultValue={r?.max_occupancy ?? ""} className={inputClass} />
          </Field>
          <Field label="Booked at least … days ahead">
            <input type="number" name="min_lead_days" min="0" defaultValue={r?.min_lead_days ?? ""} className={inputClass} />
          </Field>
          <Field label="… and at most … days ahead" hint="3 = a last-minute rule.">
            <input type="number" name="max_lead_days" min="0" defaultValue={r?.max_lead_days ?? ""} className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="From date">
            <input type="date" name="start_date" defaultValue={r?.start_date ?? ""} className={inputClass} />
          </Field>
          <Field label="To date (inclusive)">
            <input type="date" name="end_date" defaultValue={r?.end_date ?? ""} className={inputClass} />
          </Field>
          <Field label="Occasion" hint="Shown to whoever approves the change.">
            <input name="occasion" defaultValue={r?.occasion} placeholder="Diwali, Tulip festival…" className={inputClass} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-medium text-slate-600">Nights</span>
          {DAYS.map((d, i) => (
            <Check
              key={d}
              name="days_of_week"
              value={String(i)}
              defaultChecked={r ? r.days_of_week.includes(i) : true}
              label={d}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-md p-4 space-y-4">
        <legend className="text-xs font-medium text-slate-600 px-1">What it does to the rate</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Change">
            <select name="adjustment_kind" defaultValue={r?.adjustment_kind ?? "percent"} className={inputClass}>
              <option value="percent">Percent</option>
              <option value="amount">Add / subtract ₹</option>
              <option value="fixed">Fixed rate ₹</option>
            </select>
          </Field>
          <Field label="Value" hint="15 = +15%; -10 = 10% off.">
            <input type="number" name="adjustment_value" step="0.01" required defaultValue={r?.adjustment_value} className={inputClass} />
          </Field>
          <Field label="Never below ₹" hint="0 = no floor.">
            <input type="number" name="floor_rate" min="0" step="1" defaultValue={r?.floor_rate ?? 0} className={inputClass} />
          </Field>
          <Field label="Never above ₹" hint="0 = no ceiling.">
            <input type="number" name="ceiling_rate" min="0" step="1" defaultValue={r?.ceiling_rate ?? 0} className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Priority" hint="Higher wins where two rules match the same night.">
            <input type="number" name="priority" defaultValue={r?.priority ?? 0} className={inputClass} />
          </Field>
          <Check name="is_active" defaultChecked={r?.is_active ?? true} label="Active" />
        </div>
      </fieldset>
    </>
  );
}

export default async function PricingRulesPage() {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const manage = can(session, "revenue.manage");

  const [{ data: rules }, { data: types }] = await Promise.all([
    supabase.from("pricing_rules").select("*").order("priority", { ascending: false }).order("name"),
    supabase.from("room_types").select("id, name").order("sort_order"),
  ]);
  const list = (rules ?? []) as PricingRule[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];

  return (
    <div className="space-y-6">
      <Notice>
        A rule&apos;s conditions all have to hold before it changes a rate, so &ldquo;80% full&rdquo; plus &ldquo;Fri,
        Sat&rdquo; means busy weekends only. Rates never stack: where two rules match a night, the higher priority sets
        the price. Nothing changes until the rules are run from the Forecast tab.
        {settings.revenue_floor_rate > 0 || settings.revenue_ceiling_rate > 0 ? (
          <>
            {" "}
            Every rule is also held inside the property limits
            {settings.revenue_floor_rate > 0 && ` of ₹${settings.revenue_floor_rate.toLocaleString("en-IN")}`}
            {settings.revenue_ceiling_rate > 0 && ` up to ₹${settings.revenue_ceiling_rate.toLocaleString("en-IN")}`}.
          </>
        ) : null}
      </Notice>

      {manage && (
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Add a pricing rule</summary>
            <div className="mt-5">
              <ActionForm action={savePricingRule} submitLabel="Add rule">
                <Fields typeList={typeList} />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {list.length === 0 && (
        <p className="text-sm text-slate-500">
          No pricing rules yet — every night sells at its seasonal rate.
        </p>
      )}

      {list.map((r) => (
        <Card key={r.id} className="p-5">
          <details>
            <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{r.name}</span>
              <Tag tone="gold">{describeChange(r)}</Tag>
              {!r.is_active && <Tag tone="red">Inactive</Tag>}
              {r.occasion && <Tag tone="violet">{r.occasion}</Tag>}
              <span className="text-xs text-slate-600">
                {describeConditions(r)} ·{" "}
                {r.room_type_id ? typeList.find((t) => t.id === r.room_type_id)?.name : "all room types"} · priority{" "}
                {r.priority}
              </span>
              {manage && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
            </summary>
            {manage && (
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                <ActionForm action={savePricingRule} submitLabel="Save rule">
                  <input type="hidden" name="id" value={r.id} />
                  <Fields r={r} typeList={typeList} />
                </ActionForm>
                <ActionForm
                  action={deletePricingRule}
                  submitLabel="Delete rule"
                  submitClassName={dangerButtonClass}
                  confirmMessage="Delete this rule? Rates it has already set stay live until you clear them."
                  className=""
                >
                  <input type="hidden" name="id" value={r.id} />
                </ActionForm>
              </div>
            )}
          </details>
        </Card>
      ))}
    </div>
  );
}
