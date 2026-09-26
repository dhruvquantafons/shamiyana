"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
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
import BrandMark from "./BrandMark";
import { Avatar } from "./ui";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  /** Shown when the person holds any of these; empty means everyone. */
  any: Permission[];
};

export const NAV: { heading?: string; items: NavItem[] }[] = [
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

  const sections = NAV.map((section) => ({ ...section, items: section.items.filter(allowed) })).filter(
    (section) => section.items.length > 0,
  );
  const nav = <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />;

  const footer = (
    <div className="border-t border-slate-200 pt-4 mt-6 space-y-0.5">
      <div className="flex items-center gap-3 mb-2 px-2.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
        <Avatar name={staff.full_name || staff.email} size="md" />
        <span className="min-w-0">
          <span className="block text-sm text-slate-900 font-medium truncate">{staff.full_name || staff.email}</span>
          <span className="block text-[11px] text-slate-500 truncate">
            {roleName}
            {staff.job_title ? ` · ${staff.job_title}` : ""}
          </span>
        </span>
      </div>
      <Link
        href="/admin/security"
        onClick={() => setOpen(false)}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
      >
        <KeyRound strokeWidth={1.75} className="w-[18px] h-[18px] shrink-0 text-slate-400" />
        <span>Password &amp; 2FA</span>
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150 cursor-pointer"
        >
          <LogOut strokeWidth={1.75} className="w-[18px] h-[18px] shrink-0 text-slate-400" />
          <span>Sign out</span>
        </button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5 px-2 py-1">
      <BrandMark className="w-10 h-10 shrink-0" />
      <span>
        <span className="admin-display block text-lg text-slate-900 leading-none">Shamiyana</span>
        <span className="block text-[9.5px] uppercase tracking-[0.18em] text-slate-500 leading-tight mt-1.5">Property management</span>
      </span>
    </Link>
  );

  return (
    <>
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-3 print:hidden">
        {brand}
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-slate-600 p-1.5 cursor-pointer">
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="relative w-72 bg-white p-4 flex flex-col justify-between overflow-y-auto shadow-2xl rounded-r-2xl">
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

      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 px-4 py-5 flex-col justify-between overflow-y-auto print:hidden">
        <div className="space-y-7">
          <div className="space-y-4">
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

/**
 * The grouped nav list with a sliding highlight behind the active item.
 *
 * The highlight is one absolutely positioned element that is moved to the
 * active link after each navigation, so it glides between items instead of
 * blinking from one to the next. It is positioned directly in a layout
 * effect (no state, no re-render). Until it has been placed the active link
 * paints its own background, so there is never a frame without one. The
 * sidebar renders this twice (drawer and desktop rail); each instance
 * measures its own links.
 */
function NavList({
  sections,
  pathname,
  onNavigate,
}: {
  sections: { heading?: string; items: NavItem[] }[];
  pathname: string;
  onNavigate: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const mark = markRef.current;
    if (!nav || !mark) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        mark.style.opacity = "0";
        return;
      }
      mark.style.opacity = "1";
      mark.style.height = `${active.offsetHeight}px`;
      mark.style.transform = `translateY(${active.offsetTop}px)`;
      // Only animate moves after the first placement.
      if (nav.dataset.ready !== "true") requestAnimationFrame(() => (nav.dataset.ready = "true"));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <nav ref={navRef} className="group/nav relative space-y-6">
      <span
        ref={markRef}
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 rounded-lg bg-emerald-100 opacity-0 pointer-events-none group-data-[ready=true]/nav:transition-[transform,height,opacity] group-data-[ready=true]/nav:duration-300 group-data-[ready=true]/nav:ease-[cubic-bezier(0.22,1,0.36,1)]"
      />
      {sections.map((section, i) => (
        <div key={section.heading ?? i} className="space-y-0.5">
          {section.heading && <p className="admin-eyebrow px-3 pb-1.5">{section.heading}</p>}
          {section.items.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`group relative z-10 flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-colors duration-150 ease-out ${
                  active
                    ? "text-emerald-800 font-medium bg-emerald-100 group-data-[ready=true]/nav:bg-transparent"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon
                  strokeWidth={1.75}
                  className={`w-[18px] h-[18px] shrink-0 transition-colors duration-150 ${
                    active ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600"
                  }`}
                />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
