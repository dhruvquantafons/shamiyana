"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Bell, ChevronRight, Search } from "lucide-react";
import { NAV } from "./Sidebar";

/** Pages that live outside the nav but still deserve a breadcrumb. */
const OFF_NAV: Record<string, string> = {
  "/admin/security": "Password & 2FA",
};

/**
 * Where am I: the nav group and item for the current path, e.g.
 * "Operations / Bookings". The longest matching nav href wins, so
 * /admin/billing/invoices resolves to Billing, not to anything shorter.
 */
function crumbsFor(pathname: string) {
  let best: { heading?: string; label: string; href: string } | null = null;
  for (const section of NAV) {
    for (const item of section.items) {
      const hit = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && (!best || item.href.length > best.href.length)) {
        best = { heading: section.heading, label: item.label, href: item.href };
      }
    }
  }
  if (best) return best;
  const off = Object.keys(OFF_NAV).find((href) => pathname.startsWith(href));
  return off ? { label: OFF_NAV[off], href: off } : null;
}

/**
 * The desktop header above every admin page: breadcrumb on the left, the
 * booking search and the notification log on the right.
 *
 * The search is the same plain GET form the Bookings (or, without booking
 * access, Guests) page already uses, so it searches with the list's own
 * rules and lands on its results. ⌘K / Ctrl+K focuses it.
 */
export default function TopBar({ access }: { access: { isSuperuser: boolean; permissions: string[] } }) {
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const can = (...perms: string[]) => access.isSuperuser || perms.some((p) => access.permissions.includes(p));

  const search = can("bookings.view")
    ? { action: "/admin/bookings", placeholder: "Search bookings, guests, rooms…" }
    : can("guests.view")
      ? { action: "/admin/guests", placeholder: "Search guests…" }
      : null;
  const seesLog = can("guests.view", "settings.manage", "audit.view");
  const crumb = crumbsFor(pathname);
  const deeper = crumb && pathname !== crumb.href;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="hidden lg:flex sticky top-0 z-20 h-16 items-center justify-between gap-6 px-10 bg-white/85 backdrop-blur border-b border-slate-200 print:hidden">
      <nav aria-label="Breadcrumb" className="min-w-0">
        {crumb && (
          <ol className="flex items-center gap-1.5 text-sm">
            {crumb.heading && (
              <>
                <li className="text-slate-500">{crumb.heading}</li>
                <li aria-hidden="true">
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </li>
              </>
            )}
            <li className="truncate">
              {deeper ? (
                <Link href={crumb.href} className="text-slate-500 hover:text-slate-900 transition-colors duration-150">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium text-slate-900">
                  {crumb.label}
                </span>
              )}
            </li>
          </ol>
        )}
      </nav>

      <div className="flex items-center gap-2.5">
        {search && (
          <form action={search.action} role="search" className="relative w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              name="q"
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="w-full h-9 pl-9 pr-12 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 transition-colors duration-150"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-[10.5px] font-sans text-slate-500 pointer-events-none">
              ⌘K
            </kbd>
          </form>
        )}
        {seesLog && (
          <Link
            href="/admin/notifications"
            aria-label="Notification log"
            title="Notification log"
            className={`w-9 h-9 inline-flex items-center justify-center rounded-lg border transition-colors duration-150 ${
              pathname.startsWith("/admin/notifications")
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <Bell className="w-4 h-4" strokeWidth={1.75} />
          </Link>
        )}
      </div>
    </header>
  );
}
