import Link from "next/link";
import type { BookingStatus } from "../../lib/types";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES } from "../../lib/types";

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
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && (
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{description}</p>
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
    <div className={`bg-white border border-slate-200 rounded-lg ${className}`}>
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center self-center px-2 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap ${BOOKING_STATUS_STYLES[status]}`}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

export function StatCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
}) {
  const body = (
    <div className="bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 transition-colors h-full">
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
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
      <span className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-400/30 transition-colors";

export const buttonClass =
  "inline-flex items-center justify-center px-3.5 py-2 text-sm font-medium rounded-md bg-yellow-400 text-slate-900 shadow-sm hover:bg-yellow-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const secondaryButtonClass =
  "inline-flex items-center justify-center px-3.5 py-2 text-sm font-medium rounded-md bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50";

export function Banner({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      role="status"
      className={`text-sm px-3 py-2 rounded-md border ${
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
    <div className="text-center py-12 text-sm text-slate-500">{message}</div>
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
  "inline-flex items-center justify-center px-3.5 py-2 text-sm font-medium rounded-md bg-white text-rose-700 border border-rose-200 shadow-sm hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const checkboxClass = "accent-yellow-500 w-4 h-4 shrink-0 rounded";

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h2 className="text-sm font-semibold text-slate-900">{children}</h2>
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
  return <div className={`text-sm border rounded-md px-3.5 py-2.5 leading-relaxed ${tones[tone]}`}>{children}</div>;
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "gold" | "green" | "red" | "amber" | "blue" | "violet" }) {
  const tones = {
    neutral: "bg-slate-50 text-slate-600 border-slate-200",
    gold: "bg-yellow-50 text-yellow-800 border-yellow-200",
    green: "bg-emerald-50 text-emerald-800 border-emerald-200",
    red: "bg-rose-50 text-rose-800 border-rose-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    violet: "bg-violet-50 text-violet-800 border-violet-200",
  };
  return (
    <span className={`inline-flex items-center self-center px-1.5 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const tableHeadClass =
  "text-left text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-200";

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
