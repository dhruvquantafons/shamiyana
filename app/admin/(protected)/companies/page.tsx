import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import type { Company } from "../../../lib/types";
import { saveCompany } from "../../rates-actions";
import { PageHeader, Card, Field, Check, Tag, inputClass, fmtMoney } from "../../components/ui";
import ActionForm from "../../components/ActionForm";

function CompanyFields({ c }: { c?: Company }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Company name">
          <input name="name" required defaultValue={c?.name} className={inputClass} />
        </Field>
        <Field label="GSTIN">
          <input name="gstin" defaultValue={c?.gstin} maxLength={15} className={`${inputClass} uppercase`} />
        </Field>
        <Field label="Contact person">
          <input name="contact_name" defaultValue={c?.contact_name} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Field label="Email">
          <input type="email" name="email" defaultValue={c?.email} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input name="phone" defaultValue={c?.phone} className={inputClass} />
        </Field>
        <Field label="Credit limit (₹)" hint="For direct billing.">
          <input type="number" name="credit_limit" min={0} defaultValue={c?.credit_limit ?? ""} className={inputClass} />
        </Field>
        <Field label="Payment terms (days)">
          <input type="number" name="payment_terms_days" min={0} max={365} defaultValue={c?.payment_terms_days ?? 30} className={inputClass} />
        </Field>
      </div>
      <Field label="Billing address">
        <textarea name="billing_address" rows={2} defaultValue={c?.billing_address} className={inputClass} />
      </Field>
      <Field label="Notes">
        <input name="notes" defaultValue={c?.notes} className={inputClass} />
      </Field>
      <Check name="is_active" defaultChecked={c?.is_active ?? true} label="Active" />
    </>
  );
}

export default async function CompaniesPage() {
  await requirePermission("companies.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("*").order("name");
  const companies = (data ?? []) as Company[];

  return (
    <>
      <PageHeader
        title="Corporate accounts"
        description="Companies that book with you. Link a corporate rate plan to a company on the Rates page; bookings on direct billing leave their balance on the company's account at check-out."
      />
      <div className="space-y-6">
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Add a company</summary>
            <div className="mt-5">
              <ActionForm action={saveCompany} submitLabel="Add company">
                <CompanyFields />
              </ActionForm>
            </div>
          </details>
        </Card>

        {companies.map((c) => (
          <Card key={c.id} className="p-5">
            <details>
              <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{c.name}</span>
                {!c.is_active && <Tag tone="red">Inactive</Tag>}
                <span className="text-xs text-slate-600">
                  {[c.gstin && `GSTIN ${c.gstin}`, c.contact_name, c.credit_limit !== null && `limit ${fmtMoney(c.credit_limit)}`, `${c.payment_terms_days}-day terms`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="ml-auto text-[11px] text-yellow-700">Edit</span>
              </summary>
              <div className="mt-5 pt-5 border-t border-slate-100">
                <ActionForm action={saveCompany} submitLabel="Save">
                  <input type="hidden" name="id" value={c.id} />
                  <CompanyFields c={c} />
                </ActionForm>
              </div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
