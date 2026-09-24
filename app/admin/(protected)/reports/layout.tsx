import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import SectionTabs from "../../components/SectionTabs";

/** Module 13 — the reports management and the owner actually read. */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyPermission(["reports.view", "reports.financial", "reports.schedule"]);
  const financial = can(session, "reports.financial");

  const tabs = [
    { href: "/admin/reports", label: "Overview" },
    financial && { href: "/admin/reports/financial", label: "Financial" },
    { href: "/admin/reports/operations", label: "Operations" },
    { href: "/admin/reports/guests", label: "Guests" },
    { href: "/admin/reports/builder", label: "Build a report" },
    can(session, "reports.schedule") && { href: "/admin/reports/schedules", label: "Scheduled" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Occupancy, revenue and performance. Figures from a closed night audit never change; live ones still can."
      />
      <SectionTabs tabs={tabs} label="Report sections" />
      {children}
    </>
  );
}
