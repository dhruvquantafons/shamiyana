import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { loadPricingData, loadCompanies } from "../../../../lib/rate-data";
import { todayIn, addDays } from "../../../../lib/dates";
import { PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import { createGroup } from "../../../group-actions";
import { Card, Field, inputClass, fmtMoney } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function NewGroupPage() {
  const session = await requirePermission("bookings.groups");
  const supabase = await createClient();
  const settings = await getSettings();
  const [pricing, companies] = await Promise.all([loadPricingData(supabase), loadCompanies(supabase)]);
  const today = todayIn(settings.timezone);
  const plans = pricing.plans.filter((p) => p.is_active);
  const defaultPlan = plans.find((p) => p.rate_type === "group") ?? plans.find((p) => p.rate_type === "bar") ?? plans[0];

  return (
    <>
      <Link href="/admin/groups" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Groups
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">New group booking</h1>
      <p className="text-sm text-slate-600 mb-6">
        Every room is held at once, or none is — if the hotel cannot fit the whole block, nothing is booked.
      </p>

      <Card className="p-5 max-w-3xl">
        <ActionForm
          action={createGroup}
          submitLabel="Block rooms"
          pendingLabel="Blocking…"
          overbookHint={
            can(session, "bookings.overbook") ? (
              <Field label="Overbooking reason" hint="Sells the block beyond capacity.">
                <input name="overbook_reason" className={inputClass} />
              </Field>
            ) : (
              <p className="text-xs text-amber-900">Reduce the number of rooms or change the dates.</p>
            )
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Group name">
              <input name="name" required placeholder="Sharma–Kaul wedding" className={inputClass} />
            </Field>
            <Field label="Company">
              <select name="company_id" defaultValue="" className={inputClass}>
                <option value="">None</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Organiser">
              <input name="organiser_name" className={inputClass} />
            </Field>
            <Field label="Organiser phone">
              <input name="organiser_phone" className={inputClass} />
            </Field>
            <Field label="Organiser email">
              <input type="email" name="organiser_email" className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Arrival">
              <input type="date" name="check_in" required defaultValue={addDays(today, 14)} className={inputClass} />
            </Field>
            <Field label="Departure">
              <input type="date" name="check_out" required defaultValue={addDays(today, 16)} className={inputClass} />
            </Field>
            <Field label="Rate plan">
              <select name="rate_plan_id" defaultValue={defaultPlan?.id} required className={inputClass}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Adults per room">
              <input type="number" name="adults_per_room" min={1} max={10} defaultValue={2} className={inputClass} />
            </Field>
          </div>

          <div>
            <p className="text-xs font-medium text-yellow-700 mb-2">Rooms to block</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {pricing.roomTypes
                .filter((t) => t.is_active)
                .map((t) => (
                  <Field key={t.id} label={t.name} hint={`from ${fmtMoney(t.base_rate)}`}>
                    <input type="number" name={`rooms_${t.id}`} min={0} defaultValue={0} className={inputClass} />
                  </Field>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Status">
              <select name="status" defaultValue="tentative" className={inputClass}>
                <option value="tentative">Tentative (held until contract)</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </Field>
            <Field label="Source">
              <select name="source" defaultValue="email" className={inputClass}>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="corporate">Corporate</option>
                <option value="travel_agent">Travel agent</option>
                <option value="walk_in">In person</option>
              </select>
            </Field>
            <Field label="Payment">
              <select name="payment_method" defaultValue="bank_transfer" className={inputClass}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
