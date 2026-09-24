import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import SectionTabs from "../../components/SectionTabs";

/** Module 6 — the outlets: taking orders, settling bills and the menus. */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyPermission(["pos.view", "pos.order", "pos.pay", "pos.manage"]);

  const tabs = [
    { href: "/admin/pos", label: "Till" },
    can(session, "pos.manage") && { href: "/admin/pos/menu", label: "Outlets & menus" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader
        title="Point of sale"
        description="Restaurant, bar, spa, shop, mini-bar, room service and laundry. Bills can be charged to a guest's room."
      />
      <SectionTabs tabs={tabs} label="Point of sale sections" />
      {children}
    </>
  );
}
