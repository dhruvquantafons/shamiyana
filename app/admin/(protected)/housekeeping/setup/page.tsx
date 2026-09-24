import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import type { HkChecklistItem, HkZone, Staff } from "../../../../lib/types";
import { CHECKLIST_CATEGORY_LABELS } from "../../../../lib/types";
import { saveZone, deleteZone, setStaffDuty, saveChecklistItem } from "../../../housekeeping-actions";
import { Card, Field, Check, SectionTitle, inputClass, secondaryButtonClass, tableHeadClass, checkboxClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function HousekeepingSetupPage() {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const settings = await getSettings();

  const [{ data: zoneRows }, { data: staffRows }, { data: perms }, { data: itemRows }, { data: types }] = await Promise.all([
    supabase.from("housekeeping_zones").select("*").order("sort_order").order("name"),
    supabase.from("staff").select("id, full_name, email, role, on_duty, hk_zone_id, is_active").eq("is_active", true).order("full_name"),
    supabase.from("role_permissions").select("role_key, permission").in("permission", ["housekeeping.tasks", "housekeeping.assign"]),
    supabase.from("hk_checklist_items").select("*").order("category").order("sort_order"),
    supabase.from("room_types").select("name, cleaning_minutes").order("sort_order"),
  ]);

  const zones = (zoneRows ?? []) as HkZone[];
  const has = (p: string) => new Set((perms ?? []).filter((r) => r.permission === p).map((r) => r.role_key));
  const cleaners = ((staffRows ?? []) as Staff[]).filter(
    (s) => has("housekeeping.tasks").has(s.role) && !has("housekeeping.assign").has(s.role),
  );
  const items = (itemRows ?? []) as HkChecklistItem[];

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <SectionTitle>Staff on duty</SectionTitle>
        <p className="text-sm text-slate-500 mb-3">
          New tasks go to on-duty housekeepers, preferring those whose zone covers the room&apos;s floor, then whoever has
          the fewest open tasks.
        </p>
        {cleaners.length === 0 ? (
          <p className="text-sm text-slate-500">
            No staff have the Housekeeping Staff role yet. Add them on the <Link href="/admin/staff" className="text-yellow-800">Staff</Link> page.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Zone</th>
                <th className="px-3 py-2 font-medium">On duty</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cleaners.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.full_name || s.email}</td>
                  <td className="px-3 py-2" colSpan={3}>
                    <form action={setStaffDuty} className="flex items-center gap-4">
                      <input type="hidden" name="staff_id" value={s.id} />
                      <select name="zone_id" defaultValue={s.hk_zone_id ?? ""} className={`${inputClass} max-w-[200px] !py-1`}>
                        <option value="">Any floor</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="on_duty" defaultChecked={s.on_duty} className={checkboxClass} />
                        <span className="text-slate-600">On duty</span>
                      </label>
                      <button className={`${secondaryButtonClass} !py-1 ml-auto`}>Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle>Zones</SectionTitle>
        <div className="space-y-2 mb-4">
          {zones.map((z) => (
            <div key={z.id} className="flex items-end gap-2">
              <ActionForm action={saveZone} submitLabel="Save" submitClassName={`${secondaryButtonClass} !py-1.5`} className="flex items-end gap-2 flex-1">
                <input type="hidden" name="id" value={z.id} />
                <input name="name" defaultValue={z.name} className={`${inputClass} max-w-[200px]`} />
                <input name="floors" defaultValue={z.floors.join(", ")} className={`${inputClass} max-w-[160px]`} />
              </ActionForm>
              <form action={deleteZone}>
                <input type="hidden" name="id" value={z.id} />
                <button className="text-xs text-slate-400 hover:text-rose-700 cursor-pointer pb-2">Delete</button>
              </form>
            </div>
          ))}
        </div>
        <ActionForm action={saveZone} submitLabel="Add zone" className="flex flex-wrap items-end gap-2">
          <Field label="Zone name">
            <input name="name" placeholder="East wing" className={`${inputClass} max-w-[200px]`} />
          </Field>
          <Field label="Floors">
            <input name="floors" placeholder="1, 2" className={`${inputClass} max-w-[160px]`} />
          </Field>
        </ActionForm>
      </Card>

      <Card className="p-4">
        <SectionTitle>Checklist</SectionTitle>
        <p className="text-sm text-slate-500 mb-3">Ticked by the housekeeper before marking a room done. Quantity is the standard stock per room.</p>
        {(["linen", "amenities", "minibar"] as const).map((cat) => (
          <div key={cat} className="mb-4">
            <p className="text-sm font-semibold text-slate-900 mb-1">{CHECKLIST_CATEGORY_LABELS[cat]}</p>
            <div className="space-y-1.5">
              {items
                .filter((i) => i.category === cat)
                .map((i) => (
                  <ActionForm
                    key={i.id}
                    action={saveChecklistItem}
                    submitLabel="Save"
                    submitClassName="text-xs text-yellow-800 cursor-pointer"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="category" value={cat} />
                    <input type="hidden" name="sort_order" value={i.sort_order} />
                    <input name="label" defaultValue={i.label} className={`${inputClass} max-w-[240px] !py-1`} />
                    <input type="number" name="par_qty" min={0} max={99} defaultValue={i.par_qty} className={`${inputClass} !w-16 !py-1`} />
                    <Check name="is_active" defaultChecked={i.is_active} label="In use" />
                  </ActionForm>
                ))}
            </div>
          </div>
        ))}
        <ActionForm action={saveChecklistItem} submitLabel="Add item" className="flex flex-wrap items-end gap-2 pt-3 border-t border-slate-100">
          <Field label="Section">
            <select name="category" defaultValue="amenities" className={inputClass}>
              {Object.entries(CHECKLIST_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Item">
            <input name="label" className={`${inputClass} max-w-[240px]`} />
          </Field>
          <Field label="Qty">
            <input type="number" name="par_qty" min={0} max={99} defaultValue={1} className={`${inputClass} !w-20`} />
          </Field>
        </ActionForm>
      </Card>

      <Card className="p-4 text-sm text-slate-600">
        <SectionTitle>Targets</SectionTitle>
        <p>
          Default turnaround: <strong>{settings.hk_default_minutes} minutes</strong>; deep clean every{" "}
          <strong>{settings.hk_deep_clean_days} days</strong> (set on{" "}
          <Link href="/admin/settings" className="text-yellow-800">Settings</Link>). Deep cleans get three times the target.
        </p>
        <p className="mt-1">
          Per room type:{" "}
          {(types ?? []).map((t) => `${t.name} ${t.cleaning_minutes ?? settings.hk_default_minutes} min`).join(" · ")} (set on{" "}
          <Link href="/admin/rates" className="text-yellow-800">Rates → Room types</Link>).
        </p>
      </Card>
    </div>
  );
}
