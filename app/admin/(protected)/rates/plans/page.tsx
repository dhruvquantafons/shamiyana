import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { loadCompanies } from "../../../../lib/rate-data";
import { describePenalty } from "../../../../lib/policies";
import type { Company, RatePlan, RoomType } from "../../../../lib/types";
import { RATE_TYPE_LABELS, MEAL_PLAN_LABELS, PENALTY_LABELS } from "../../../../lib/types";
import { saveRatePlan } from "../../../rates-actions";
import { Card, Field, Check, Tag, inputClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function RatePlansPage() {
  const session = await requireAnyPermission(["rates.view", "rates.manage"]);
  const supabase = await createClient();
  const manage = can(session, "rates.manage");

  const [{ data: plans }, { data: types }, companies] = await Promise.all([
    supabase.from("rate_plans").select("*").order("sort_order").order("name"),
    supabase.from("room_types").select("id, name").order("sort_order"),
    loadCompanies(supabase),
  ]);
  const planList = (plans ?? []) as RatePlan[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];

  return (
    <div className="space-y-6">
      {manage && (
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Create a rate plan</summary>
            <div className="mt-5">
              <ActionForm action={saveRatePlan} submitLabel="Create plan">
                <PlanFields roomTypes={typeList} companies={companies} />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {planList.map((plan) => (
        <Card key={plan.id} className="p-5">
          <details>
            <summary className="list-none cursor-pointer">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-yellow-800">{plan.code}</span>
                <span className="text-base font-semibold text-slate-900">{plan.name}</span>
                <Tag tone="gold">{RATE_TYPE_LABELS[plan.rate_type]}</Tag>
                <Tag>{plan.meal_plan}</Tag>
                {!plan.is_active && <Tag tone="red">Inactive</Tag>}
                {plan.is_public && plan.is_active && <Tag tone="green">On website</Tag>}
                {manage && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
              </div>
              <p className="text-xs text-slate-600 mt-1">
                {plan.adjustment_kind === "fixed"
                  ? `₹${Number(plan.adjustment_value).toLocaleString("en-IN")} per night, all in`
                  : Number(plan.adjustment_value) === 0
                    ? "Base rate"
                    : plan.adjustment_kind === "percent"
                      ? `${Number(plan.adjustment_value) > 0 ? "+" : ""}${Number(plan.adjustment_value)}% on base rate`
                      : `${Number(plan.adjustment_value) > 0 ? "+" : "−"}₹${Math.abs(Number(plan.adjustment_value))} per night`}
                {" · "}
                {plan.is_refundable
                  ? `free cancellation to ${plan.free_cancellation_hours}h, then ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)}`
                  : "non-refundable"}
                {Number(plan.deposit_percent) > 0 && ` · ${Number(plan.deposit_percent)}% deposit`}
                {plan.min_los && ` · min ${plan.min_los} nights`}
                {plan.los_discount_min_nights && ` · ${Number(plan.los_discount_percent)}% off ${plan.los_discount_min_nights}+ nights`}
                {plan.company_id && ` · ${companies.find((c) => c.id === plan.company_id)?.name ?? "company"}`}
              </p>
            </summary>
            {manage && (
              <div className="mt-5 pt-5 border-t border-slate-100">
                <ActionForm action={saveRatePlan} submitLabel="Save plan">
                  <input type="hidden" name="id" value={plan.id} />
                  <PlanFields plan={plan} roomTypes={typeList} companies={companies} />
                </ActionForm>
              </div>
            )}
          </details>
        </Card>
      ))}
    </div>
  );
}

function PlanFields({
  plan,
  roomTypes,
  companies,
}: {
  plan?: RatePlan;
  roomTypes: Pick<RoomType, "id" | "name">[];
  companies: Company[];
}) {
  const legend = "text-xs font-medium text-yellow-700";
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Code" hint="Short, unique. e.g. NRF, CORP-TCS">
          <input name="code" required defaultValue={plan?.code} className={`${inputClass} uppercase`} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Name">
            <input name="name" required defaultValue={plan?.name} className={inputClass} />
          </Field>
        </div>
        <Field label="Rate type">
          <select name="rate_type" defaultValue={plan?.rate_type ?? "bar"} className={inputClass}>
            {Object.entries(RATE_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Meals">
          <select name="meal_plan" defaultValue={plan?.meal_plan ?? "CP"} className={inputClass}>
            {Object.entries(MEAL_PLAN_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Adjust by">
          <select name="adjustment_kind" defaultValue={plan?.adjustment_kind ?? "percent"} className={inputClass}>
            <option value="percent">Percent of base rate</option>
            <option value="amount">Amount per night (₹)</option>
            <option value="fixed">Fixed rate per night (₹)</option>
          </select>
        </Field>
        <Field label="Adjustment" hint="-10 = 10% off. +1500 for a package. With a fixed rate, the nightly price itself.">
          <input type="number" name="adjustment_value" step="0.01" defaultValue={plan?.adjustment_value ?? 0} className={inputClass} />
        </Field>
        <Field label="Company" hint="Corporate plans only.">
          <select name="company_id" defaultValue={plan?.company_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div>
        <p className={`${legend} mb-2`}>Room types (none ticked = all)</p>
        <div className="flex flex-wrap gap-4">
          {roomTypes.map((t) => (
            <Check key={t.id} name="room_type_ids" value={t.id} defaultChecked={plan?.room_type_ids.includes(t.id)} label={t.name} />
          ))}
        </div>
      </div>

      <Field label="Package inclusions" hint="One per line, e.g. Airport pickup, Shikara ride, Spa credit.">
        <textarea name="inclusions" rows={2} defaultValue={plan?.inclusions.join("\n")} className={inputClass} />
      </Field>

      <Field label="Description">
        <textarea name="description" rows={2} defaultValue={plan?.description} className={inputClass} />
      </Field>

      <p className={legend}>Cancellation, no-show and deposit</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Free cancellation until" hint="Hours before arrival (24, 48, 72…)">
          <input type="number" name="free_cancellation_hours" min={0} defaultValue={plan?.free_cancellation_hours ?? 48} className={inputClass} />
        </Field>
        <Field label="Then charge">
          <select name="cancellation_penalty" defaultValue={plan?.cancellation_penalty ?? "first_night"} className={inputClass}>
            {Object.entries(PENALTY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cancellation %" hint="When charging a percentage.">
          <input type="number" name="cancellation_penalty_percent" min={0} max={100} defaultValue={plan?.cancellation_penalty_percent ?? 0} className={inputClass} />
        </Field>
        <Field label="Deposit %" hint="Of the stay, at booking.">
          <input type="number" name="deposit_percent" min={0} max={100} defaultValue={plan?.deposit_percent ?? 0} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="No-show charge">
          <select name="no_show_penalty" defaultValue={plan?.no_show_penalty ?? "first_night"} className={inputClass}>
            {Object.entries(PENALTY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="No-show %">
          <input type="number" name="no_show_penalty_percent" min={0} max={100} defaultValue={plan?.no_show_penalty_percent ?? 0} className={inputClass} />
        </Field>
        <div className="sm:col-span-2 flex items-end pb-2">
          <Check name="is_refundable" defaultChecked={plan?.is_refundable ?? true} label="Refundable" hint="Untick for non-refundable: the charge applies whenever cancelled." />
        </div>
      </div>

      <p className={legend}>Length of stay and validity</p>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
        <Field label="Min nights">
          <input type="number" name="min_los" min={1} defaultValue={plan?.min_los ?? ""} className={inputClass} />
        </Field>
        <Field label="Max nights">
          <input type="number" name="max_los" min={1} defaultValue={plan?.max_los ?? ""} className={inputClass} />
        </Field>
        <Field label="Discount from">
          <input type="number" name="los_discount_min_nights" min={2} placeholder="nights" defaultValue={plan?.los_discount_min_nights ?? ""} className={inputClass} />
        </Field>
        <Field label="Discount %">
          <input type="number" name="los_discount_percent" min={0} max={100} defaultValue={plan?.los_discount_percent ?? ""} className={inputClass} />
        </Field>
        <Field label="Arrivals from">
          <input type="date" name="valid_from" defaultValue={plan?.valid_from ?? ""} className={inputClass} />
        </Field>
        <Field label="Arrivals until">
          <input type="date" name="valid_to" defaultValue={plan?.valid_to ?? ""} className={inputClass} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-6">
        <Check name="is_active" defaultChecked={plan?.is_active ?? true} label="Active" />
        <Check name="is_public" defaultChecked={plan?.is_public ?? true} label="Offer on the website" />
      </div>
    </>
  );
}

