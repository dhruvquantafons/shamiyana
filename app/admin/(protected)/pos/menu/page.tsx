import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { taxRateFor } from "../../../../lib/pos";
import type { Outlet, PosCategory, PosItem, PosModifier } from "../../../../lib/types";
import { OUTLET_KIND_LABELS } from "../../../../lib/types";
import {
  saveOutlet,
  saveCategory,
  saveItem,
  saveModifier,
  addItemsInBulk,
} from "../../../pos-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * Outlets and their menus (SOW Module 6 "Menu/item and price list management
 * per outlet").
 *
 * Tax is set on the outlet and may be overridden per category or per item,
 * which is how one restaurant can charge 5% on food and 18% on a beer. The
 * effective rate is shown on every row so nobody has to work it out.
 *
 * One outlet is edited at a time, chosen by ?outlet=; a hotel's full menu is
 * hundreds of lines and rendering all of them at once helps nobody.
 */
export default async function PosMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  await requirePermission("pos.manage");
  const { outlet: outletParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data: outletRows } = await supabase.from("pos_outlets").select("*").order("sort_order");
  const outlets = (outletRows ?? []) as Outlet[];
  const selected = outlets.find((o) => o.id === outletParam) ?? outlets[0] ?? null;

  const [{ data: catRows }, { data: itemRows }, { data: modRows }, { data: linkRows }] = selected
    ? await Promise.all([
        supabase.from("pos_categories").select("*").eq("outlet_id", selected.id).order("sort_order"),
        supabase.from("pos_items").select("*").eq("outlet_id", selected.id).order("sort_order"),
        supabase.from("pos_modifiers").select("*").eq("outlet_id", selected.id).order("sort_order"),
        supabase.from("pos_item_modifiers").select("item_id, modifier_id"),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

  const categories = (catRows ?? []) as PosCategory[];
  const items = (itemRows ?? []) as PosItem[];
  const modifiers = (modRows ?? []) as PosModifier[];
  const links = (linkRows ?? []) as { item_id: string; modifier_id: string }[];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Outlets" value={outlets.length} hint={`${outlets.filter((o) => o.is_active).length} open`} />
        <StatCard label="Menu items" value={items.length} hint={selected?.name ?? "—"} />
        <StatCard label="Categories" value={categories.length} />
        <StatCard label="Modifiers" value={modifiers.length} hint="Extra cheese, no ice…" />
      </div>

      <Notice tone="info">
        POS hardware — terminals, receipt and kitchen printers, card machines — is the hotel&apos;s to buy; this system
        integrates with it. Bills and kitchen tickets print from the browser, and a kitchen display can be connected
        with <code>KOT_WEBHOOK_URL</code>.
      </Notice>

      {/* ── Pick an outlet ── */}
      <Card className="p-5">
        <SectionTitle>Outlets</SectionTitle>
        {outlets.length === 0 ? (
          <EmptyState message="No outlets yet. Add the first one below." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-3 font-semibold">Outlet</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold text-right">Tax</th>
                  <th className="py-2 pr-3 font-semibold text-right">Service</th>
                  <th className="py-2 pr-3 font-semibold">Orders by</th>
                  <th className="py-2 pr-3 font-semibold">Kitchen</th>
                  <th className="py-2 pr-3 font-semibold">Open</th>
                  <th className="py-2 pr-3 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {outlets.map((o) => (
                  <tr key={o.id} className={selected?.id === o.id ? "bg-yellow-50/60" : ""}>
                    <td className="py-2 px-3">
                      <span className="font-mono text-slate-500">{o.code}</span>{" "}
                      <span className="text-slate-900">{o.name}</span>
                    </td>
                    <td className="py-2 pr-3">{OUTLET_KIND_LABELS[o.kind]}</td>
                    <td className="py-2 pr-3 text-right">
                      {o.tax_rate}%{o.tax_inclusive && <span className="text-slate-500"> incl.</span>}
                    </td>
                    <td className="py-2 pr-3 text-right">{o.service_charge_percent}%</td>
                    <td className="py-2 pr-3 capitalize">{o.orders_by}</td>
                    <td className="py-2 pr-3">{o.sends_kot ? <Tag tone="green">KOT</Tag> : "—"}</td>
                    <td className="py-2 pr-3">{o.is_active ? <Tag tone="green">Yes</Tag> : <Tag tone="neutral">No</Tag>}</td>
                    <td className="py-2 pr-3 text-right">
                      <a href={`/admin/pos/menu?outlet=${o.id}`} className="text-yellow-700 hover:underline">
                        {selected?.id === o.id ? "Editing" : "Edit menu"}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="mt-4 pt-4 border-t border-slate-100">
          <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Add or edit an outlet</summary>
          <ActionForm action={saveOutlet} submitLabel="Save outlet" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
            <Field label="Editing" hint="Leave blank to add a new outlet.">
              <select name="id" defaultValue="" className={inputClass}>
                <option value="">New outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Code" hint="2–6 letters or digits, used in bill numbers.">
                <input name="code" required maxLength={6} placeholder="RST" className={`${inputClass} uppercase`} />
              </Field>
              <Field label="Name">
                <input name="name" required maxLength={80} placeholder="Shamiyana Restaurant" className={inputClass} />
              </Field>
              <Field label="Type">
                <select name="kind" defaultValue="restaurant" className={inputClass}>
                  {Object.entries(OUTLET_KIND_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="Tax rate (%)" hint="The default for this outlet's items.">
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={5} className={inputClass} />
              </Field>
              <Field label="Service charge (%)">
                <input type="number" name="service_charge_percent" min={0} max={100} step="0.01" defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Orders by">
                <select name="orders_by" defaultValue="either" className={inputClass}>
                  <option value="either">Table or room</option>
                  <option value="table">Table only</option>
                  <option value="room">Room only</option>
                </select>
              </Field>
              <Field label="Order">
                <input type="number" name="sort_order" min={0} max={100} defaultValue={outlets.length + 1} className={inputClass} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check name="tax_inclusive" label="Menu prices already include tax" />
              <Check name="sends_kot" label="Sends a ticket to the kitchen" />
              <Check name="is_active" defaultChecked label="Open for business" />
            </div>
          </ActionForm>
        </details>
      </Card>

      {selected && (
        <>
          {/* ── Categories ── */}
          <Card className="p-5">
            <SectionTitle>{selected.name} — categories</SectionTitle>
            <p className="text-[11px] text-slate-500 -mt-2 mb-3">
              A category may set its own tax rate; leaving it blank uses the outlet&apos;s {selected.tax_rate}%.
            </p>
            {categories.length === 0 ? (
              <p className="text-xs text-slate-500 mb-3">No categories yet — items can sit directly on the menu.</p>
            ) : (
              <ul className="space-y-1 text-xs mb-3">
                {categories.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
                    <span>
                      {c.name}
                      {!c.is_active && (
                        <>
                          {" "}
                          <Tag tone="neutral">Hidden</Tag>
                        </>
                      )}
                    </span>
                    <span className="text-slate-500">
                      {c.tax_rate === null ? `${selected.tax_rate}% (outlet)` : `${c.tax_rate}%`} ·{" "}
                      {items.filter((i) => i.category_id === c.id).length} items
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Add or edit a category</summary>
              <ActionForm action={saveCategory} submitLabel="Save category" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
                <input type="hidden" name="outlet_id" value={selected.id} />
                <Field label="Editing" hint="Leave blank to add a new one.">
                  <select name="id" defaultValue="" className={inputClass}>
                    <option value="">New category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Name">
                    <input name="name" required maxLength={60} placeholder="Wazwan" className={inputClass} />
                  </Field>
                  <Field label="Tax rate (%)" hint="Blank inherits the outlet's.">
                    <input type="number" name="tax_rate" min={0} max={100} step="0.01" className={inputClass} />
                  </Field>
                  <Field label="Order">
                    <input type="number" name="sort_order" min={0} max={1000} defaultValue={categories.length + 1} className={inputClass} />
                  </Field>
                </div>
                <Check name="is_active" defaultChecked label="Show on the menu" />
              </ActionForm>
            </details>
          </Card>

          {/* ── Items ── */}
          <Card>
            <div className="px-4 pt-4">
              <SectionTitle>{selected.name} — menu</SectionTitle>
            </div>
            {items.length === 0 ? (
              <EmptyState message="Nothing on this menu yet. Add items below — the bulk form is quickest." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={tableHeadClass}>
                      <th className="py-2 px-4 font-semibold">Item</th>
                      <th className="py-2 pr-3 font-semibold">Category</th>
                      <th className="py-2 pr-3 font-semibold text-right">Price</th>
                      <th className="py-2 pr-3 font-semibold text-right">Tax</th>
                      <th className="py-2 pr-3 font-semibold">Modifiers</th>
                      <th className="py-2 pr-4 font-semibold">On the menu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {items.map((i) => {
                      const own = links
                        .filter((l) => l.item_id === i.id)
                        .map((l) => modifiers.find((m) => m.id === l.modifier_id)?.name)
                        .filter(Boolean);
                      return (
                        <tr key={i.id} className={i.is_active ? "" : "text-slate-400"}>
                          <td className="py-2 px-4">
                            {i.name}
                            {i.code && <span className="block text-[10px] text-slate-500">{i.code}</span>}
                          </td>
                          <td className="py-2 pr-3 text-slate-500">
                            {categories.find((c) => c.id === i.category_id)?.name ?? "—"}
                          </td>
                          <td className="py-2 pr-3 text-right">{fmtMoney(i.price)}</td>
                          <td className="py-2 pr-3 text-right">
                            {taxRateFor(i, categories, selected)}%
                            {i.tax_rate === null && <span className="text-slate-400"> inherited</span>}
                          </td>
                          <td className="py-2 pr-3 text-slate-500">{own.length ? own.join(", ") : "—"}</td>
                          <td className="py-2 pr-4">
                            {i.is_active ? <Tag tone="green">Yes</Tag> : <Tag tone="neutral">No</Tag>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-4 py-4 border-t border-slate-100 space-y-3">
              <details>
                <summary className="text-xs font-medium text-yellow-700 cursor-pointer">
                  Add several items at once
                </summary>
                <ActionForm action={addItemsInBulk} submitLabel="Add items" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
                  <input type="hidden" name="outlet_id" value={selected.id} />
                  <Field label="Category" hint="Optional — all of them go here.">
                    <select name="category_id" defaultValue="" className={inputClass}>
                      <option value="">No category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Items" hint='One per line, as "Name | price".'>
                    <textarea
                      name="items"
                      rows={6}
                      placeholder={"Rista | 950\nGoshtaba | 1050\nKahwa | 180"}
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                  <p className="text-[11px] text-slate-500">
                    Prices are before tax unless the outlet is set to tax-inclusive. Set a per-item tax rate afterwards
                    only where it differs.
                  </p>
                </ActionForm>
              </details>

              <details>
                <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Add or edit one item</summary>
                <ActionForm action={saveItem} submitLabel="Save item" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
                  <input type="hidden" name="outlet_id" value={selected.id} />
                  <Field label="Editing" hint="Leave blank to add a new one.">
                    <select name="id" defaultValue="" className={inputClass}>
                      <option value="">New item</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <Field label="Name">
                      <input name="name" required maxLength={120} className={inputClass} />
                    </Field>
                    <Field label="Price">
                      <input type="number" name="price" min={0} step="0.01" required className={inputClass} />
                    </Field>
                    <Field label="Category">
                      <select name="category_id" defaultValue="" className={inputClass}>
                        <option value="">None</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Tax rate (%)" hint="Blank inherits.">
                      <input type="number" name="tax_rate" min={0} max={100} step="0.01" className={inputClass} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Code" hint="Optional.">
                      <input name="code" maxLength={30} className={inputClass} />
                    </Field>
                    <Field label="Description" hint="Shown at the till.">
                      <input name="description" maxLength={300} className={inputClass} />
                    </Field>
                    <Field label="Order">
                      <input type="number" name="sort_order" min={0} max={10000} defaultValue={items.length + 1} className={inputClass} />
                    </Field>
                  </div>
                  <Check name="is_active" defaultChecked label="On the menu" />
                </ActionForm>
              </details>
            </div>
          </Card>

          {/* ── Modifiers ── */}
          <Card className="p-5">
            <SectionTitle>{selected.name} — modifiers</SectionTitle>
            <p className="text-[11px] text-slate-500 -mt-2 mb-3">
              Choices a waiter can add to an item: &ldquo;extra cheese&rdquo;, &ldquo;no ice&rdquo;. A modifier can only
              be applied to the items you attach it to, so nobody puts extra gravy on a cup of tea.
            </p>
            {modifiers.length === 0 ? (
              <p className="text-xs text-slate-500 mb-3">None yet.</p>
            ) : (
              <ul className="space-y-1 text-xs mb-3">
                {modifiers.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
                    <span>
                      {m.name}
                      {!m.is_active && (
                        <>
                          {" "}
                          <Tag tone="neutral">Hidden</Tag>
                        </>
                      )}
                    </span>
                    <span className="text-slate-500">
                      {Number(m.price_delta) === 0 ? "no charge" : fmtMoney(m.price_delta)} ·{" "}
                      {links.filter((l) => l.modifier_id === m.id).length} items
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {items.length === 0 ? (
              <p className="text-xs text-slate-500">Add menu items first, then attach modifiers to them.</p>
            ) : (
              <details>
                <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Add or edit a modifier</summary>
                <ActionForm action={saveModifier} submitLabel="Save modifier" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
                  <input type="hidden" name="outlet_id" value={selected.id} />
                  <Field label="Editing" hint="Leave blank to add a new one. Re-tick its items when editing.">
                    <select name="id" defaultValue="" className={inputClass}>
                      <option value="">New modifier</option>
                      {modifiers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Name">
                      <input name="name" required maxLength={60} placeholder="Extra gravy" className={inputClass} />
                    </Field>
                    <Field label={`Price change (${settings.currency})`} hint="0 for no charge; negative to discount.">
                      <input type="number" name="price_delta" step="0.01" defaultValue={0} className={inputClass} />
                    </Field>
                    <Field label="Order">
                      <input type="number" name="sort_order" min={0} max={1000} defaultValue={modifiers.length + 1} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Can be used on" hint="Tick every item this modifier applies to.">
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md p-2 space-y-1">
                      {items.map((i) => (
                        <Check key={i.id} name="item_id" value={i.id} label={i.name} />
                      ))}
                    </div>
                  </Field>
                  <Check name="is_active" defaultChecked label="Available at the till" />
                </ActionForm>
              </details>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
