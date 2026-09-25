"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs under a section header; the first tab is active only on its exact path. */
export default function SectionTabs({ tabs, label }: { tabs: { href: string; label: string }[]; label: string }) {
  const pathname = usePathname();
  const root = tabs[0]?.href;
  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-1 border-b border-slate-200 mb-8" aria-label={label}>
      {tabs.map((t) => {
        const active =
          t.href === root
            ? pathname === t.href || (!tabs.some((o) => o.href !== root && pathname.startsWith(o.href)) && pathname.startsWith(`${t.href}/`))
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-0.5 pb-3 pt-1 text-[13.5px] -mb-px border-b transition-colors ${
              active ? "border-yellow-400 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
