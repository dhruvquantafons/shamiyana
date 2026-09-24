import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import SectionTabs from "../../components/SectionTabs";

/** Module 7 — invoices raised across the property, and refund approvals. */
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyPermission([
    "folio.view",
    "folio.invoice",
    "folio.refund_approve",
    "folio.city_ledger",
  ]);

  const tabs = [
    { href: "/admin/billing/invoices", label: "Invoices" },
    { href: "/admin/billing/refunds", label: "Refunds" },
    { href: "/admin/billing/city-ledger", label: "City ledger" },
    { href: "/admin/billing/currencies", label: "Currencies" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader
        title="Billing"
        description="Tax invoices, online payments, refund approvals, corporate accounts and exchange rates."
        action={
          can(session, "folio.invoice") ? undefined : (
            <span className="text-xs text-slate-500">You can view invoices but not issue them.</span>
          )
        }
      />
      <SectionTabs tabs={tabs} label="Billing sections" />
      {children}
    </>
  );
}
