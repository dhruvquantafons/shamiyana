import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, ClipboardList, Handshake, ReceiptIndianRupee } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import {
  advanceDue,
  advanceSettled,
  amountPaid,
  billablePax,
  blocksConfirmation,
  clashWith,
  clientName,
  competingFor,
  equipmentForSpace,
  eventBalance,
  eventHours,
  hhmm,
  isBilled,
  layoutFits,
} from "../../../../lib/events";
import type {
  Booking,
  Company,
  EventBooking,
  EventEquipment,
  EventLayout,
  EventLine,
  EventPackage,
  EventPayment,
  EventSpace,
  Invoice,
} from "../../../../lib/types";
import {
  EVENT_LINE_KIND_LABELS,
  EVENT_PAYMENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  MEAL_PERIOD_LABELS,
  PAYMENT_METHOD_LABELS,
  RENTAL_BASIS_LABELS,
} from "../../../../lib/types";
import {
  Card,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  Stat,
  StatCard,
  Tag,
  dangerButtonClass,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import {
  addEventLine,
  approveEventQuote,
  billEventToCompany,
  billEventToRoom,
  cancelEvent,
  completeEvent,
  confirmEvent,
  issueEventInvoice,
  recordEventContract,
  removeEventLine,
  saveEventOrder,
  submitEventQuote,
  takeEventPayment,
  updateEvent,
} from "../../../event-actions";

/**
 * One function, from enquiry to settled bill.
 *
 * The stages run left to right: price it, quote it, get it approved if it is
 * a large one, confirm it — which is the moment the hall is actually held —
 * run it, close it off on the real head count, and bill it. Each stage shows
 * only what can be done now, because a screen that offers "confirm" on an
 * unpriced enquiry teaches the desk to click through warnings.
 */
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["events.view", "events.book", "events.bill"]);
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const { data: row } = await supabase
    .from("event_bookings")
    .select(
      "*, event_spaces(*), event_layouts(name, capacity), event_packages(name, price_per_head, tax_rate, inclusions, meal_period), companies(name, gstin, billing_address), guests(full_name, phone, email), bookings(reference, check_in, check_out, status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();
  const event = row as EventBooking & {
    event_spaces: EventSpace | null;
    event_packages: (Pick<EventPackage, "name" | "price_per_head" | "tax_rate" | "inclusions"> & { meal_period: EventPackage["meal_period"] }) | null;
  };
  const space = event.event_spaces;

  const [
    { data: lineRows },
    { data: payRows },
    { data: layoutRows },
    { data: packageRows },
    { data: equipmentRows },
    { data: companyRows },
    { data: invoiceRows },
    { data: sameDayRows },
    { data: residentRows },
  ] = await Promise.all([
    supabase.from("event_lines").select("*").eq("event_id", id).order("sort_order").order("created_at"),
    supabase.from("event_payments").select("*").eq("event_id", id).order("created_at"),
    supabase.from("event_layouts").select("*").eq("space_id", event.space_id).eq("is_active", true).order("sort_order"),
    supabase.from("event_packages").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("event_equipment").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("companies").select("id, name, credit_limit, payment_terms_days").eq("is_active", true).order("name"),
    supabase.from("invoices").select("*").eq("event_id", id).order("issued_at", { ascending: false }),
    supabase
      .from("event_bookings")
      .select("id, number, title, status, space_id, event_date, setup_from, teardown_to")
      .eq("space_id", event.space_id)
      .eq("event_date", event.event_date),
    supabase
      .from("bookings")
      .select("id, reference, contact_name, check_in, check_out, status, guests(full_name)")
      .in("status", ["checked_in", "checked_out"])
      .gte("check_out", event.event_date)
      .order("check_in", { ascending: false })
      .limit(60),
  ]);

  const lines = (lineRows ?? []) as EventLine[];
  const payments = (payRows ?? []) as EventPayment[];
  const layouts = (layoutRows ?? []) as EventLayout[];
  const packages = (packageRows ?? []) as EventPackage[];
  const equipment = equipmentForSpace((equipmentRows ?? []) as EventEquipment[], event.space_id);
  const companies = (companyRows ?? []) as Pick<Company, "id" | "name" | "credit_limit" | "payment_terms_days">[];
  const invoices = (invoiceRows ?? []) as Invoice[];
  const sameDay = (sameDayRows ?? []) as (Pick<
    EventBooking,
    "id" | "number" | "title" | "status" | "space_id" | "event_date" | "setup_from" | "teardown_to"
  >)[];
  const residents = (residentRows ?? []) as unknown as (Pick<
    Booking,
    "id" | "reference" | "contact_name" | "check_in" | "check_out" | "status"
  > & { guests: { full_name: string } | null })[];

  const pax = billablePax(event);
  const paid = amountPaid(payments);
  const balance = eventBalance(event, payments);
  const billed = isBilled(payments);
  const issuedInvoice = invoices.find((i) => i.status === "issued") ?? null;
  const cannotConfirm = blocksConfirmation(event);
  const clash = clashWith(event, sameDay);
  const competing = competingFor(event, sameDay);
  const seatsShort = !layoutFits(pax, event.event_layouts ?? null);
  const depositDue = advanceDue(Number(event.grand_total), settings.event_advance_percent);
  const depositTaken = advanceSettled(event, payments, settings.event_advance_percent);

  const canBook = can(session, "events.book");
  const canQuote = can(session, "events.quote");
  const canApprove = can(session, "events.approve");
  const canBill = can(session, "events.bill");
  const locked = event.status === "cancelled" || billed || Boolean(issuedInvoice);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-slate-500">{event.number}</p>
              <Tag
                tone={
                  event.status === "confirmed"
                    ? "green"
                    : event.status === "completed"
                      ? "blue"
                      : event.status === "quoted"
                        ? "amber"
                        : event.status === "cancelled"
                          ? "red"
                          : "neutral"
                }
              >
                {EVENT_STATUS_LABELS[event.status]}
              </Tag>
              {event.approval_required && !event.approved_at && event.status === "quoted" && (
                <Tag tone="amber">Waiting for approval</Tag>
              )}
              {billed && <Tag tone="violet">Billed</Tag>}
            </div>
            <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{event.title}</p>
            <p className="text-xs text-slate-600">
              {EVENT_TYPE_LABELS[event.event_type]} · {clientName(event)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/events/${id}/quotation`} className={secondaryButtonClass}>
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Quotation
              </span>
            </Link>
            <Link href={`/admin/events/${id}/contract`} className={secondaryButtonClass}>
              <span className="flex items-center gap-1.5">
                <Handshake className="w-3.5 h-3.5" /> Contract
              </span>
            </Link>
            <Link href={`/admin/events/${id}/beo`} className={secondaryButtonClass}>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5" /> Event order
              </span>
            </Link>
            {issuedInvoice && (
              <Link href={`/admin/events/${id}/invoice/${issuedInvoice.id}`} className={secondaryButtonClass}>
                <span className="flex items-center gap-1.5">
                  <ReceiptIndianRupee className="w-3.5 h-3.5" /> {issuedInvoice.number}
                </span>
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="Date">{fmtDate(event.event_date)}</Stat>
          <Stat label="Time">
            {hhmm(event.start_time)}–{hhmm(event.end_time)}
            <span className="block text-[11px] text-slate-500">{eventHours(event.start_time, event.end_time)} hours</span>
          </Stat>
          <Stat label="Hall held">
            {hhmm(event.setup_from)}–{hhmm(event.teardown_to)}
            <span className="block text-[11px] text-slate-500">Dressing and clearing</span>
          </Stat>
          <Stat label="Space">
            {space?.name ?? "—"}
            {space?.floor !== null && space?.floor !== undefined && (
              <span className="block text-[11px] text-slate-500">Floor {space.floor}</span>
            )}
          </Stat>
          <Stat label="Seating">
            {event.event_layouts?.name ?? "Not chosen"}
            {event.event_layouts && (
              <span className="block text-[11px] text-slate-500">seats {event.event_layouts.capacity}</span>
            )}
          </Stat>
          <Stat label="Billed for">
            {pax} {pax === 1 ? "person" : "people"}
            <span className="block text-[11px] text-slate-500">
              {event.pax_actual !== null
                ? `${event.pax_actual} attended`
                : event.pax_guaranteed > 0
                  ? `${event.pax_guaranteed} guaranteed`
                  : `${event.pax_expected} expected`}
            </span>
          </Stat>
        </div>
      </Card>

      {/* ── What needs attention ── */}
      {clash && (
        <Notice tone="error">
          The hall is already held on {fmtDate(event.event_date)} by{" "}
          <Link href={`/admin/events/${clash.id}`} className="underline">
            {clash.number} — {clash.title}
          </Link>{" "}
          from {hhmm(clash.setup_from)} to {hhmm(clash.teardown_to)}. This function cannot be confirmed at that time.
        </Notice>
      )}
      {seatsShort && (
        <Notice tone="warn">
          {event.event_layouts?.name} seats {event.event_layouts?.capacity}, but this function is billed for {pax}.
          Choose a plan that fits, or agree a smaller head count with the client.
        </Notice>
      )}
      {competing.length > 0 && event.status !== "confirmed" && event.status !== "completed" && (
        <Notice tone="info">
          {competing.length} other {competing.length === 1 ? "enquiry is" : "enquiries are"} chasing{" "}
          {fmtDate(event.event_date)}:{" "}
          {competing.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link href={`/admin/events/${c.id}`} className="underline">
                {c.number}
              </Link>
            </span>
          ))}
          . Whoever confirms first holds the hall.
        </Notice>
      )}
      {event.status === "cancelled" && (
        <Notice tone="error">Cancelled — {event.cancel_reason}</Notice>
      )}
      {event.status === "confirmed" && !depositTaken && settings.event_advance_percent > 0 && (
        <Notice tone="warn">
          No deposit has been taken yet. The hotel normally asks for {settings.event_advance_percent}% up front, which
          is {fmtMoney(depositDue)} on this event.
        </Notice>
      )}

      {/* ── The money ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Event value" value={fmtMoney(event.grand_total)} hint={`${fmtMoney(event.net_total)} + tax`} />
        <StatCard label="Received" value={fmtMoney(paid)} hint={`Deposit normally ${fmtMoney(depositDue)}`} />
        <StatCard
          label="Still owed"
          value={fmtMoney(balance)}
          hint={balance <= 0 ? "Settled" : billed ? "On a room or company account" : "Not yet billed"}
        />
        <StatCard
          label={settings.tax_label}
          value={fmtMoney(event.tax_total)}
          hint={event.discount_amount > 0 ? `After ${fmtMoney(event.discount_amount)} discount` : "Included above"}
        />
      </div>

      {/* ── How it is priced ── */}
      <Card className="p-5">
        <SectionTitle>How this is priced</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={tableHeadClass}>
                <th className="py-2 pr-3 font-semibold">Part</th>
                <th className="py-2 pr-3 font-semibold">Basis</th>
                <th className="py-2 pr-3 font-semibold text-right">Taxable value</th>
                <th className="py-2 pr-3 font-semibold text-right">{settings.tax_label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr>
                <td className="py-2 pr-3">Hall</td>
                <td className="py-2 pr-3">
                  {RENTAL_BASIS_LABELS[event.rental_basis]}
                  {event.rental_basis === "hourly" && ` — ${event.rental_hours} h`}
                </td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.rental_net)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.rental_tax)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Catering</td>
                <td className="py-2 pr-3">
                  {event.event_packages
                    ? `${event.event_packages.name} — ${fmtMoney(event.event_packages.price_per_head)} × ${pax}`
                    : "No catering package"}
                </td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.catering_net)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.catering_tax)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Equipment</td>
                <td className="py-2 pr-3">{lines.filter((l) => l.kind === "equipment").length} item(s)</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.equipment_net)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.equipment_tax)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Extras</td>
                <td className="py-2 pr-3">{lines.filter((l) => l.kind !== "equipment").length} item(s)</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.other_net)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.other_tax)}</td>
              </tr>
              {event.service_net > 0 && (
                <tr>
                  <td className="py-2 pr-3">Service charge</td>
                  <td className="py-2 pr-3">{settings.event_service_charge_percent}% of the above</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(event.service_net)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(event.service_tax)}</td>
                </tr>
              )}
              {event.discount_amount > 0 && (
                <tr className="text-emerald-700">
                  <td className="py-2 pr-3">Discount</td>
                  <td className="py-2 pr-3">{event.discount_percent}% across every part</td>
                  <td className="py-2 pr-3 text-right">−{fmtMoney(event.discount_amount)}</td>
                  <td className="py-2 pr-3 text-right">—</td>
                </tr>
              )}
              <tr className="font-medium text-slate-900 border-t-2 border-slate-900">
                <td className="py-2 pr-3" colSpan={2}>
                  Total
                </td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.net_total)}</td>
                <td className="py-2 pr-3 text-right">{fmtMoney(event.tax_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {event.tax_breakdown.length > 0 && (
          <p className="mt-3 text-[11px] text-slate-500">
            Taxed at{" "}
            {event.tax_breakdown
              .map((b) => `${b.rate}% on ${fmtMoney(b.net)}`)
              .join(", ")}
            . The hall and the food are taxed at their own rates, which is why a banquet bill carries more than one.
          </p>
        )}
      </Card>

      {/* ── Equipment and extras ── */}
      <Card>
        <div className="px-5 pt-5">
          <SectionTitle>Equipment and extras</SectionTitle>
        </div>
        {lines.length === 0 ? (
          <EmptyState message="Nothing beyond the hall and the catering package." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-5 font-semibold">What</th>
                  <th className="py-2 pr-3 font-semibold">Kind</th>
                  <th className="py-2 pr-3 font-semibold text-right">Qty</th>
                  <th className="py-2 pr-3 font-semibold text-right">Each</th>
                  <th className="py-2 pr-3 font-semibold text-right">Value</th>
                  <th className="py-2 pr-3 font-semibold text-right">{settings.tax_label}</th>
                  <th className="py-2 pr-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-5">{l.description}</td>
                    <td className="py-2 pr-3">{EVENT_LINE_KIND_LABELS[l.kind]}</td>
                    <td className="py-2 pr-3 text-right">{l.qty}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(l.unit_price)}</td>
                    <td className="py-2 pr-3 text-right">{fmtMoney(l.net_amount)}</td>
                    <td className="py-2 pr-3 text-right">
                      {fmtMoney(l.tax_amount)}
                      <span className="block text-[10px] text-slate-400">at {l.tax_rate}%</span>
                    </td>
                    <td className="py-2 pr-5 text-right">
                      {canBook && !locked && (
                        <ActionForm
                          action={removeEventLine}
                          submitLabel="Remove"
                          pendingLabel="…"
                          className="inline"
                          submitClassName="text-[11px] text-rose-700 hover:underline cursor-pointer"
                          confirmMessage={`Remove “${l.description}” from this event?`}
                        >
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="event_id" value={id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canBook && !locked && (
          <div className="p-5 border-t border-slate-100">
            <ActionForm action={addEventLine} submitLabel="Add" pendingLabel="Adding…">
              <input type="hidden" name="event_id" value={id} />
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <Field label="From the equipment list" hint="Fills in the price and tax rate">
                  <select name="equipment_id" defaultValue="" className={inputClass}>
                    <option value="">Something else</option>
                    {equipment.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} — {fmtMoney(e.rental_price)} per {e.unit} ({e.qty_available} available)
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Or describe it">
                  <input name="description" maxLength={200} className={inputClass} placeholder="Stage flowers" />
                </Field>
                <Field label="Kind">
                  <select name="kind" defaultValue="other" className={inputClass}>
                    {Object.entries(EVENT_LINE_KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity">
                  <input type="number" name="qty" min={0.01} step="0.01" defaultValue={1} className={inputClass} />
                </Field>
                <Field label="Price each" hint="Leave blank to use the list price">
                  <input type="number" name="unit_price" min={0} step="0.01" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      {/* ── The stages ── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <SectionTitle>Where this has got to</SectionTitle>

          <ol className="space-y-2 text-xs text-slate-600 mb-5">
            <li className={event.quoted_at ? "text-emerald-700" : ""}>
              1. Quotation {event.quoted_at ? `prepared ${fmtDateTime(event.quoted_at)}` : "not yet prepared"}
            </li>
            <li className={event.approved_at ? "text-emerald-700" : ""}>
              2. Approval{" "}
              {event.approved_at
                ? `given ${fmtDateTime(event.approved_at)}`
                : event.approval_required
                  ? "needed — above the threshold"
                  : "not needed at this value"}
            </li>
            <li className={event.confirmed_at ? "text-emerald-700" : ""}>
              3. Confirmed {event.confirmed_at ? fmtDateTime(event.confirmed_at) : "— the hall is not held yet"}
            </li>
            <li className={event.contract_signed_on ? "text-emerald-700" : ""}>
              4. Contract{" "}
              {event.contract_signed_on
                ? `signed ${fmtDate(event.contract_signed_on)} by ${event.contract_signed_name}`
                : "not recorded as signed"}
            </li>
            <li className={event.completed_at ? "text-emerald-700" : ""}>
              5. Closed off {event.completed_at ? fmtDateTime(event.completed_at) : "— after the event"}
            </li>
          </ol>

          <div className="space-y-4">
            {canQuote && (event.status === "enquiry" || event.status === "quoted") && (
              <ActionForm
                action={submitEventQuote}
                submitLabel={event.quoted_at ? "Reprice the quotation" : "Prepare the quotation"}
                pendingLabel="Pricing…"
                className="space-y-2"
                submitClassName={secondaryButtonClass}
                footer={
                  <span className="text-[11px] text-slate-500">
                    Quotations of {fmtMoney(settings.event_quote_approval_threshold)} or more need approval.
                  </span>
                }
              >
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            )}

            {canApprove && event.status === "quoted" && event.approval_required && !event.approved_at && (
              <ActionForm
                action={approveEventQuote}
                submitLabel="Approve this quotation"
                pendingLabel="Approving…"
                className="space-y-2"
                footer={
                  <span className="text-[11px] text-slate-500">
                    Whoever prepared it cannot approve it.
                  </span>
                }
              >
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            )}

            {canBook && event.status === "quoted" && (
              <ActionForm
                action={confirmEvent}
                submitLabel="Confirm and hold the hall"
                pendingLabel="Confirming…"
                className="space-y-2"
                confirmMessage="Confirm this event? The hall will be held and will refuse a second function at that time."
              >
                <input type="hidden" name="id" value={id} />
                {cannotConfirm && <Notice tone="warn">{cannotConfirm}</Notice>}
              </ActionForm>
            )}

            {canBook && event.status === "confirmed" && (
              <ActionForm
                action={completeEvent}
                submitLabel="Close off the event"
                pendingLabel="Closing…"
                confirmMessage="Close this event off? The head count is then fixed for billing."
              >
                <input type="hidden" name="id" value={id} />
                <Field
                  label="How many actually attended?"
                  hint={`The guarantee is ${event.pax_guaranteed}; a higher turnout is what gets billed`}
                >
                  <input
                    type="number"
                    name="pax_actual"
                    min={0}
                    required
                    defaultValue={event.pax_guaranteed || event.pax_expected}
                    className={inputClass}
                  />
                </Field>
              </ActionForm>
            )}

            {canBook && event.status === "confirmed" && !event.contract_signed_on && (
              <ActionForm action={recordEventContract} submitLabel="Record the signed contract" pendingLabel="Saving…" submitClassName={secondaryButtonClass}>
                <input type="hidden" name="id" value={id} />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Signed on">
                    <input type="date" name="contract_signed_on" required defaultValue={today} className={inputClass} />
                  </Field>
                  <Field label="Signed by">
                    <input name="contract_signed_name" required maxLength={120} className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            )}

            {canBook && event.status !== "cancelled" && event.status !== "completed" && (
              <ActionForm
                action={cancelEvent}
                submitLabel="Cancel this event"
                pendingLabel="Cancelling…"
                submitClassName={dangerButtonClass}
                confirmMessage="Cancel this event? The hall is released."
              >
                <input type="hidden" name="id" value={id} />
                <Field label="Why?" hint="Kept on the record">
                  <input name="reason" required maxLength={300} className={inputClass} />
                </Field>
              </ActionForm>
            )}
          </div>
        </Card>

        {/* ── Money in ── */}
        <Card className="p-5">
          <SectionTitle>Deposits, payments and billing</SectionTitle>

          {event.payment_terms && (
            <p className="text-[11px] text-slate-500 -mt-2 mb-4">Agreed terms: {event.payment_terms}</p>
          )}

          {payments.length === 0 ? (
            <p className="text-xs text-slate-500 mb-4">Nothing received yet.</p>
          ) : (
            <table className="w-full text-xs mb-4">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="py-2 pr-3 font-semibold">What</th>
                  <th className="py-2 pr-3 font-semibold">How</th>
                  <th className="py-2 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {payments.map((p) => (
                  <tr key={p.id} className={p.voided_at ? "text-slate-400 line-through" : ""}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(p.created_at.slice(0, 10))}</td>
                    <td className="py-2 pr-3">{EVENT_PAYMENT_KIND_LABELS[p.kind]}</td>
                    <td className="py-2 pr-3">
                      {p.method ? PAYMENT_METHOD_LABELS[p.method] : "—"}
                      {p.reference && <span className="block text-[10px] text-slate-400">{p.reference}</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {p.kind === "refund" ? "−" : ""}
                      {fmtMoney(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canBill && event.status !== "cancelled" && balance > 0 && (
            <ActionForm action={takeEventPayment} submitLabel="Record it" pendingLabel="Saving…">
              <input type="hidden" name="id" value={id} />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="What is it?">
                  <select name="kind" defaultValue={paid === 0 ? "advance" : "payment"} className={inputClass}>
                    <option value="advance">Deposit to hold the date</option>
                    <option value="payment">Payment</option>
                  </select>
                </Field>
                <Field label="How?">
                  <select name="method" defaultValue="bank_transfer" className={inputClass}>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount" hint={`${fmtMoney(balance)} outstanding`}>
                  <input
                    type="number"
                    name="amount"
                    min={0.01}
                    step="0.01"
                    required
                    defaultValue={paid === 0 ? depositDue : balance}
                    className={inputClass}
                  />
                </Field>
                <Field label="Reference" hint="Cheque or transfer number">
                  <input name="reference" maxLength={120} className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          )}

          {canBill && event.status === "cancelled" && paid > 0 && (
            <ActionForm action={takeEventPayment} submitLabel="Record a refund" pendingLabel="Saving…" submitClassName={secondaryButtonClass}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="kind" value="refund" />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Amount returned" hint={`${fmtMoney(paid)} was received`}>
                  <input type="number" name="amount" min={0.01} step="0.01" required className={inputClass} />
                </Field>
                <Field label="How?">
                  <select name="method" defaultValue="bank_transfer" className={inputClass}>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </ActionForm>
          )}

          {canBill && balance > 0 && (event.status === "confirmed" || event.status === "completed") && (
            <div className="mt-5 pt-5 border-t border-slate-100 space-y-5">
              <p className="text-xs text-slate-600">
                Three ways to bill the {fmtMoney(balance)} still owed. Each one puts it into the main billing module,
                so it is chased and reported like any other money.
              </p>

              <ActionForm
                action={billEventToCompany}
                submitLabel="Bill it to a company"
                pendingLabel="Billing…"
                submitClassName={secondaryButtonClass}
                confirmMessage="Put this event on the company's account?"
              >
                <input type="hidden" name="id" value={id} />
                <Field label="Company" hint="Falls due on their own payment terms and ages with their other debt">
                  <select name="company_id" defaultValue={event.company_id ?? ""} className={inputClass}>
                    <option value="">Choose a company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.payment_terms_days} day terms
                        {c.credit_limit !== null ? `, limit ${c.credit_limit}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>

              <ActionForm
                action={billEventToRoom}
                submitLabel="Bill it to a room"
                pendingLabel="Billing…"
                submitClassName={secondaryButtonClass}
                confirmMessage="Post this event to the guest's folio?"
              >
                <input type="hidden" name="id" value={id} />
                <Field
                  label="Stay"
                  hint="For a residential conference: it goes on the guest's folio and their invoice, posted to the master folio"
                >
                  <select name="booking_id" defaultValue={event.booking_id ?? ""} className={inputClass}>
                    <option value="">Choose a stay</option>
                    {residents.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.reference} — {b.guests?.full_name || b.contact_name} ({fmtDate(b.check_in)} →{" "}
                        {fmtDate(b.check_out)})
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>

              {can(session, "folio.invoice") && (
                <ActionForm
                  action={issueEventInvoice}
                  submitLabel="Issue a tax invoice for the event"
                  pendingLabel="Issuing…"
                  className="space-y-2"
                  confirmMessage="Issue a GST invoice for this event? The number is taken from the property's series and cannot be reused."
                  footer={
                    <span className="text-[11px] text-slate-500">
                      From the property&apos;s own invoice series, not a separate one.
                    </span>
                  }
                >
                  <input type="hidden" name="id" value={id} />
                </ActionForm>
              )}
            </div>
          )}

          {invoices.length > 0 && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <p className="text-[11px] text-slate-500 mb-2">Invoices raised for this event</p>
              <ul className="space-y-1 text-xs">
                {invoices.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <Link href={`/admin/events/${id}/invoice/${i.id}`} className="font-mono text-yellow-700 hover:underline">
                      {i.number}
                    </Link>
                    <Tag tone={i.status === "issued" ? "green" : "red"}>
                      {i.status === "issued" ? "Issued" : "Cancelled"}
                    </Tag>
                    <span className="ml-auto">{fmtMoney(i.grand_total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* ── The event order ── */}
      {canBook && (
        <Card className="p-5">
          <SectionTitle
            action={
              <Link href={`/admin/events/${id}/beo`} className="text-[11px] text-yellow-700 hover:underline">
                Print the event order
              </Link>
            }
          >
            Banquet event order
          </SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-4">
            What each department needs on the day. The kitchen reads the menu, the stewards read the service notes and
            the technicians read the audio-visual notes — so write for them, not for the file.
          </p>
          <ActionForm action={saveEventOrder} submitLabel="Save the event order" pendingLabel="Saving…">
            <input type="hidden" name="id" value={id} />
            <div className="grid lg:grid-cols-2 gap-4">
              <Field label="Menu and catering notes" hint="Dietary requirements, service times, the cake">
                <textarea name="menu_notes" rows={4} defaultValue={event.menu_notes} maxLength={4000} className={inputClass} />
              </Field>
              <Field label="Setting up" hint="Seating, staging, linen, signage, where the registration desk goes">
                <textarea name="beo_setup_notes" rows={4} defaultValue={event.beo_setup_notes} maxLength={4000} className={inputClass} />
              </Field>
              <Field label="Service" hint="How many stewards, when tea goes out, bar arrangements">
                <textarea name="beo_service_notes" rows={4} defaultValue={event.beo_service_notes} maxLength={4000} className={inputClass} />
              </Field>
              <Field label="Audio-visual" hint="Microphones, projector, who is testing it and when">
                <textarea name="beo_av_notes" rows={4} defaultValue={event.beo_av_notes} maxLength={4000} className={inputClass} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}

      {/* ── Details ── */}
      {canBook && event.status !== "cancelled" && (
        <Card className="p-5">
          <SectionTitle>Change the details</SectionTitle>
          {locked && (
            <Notice tone="info">
              This event has been billed, so the head count, the package, the hall charge and the discount can no
              longer change. Cancel the bill first if something really was wrong.
            </Notice>
          )}
          <ActionForm action={updateEvent} submitLabel="Save changes" pendingLabel="Saving…">
            <input type="hidden" name="id" value={id} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="What is it called?">
                <input name="title" required defaultValue={event.title} maxLength={120} className={inputClass} />
              </Field>
              <Field label="Kind of function">
                <select name="event_type" defaultValue={event.event_type} className={inputClass}>
                  {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Seating plan">
                <select name="layout_id" defaultValue={event.layout_id ?? ""} className={inputClass}>
                  <option value="">Not chosen</option>
                  {layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — seats {l.capacity}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date">
                <input type="date" name="event_date" required defaultValue={event.event_date} className={inputClass} />
              </Field>
              <Field label="From">
                <input type="time" name="start_time" required defaultValue={hhmm(event.start_time)} className={inputClass} />
              </Field>
              <Field label="To">
                <input type="time" name="end_time" required defaultValue={hhmm(event.end_time)} className={inputClass} />
              </Field>

              <Field label="People expected">
                <input type="number" name="pax_expected" min={1} required defaultValue={event.pax_expected} className={inputClass} />
              </Field>
              <Field label="Guaranteed" hint="What is billed even if fewer come">
                <input type="number" name="pax_guaranteed" min={0} defaultValue={event.pax_guaranteed} className={inputClass} />
              </Field>
              <Field label="Catering package" hint="Per head">
                <select name="package_id" defaultValue={event.package_id ?? ""} className={inputClass}>
                  <option value="">No catering</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmtMoney(p.price_per_head)} per head ({MEAL_PERIOD_LABELS[p.meal_period]})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Hall charge">
                <select name="rental_basis" defaultValue={event.rental_basis} className={inputClass}>
                  {Object.entries(RENTAL_BASIS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hours" hint="Only used for “By the hour”">
                <input type="number" name="rental_hours" min={0} step="0.25" defaultValue={event.rental_hours} className={inputClass} />
              </Field>
              <Field label="Agreed hall amount" hint="Only used for “Agreed amount”">
                <input
                  type="number"
                  name="rental_override"
                  min={0}
                  step="0.01"
                  defaultValue={event.rental_override ?? ""}
                  className={inputClass}
                />
              </Field>

              <Field label="Discount %" hint="Applied to every part, so the taxable value falls with it">
                <input
                  type="number"
                  name="discount_percent"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={event.discount_percent}
                  className={inputClass}
                />
              </Field>
              <Field label="Company">
                <select name="company_id" defaultValue={event.company_id ?? ""} className={inputClass}>
                  <option value="">Not a company booking</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contact name">
                <input name="contact_name" defaultValue={event.contact_name} maxLength={120} className={inputClass} />
              </Field>
              <Field label="Contact phone">
                <input name="contact_phone" defaultValue={event.contact_phone} maxLength={30} className={inputClass} />
              </Field>
              <Field label="Contact email">
                <input type="email" name="contact_email" defaultValue={event.contact_email} maxLength={120} className={inputClass} />
              </Field>
              <Field
                label="Payment terms"
                hint="Printed on the quotation and the contract. Defaulted from the company's account terms."
              >
                <input name="payment_terms" defaultValue={event.payment_terms} maxLength={500} className={inputClass} />
              </Field>
              <Field label="Linked stay" hint="For a residential conference">
                <select name="booking_id" defaultValue={event.booking_id ?? ""} className={inputClass}>
                  <option value="">Not linked to a stay</option>
                  {residents.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.reference} — {b.guests?.full_name || b.contact_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea name="notes" rows={2} defaultValue={event.notes} maxLength={2000} className={inputClass} />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
