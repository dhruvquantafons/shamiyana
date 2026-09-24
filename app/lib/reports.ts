/**
 * Reporting and analytics (SOW Module 13).
 *
 * The database does the aggregating — see 0018_reports.sql, where each report
 * is a permission-checked function so "financial reports restricted to
 * Management/Finance" is enforced rather than merely hidden. What lives here
 * are the hotel KPIs derived from those aggregates, the date ranges a manager
 * actually asks for, and CSV serialisation.
 *
 * Pure functions, no database access — unit tested in tests/reports.test.ts.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

/** One row of report_daily(). */
export interface DailyRow {
  day: string;
  /** 'audit' when the night audit closed this date, 'live' when computed now. */
  source: "audit" | "live";
  rooms_available: number;
  rooms_sold: number;
  room_revenue: number;
  other_revenue: number;
  tax_total: number;
  total_revenue: number;
}

/** One row of report_bookings(). */
export interface BookingRow {
  source: string;
  bookings: number;
  room_nights: number;
  cancelled: number;
  no_shows: number;
  revenue: number;
}

export interface Kpis {
  /** Room-nights that could have been sold across the range. */
  availableRoomNights: number;
  roomsSold: number;
  occupancy: number;
  /** Average Daily Rate: room revenue per room actually sold. */
  adr: number;
  /** Revenue Per Available Room: room revenue per room available. */
  revpar: number;
  /** Gross Operating Profit Per Available Room. Null when no cost is set. */
  goppar: number | null;
  roomRevenue: number;
  otherRevenue: number;
  taxTotal: number;
  totalRevenue: number;
  operatingCost: number | null;
  /** How many of the days in range are closed by a night audit. */
  auditedDays: number;
  days: number;
}

const sum = (rows: DailyRow[], field: keyof DailyRow) =>
  rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);

/**
 * The property's running cost for a number of days, from the monthly figure.
 *
 * A month is taken as 30.44 days — the mean Gregorian month — so a 31-day
 * January and a 28-day February do not report wildly different GOPPAR for the
 * same trade. Zero means the hotel has not entered a cost.
 */
export function proratedOperatingCost(monthlyCost: number, days: number): number | null {
  if (!(monthlyCost > 0) || !(days > 0)) return null;
  return round2((monthlyCost / 30.44) * days);
}

/**
 * The SOW's Core KPIs, from the daily rows.
 *
 * ADR divides by rooms *sold* and RevPAR by rooms *available* — that is the
 * whole difference between them, and the reason a hotel quotes both: a high
 * ADR on an empty hotel is not a good week.
 */
export function kpisFrom(rows: DailyRow[], monthlyOperatingCost = 0): Kpis {
  const availableRoomNights = sum(rows, "rooms_available");
  const roomsSold = sum(rows, "rooms_sold");
  const roomRevenue = round2(sum(rows, "room_revenue"));
  const otherRevenue = round2(sum(rows, "other_revenue"));
  const taxTotal = round2(sum(rows, "tax_total"));
  const totalRevenue = round2(sum(rows, "total_revenue"));
  const operatingCost = proratedOperatingCost(monthlyOperatingCost, rows.length);

  return {
    availableRoomNights,
    roomsSold,
    occupancy: availableRoomNights > 0 ? round1((roomsSold / availableRoomNights) * 100) : 0,
    adr: roomsSold > 0 ? round2(roomRevenue / roomsSold) : 0,
    revpar: availableRoomNights > 0 ? round2(roomRevenue / availableRoomNights) : 0,
    goppar:
      operatingCost !== null && availableRoomNights > 0
        ? round2((totalRevenue - operatingCost) / availableRoomNights)
        : null,
    roomRevenue,
    otherRevenue,
    taxTotal,
    totalRevenue,
    operatingCost,
    auditedDays: rows.filter((r) => r.source === "audit").length,
    days: rows.length,
  };
}

export interface BookingKpis {
  bookings: number;
  cancelled: number;
  noShows: number;
  cancellationRate: number;
  noShowRate: number;
  roomNights: number;
}

export function bookingKpis(rows: BookingRow[]): BookingKpis {
  const bookings = rows.reduce((s, r) => s + Number(r.bookings), 0);
  const cancelled = rows.reduce((s, r) => s + Number(r.cancelled), 0);
  const noShows = rows.reduce((s, r) => s + Number(r.no_shows), 0);
  return {
    bookings,
    cancelled,
    noShows,
    cancellationRate: bookings > 0 ? round1((cancelled / bookings) * 100) : 0,
    noShowRate: bookings > 0 ? round1((noShows / bookings) * 100) : 0,
    roomNights: rows.reduce((s, r) => s + Number(r.room_nights), 0),
  };
}

/** The share of guests in a period who had stayed before. */
export function repeatGuestRatio(distinctGuests: number, repeatGuests: number): number {
  if (!(distinctGuests > 0)) return 0;
  return round1((repeatGuests / distinctGuests) * 100);
}

// ── Date ranges ─────────────────────────────────────────────────────────────

export type RangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_month"
  | "last_month"
  | "this_financial_year"
  | "custom";

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_financial_year: "This financial year",
  custom: "Custom",
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const shift = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Turns a preset into a date range, relative to the property's today rather
 * than the server's — a hotel in Srinagar closes its day on its own clock.
 * The financial year runs 1 April to 31 March, matching invoice numbering.
 */
export function resolveRange(preset: RangePreset, today: string, from = "", to = ""): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);

  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = shift(today, -1);
      return { from: day, to: day };
    }
    case "last7":
      return { from: shift(today, -6), to: today };
    case "last30":
      return { from: shift(today, -29), to: today };
    case "this_month":
      return { from: iso(y, m, 1), to: today };
    case "last_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDayOfMonth(py, pm)) };
    }
    case "this_financial_year": {
      const startYear = m >= 4 ? y : y - 1;
      return { from: iso(startYear, 4, 1), to: today };
    }
    case "custom":
      // Fall back to this month when a custom range is incomplete or inverted.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return { from: iso(y, m, 1), to: today };
      }
      return from <= to ? { from, to } : { from: to, to: from };
  }
}

/** Days in a range, inclusive. */
export function daysInRange(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

export function describeRange(from: string, to: string): string {
  return from === to ? from : `${from} to ${to}`;
}

// ── The custom report builder ───────────────────────────────────────────────

/**
 * What the builder can produce (SOW Module 13: "Custom report builder with
 * export to Excel/PDF").
 *
 * Deliberately a fixed set of reports over a chosen date range rather than an
 * open query tool: the front desk should not be able to write SQL, and every
 * one of these already has an access rule attached to it.
 */
export const REPORT_KINDS = [
  "daily_revenue",
  "tax_summary",
  "payments",
  "outlet_sales",
  "outlet_payments",
  "events",
  "outstanding",
  "bookings",
  "housekeeping",
  "maintenance",
  "attendance",
  "guests",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportDefinition {
  kind: ReportKind;
  label: string;
  description: string;
  /** The database function behind it. */
  fn: string;
  /** Financial reports are Management/Finance only (SOW Module 13). */
  financial: boolean;
  /** False for reports that ignore the date range, such as outstanding money. */
  ranged: boolean;
  columns: { key: string; label: string; money?: boolean }[];
}

export const REPORTS: ReportDefinition[] = [
  {
    kind: "daily_revenue",
    label: "Daily revenue",
    description: "Rooms sold, occupancy and revenue for each day, from the closed night audit where there is one.",
    fn: "report_daily",
    financial: true,
    ranged: true,
    columns: [
      { key: "day", label: "Date" },
      { key: "source", label: "Source" },
      { key: "rooms_available", label: "Available" },
      { key: "rooms_sold", label: "Sold" },
      { key: "room_revenue", label: "Room revenue", money: true },
      { key: "other_revenue", label: "Other revenue", money: true },
      { key: "tax_total", label: "Tax", money: true },
      { key: "total_revenue", label: "Total", money: true },
    ],
  },
  {
    kind: "tax_summary",
    label: "Tax summary",
    description: "What was charged at each tax rate — the figures a GST return needs.",
    fn: "report_tax_summary",
    financial: true,
    ranged: true,
    columns: [
      { key: "rate", label: "Rate %" },
      { key: "net", label: "Taxable value", money: true },
      { key: "tax", label: "Tax", money: true },
      { key: "entries", label: "Charges" },
    ],
  },
  {
    kind: "payments",
    label: "Payments and refunds",
    description: "How guests paid, and what went back out.",
    fn: "report_payments",
    financial: true,
    ranged: true,
    columns: [
      { key: "method", label: "Method" },
      { key: "taken", label: "Taken", money: true },
      { key: "refunded", label: "Refunded", money: true },
      { key: "count", label: "Entries" },
    ],
  },
  {
    kind: "outlet_sales",
    label: "Outlet-wise sales",
    description: "Restaurant, bar, spa and the rest: bills, covers and takings per outlet.",
    fn: "report_outlet_sales",
    financial: true,
    ranged: true,
    columns: [
      { key: "outlet", label: "Outlet" },
      { key: "kind", label: "Type" },
      { key: "bills", label: "Bills" },
      { key: "covers", label: "Covers" },
      { key: "net", label: "Net", money: true },
      { key: "tax", label: "Tax", money: true },
      { key: "service", label: "Service", money: true },
      { key: "tips", label: "Tips", money: true },
      { key: "total", label: "Total", money: true },
    ],
  },
  {
    kind: "outlet_payments",
    label: "Outlet settlement",
    description: "How outlet bills were settled — cash at the till against charged to a room.",
    fn: "report_outlet_payments",
    financial: true,
    ranged: true,
    columns: [
      { key: "kind", label: "Settled by" },
      { key: "amount", label: "Amount", money: true },
      { key: "count", label: "Bills" },
    ],
  },
  {
    kind: "events",
    label: "Events and banquets",
    description:
      "Conference and banquet business by kind of function: the hall, the catering and the extras. Event revenue is not a room night, so it is reported here rather than folded into occupancy and ADR.",
    fn: "report_events",
    financial: true,
    ranged: true,
    columns: [
      { key: "event_type", label: "Kind of function" },
      { key: "events", label: "Functions" },
      { key: "pax", label: "Covers" },
      { key: "rental", label: "Hall", money: true },
      { key: "catering", label: "Catering", money: true },
      { key: "equipment", label: "Equipment", money: true },
      { key: "other", label: "Extras", money: true },
      { key: "service", label: "Service", money: true },
      { key: "tax", label: "Tax", money: true },
      { key: "total", label: "Total", money: true },
    ],
  },
  {
    kind: "outstanding",
    label: "Outstanding payments",
    description: "Stays that still owe money, in house and departed. Corporate debt is on the city ledger.",
    fn: "report_outstanding",
    financial: true,
    ranged: false,
    columns: [
      { key: "source", label: "Where" },
      { key: "reference", label: "Booking" },
      { key: "who", label: "Guest" },
      { key: "status", label: "Status" },
      { key: "due_date", label: "Departure" },
      { key: "amount", label: "Owed", money: true },
    ],
  },
  {
    kind: "bookings",
    label: "Bookings by source",
    description: "Where the business came from, and how much of it cancelled or never arrived.",
    fn: "report_bookings",
    financial: false,
    ranged: true,
    columns: [
      { key: "source", label: "Source" },
      { key: "bookings", label: "Bookings" },
      { key: "room_nights", label: "Room nights" },
      { key: "cancelled", label: "Cancelled" },
      { key: "no_shows", label: "No-shows" },
      { key: "revenue", label: "Revenue", money: true },
    ],
  },
  {
    kind: "housekeeping",
    label: "Housekeeping performance",
    description: "Rooms cleaned per attendant, inspections passed and average turnaround.",
    fn: "report_housekeeping",
    financial: false,
    ranged: true,
    columns: [
      { key: "staff_name", label: "Attendant" },
      { key: "tasks", label: "Tasks" },
      { key: "inspected", label: "Inspected" },
      { key: "failed", label: "Failed inspection" },
      { key: "avg_minutes", label: "Avg minutes" },
    ],
  },
  {
    kind: "maintenance",
    label: "Maintenance turnaround",
    description: "Tickets raised and resolved by priority, and how many missed their target.",
    fn: "report_maintenance",
    financial: false,
    ranged: true,
    columns: [
      { key: "priority", label: "Priority" },
      { key: "raised", label: "Raised" },
      { key: "resolved", label: "Resolved" },
      { key: "breached", label: "Past target" },
      { key: "avg_hours", label: "Avg hours" },
    ],
  },
  {
    kind: "attendance",
    label: "Staff attendance",
    description: "Days present, absences against the roster, approved leave and hours worked.",
    fn: "report_attendance",
    financial: false,
    ranged: true,
    columns: [
      { key: "staff_name", label: "Staff" },
      { key: "department", label: "Department" },
      { key: "present", label: "Present" },
      { key: "absent", label: "Absent" },
      { key: "leave_days", label: "On leave" },
      { key: "hours", label: "Hours" },
    ],
  },
  {
    kind: "guests",
    label: "Guest and loyalty metrics",
    description: "Repeat guest ratio, feedback scores and how the loyalty programme is performing.",
    fn: "report_guests",
    financial: false,
    ranged: true,
    columns: [
      { key: "stays", label: "Stays" },
      { key: "distinct_guests", label: "Guests" },
      { key: "repeat_guests", label: "Repeat guests" },
      { key: "feedback_count", label: "Feedback" },
      { key: "avg_overall", label: "Avg rating" },
      { key: "loyalty_members", label: "Members" },
      { key: "points_earned", label: "Points earned" },
      { key: "points_redeemed", label: "Points redeemed" },
    ],
  },
];

export function reportByKind(kind: string): ReportDefinition | null {
  return REPORTS.find((r) => r.kind === kind) ?? null;
}

/** The reports a person may actually run, given their permissions. */
export function reportsFor(options: { financial: boolean; view: boolean }): ReportDefinition[] {
  return REPORTS.filter((r) => (r.financial ? options.financial : options.view || options.financial));
}

/**
 * Turns report rows into the grid a CSV or a table renders. Values are taken
 * by the definition's column order, so the export always matches the screen.
 */
export function toGrid(
  definition: ReportDefinition,
  rows: Record<string, unknown>[],
): { header: string[]; body: (string | number)[][] } {
  return {
    header: definition.columns.map((c) => c.label),
    body: rows.map((row) =>
      definition.columns.map((c) => {
        const value = row[c.key];
        if (value === null || value === undefined) return "";
        if (typeof value === "number") return value;
        return String(value);
      }),
    ),
  };
}

/** A filename that sorts and reads well in a downloads folder. */
export function exportFilename(kind: string, from: string, to: string): string {
  const range = from === to ? from : `${from}_${to}`;
  return `${kind}_${range}.csv`;
}
