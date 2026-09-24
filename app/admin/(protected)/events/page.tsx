import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { todayIn } from "../../../lib/dates";
import { billablePax, clientName, eventHours, hhmm, layoutsFor } from "../../../lib/events";
import type {
  Company,
  EventBooking,
  EventLayout,
  EventPackage,
  EventSpace,
  EventStatus,
} from "../../../lib/types";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  MEAL_PERIOD_LABELS,
  RENTAL_BASIS_LABELS,
} from "../../../lib/types";
import {
  Card,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDate,
  fmtMoney,
  inputClass,
  tableHeadClass,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import { createEvent } from "../../event-actions";

/**
 * The events list, and the form that takes an enquiry.
 *
 * An enquiry, a quotation and a confirmed function are the same record at
 * different stages, so this one list is the whole pipeline: what is being
 * chased, what is waiting for a manager, and what is actually happening.
 */

const STATUS_TONE: Record<EventStatus, "neutral" | "amber" | "green" | "blue" | "red"> = {
  enquiry: "neutral",
  quoted: "amber",
  confirmed: "green",
  completed: "blue",
  cancelled: "red",
};

const FILTERS = ["upcoming", "open", "awaiting_approval", "past", "all"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  upcoming: "Coming up",
  open: "Being chased",
  awaiting_approval: "Waiting for approval",
  past: "Past",
  all: "Everything",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const session = await requireAnyPermission(["events.view", "events.book"]);
  const { show } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const filter: Filter = (FILTERS as readonly string[]).includes(show ?? "")
    ? (show as Filter)
    : "upcoming";

  const [{ data: eventRows }, { data: spaceRows }, { data: layoutRows }, { data: packageRows }, { data: companyRows }] =
    await Promise.all([
      supabase
        .from("event_bookings")
        .select("*, event_spaces(name, code, tax_rate), event_layouts(name, capacity), companies(name, gstin, billing_address), guests(full_name, phone, email)")
        .order("event_date", { ascending: filter !== "past" })
        .order("start_time")
        .limit(400),
      supabase.from("event_spaces").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("event_layouts").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("event_packages").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
    ]);

  const all = (eventRows ?? []) as EventBooking[];
  const spaces = (spaceRows ?? []) as EventSpace[];
  const layouts = (layoutRows ?? []) as EventLayout[];
  const packages = (packageRows ?? []) as EventPackage[];
  const companies = (companyRows ?? []) as Pick<Company, "id" | "name">[];

  const live = all.filter((e) => e.status !== "cancelled");
  const events =
    filter === "all"
      ? all
      : filter === "past"
        ? all.filter((e) => e.event_date < today)
        : filter === "open"
          ? live.filter((e) => e.status === "enquiry" || e.status === "quoted")
          : filter === "awaiting_approval"
            ? live.filter((e) => e.status === "quoted" && e.approval_required && !e.approved_at)
            : live.filter((e) => e.event_date >= today);

  const confirmedAhead = live.filter((e) => e.event_date >= today && e.status === "confirmed");
  const chasing = live.filter((e) => e.status === "enquiry" || e.status === "quoted");
  const waiting = chasing.filter((e) => e.status === "quoted" && e.approval_required && !e.approved_at);
  const confirmedValue = confirmedAhead.reduce((s, e) => s + Number(e.grand_total), 0);
  const pipelineValue = chasing.reduce((s, e) => s + Number(e.grand_total), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Confirmed ahead" value={confirmedAhead.length} hint="Functions still to come" />
        <StatCard label="Confirmed value" value={fmtMoney(confirmedValue)} hint="Including tax" />
        <StatCard label="Being chased" value={chasing.length} hint={`${fmtMoney(pipelineValue)} quoted`} />
        <StatCard
          label="Waiting for approval"
          value={waiting.length}
          hint={waiting.length ? "A manager has to approve these" : "Nothing held up"}
        />
      </div>

      {spaces.length === 0 && (
        <Notice tone="warn">
          There is no event space set up yet. Add the hall under <strong>Hall &amp; packages</strong> before taking an
          enquiry.
        </Notice>
      )}

      {/* ── Take an enquiry ── */}
      {can(session, "events.book") && spaces.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Take an enquiry</SectionTitle>
          <ActionForm action={createEvent} submitLabel="Take the enquiry" pendingLabel="Saving…">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="What is it called?" hint="How the hotel will refer to it">
                <input name="title" required maxLength={120} className={inputClass} placeholder="Khan wedding reception" />
              </Field>
              <Field label="Kind of function">
                <select name="event_type" defaultValue="conference" className={inputClass}>
                  {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Space">
                <select name="space_id" required defaultValue={spaces[0]?.id} className={inputClass}>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date">
                <input type="date" name="event_date" required defaultValue={today} className={inputClass} />
              </Field>
              <Field label="From">
                <input type="time" name="start_time" required defaultValue="09:00" className={inputClass} />
              </Field>
              <Field label="To">
                <input type="time" name="end_time" required defaultValue="18:00" className={inputClass} />
              </Field>

              <Field label="People expected" hint="The seating plan is offered to match">
                <input type="number" name="pax_expected" min={1} required defaultValue={50} className={inputClass} />
              </Field>
              <Field label="Guaranteed" hint="What the client agrees to pay for, even if fewer come">
                <input type="number" name="pax_guaranteed" min={0} defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Seating plan">
                <select name="layout_id" defaultValue="" className={inputClass}>
                  <option value="">Decide later</option>
                  {layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — seats {l.capacity}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Catering package" hint="Priced per head">
                <select name="package_id" defaultValue="" className={inputClass}>
                  <option value="">No catering</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmtMoney(p.price_per_head)} per head ({MEAL_PERIOD_LABELS[p.meal_period]})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hall charge">
                <select name="rental_basis" defaultValue="full_day" className={inputClass}>
                  {Object.entries(RENTAL_BASIS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Agreed hall amount" hint="Only used for “Agreed amount”">
                <input type="number" name="rental_override" min={0} step="0.01" className={inputClass} />
              </Field>

              <Field label="Company" hint="For corporate business, billed on account">
                <select name="company_id" defaultValue="" className={inputClass}>
                  <option value="">Not a company booking</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contact name">
                <input name="contact_name" maxLength={120} className={inputClass} placeholder="Who is organising it" />
              </Field>
              <Field label="Contact phone">
                <input name="contact_phone" maxLength={30} className={inputClass} />
              </Field>
              <Field
                label="Payment terms"
                hint="Left blank, a company's account terms or the hotel's usual deposit sentence is used"
              >
                <input name="payment_terms" maxLength={500} className={inputClass} />
              </Field>
            </div>

            <Field label="Notes" hint="Anything the desk should remember about this enquiry">
              <textarea name="notes" rows={2} maxLength={2000} className={inputClass} />
            </Field>
          </ActionForm>

          {layouts.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              Seating plans available: {layoutsFor(layouts, 0).map((l) => `${l.name} (${l.capacity})`).join(" · ")}.
            </p>
          )}
        </Card>
      )}

      {/* ── The list ── */}
      <Card>
        <div className="px-4 pt-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={`/admin/events?show=${f}`}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                filter === f
                  ? "border-yellow-500 bg-yellow-50 text-yellow-800"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {FILTER_LABELS[f]}
            </Link>
          ))}
        </div>

        {events.length === 0 ? (
          <EmptyState message="Nothing here. Take an enquiry above, or choose another filter." />
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Reference</th>
                  <th className="py-2 pr-3 font-semibold">Function</th>
                  <th className="py-2 pr-3 font-semibold">For</th>
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Time</th>
                  <th className="py-2 pr-3 font-semibold text-right">Billed for</th>
                  <th className="py-2 pr-3 font-semibold text-right">Value</th>
                  <th className="py-2 pr-4 font-semibold">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {events.map((e) => (
                  <tr key={e.id} className={e.status === "cancelled" ? "text-slate-400" : "hover:bg-slate-50/60"}>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <Link href={`/admin/events/${e.id}`} className="font-mono text-yellow-700 hover:underline">
                        {e.number}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {e.title}
                      <span className="block text-[11px] text-slate-500">
                        {EVENT_TYPE_LABELS[e.event_type]}
                        {e.event_layouts ? ` · ${e.event_layouts.name}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{clientName(e)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(e.event_date)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {hhmm(e.start_time)}–{hhmm(e.end_time)}
                      <span className="block text-[11px] text-slate-500">
                        {eventHours(e.start_time, e.end_time)} h
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{billablePax(e)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">{fmtMoney(e.grand_total)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <Tag tone={STATUS_TONE[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Tag>
                      {e.status === "quoted" && e.approval_required && !e.approved_at && (
                        <span className="block text-[11px] text-amber-700 mt-0.5">Needs approval</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
