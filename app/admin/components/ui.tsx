/**
 * Shared admin component kit.
 *
 * Visual language (full notes in app/admin/DESIGN.md): a white page; white
 * rounded-xl cards with a hairline border and the faintest shadow; soft
 * brand green used sparingly — the active nav item, selected chips, one
 * "hero" stat card per row, success pills, charts; a near-black green for
 * the primary action; status as borderless tinted pills (`admin-pill`).
 * Everything is Inter — semibold and tightly tracked for headings and
 * figures. Motion is limited to short colour/shadow transitions on hover
 * and the route fade in template.tsx.
 *
 * Pages should build from these primitives rather than restating classes,
 * so a later restyle only has to touch this file.
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PAGE_SIZE, pageHref, pageList, type PageParams } from "./paging";
import type { BookingStatus } from "../../lib/types";
import { BOOKING_STATUS_LABELS } from "../../lib/types";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        <h1 className="text-slate-900">{title}</h1>
        {description && (
          <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/**
 * Pill tints for booking status, after the reference's booking list:
 * pending is amber, an expected arrival is lime, an in-house guest is green.
 * The shared BOOKING_STATUS_STYLES in lib/types stays as it is for its other
 * consumers.
 */
const STATUS_PILL: Record<BookingStatus, string> = {
  tentative: "bg-amber-100 text-amber-800",
  confirmed: "bg-lime-100 text-lime-900",
  checked_in: "bg-emerald-100 text-emerald-800",
  checked_out: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-100 text-rose-800",
  no_show: "bg-orange-100 text-orange-800",
  waitlisted: "bg-violet-100 text-violet-800",
};

const pillClass =
  "admin-pill inline-flex items-center self-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap";

export function StatusPill({ status }: { status: BookingStatus }) {
  return <span className={`${pillClass} ${STATUS_PILL[status]}`}>{BOOKING_STATUS_LABELS[status]}</span>;
}

export function StatCard({
  label,
  value,
  href,
  hint,
  icon,
  highlight = false,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
  /** Optional lucide icon, shown in a small circle on the right. */
  icon?: React.ReactNode;
  /** The pale-green "hero" card. Use it for the one figure a row leads with. */
  highlight?: boolean;
}) {
  const body = (
    <div
      className={`relative rounded-xl border px-5 py-4 h-full shadow-sm transition duration-200 ease-out ${
        highlight ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"
      } ${href ? "hover:border-slate-300 hover:shadow-[0_6px_18px_-10px_rgb(17_20_18/0.18)]" : ""}`}
    >
      <p className={`text-[13px] text-slate-500 ${icon ? "pr-12" : ""}`}>{label}</p>
      {icon && (
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 right-5 w-10 h-10 rounded-full flex items-center justify-center [&_svg]:w-4 [&_svg]:h-4 ${
            highlight ? "bg-emerald-200 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {icon}
        </span>
      )}
      <p className={`admin-display text-[1.75rem] leading-none text-slate-900 mt-2.5 ${icon ? "pr-12" : ""}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-2">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-slate-700 mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 transition-colors duration-150";

/** Primary action: the reference's near-black green with white text. */
export const buttonClass =
  "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg bg-emerald-900 text-white shadow-sm hover:bg-emerald-950 transition-colors duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const secondaryButtonClass =
  "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-colors duration-150 ease-out cursor-pointer disabled:opacity-50";

export function Banner({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      role="status"
      className={`text-sm px-4 py-2.5 rounded-xl border ${
        error
          ? "bg-rose-50 text-rose-800 border-rose-200"
          : "bg-emerald-50 text-emerald-800 border-emerald-200"
      }`}
    >
      {error ?? success}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-14 text-sm text-slate-500">{message}</div>
  );
}

/** Formats a yyyy-mm-dd date without dragging in a timezone shift. */
export function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtMoney(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return "—";
  return `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export const dangerButtonClass =
  "inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const checkboxClass = "accent-emerald-600 w-4 h-4 shrink-0 rounded";

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h2 className="text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

/** A small labelled value, used in summary grids. */
export function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 mt-0.5">{children}</dd>
    </div>
  );
}

export function Check({ name, label, defaultChecked, hint, value }: {
  name: string;
  label: React.ReactNode;
  defaultChecked?: boolean;
  hint?: string;
  value?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className={`${checkboxClass} mt-0.5`} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "error"; children: React.ReactNode }) {
  const tones = {
    info: "bg-slate-50 border-slate-200 text-slate-600",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
    error: "bg-rose-50 border-rose-200 text-rose-900",
  };
  return <div className={`text-sm border rounded-xl px-4 py-3 leading-relaxed ${tones[tone]}`}>{children}</div>;
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "gold" | "green" | "red" | "amber" | "blue" | "violet" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-600",
    gold: "bg-lime-100 text-lime-900",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return <span className={`${pillClass} ${tones[tone]}`}>{children}</span>;
}

/** Header row of a table inside a Card: white, muted labels, one hairline. */
export const tableHeadClass =
  "text-left text-xs font-medium text-slate-500 bg-white border-b border-slate-200";

/** Body row: a quick grey wash on hover. */
export const tableRowClass = "hover:bg-slate-50 transition-colors duration-150";

/* ── People ─────────────────────────────────────────────────────────────── */

const AVATAR_TONES = [
  "bg-emerald-100 text-emerald-800",
  "bg-lime-100 text-lime-900",
  "bg-amber-100 text-amber-800",
  "bg-blue-100 text-blue-800",
  "bg-violet-100 text-violet-800",
  "bg-slate-100 text-slate-700",
];

/**
 * Initials in a soft tinted circle, for the person a table row is about
 * (guest, staff member). Decorative — the name always sits beside it — so
 * it is hidden from screen readers. The tint is chosen from the name, so the
 * same person always gets the same colour.
 */
export function Avatar({ name, size = "sm" }: { name: string | null | undefined; size?: "sm" | "md" }) {
  const clean = (name ?? "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center shrink-0 rounded-full font-semibold ${
        size === "md" ? "w-9 h-9 text-xs" : "w-7 h-7 text-[10.5px]"
      } ${AVATAR_TONES[hash % AVATAR_TONES.length]}`}
    >
      {initials}
    </span>
  );
}

/* ── Search and filters ─────────────────────────────────────────────────── */

/**
 * A list's search box: a plain GET form, so submitting reloads the page with
 * `?q=` and the server component applies it to its query. `keep` carries the
 * list's other filters through as hidden fields; `page` is never carried, so
 * a new search starts on page 1.
 */
export function SearchInput({
  action,
  defaultValue = "",
  placeholder = "Search",
  name = "q",
  keep = {},
  button = "Search",
  className = "",
}: {
  /** The list's own route, e.g. "/admin/rooms". */
  action: string;
  defaultValue?: string;
  placeholder?: string;
  name?: string;
  keep?: PageParams;
  /** Submit button label; pass `false` to rely on the Enter key alone. */
  button?: string | false;
  className?: string;
}) {
  return (
    <form action={action} role="search" className={`flex gap-2 ${className}`}>
      {Object.entries(keep).map(([k, v]) => (v && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative flex-1 min-w-0">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={placeholder}
          className={`${inputClass} pl-9`}
        />
      </div>
      {button && (
        <button type="submit" className={secondaryButtonClass}>
          {button}
        </button>
      )}
    </form>
  );
}

/**
 * A row of filter chips, each a link that sets one query param. The option
 * whose value is "all" clears the param. Other filters (`params`) are kept;
 * `page` is dropped, so changing a filter always starts on page 1.
 */
export function FilterChips({
  path,
  param,
  options,
  current,
  params = {},
  label = "Filter",
}: {
  path: string;
  param: string;
  /** `swatch` is a background class for a small colour dot, when the chips double as a legend. */
  options: { value: string; label: string; count?: number; swatch?: string }[];
  current: string;
  params?: PageParams;
  /** Accessible name for the group, e.g. "Status". */
  label?: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={pageHref(path, { ...params, [param]: o.value === "all" ? null : o.value }, 1)}
            aria-current={active ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors duration-150 ease-out ${
              active
                ? "bg-emerald-100 border-emerald-200 text-emerald-800 font-medium"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {o.swatch && <span aria-hidden="true" className={`w-2 h-2 rounded-full ${o.swatch}`} />}
            {o.label}
            {o.count !== undefined && (
              <span className={`tabular-nums text-[10.5px] ${active ? "text-emerald-700" : "text-slate-400"}`}>{o.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function nightsBetween(checkIn: string, checkOut: string) {
  return Math.max(
    1,
    Math.round(
      (new Date(checkOut + "T00:00:00").getTime() -
        new Date(checkIn + "T00:00:00").getTime()) /
        86400000,
    ),
  );
}

/* ── Pagination ─────────────────────────────────────────────────────────── */

export { PAGE_SIZE, pageParam, pageRange, outOfRange, pageHref, clampPage } from "./paging";

/**
 * "Showing 26–50 of 312" with numbered page links. Server-rendered links, so
 * paging is plain navigation and keeps every filter in the URL. Renders
 * nothing when everything fits on one page.
 *
 * Put it as the last child of the list's Card; pass `className` to change
 * the default bar styling when the list is not in a card.
 */
export function Pagination({
  page,
  total,
  path,
  params = {},
  pageSize = PAGE_SIZE,
  className = "px-5 py-3 border-t border-slate-100",
}: {
  page: number;
  total: number;
  /** The list's own route, e.g. "/admin/bookings". */
  path: string;
  /** The current filters, carried onto every page link. */
  params?: PageParams;
  pageSize?: number;
  className?: string;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last === 1 && page === 1) return null;
  const first = Math.min(total, (page - 1) * pageSize + 1);
  const end = Math.min(total, page * pageSize);
  const cell = "min-w-8 h-8 px-2 inline-flex items-center justify-center rounded-lg text-xs tabular-nums transition-colors duration-150";
  const idle = `${cell} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
  const off = `${cell} text-slate-300`;

  return (
    <nav aria-label="Pagination" className={`flex flex-wrap items-center justify-between gap-3 print:hidden ${className}`}>
      <p className="text-xs text-slate-500 tabular-nums">
        Showing {first.toLocaleString("en-IN")}–{end.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={pageHref(path, params, page - 1)} aria-label="Previous page" className={idle}>
            <ChevronLeft className="w-4 h-4" />
          </Link>
        ) : (
          <span aria-hidden="true" className={off}>
            <ChevronLeft className="w-4 h-4" />
          </span>
        )}
        {pageList(Math.min(page, last), last).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className={`${cell} text-slate-400`} aria-hidden="true">
              …
            </span>
          ) : n === page ? (
            <span key={n} aria-current="page" className={`${cell} bg-emerald-100 text-emerald-800 font-semibold`}>
              {n}
            </span>
          ) : (
            <Link key={n} href={pageHref(path, params, n)} className={idle}>
              {n}
            </Link>
          ),
        )}
        {page < last ? (
          <Link href={pageHref(path, params, page + 1)} aria-label="Next page" className={idle}>
            <ChevronRight className="w-4 h-4" />
          </Link>
        ) : (
          <span aria-hidden="true" className={off}>
            <ChevronRight className="w-4 h-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
