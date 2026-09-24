import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import type { EventEquipment, EventLayout, EventPackage, EventSpace } from "../../../../lib/types";
import { MEAL_PERIOD_LABELS } from "../../../../lib/types";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import {
  deleteEventLayout,
  saveEventEquipment,
  saveEventLayout,
  saveEventPackage,
  saveEventSpace,
} from "../../../event-actions";

/**
 * What a quotation is built from: the hall and its rates, the seating plans
 * it can be laid out in, the per-head catering packages and the equipment
 * that can be hired.
 *
 * The seeded figures are placeholders. Every one of them has to be set by the
 * hotel before the first quotation goes out, which is why this page says so
 * rather than quietly letting a zero-rated hall be quoted.
 */
export default async function EventSetupPage() {
  await requirePermission("events.manage");
  const supabase = await createClient();
  const settings = await getSettings();

  const [{ data: spaceRows }, { data: layoutRows }, { data: packageRows }, { data: equipmentRows }] =
    await Promise.all([
      supabase.from("event_spaces").select("*").order("sort_order"),
      supabase.from("event_layouts").select("*").order("sort_order"),
      supabase.from("event_packages").select("*").order("sort_order"),
      supabase.from("event_equipment").select("*").order("sort_order"),
    ]);

  const spaces = (spaceRows ?? []) as EventSpace[];
  const layouts = (layoutRows ?? []) as EventLayout[];
  const packages = (packageRows ?? []) as EventPackage[];
  const equipment = (equipmentRows ?? []) as EventEquipment[];

  const unpriced = [
    ...spaces.filter((s) => s.is_active && s.rental_full_day === 0 && s.rental_half_day === 0 && s.rental_per_hour === 0 && s.min_charge === 0),
  ];
  const unpricedPackages = packages.filter((p) => p.is_active && Number(p.price_per_head) === 0);

  return (
    <div className="space-y-6">
      {(unpriced.length > 0 || unpricedPackages.length > 0) && (
        <Notice tone="warn">
          {unpriced.length > 0 && (
            <>
              {unpriced.map((s) => s.name).join(", ")} {unpriced.length === 1 ? "has" : "have"} no hall rate set.{" "}
            </>
          )}
          {unpricedPackages.length > 0 && (
            <>
              {unpricedPackages.length} catering package
              {unpricedPackages.length === 1 ? " is" : "s are"} priced at zero per head.{" "}
            </>
          )}
          Set the hotel&apos;s real figures before quoting, or a quotation will go out at nothing.
        </Notice>
      )}

      {/* ── The hall ── */}
      {spaces.map((space) => (
        <Card key={space.id} className="p-5">
          <SectionTitle>{space.name}</SectionTitle>
          <ActionForm action={saveEventSpace} submitLabel="Save the hall" pendingLabel="Saving…">
            <input type="hidden" name="id" value={space.id} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Name">
                <input name="name" required defaultValue={space.name} maxLength={80} className={inputClass} />
              </Field>
              <Field label="Code" hint="Fixed once set">
                <input defaultValue={space.code} disabled className={`${inputClass} opacity-60`} />
              </Field>
              <Field label="Floor" hint="Which floor the space is on">
                <input type="number" name="floor" defaultValue={space.floor ?? ""} className={inputClass} />
              </Field>
              <Field label="Floor area (sq ft)" hint="Printed on the quotation if given">
                <input type="number" name="area_sqft" min={1} defaultValue={space.area_sqft ?? ""} className={inputClass} />
              </Field>
              <Field label={`${settings.tax_label} rate %`} hint="Hall rental is usually 18% in India">
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={space.tax_rate} className={inputClass} />
              </Field>

              <Field label="Full day">
                <input type="number" name="rental_full_day" min={0} step="0.01" defaultValue={space.rental_full_day} className={inputClass} />
              </Field>
              <Field label="Half day">
                <input type="number" name="rental_half_day" min={0} step="0.01" defaultValue={space.rental_half_day} className={inputClass} />
              </Field>
              <Field label="Per hour">
                <input type="number" name="rental_per_hour" min={0} step="0.01" defaultValue={space.rental_per_hour} className={inputClass} />
              </Field>
              <Field label="Minimum charge" hint="The least the hall is let for, whatever the basis works out to">
                <input type="number" name="min_charge" min={0} step="0.01" defaultValue={space.min_charge} className={inputClass} />
              </Field>

              <Field label="Setting-up time (minutes)" hint="The hall is held this long before the event starts">
                <input type="number" name="setup_minutes" min={0} max={1440} defaultValue={space.setup_minutes} className={inputClass} />
              </Field>
              <Field label="Clearing time (minutes)" hint="And this long after it finishes">
                <input type="number" name="teardown_minutes" min={0} max={1440} defaultValue={space.teardown_minutes} className={inputClass} />
              </Field>
              <Field label="Order on screen">
                <input type="number" name="sort_order" min={0} defaultValue={space.sort_order} className={inputClass} />
              </Field>
              <div className="flex items-end">
                <Check name="is_active" label="Available for booking" defaultChecked={space.is_active} />
              </div>
            </div>
            <Field label="Description" hint="Printed on the quotation">
              <textarea name="description" rows={2} defaultValue={space.description} maxLength={500} className={inputClass} />
            </Field>
          </ActionForm>

          {/* ── Seating plans ── */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <SectionTitle>Seating plans</SectionTitle>
            <p className="text-[11px] text-slate-500 -mt-2 mb-3">
              One hall, laid out several ways. The capacity of each plan is what decides how many the hotel can
              actually take, so these have to be measured rather than guessed.
            </p>

            {layouts.filter((l) => l.space_id === space.id).length === 0 ? (
              <EmptyState message="No seating plans yet." />
            ) : (
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={tableHeadClass}>
                      <th className="py-2 pr-3 font-semibold">Plan</th>
                      <th className="py-2 pr-3 font-semibold text-right">Seats</th>
                      <th className="py-2 pr-3 font-semibold">Notes</th>
                      <th className="py-2 pr-3 font-semibold">In use</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {layouts
                      .filter((l) => l.space_id === space.id)
                      .map((l) => (
                        <tr key={l.id}>
                          <td className="py-2 pr-3">
                            <ActionForm
                              action={saveEventLayout}
                              submitLabel="Save"
                              pendingLabel="…"
                              className="flex flex-wrap items-end gap-2"
                              submitClassName="text-[11px] text-yellow-700 hover:underline cursor-pointer"
                            >
                              <input type="hidden" name="id" value={l.id} />
                              <input name="name" defaultValue={l.name} maxLength={60} className={`${inputClass} w-32`} />
                              <input type="number" name="capacity" min={1} defaultValue={l.capacity} className={`${inputClass} w-20`} />
                              <input name="notes" defaultValue={l.notes} maxLength={300} className={`${inputClass} w-56`} />
                              <Check name="is_active" label="Active" defaultChecked={l.is_active} />
                              <input type="hidden" name="sort_order" value={l.sort_order} />
                            </ActionForm>
                          </td>
                          <td className="py-2 pr-3 text-right">{l.capacity}</td>
                          <td className="py-2 pr-3 text-slate-500">{l.notes}</td>
                          <td className="py-2 pr-3">{l.is_active ? "Yes" : "No"}</td>
                          <td className="py-2 text-right">
                            <ActionForm
                              action={deleteEventLayout}
                              submitLabel="Remove"
                              pendingLabel="…"
                              className="inline"
                              submitClassName="text-[11px] text-rose-700 hover:underline cursor-pointer"
                              confirmMessage={`Remove the “${l.name}” plan?`}
                            >
                              <input type="hidden" name="id" value={l.id} />
                            </ActionForm>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <ActionForm
              action={saveEventLayout}
              submitLabel="Add a seating plan"
              pendingLabel="Adding…"
              submitClassName={secondaryButtonClass}
            >
              <input type="hidden" name="space_id" value={space.id} />
              <input type="hidden" name="is_active" value="on" />
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Plan">
                  <input name="name" required maxLength={60} className={inputClass} placeholder="Cabaret" />
                </Field>
                <Field label="Seats">
                  <input type="number" name="capacity" min={1} required className={inputClass} />
                </Field>
                <Field label="Notes">
                  <input name="notes" maxLength={300} className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </div>
        </Card>
      ))}

      {spaces.length === 0 && (
        <Card className="p-5">
          <SectionTitle>Add the hall</SectionTitle>
          <ActionForm action={saveEventSpace} submitLabel="Add the space" pendingLabel="Saving…">
            <input type="hidden" name="is_active" value="on" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Name">
                <input name="name" required maxLength={80} className={inputClass} placeholder="Shamiyana Conference Hall" />
              </Field>
              <Field label="Code" hint="2 to 8 letters or digits">
                <input name="code" required maxLength={8} className={inputClass} placeholder="HALL" />
              </Field>
              <Field label="Floor">
                <input type="number" name="floor" className={inputClass} />
              </Field>
              <Field label="Full day">
                <input type="number" name="rental_full_day" min={0} step="0.01" className={inputClass} />
              </Field>
              <Field label={`${settings.tax_label} rate %`}>
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={18} className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}

      {/* ── Catering packages ── */}
      <Card>
        <div className="px-5 pt-5">
          <SectionTitle>Catering packages</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-3">
            Banquet food is quoted per head, not from the restaurant card, so these prices are kept separate from the
            outlet menus. What each package includes is printed on the quotation, one line per entry.
          </p>
        </div>

        {packages.length === 0 ? (
          <EmptyState message="No catering packages yet." />
        ) : (
          <div className="divide-y divide-slate-100">
            {packages.map((p) => (
              <div key={p.id} className="p-5">
                <ActionForm action={saveEventPackage} submitLabel="Save" pendingLabel="Saving…" submitClassName={secondaryButtonClass}>
                  <input type="hidden" name="id" value={p.id} />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Field label="Package">
                      <input name="name" required defaultValue={p.name} maxLength={80} className={inputClass} />
                    </Field>
                    <Field label="Code" hint="Fixed once set">
                      <input defaultValue={p.code} disabled className={`${inputClass} opacity-60`} />
                    </Field>
                    <Field label="Per head">
                      <input type="number" name="price_per_head" min={0} step="0.01" required defaultValue={p.price_per_head} className={inputClass} />
                    </Field>
                    <Field label={`${settings.tax_label} rate %`} hint="Banquet catering is usually 5%">
                      <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={p.tax_rate} className={inputClass} />
                    </Field>

                    <Field label="Meal">
                      <select name="meal_period" defaultValue={p.meal_period} className={inputClass}>
                        {Object.entries(MEAL_PERIOD_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Minimum guests" hint="Below this the kitchen will not serve it">
                      <input type="number" name="min_pax" min={0} defaultValue={p.min_pax} className={inputClass} />
                    </Field>
                    <Field label="Order on screen">
                      <input type="number" name="sort_order" min={0} defaultValue={p.sort_order} className={inputClass} />
                    </Field>
                    <div className="flex items-end">
                      <Check name="is_active" label="Offered" defaultChecked={p.is_active} />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Description">
                      <textarea name="description" rows={2} defaultValue={p.description} maxLength={500} className={inputClass} />
                    </Field>
                    <Field label="What it includes" hint="One line each; printed on the quotation">
                      <textarea
                        name="inclusions"
                        rows={4}
                        defaultValue={p.inclusions.join("\n")}
                        maxLength={5000}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </ActionForm>
              </div>
            ))}
          </div>
        )}

        <div className="p-5 border-t border-slate-100">
          <ActionForm action={saveEventPackage} submitLabel="Add a package" pendingLabel="Adding…">
            <input type="hidden" name="is_active" value="on" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Field label="Package">
                <input name="name" required maxLength={80} className={inputClass} placeholder="Wedding dinner" />
              </Field>
              <Field label="Code" hint="2 to 12 characters">
                <input name="code" required maxLength={12} className={inputClass} placeholder="WED-DIN" />
              </Field>
              <Field label="Per head">
                <input type="number" name="price_per_head" min={0} step="0.01" required className={inputClass} />
              </Field>
              <Field label={`${settings.tax_label} rate %`}>
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={5} className={inputClass} />
              </Field>
              <Field label="Meal">
                <select name="meal_period" defaultValue="dinner" className={inputClass}>
                  {Object.entries(MEAL_PERIOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="What it includes" hint="One line each">
              <textarea name="inclusions" rows={3} maxLength={5000} className={inputClass} />
            </Field>
          </ActionForm>
        </div>
      </Card>

      {/* ── Equipment ── */}
      <Card>
        <div className="px-5 pt-5">
          <SectionTitle>Equipment for hire</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-3">
            How many the hotel owns is shown to whoever is quoting, so the hall is not promised three projectors when
            there is one. An item tied to a space is only offered for that space; one left as &ldquo;any space&rdquo;
            travels between rooms.
          </p>
        </div>

        {equipment.length === 0 ? (
          <EmptyState message="No equipment listed yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-5 font-semibold">Item</th>
                  <th className="py-2 pr-3 font-semibold">Space</th>
                  <th className="py-2 pr-3 font-semibold text-right">Price</th>
                  <th className="py-2 pr-3 font-semibold">Per</th>
                  <th className="py-2 pr-3 font-semibold text-right">{settings.tax_label} %</th>
                  <th className="py-2 pr-3 font-semibold text-right">Owned</th>
                  <th className="py-2 pr-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {equipment.map((e) => (
                  <tr key={e.id} className={e.is_active ? "" : "text-slate-400"}>
                    <td className="py-2 px-5">
                      <ActionForm
                        action={saveEventEquipment}
                        submitLabel="Save"
                        pendingLabel="…"
                        className="flex flex-wrap items-end gap-2"
                        submitClassName="text-[11px] text-yellow-700 hover:underline cursor-pointer"
                      >
                        <input type="hidden" name="id" value={e.id} />
                        <input name="name" defaultValue={e.name} maxLength={80} className={`${inputClass} w-44`} />
                        <select name="space_id" defaultValue={e.space_id ?? ""} className={`${inputClass} w-40`}>
                          <option value="">Any space</option>
                          {spaces.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name}
                            </option>
                          ))}
                        </select>
                        <input type="number" name="rental_price" min={0} step="0.01" defaultValue={e.rental_price} className={`${inputClass} w-24`} />
                        <input name="unit" defaultValue={e.unit} maxLength={20} className={`${inputClass} w-20`} />
                        <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={e.tax_rate} className={`${inputClass} w-20`} />
                        <input type="number" name="qty_available" min={0} defaultValue={e.qty_available} className={`${inputClass} w-16`} />
                        <Check name="is_active" label="Offered" defaultChecked={e.is_active} />
                        <input type="hidden" name="sort_order" value={e.sort_order} />
                      </ActionForm>
                    </td>
                    <td className="py-2 pr-3">
                      {spaces.find((sp) => sp.id === e.space_id)?.name ?? "Any space"}
                    </td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(e.rental_price)}</td>
                    <td className="py-2 pr-3">{e.unit}</td>
                    <td className="py-2 pr-3 text-right">{e.tax_rate}</td>
                    <td className="py-2 pr-3 text-right">{e.qty_available}</td>
                    <td className="py-2 pr-5 text-slate-500">{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-5 border-t border-slate-100">
          <ActionForm action={saveEventEquipment} submitLabel="Add equipment" pendingLabel="Adding…">
            <input type="hidden" name="is_active" value="on" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Field label="Item">
                <input name="name" required maxLength={80} className={inputClass} placeholder="LED wall" />
              </Field>
              <Field label="Space" hint="Leave as any space if it travels between rooms">
                <select name="space_id" defaultValue="" className={inputClass}>
                  <option value="">Any space</option>
                  {spaces.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hire price">
                <input type="number" name="rental_price" min={0} step="0.01" required className={inputClass} />
              </Field>
              <Field label="Per" hint="unit, set, section, hour">
                <input name="unit" maxLength={20} defaultValue="unit" className={inputClass} />
              </Field>
              <Field label={`${settings.tax_label} rate %`}>
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={18} className={inputClass} />
              </Field>
              <Field label="How many owned">
                <input type="number" name="qty_available" min={0} defaultValue={1} className={inputClass} />
              </Field>
            </div>
            <Field label="Description">
              <input name="description" maxLength={500} className={inputClass} />
            </Field>
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
