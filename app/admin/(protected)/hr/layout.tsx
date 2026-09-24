import { requireSession } from "../../../lib/auth";
import { can, canAny } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import LiveRefresh from "../../components/LiveRefresh";
import SectionTabs from "../../components/SectionTabs";

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const view = canAny(session, ["hr.view", "hr.manage"]);
  const tabs = [
    { href: "/admin/hr", label: "My work" },
    view && { href: "/admin/hr/roster", label: "Roster" },
    canAny(session, ["hr.view", "hr.manage", "hr.export"]) && { href: "/admin/hr/attendance", label: "Attendance" },
    canAny(session, ["hr.approve_leave", "hr.view"]) && { href: "/admin/hr/leave", label: "Leave" },
    view && { href: "/admin/hr/staff", label: "Staff" },
    can(session, "hr.manage") && { href: "/admin/hr/setup", label: "Setup" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <LiveRefresh tables={["attendance", "leave_requests"]} />
      <PageHeader title="HR & attendance" description="Shifts, clock-in, leave and staff records." />
      <SectionTabs tabs={tabs} label="HR sections" />
      {children}
    </>
  );
}
