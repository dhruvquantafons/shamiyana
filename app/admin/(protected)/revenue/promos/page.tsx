import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type { PromoCode, RatePlan, RoomType } from "../../../../lib/types";
import { savePromoCode, deletePromoCode } from "../../../revenue-actions";
import {
  Card,
  Check,
  Field,
  Notice,
  Tag,
  dangerButtonClass,
  fmtMoney,
  inputClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

function describeDiscount(p: PromoCode) {
  const v = Number(p.discount_value);
  const base = p.discount_kind === "percent" ? `${v}% off` : `₹${v.toLocaleString("en-IN")} off`;
  return p.discount_kind === "percent" && Number(p.max_discount) > 0
    ? `${base}, up to ${fmtMoney(p.max_discount)}`
    : base;
}

/** Whether the code can be used today, and why not when it cannot. */
function statusOf(p: PromoCode, today: string): { tone: "green" | "red" | "amber"; label: string } {
  if (!p.is_active) return { tone: "red", label: "Switched off" };
  if (p.valid_to && today > p.valid_to) return { tone: "red", label: "Expired" };
  if (p.valid_from && today < p.valid_from) return { tone: "amber", label: "Not started" };
  if (p.max_redemptions !== null && p.redemption_count >= p.max_redemptions) {
    return { tone: "red", label: "Fully redeemed" };
  }
  return { tone: "green", label: "Live" };
}

function Fields({
  p,
  typeList,
  planList,
}: {
  p?: PromoCode;
  typeList: Pick<RoomType, "id" | "name">[];
  planList: Pick<RatePlan, "id" | "name">[];
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Code" hint="What the guest types. Letters, numbers, - and _.">
          <input
            name="code"
            required
            defaultValue={p?.code}
            placeholder="MONSOON25"
            className={`${inputClass} uppercase`}
          />
        </Field>
        <div className="sm:col-span-3">
          <Field label="Name" hint="For staff — not shown to guests.">
            <input name="name" required defaultValue={p?.name} placeholder="Monsoon offer 2026" className={inputClass} />
          </Field>
        </div>
      </div>

      <Field label="Description">
        <input name="description" defaultValue={p?.description} className={inputClass} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Discount">
          <select name="discount_kind" defaultValue={p?.discount_kind ?? "percent"} className={inputClass}>
            <option value="percent">Percentage</option>
            <option value="amount">Fixed amount ₹</option>
          </select>
        </Field>
        <Field label="Value" hint="10 = 10% or ₹10, by the kind above.">
          <input type="number" name="discount_value" min="0.01" step="0.01" required defaultValue={p?.discount_value} className={inputClass} />
        </Field>
        <Field label="Cap the discount at ₹" hint="0 = no cap. Only bites on a percentage.">
          <input type="number" name="max_discount" min="0" step="1" defaultValue={p?.max_discount ?? 0} className={inputClass} />
        </Field>
      </div>

      <fieldset className="border border-slate-200 rounded-md p-4 space-y-4">
        <legend className="text-xs font-medium text-slate-600 px-1">When it may be used</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Bookable from">
            <input type="date" name="valid_from" defaultValue={p?.valid_from ?? ""} className={inputClass} />
          </Field>
          <Field label="Expires after">
            <input type="date" name="valid_to" defaultValue={p?.valid_to ?? ""} className={inputClass} />
          </Field>
          <Field label="For stays from" hint="Leave empty for any night.">
            <input type="date" name="stay_from" defaultValue={p?.stay_from ?? ""} className={inputClass} />
          </Field>
          <Field label="For stays until">
            <input type="date" name="stay_to" defaultValue={p?.stay_to ?? ""} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border border-slate-200 rounded-md p-4 space-y-4">
        <legend className="text-xs font-medium text-slate-600 px-1">Conditions and limits</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Minimum nights">
            <input type="number" name="min_nights" min="1" defaultValue={p?.min_nights ?? ""} className={inputClass} />
          </Field>
          <Field label="Minimum spend ₹">
            <input type="number" name="min_amount" min="0" step="1" defaultValue={p?.min_amount ?? 0} className={inputClass} />
          </Field>
          <Field label="Total uses allowed" hint="Empty = unlimited.">
            <input type="number" name="max_redemptions" min="1" defaultValue={p?.max_redemptions ?? ""} className={inputClass} />
          </Field>
          <Field label="Uses per guest" hint="Empty = unlimited.">
            <input type="number" name="max_per_guest" min="1" defaultValue={p?.max_per_guest ?? ""} className={inputClass} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Room types" hint="None ticked = every room type.">
            <div className="flex flex-wrap gap-3 pt-1">
              {typeList.map((t) => (
                <Check
                  key={t.id}
                  name="room_type_ids"
                  value={t.id}
                  defaultChecked={p?.room_type_ids.includes(t.id) ?? false}
                  label={t.name}
                />
              ))}
            </div>
          </Field>
          <Field label="Rate plans" hint="None ticked = every rate plan.">
            <div className="flex flex-wrap gap-3 pt-1">
              {planList.map((pl) => (
                <Check
                  key={pl.id}
                  name="rate_plan_ids"
                  value={pl.id}
                  defaultChecked={p?.rate_plan_ids.includes(pl.id) ?? false}
                  label={pl.name}
                />
              ))}
            </div>
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-6">
        <Check
          name="is_public"
          defaultChecked={p?.is_public ?? true}
          label="Guests may type it on the website"
          hint="Off makes it a code only the desk can apply."
        />
        <Check name="is_active" defaultChecked={p?.is_active ?? true} label="Active" />
      </div>
    </>
  );
}

export default async function PromoCodesPage() {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const manage = can(session, "revenue.manage");
  const today = todayIn(settings.timezone);

  const [{ data: promos }, { data: types }, { data: plans }] = await Promise.all([
    supabase.from("promo_codes").select("*").order("created_at", { ascending: false }),
    supabase.from("room_types").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("rate_plans").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  const list = (promos ?? []) as PromoCode[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];
  const planList = (plans ?? []) as Pick<RatePlan, "id" | "name">[];

  return (
    <div className="space-y-6">
      <Notice>
        A promo code comes off the finished stay total, after the rate plan and any length-of-stay discount, so
        &ldquo;10% off&rdquo; means 10% off what the guest was about to pay. A code is spent when the booking is taken
        and given back if that booking is cancelled or marked a no-show.
      </Notice>

      {manage && (
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Create a promo code</summary>
            <div className="mt-5">
              <ActionForm action={savePromoCode} submitLabel="Create code">
                <Fields typeList={typeList} planList={planList} />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}

      {list.length === 0 && <p className="text-sm text-slate-500">No promo codes yet.</p>}

      {list.map((p) => {
        const status = statusOf(p, today);
        return (
          <Card key={p.id} className="p-5">
            <details>
              <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold font-mono">{p.code}</span>
                <Tag tone="gold">{describeDiscount(p)}</Tag>
                <Tag tone={status.tone}>{status.label}</Tag>
                {!p.is_public && <Tag tone="blue">Desk only</Tag>}
                <span className="text-xs text-slate-600">
                  {p.name} · used {p.redemption_count}
                  {p.max_redemptions !== null ? ` of ${p.max_redemptions}` : ""} time(s)
                  {p.valid_to ? ` · expires ${p.valid_to}` : ""}
                </span>
                {manage && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
              </summary>
              {manage && (
                <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                  <ActionForm action={savePromoCode} submitLabel="Save code">
                    <input type="hidden" name="id" value={p.id} />
                    <Fields p={p} typeList={typeList} planList={planList} />
                  </ActionForm>
                  <ActionForm
                    action={deletePromoCode}
                    submitLabel="Delete code"
                    submitClassName={dangerButtonClass}
                    confirmMessage="Delete this code? A code that has been used is switched off instead."
                    className=""
                  >
                    <input type="hidden" name="id" value={p.id} />
                  </ActionForm>
                </div>
              )}
            </details>
          </Card>
        );
      })}
    </div>
  );
}
