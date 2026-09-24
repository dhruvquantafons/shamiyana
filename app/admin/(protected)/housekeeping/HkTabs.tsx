"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HkTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 mb-6" aria-label="Housekeeping sections">
      {tabs.map((t) => {
        const active = t.href === "/admin/housekeeping" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              active ? "border-yellow-500 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
