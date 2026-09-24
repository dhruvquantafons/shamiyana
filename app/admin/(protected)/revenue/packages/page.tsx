import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { packageRetailValue } from "../../../../lib/revenue";
import { PACKAGE_BASIS_LABELS, MEAL_PLAN_LABELS } from "../../../../lib/types";
import type { PackageComponent, RatePlan } from "../../../../lib/types";
import { savePackageComponent, deletePackageComponent } from "../../../revenue-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  Tag,
  fmtMoney,
  inputClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

function describePrice(p: RatePlan) {
  const v = Number(p.adjustment_value);
  if (p.adjustment_kind === "fixed") return `₹${v.toLocaleString("en-IN")} per night, all in`;
  if (p.adjustment_kind === "amount") {
    return `${v >= 0 ? "+" : "−"}₹${Math.abs(v).toLocaleString("en-IN")} on the room rate`;
  }
  return v === 0 ? "at the room rate" : `${v >= 0 ? "+" : ""}${v}% on the room rate`;
}

export default async function PackagesPage() {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const manage = can(session, "rates.manage");

  const [{ data: plans }, { data: components }] = await Promise.all([
    supabase.from("rate_plans").select("*").eq("rate_type", "package").order("sort_order").order("name"),
    supabase.from("package_components").select("*").order("sort_order"),
  ]);

  const packages = (plans ?? []) as RatePlan[];
  const parts = (components ?? []) as PackageComponent[];

  return (
    <div className="space-y-6">
      <Notice>
        A package is a rate plan of the &ldquo;Package&rdquo; type — room plus whatever is bundled with it, sold at one
        price. Set that price on the plan itself under{" "}
        <Link href="/admin/rates/plans" className="text-yellow-700 underline">
          Rates &rarr; Rate plans
        </Link>
        ; choose &ldquo;Fixed rate&rdquo; there to sell the whole thing at a flat nightly price. What you list here is
        what is inside it, and what each part would cost bought separately — used to show the guest the saving, never
        billed on top.
      </Notice>

      {packages.length === 0 ? (
        <EmptyState message="No package rate plans yet. Create a rate plan of the Package type under Rates → Rate plans, then list what is inside it here." />
      ) : (
        packages.map((pkg) => {
          const mine = parts.filter((c) => c.rate_plan_id === pkg.id);
          // Priced as a two-night stay for two, the commonest leisure booking,
          // purely to give the list a comparable headline figure.
          const sample = packageRetailValue(mine, 2, 2);

          return (
            <Card key={pkg.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-base font-semibold">{pkg.name}</h2>
                <Tag tone="gold">{describePrice(pkg)}</Tag>
                <Tag tone="blue">{MEAL_PLAN_LABELS[pkg.meal_plan]}</Tag>
                {!pkg.is_active && <Tag tone="red">Inactive</Tag>}
                {!pkg.is_public && <Tag tone="neutral">Not on the website</Tag>}
              </div>
              {pkg.description && <p className="text-sm text-slate-600 mb-3">{pkg.description}</p>}

              {mine.length === 0 ? (
                <p className="text-sm text-slate-500 mb-4">
                  Nothing listed inside this package yet.
                </p>
              ) : (
                <>
                  <ul className="text-sm divide-y divide-slate-100 mb-2">
                    {mine.map((c) => (
                      <li key={c.id} className="py-2 flex flex-wrap items-center gap-2">
                        <span className={c.is_active ? "font-medium" : "font-medium text-slate-400 line-through"}>
                          {c.quantity > 1 ? `${c.quantity} × ` : ""}
                          {c.name}
                        </span>
                        <span className="text-xs text-slate-500">{PACKAGE_BASIS_LABELS[c.basis]}</span>
                        {c.description && <span className="text-xs text-slate-500">— {c.description}</span>}
                        <span className="ml-auto tabular-nums text-slate-600">
                          {Number(c.retail_value) > 0 ? `worth ${fmtMoney(c.retail_value)}` : "no value set"}
                        </span>
                        {manage && (
                          <ActionForm
                            action={deletePackageComponent}
                            submitLabel="×"
                            submitClassName="text-slate-400 hover:text-red-600 text-base leading-none ml-2"
                            confirmMessage="Remove this from the package?"
                            className=""
                          >
                            <input type="hidden" name="id" value={c.id} />
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500 mb-4">
                    Bought separately, two guests over two nights would pay {fmtMoney(sample)} for the extras alone.
                  </p>
                </>
              )}

              {manage && (
                <details className="border-t border-slate-100 pt-4">
                  <summary className="text-sm font-medium text-yellow-700 cursor-pointer">
                    Add something to this package
                  </summary>
                  <div className="mt-4">
                    <ActionForm action={savePackageComponent} submitLabel="Add to package">
                      <input type="hidden" name="rate_plan_id" value={pkg.id} />
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        <Field label="What is included">
                          <input name="name" required placeholder="Spa treatment, Breakfast…" className={inputClass} />
                        </Field>
                        <Field label="How often">
                          <select name="basis" defaultValue="per_stay" className={inputClass}>
                            {Object.entries(PACKAGE_BASIS_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Quantity">
                          <input type="number" name="quantity" min="1" max="99" defaultValue={1} className={inputClass} />
                        </Field>
                        <Field label="Worth ₹ on its own" hint="What it would cost bought separately.">
                          <input type="number" name="retail_value" min="0" step="1" defaultValue={0} className={inputClass} />
                        </Field>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <Field label="Description">
                            <input name="description" placeholder="60-minute Kashmiri oil massage for two." className={inputClass} />
                          </Field>
                        </div>
                        <Field label="Order">
                          <input type="number" name="sort_order" defaultValue={0} className={inputClass} />
                        </Field>
                      </div>
                      <Check name="is_active" defaultChecked label="Active" />
                    </ActionForm>
                  </div>
                </details>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
