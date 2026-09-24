"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/rates", label: "Room types" },
  { href: "/admin/rates/plans", label: "Rate plans" },
  { href: "/admin/rates/seasons", label: "Seasons" },
  { href: "/admin/rates/restrictions", label: "Restrictions" },
  { href: "/admin/rates/allocations", label: "Channel allocation" },
];

export default function RatesTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 mb-6" aria-label="Rates sections">
      {TABS.map((t) => {
        const active = t.href === "/admin/rates" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              active ? "border-yellow-500 text-slate-900 font-medium" : "border-transparent text-slate-600 hover:text-yellow-700"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
