import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { shiftHours, shiftLabel } from "../../../../lib/hr";
import type { Department, ShiftColor, ShiftType } from "../../../../lib/types";
import { deleteDepartment, saveDepartment, saveGeofence, saveShiftType } from "../../../hr-actions";
import { Card, Check, Field, SectionTitle, inputClass, secondaryButtonClass } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { SHIFT_COLOR_CLASS } from "../shared";

const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

function ShiftFields({ s }: { s?: ShiftType }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
      <Field label="Name">
        <input name="name" required defaultValue={s?.name} className={inputClass} />
      </Field>
      <Field label="Start">
        <input type="time" name="start_time" required defaultValue={hm(s?.start_time ?? null)} className={inputClass} />
      </Field>
      <Field label="End">
        <input type="time" name="end_time" required defaultValue={hm(s?.end_time ?? null)} className={inputClass} />
      </Field>
      <Field label="Split: start">
        <input type="time" name="start_time_2" defaultValue={hm(s?.start_time_2 ?? null)} className={inputClass} />
      </Field>
      <Field label="Split: end">
        <input type="time" name="end_time_2" defaultValue={hm(s?.end_time_2 ?? null)} className={inputClass} />
      </Field>
      <Field label="Colour">
        <select name="color" defaultValue={s?.color ?? "slate"} className={inputClass}>
          {(Object.keys(SHIFT_COLOR_CLASS) as ShiftColor[]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export default async function HrSetupPage() {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const settings = await getSettings();
  const [{ data: depts }, { data: types }] = await Promise.all([
    supabase.from("departments").select("*").order("sort_order"),
    supabase.from("shift_types").select("*").order("sort_order"),
  ]);
  const departments = (depts ?? []) as Department[];
  const shifts = (types ?? []) as ShiftType[];

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <SectionTitle>Shift types</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {shifts.map((s) => (
            <li key={s.id} className={`py-3 ${s.is_active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-xs rounded px-2 py-1 ${SHIFT_COLOR_CLASS[s.color]}`}>{s.name}</span>
                <span className="text-sm text-slate-700">
                  {shiftLabel(s)} · {shiftHours(s)} h
                </span>
                {!s.is_active && <span className="text-xs text-slate-500">not in use</span>}
              </div>
              <details className="mt-2">
                <summary className="text-xs text-yellow-800 cursor-pointer">Edit</summary>
                <div className="mt-2">
                  <ActionForm action={saveShiftType} submitLabel="Save" className="space-y-2">
                    <input type="hidden" name="id" value={s.id} />
                    <ShiftFields s={s} />
                    <Check name="is_active" label="In use" defaultChecked={s.is_active} />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details>
          <summary className={`${secondaryButtonClass} list-none w-fit`}>Add a shift type</summary>
          <div className="mt-3">
            <ActionForm action={saveShiftType} submitLabel="Add shift" className="space-y-2">
              <ShiftFields />
            </ActionForm>
          </div>
        </details>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 space-y-4">
          <SectionTitle>Departments</SectionTitle>
          <ul className="divide-y divide-slate-100">
            {departments.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-2">
                <ActionForm action={saveDepartment} submitLabel="Save" submitClassName="text-xs text-yellow-800 cursor-pointer" className="flex-1 flex items-center gap-2 [&>div]:shrink-0">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="name" defaultValue={d.name} required className={inputClass} />
                </ActionForm>
                <form action={deleteDepartment}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-xs text-rose-700 cursor-pointer">Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <ActionForm action={saveDepartment} submitLabel="Add" submitClassName={secondaryButtonClass} className="flex items-end gap-2 [&>div]:shrink-0">
            <input name="name" required placeholder="New department" className={inputClass} />
          </ActionForm>
        </Card>

        <Card className="p-5 space-y-3">
          <SectionTitle>Clock-in rules</SectionTitle>
          <p className="text-sm text-slate-600">
            Set the hotel&rsquo;s location to check where staff clock in from their phones. Biometric devices can send clock-ins
            through the attendance integration (see the README).
          </p>
          <ActionForm action={saveGeofence} submitLabel="Save" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input name="lat" inputMode="decimal" defaultValue={settings.hr_geofence_lat ?? ""} placeholder="34.0837" className={inputClass} />
              </Field>
              <Field label="Longitude">
                <input name="lng" inputMode="decimal" defaultValue={settings.hr_geofence_lng ?? ""} placeholder="74.7973" className={inputClass} />
              </Field>
              <Field label="Radius (metres)">
                <input type="number" name="radius" min={20} max={5000} defaultValue={settings.hr_geofence_radius_m} className={inputClass} />
              </Field>
              <Field label="Late after (minutes)" hint="Grace after shift start.">
                <input type="number" name="grace" min={0} max={240} defaultValue={settings.hr_late_grace_minutes} className={inputClass} />
              </Field>
            </div>
            <Check
              name="required"
              label="Staff must be on site to clock in or out"
              defaultChecked={settings.hr_require_geofence}
              hint="Self clock-in is refused outside the radius or without the phone's location."
            />
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
