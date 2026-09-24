import type {
  Company,
  EventBooking,
  EventLayout,
  EventEquipment,
  EventLine,
  EventPackage,
  EventPayment,
  EventSpace,
  TaxBand,
} from "./types";

/**
 * Banquet, conference and event arithmetic (SOW Module 10).
 *
 * These are pure mirrors of the SQL in 0019_events.sql, in the same order and
 * with the same rounding, so the screen can price an event as the desk types
 * without a round trip and still agree with what the database will store. The
 * database remains the authority; this is what makes the quotation preview
 * honest, and it is what the unit tests in tests/events.test.ts pin down.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Head count ──────────────────────────────────────────────────────────────

type PaxFields = Pick<EventBooking, "pax_expected" | "pax_guaranteed" | "pax_actual">;

/**
 * The head count an event is billed for: the guarantee or the actual number,
 * whichever is higher, falling back to the expected number before either has
 * been given. A client who guarantees 100 and brings 60 pays for 100 — that
 * is what taking a guarantee is for, and it is the banquet trade's own rule.
 */
export function billablePax(e: PaxFields): number {
  const higher = Math.max(e.pax_guaranteed ?? 0, e.pax_actual ?? 0);
  return higher > 0 ? higher : e.pax_expected;
}

/** Whether the chosen seating plan actually holds the people expected. */
export function layoutFits(pax: number, layout: Pick<EventLayout, "capacity"> | null): boolean {
  return !layout || pax <= layout.capacity;
}

/** Seating plans that hold a given number, largest capacity first. */
export function layoutsFor(layouts: EventLayout[], pax: number): EventLayout[] {
  return layouts
    .filter((l) => l.is_active && l.capacity >= pax)
    .sort((a, b) => a.capacity - b.capacity);
}

// ── Hall rental ─────────────────────────────────────────────────────────────

type RentalFields = Pick<EventBooking, "rental_basis" | "rental_hours" | "rental_override">;
type SpaceRates = Pick<
  EventSpace,
  "rental_full_day" | "rental_half_day" | "rental_per_hour" | "min_charge" | "tax_rate"
>;

/**
 * What the hall is let for, before any discount. The minimum charge applies
 * to a hall that is actually let, not to one the hotel has thrown in.
 */
export function rentalNet(e: RentalFields, space: SpaceRates | null): number {
  if (!space) return 0;
  const gross =
    e.rental_basis === "waived"
      ? 0
      : e.rental_basis === "custom"
        ? Number(e.rental_override ?? 0)
        : e.rental_basis === "hourly"
          ? round2(Number(space.rental_per_hour) * Number(e.rental_hours))
          : e.rental_basis === "half_day"
            ? Number(space.rental_half_day)
            : Number(space.rental_full_day);

  if (e.rental_basis === "waived") return 0;
  return round2(Math.max(gross, Number(space.min_charge ?? 0)));
}

// ── Pricing the whole event ─────────────────────────────────────────────────

export interface EventPricingInput {
  event: PaxFields & RentalFields & Pick<EventBooking, "discount_percent">;
  space: SpaceRates | null;
  /** The one per-head catering package, or none. */
  pkg: Pick<EventPackage, "price_per_head" | "tax_rate"> | null;
  lines: Pick<EventLine, "kind" | "net_amount" | "tax_amount" | "tax_rate">[];
  /** Property setting, charged on what the client actually pays. */
  servicePercent: number;
}

export interface EventPricing {
  rentalNet: number;
  rentalTax: number;
  cateringNet: number;
  cateringTax: number;
  equipmentNet: number;
  equipmentTax: number;
  otherNet: number;
  otherTax: number;
  serviceNet: number;
  serviceTax: number;
  discountAmount: number;
  bands: TaxBand[];
  netTotal: number;
  taxTotal: number;
  grandTotal: number;
}

/**
 * Prices an event the way the database does.
 *
 * The four parts are taxed at their own rates — in India a hall and a buffet
 * do not share a GST rate — and the discount is applied to every part, so the
 * taxable value on the invoice falls with the price rather than the tax being
 * charged on money nobody paid. The totals are then taken from the rate-wise
 * bands rather than added up separately, which is what stops the summary and
 * the invoice from ever disagreeing.
 */
export function priceEvent(input: EventPricingInput): EventPricing {
  const { event, space, pkg, lines, servicePercent } = input;
  const keep = 1 - Number(event.discount_percent) / 100;
  const spaceRate = Number(space?.tax_rate ?? 0);

  const rentalGross = rentalNet(event, space);
  const cateringGross = pkg ? round2(Number(pkg.price_per_head) * billablePax(event)) : 0;
  const linesGross = lines.reduce((s, l) => s + Number(l.net_amount), 0);

  const serviceNet =
    servicePercent > 0
      ? round2((rentalGross + cateringGross + linesGross) * keep * (servicePercent / 100))
      : 0;

  // One entry per taxable part, then grouped by rate — the same union the
  // database builds in event_tax_bands().
  const parts: { rate: number; net: number }[] = [
    { rate: spaceRate, net: round2(rentalGross * keep) },
    { rate: Number(pkg?.tax_rate ?? 0), net: round2(cateringGross * keep) },
    ...lines.map((l) => ({ rate: Number(l.tax_rate), net: round2(Number(l.net_amount) * keep) })),
    { rate: spaceRate, net: serviceNet },
  ];

  const byRate = new Map<number, number>();
  for (const part of parts) {
    byRate.set(part.rate, (byRate.get(part.rate) ?? 0) + part.net);
  }

  const bands: TaxBand[] = [...byRate.entries()]
    .filter(([, net]) => round2(net) !== 0)
    .map(([rate, net]) => ({ rate, net: round2(net), tax: round2((net * rate) / 100) }))
    .sort((a, b) => a.rate - b.rate);

  const equipment = lines.filter((l) => l.kind === "equipment");
  const other = lines.filter((l) => l.kind !== "equipment");
  const sumNet = (ls: typeof lines) => ls.reduce((s, l) => s + Number(l.net_amount), 0);
  const sumTax = (ls: typeof lines) => ls.reduce((s, l) => s + Number(l.tax_amount), 0);

  const netTotal = round2(bands.reduce((s, b) => s + b.net, 0));
  const taxTotal = round2(bands.reduce((s, b) => s + b.tax, 0));

  return {
    rentalNet: round2(rentalGross * keep),
    rentalTax: round2(rentalGross * keep * (spaceRate / 100)),
    cateringNet: round2(cateringGross * keep),
    cateringTax: round2(cateringGross * keep * (Number(pkg?.tax_rate ?? 0) / 100)),
    equipmentNet: round2(sumNet(equipment) * keep),
    equipmentTax: round2(sumTax(equipment) * keep),
    otherNet: round2(sumNet(other) * keep),
    otherTax: round2(sumTax(other) * keep),
    serviceNet,
    serviceTax: round2(serviceNet * (spaceRate / 100)),
    discountAmount: round2(
      (rentalGross + cateringGross + linesGross) * (Number(event.discount_percent) / 100),
    ),
    bands,
    netTotal,
    taxTotal,
    grandTotal: round2(netTotal + taxTotal),
  };
}

/** One line of an event's quotation or bill, priced for printing. */
export function quoteLine(qty: number, unitPrice: number, taxRate: number) {
  const net = round2(qty * unitPrice);
  const tax = round2((net * taxRate) / 100);
  return { net, tax, total: round2(net + tax) };
}

// ── What is owed ────────────────────────────────────────────────────────────

/** Money received against an event, with refunds taken back off. */
export function amountPaid(payments: Pick<EventPayment, "kind" | "amount" | "voided_at">[]): number {
  return round2(
    payments
      .filter((p) => !p.voided_at)
      .reduce((s, p) => s + (p.kind === "refund" ? -Number(p.amount) : Number(p.amount)), 0),
  );
}

export function eventBalance(
  event: Pick<EventBooking, "grand_total">,
  payments: Pick<EventPayment, "kind" | "amount" | "voided_at">[],
): number {
  return round2(Number(event.grand_total) - amountPaid(payments));
}

/** The deposit the hotel normally asks for before holding the date. */
export function advanceDue(grandTotal: number, percent: number): number {
  return round2((Number(grandTotal) * Number(percent)) / 100);
}

/** Whether a deposit of at least the usual percentage has been taken. */
export function advanceSettled(
  event: Pick<EventBooking, "grand_total">,
  payments: Pick<EventPayment, "kind" | "amount" | "voided_at">[],
  percent: number,
): boolean {
  if (percent <= 0) return true;
  return amountPaid(payments) >= advanceDue(Number(event.grand_total), percent);
}

/** Whether an event has been billed, and so may no longer be repriced. */
export function isBilled(payments: Pick<EventPayment, "kind" | "voided_at">[]): boolean {
  return payments.some(
    (p) => !p.voided_at && (p.kind === "room_charge" || p.kind === "company_account"),
  );
}

// ── The quotation approval workflow ─────────────────────────────────────────

/**
 * SOW Module 10: a quotation above a configured value needs approval before
 * it may be sent. A threshold of zero means every quotation does — the same
 * rule, and the same reading of it, as refunds in Module 7.
 */
export function quoteNeedsApproval(grandTotal: number, threshold: number): boolean {
  return Number(grandTotal) >= Number(threshold);
}

/** Why an event cannot be confirmed yet, or null when it can. */
export function blocksConfirmation(
  e: Pick<EventBooking, "status" | "approval_required" | "approved_at" | "grand_total">,
): string | null {
  if (e.status === "confirmed") return "This event is already confirmed.";
  if (e.status === "completed") return "This event has already taken place.";
  if (e.status === "cancelled") return "This event is cancelled.";
  if (e.status !== "quoted") {
    return "Send a quotation first, so there is a price both sides have agreed.";
  }
  if (e.approval_required && !e.approved_at) {
    return "This quotation is above the approval threshold and needs approval before the date can be held.";
  }
  return null;
}

// ── The diary ───────────────────────────────────────────────────────────────

type Window = Pick<EventBooking, "setup_from" | "teardown_to">;

/** Whether two holds on the same hall and day overlap at all. */
export function overlaps(a: Window, b: Window): boolean {
  return a.setup_from < b.teardown_to && a.teardown_to > b.setup_from;
}

/**
 * Only a confirmed or completed event holds the hall. Two enquiries for the
 * same Saturday are ordinary business — the hotel quotes several and wins one
 * — so the diary shows them together and warns rather than refusing.
 */
export const HOLDING_STATUSES = ["confirmed", "completed"] as const;

export function holdsTheSpace(e: Pick<EventBooking, "status">): boolean {
  return (HOLDING_STATUSES as readonly string[]).includes(e.status);
}

/** The confirmed event that would clash with this one, if any. */
export function clashWith<T extends Window & Pick<EventBooking, "id" | "status" | "space_id" | "event_date">>(
  candidate: Window & Pick<EventBooking, "id" | "space_id" | "event_date">,
  others: T[],
): T | null {
  return (
    others.find(
      (o) =>
        o.id !== candidate.id &&
        o.space_id === candidate.space_id &&
        o.event_date === candidate.event_date &&
        holdsTheSpace(o) &&
        overlaps(candidate, o),
    ) ?? null
  );
}

/** Other enquiries and quotations chasing the same hall on the same day. */
export function competingFor<
  T extends Window & Pick<EventBooking, "id" | "status" | "space_id" | "event_date">,
>(candidate: Window & Pick<EventBooking, "id" | "space_id" | "event_date">, others: T[]): T[] {
  return others.filter(
    (o) =>
      o.id !== candidate.id &&
      o.space_id === candidate.space_id &&
      o.event_date === candidate.event_date &&
      (o.status === "enquiry" || o.status === "quoted") &&
      overlaps(candidate, o),
  );
}

// ── Times ───────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)/;

/** Minutes from midnight, or null when the value is not a time. */
export function minutesOf(time: string): number | null {
  const m = HHMM.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const asTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * How long the hall is held: the event, plus the hotel's own allowances for
 * dressing it and clearing it. Clamped to the day, because the hold is stored
 * as a time of day and a hall cleared at "25:00" is not a time.
 */
export function holdWindow(
  startTime: string,
  endTime: string,
  setupMinutes: number,
  teardownMinutes: number,
): { setup_from: string; teardown_to: string } {
  const start = minutesOf(startTime) ?? 0;
  const end = minutesOf(endTime) ?? start;
  return {
    setup_from: asTime(Math.max(0, start - Math.max(0, setupMinutes))),
    teardown_to: asTime(Math.min(23 * 60 + 59, end + Math.max(0, teardownMinutes))),
  };
}

/** How long the event itself runs, in hours, for hourly hall rental. */
export function eventHours(startTime: string, endTime: string): number {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  if (start === null || end === null || end <= start) return 0;
  return round2((end - start) / 60);
}

export const hhmm = (time: string) => time.slice(0, 5);

// ── Equipment ───────────────────────────────────────────────────────────────

/**
 * The equipment that can be offered for a space (SOW: "available equipment"
 * is an attribute of the space). An item tied to a space is only offered
 * there; one with no space travels, so it is offered everywhere.
 */
export function equipmentForSpace<T extends Pick<EventEquipment, "space_id" | "is_active">>(
  equipment: T[],
  spaceId: string,
): T[] {
  return equipment.filter((e) => e.is_active && (e.space_id === null || e.space_id === spaceId));
}

// ── Payment terms ───────────────────────────────────────────────────────────

/**
 * The payment terms an event starts with (SOW booking data: "payment terms").
 *
 * A corporate client already has agreed terms on their account, so those are
 * what the quotation should say rather than something typed again. Anyone
 * else gets the hotel's usual deposit sentence, which whoever is selling can
 * then edit.
 */
export function defaultPaymentTerms(
  company: Pick<Company, "name" | "payment_terms_days"> | null,
  advancePercent: number,
): string {
  if (company) {
    return company.payment_terms_days > 0
      ? `Billed to ${company.name} on account, due ${company.payment_terms_days} days from invoice.`
      : `Billed to ${company.name} on account, due on invoice.`;
  }
  return advancePercent > 0
    ? `${advancePercent}% deposit to confirm the booking; balance due on or before the day of the event.`
    : "Balance due on or before the day of the event.";
}

// ── Documents ───────────────────────────────────────────────────────────────

/** Who the event is for, from whichever of the three the desk filled in. */
export function clientName(
  e: Pick<EventBooking, "contact_name"> & {
    companies?: { name: string } | null;
    guests?: { full_name: string } | null;
  },
): string {
  return e.companies?.name || e.guests?.full_name || e.contact_name || "—";
}

/** The printed reference for an event's quotation, contract and BEO. */
export function formatEventNumber(financialYear: string, seq: number) {
  return `EVT/${financialYear}/${String(seq).padStart(4, "0")}`;
}
