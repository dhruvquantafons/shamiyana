"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ConciergeBell,
  CalendarCheck,
  UsersRound,
  GanttChart,
  UtensilsCrossed,
  PartyPopper,
  BedDouble,
  SprayCan,
  Wrench,
  Contact,
  Clock,
  IndianRupee,
  TrendingUp,
  BellRing,
  ReceiptIndianRupee,
  Building2,
  MoonStar,
  UserCog,
  ShieldCheck,
  Settings,
  ScrollText,
  ChartColumn,
  KeyRound,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import type { Staff } from "../../lib/types";
import type { Permission } from "../../lib/permissions";
import { signOut } from "../actions";
import PropertySwitcher from "./PropertySwitcher";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /** Shown when the person holds any of these; empty means everyone. */
  any: Permission[];
};

const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, any: ["dashboard.view"] }],
  },
  {
    heading: "Operations",
    items: [
      { href: "/admin/front-desk", label: "Front desk", icon: ConciergeBell, any: ["frontdesk.view"] },
      { href: "/admin/bookings", label: "Bookings", icon: CalendarCheck, any: ["bookings.view"] },
      { href: "/admin/guests", label: "Guests", icon: Contact, any: ["guests.view"] },
      { href: "/admin/groups", label: "Groups", icon: UsersRound, any: ["bookings.groups"] },
      { href: "/admin/tape-chart", label: "Tape chart", icon: GanttChart, any: ["bookings.view", "frontdesk.view"] },
      { href: "/admin/rooms", label: "Rooms", icon: BedDouble, any: ["rooms.view"] },
      {
        href: "/admin/housekeeping",
        label: "Housekeeping",
        icon: SprayCan,
        any: ["housekeeping.tasks", "housekeeping.inspect", "housekeeping.assign", "housekeeping.lost_found"],
      },
      {
        href: "/admin/maintenance",
        label: "Maintenance",
        icon: Wrench,
        any: ["maintenance.report", "maintenance.work", "maintenance.manage"],
      },
      {
        href: "/admin/pos",
        label: "Point of sale",
        icon: UtensilsCrossed,
        any: ["pos.view", "pos.order", "pos.pay", "pos.manage"],
      },
      {
        href: "/admin/events",
        label: "Events & banquets",
        icon: PartyPopper,
        any: ["events.view", "events.book", "events.quote", "events.approve", "events.bill", "events.manage"],
      },
      { href: "/admin/night-audit", label: "Night audit", icon: MoonStar, any: ["frontdesk.night_audit"] },
    ],
  },
  {
    heading: "People",
    items: [{ href: "/admin/hr", label: "HR & attendance", icon: Clock, any: [] }],
  },
  {
    heading: "Commercial",
    items: [
      { href: "/admin/rates", label: "Rates", icon: IndianRupee, any: ["rates.view", "rates.manage"] },
      {
        href: "/admin/revenue",
        label: "Revenue",
        icon: TrendingUp,
        any: ["revenue.view", "revenue.manage", "revenue.approve"],
      },
      {
        href: "/admin/billing/invoices",
        label: "Billing",
        icon: ReceiptIndianRupee,
        any: ["folio.invoice", "folio.refund_approve", "folio.city_ledger"],
      },
      { href: "/admin/companies", label: "Companies", icon: Building2, any: ["companies.manage"] },
      {
        href: "/admin/notifications",
        label: "Notifications",
        icon: BellRing,
        any: ["guests.view", "settings.manage", "audit.view"],
      },
      {
        href: "/admin/reports",
        label: "Reports",
        icon: ChartColumn,
        any: ["reports.view", "reports.financial", "reports.schedule"],
      },
    ],
  },
  {
    heading: "Administration",
    items: [
      {
        href: "/admin/properties",
        label: "Properties",
        icon: Building2,
        any: ["properties.view", "properties.manage"],
      },
      { href: "/admin/staff", label: "Staff", icon: UserCog, any: ["staff.manage"] },
      { href: "/admin/roles", label: "Roles", icon: ShieldCheck, any: ["roles.manage"] },
      { href: "/admin/settings", label: "Settings", icon: Settings, any: ["settings.manage"] },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, any: ["audit.view"] },
    ],
  },
];

export default function Sidebar({
  staff,
  roleName,
  access,
  properties = [],
  currentProperty = null,
}: {
  staff: Staff;
  roleName: string;
  access: { isSuperuser: boolean; permissions: string[] };
  /** The hotels this person may work at (SOW Module 14). */
  properties?: { id: string; code: string; name: string }[];
  currentProperty?: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const allowed = (item: NavItem) =>
    item.any.length === 0 || access.isSuperuser || item.any.some((p) => access.permissions.includes(p));

  const nav = (
    <nav className="space-y-6">
      {NAV.map((section, i) => {
        const items = section.items.filter(allowed);
        if (items.length === 0) return null;
        return (
          <div key={section.heading ?? i} className="space-y-1">
            {section.heading && (
              <p className="px-3 pb-1 text-[11px] font-medium text-slate-400">{section.heading}</p>
            )}
            {items.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    active ? "bg-yellow-50 text-yellow-800 font-medium" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-200 pt-4 space-y-1">
      <div className="px-3 pb-2">
        <p className="text-sm text-slate-900 font-medium truncate">{staff.full_name || staff.email}</p>
        <p className="text-[11px] text-slate-500">
          {roleName}
          {staff.job_title ? ` · ${staff.job_title}` : ""}
        </p>
      </div>
      <Link
        href="/admin/security"
        onClick={() => setOpen(false)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
      >
        <KeyRound className="w-4 h-4 shrink-0" />
        <span>Password &amp; 2FA</span>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign out</span>
        </button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5 px-3 py-1">
      <span className="w-7 h-7 rounded-md bg-yellow-400 text-slate-900 text-xs font-semibold flex items-center justify-center">SR</span>
      <span>
        <span className="block text-sm font-semibold text-slate-900 leading-tight">Shamiyana</span>
        <span className="block text-[11px] text-slate-500 leading-tight">Property management</span>
      </span>
    </Link>
  );

  return (
    <>
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 py-3 print:hidden">
        {brand}
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-slate-600 p-1.5 cursor-pointer">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-white p-3 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                {brand}
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-slate-600 p-1 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <PropertySwitcher properties={properties} current={currentProperty} />
              {nav}
            </div>
            {footer}
          </aside>
        </div>
      )}

      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 p-3 flex-col justify-between overflow-y-auto print:hidden">
        <div className="space-y-6">
          <div className="space-y-2">
            {brand}
            <PropertySwitcher properties={properties} current={currentProperty} />
          </div>
          {nav}
        </div>
        {footer}
      </aside>
    </>
  );
}
