import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import SectionTabs from "../../components/SectionTabs";

export default async function GuestsLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission("guests.view");
  const tabs = [
    { href: "/admin/guests", label: "Guests" },
    { href: "/admin/guests/occasions", label: "Occasions" },
    { href: "/admin/guests/feedback", label: "Feedback" },
    { href: "/admin/guests/loyalty", label: "Loyalty" },
    can(session, "guests.privacy") && { href: "/admin/guests/duplicates", label: "Duplicates" },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <>
      <PageHeader title="Guests" description="Profiles, stay history, preferences and feedback." />
      <SectionTabs tabs={tabs} label="Guest sections" />
      {children}
    </>
  );
}
