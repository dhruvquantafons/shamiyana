import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { PageHeader } from "../../components/ui";
import SectionTabs from "../../components/SectionTabs";

/** Module 10 — the conference hall: enquiries, quotations and event orders. */
export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyPermission([
    "events.view",
    "events.book",
    "events.quote",
    "events.approve",
    "events.bill",
    "events.manage",
  ]);

  const tabs = [
    { href: "/admin/events", label: "Events" },
    { href: "/admin/events/diary", label: "Diary" },
    can(session, "events.manage") && { href: "/admin/events/setup", label: "Hall & packages" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <>
      <PageHeader
        title="Events & banquets"
        description="Conferences, banquets and functions. Catering is quoted per head; only a confirmed event holds the hall."
      />
      <SectionTabs tabs={tabs} label="Event sections" />
      {children}
    </>
  );
}
