import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, User, Star, Printer, LogIn, LogOut, Users, IdCard } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { loadCompanies } from "../../../../lib/rate-data";
import { loadFolio } from "../../../../lib/folio";
import { razorpayConfigured, isTestMode } from "../../../../lib/razorpay";
import { cancellationPenalty, noShowPenalty, describePenalty } from "../../../../lib/policies";
import { rankRooms } from "../../../../lib/room-assignment";
import { hoursUntil, todayIn } from "../../../../lib/dates";
import type {
  AuditEntry,
  Booking,
  Currency,
  Folio,
  GuestRequest,
  Invoice,
  LoyaltyTier,
  PaymentTransaction,
  RatePlan,
  Room,
  RoomType,
} from "../../../../lib/types";
import {
  BOOKING_SOURCE_LABELS,
  PAYMENT_METHOD_LABELS,
  ID_TYPE_LABELS,
  MEAL_PLAN_LABELS,
  REQUEST_KIND_LABELS,
} from "../../../../lib/types";
import {
  confirmBooking,
  cancelBooking,
  markNoShow,
  reinstateBooking,
  assignRoom,
  moveRoom,
  splitBooking,
  sendBookingEmail,
} from "../../../booking-actions";
import { createGuestRequest, updateGuestRequest, reissueKeys } from "../../../frontdesk-actions";
import {
  Card,
  StatusPill,
  Stat,
  Check,
  Notice,
  Tag,
  Field,
  SectionTitle,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  nightsBetween,
  inputClass,
  buttonClass,
  secondaryButtonClass,
  dangerButtonClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import LiveRefresh from "../../../components/LiveRefresh";
import FolioPanel from "./FolioPanel";
import BillingPanel from "./BillingPanel";
import SettlementPanel from "./SettlementPanel";
import EditBookingForm from "./EditBookingForm";

type FullBooking = Booking & { rate_plans: RatePlan | null; booking_groups: { id: string; reference: string; name: string } | null };

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkedIn?: string; checkedOut?: string; keys?: string; sent?: string; tab?: string }>;
}) {
  const session = await requireAnyPermission(["bookings.view", "frontdesk.view"]);
  const { id } = await params;
  const flags = await searchParams;
  const tab = (["overview", "folio", "edit", "activity"] as const).find((t) => t === flags.tab) ?? "overview";
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase
    .from("bookings")
    .select(
      "*, guests(id, full_name, email, phone, tags, blacklist_reason, loyalty_opt_in, loyalty_member_no, loyalty_tier), room_types(id, name), rooms(id, room_number), rate_plans(*), companies(id, name), booking_groups(id, reference, name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const booking = data as FullBooking;
  const today = todayIn(settings.timezone);

  const [
    { data: roomTypes },
    { data: plans },
    { data: rooms },
    { data: stays },
    { data: blocks },
    { data: history },
    { data: moves },
    { data: requests },
    { data: sent },
    { data: keyEvents },
    { data: identity },
    { data: card },
    { data: splits },
    companies,
    folio,
    { data: folios },
    { data: invoices },
    { data: payments },
    { data: currencyRows },
    { data: loyaltyTierRows },
    { data: pointsBalance },
  ] = await Promise.all([
    supabase.from("room_types").select("*").order("sort_order"),
    supabase.from("rate_plans").select("*").order("sort_order"),
    supabase.from("rooms").select("*").order("room_number"),
    supabase
      .from("bookings")
      .select("room_id, check_in, check_out")
      .in("status", ["tentative", "confirmed", "checked_in"])
      .neq("id", id)
      .not("room_id", "is", null)
      .lt("check_in", booking.check_out)
      .gt("check_out", booking.check_in),
    supabase.from("room_blocks").select("room_id, start_date, end_date").is("released_at", null),
    supabase
      .from("audit_log")
      .select("*")
      .eq("table_name", "bookings")
      .eq("record_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("room_moves")
      .select("*, from:rooms!room_moves_from_room_id_fkey(room_number), to:rooms!room_moves_to_room_id_fkey(room_number)")
      .eq("booking_id", id)
      .order("moved_at", { ascending: false }),
    supabase.from("guest_requests").select("*").eq("booking_id", id).order("created_at", { ascending: false }),
    supabase.from("notifications").select("*").eq("booking_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("key_card_events").select("*").eq("booking_id", id).order("created_at", { ascending: false }).limit(10),
    booking.guest_id
      ? supabase.rpc("guest_identity_masked", { p_guest: booking.guest_id })
      : Promise.resolve({ data: [] }),
    supabase.from("registration_cards").select("id, signed_at").eq("booking_id", id).maybeSingle(),
    supabase.from("bookings").select("id, reference, check_in, check_out").eq("split_from_id", id),
    loadCompanies(supabase),
    loadFolio(supabase, id),
    supabase.from("folios").select("*, companies(id, name)").eq("booking_id", id).order("created_at"),
    supabase.from("invoices").select("*").eq("booking_id", id).order("issued_at", { ascending: false }),
    supabase
      .from("payment_transactions")
      .select("*")
      .eq("booking_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("currencies").select("*").eq("is_active", true).order("code"),
    supabase.from("loyalty_tiers").select("*").order("sort_order"),
    booking.guest_id
      ? supabase.rpc("loyalty_balance", { p_guest: booking.guest_id })
      : Promise.resolve({ data: 0 }),
  ]);

  const plan = booking.rate_plans;
  const open = ["tentative", "confirmed", "waitlisted"].includes(booking.status);
  const inHouse = booking.status === "checked_in";
  const closed = ["checked_out", "cancelled", "no_show"].includes(booking.status);

  const hoursToArrival = hoursUntil(booking.check_in, settings.check_in_time, settings.timezone);
  const cancelPreview =
    booking.status === "waitlisted"
      ? { amount: 0, explanation: "Waitlisted — no penalty." }
      : cancellationPenalty(plan, booking.rate_breakdown ?? [], booking.rooms_count, hoursToArrival);
  const noShowPreview = noShowPenalty(plan, booking.rate_breakdown ?? [], booking.rooms_count);

  const { ranked, ineligible } = rankRooms(
    {
      roomTypeId: booking.room_type_id,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      adults: Math.ceil(booking.adults / booking.rooms_count),
      preferredFloor: booking.preferred_floor,
      preferredView: booking.preferred_view,
      isVip: booking.is_vip,
      forImmediateCheckIn: inHouse,
    },
    (rooms ?? []) as Room[],
    stays ?? [],
    blocks ?? [],
  );

  const idOnFile = (identity as { id_type: string; id_last4: string }[] | null)?.[0];
  const guestName = booking.guests?.full_name || booking.contact_name || "Unnamed guest";

  return (
    <>
      <LiveRefresh tables={["bookings", "folio_entries"]} />
      <Link
        href="/admin/bookings"
        className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Bookings
      </Link>

      {booking.guests?.tags?.includes("Blacklisted") && (
        <div className="mb-4">
          <Notice tone="error">
            This guest is blacklisted{booking.guests.blacklist_reason ? `: ${booking.guests.blacklist_reason}` : "."}
          </Notice>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            {booking.is_vip && <Star className="w-5 h-5 text-amber-500 fill-amber-400" aria-label="VIP" />}
            {guestName}
          </h1>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono">{booking.reference}</span>
            {booking.booking_groups && (
              <Link href={`/admin/groups/${booking.booking_groups.id}`} className="inline-flex items-center gap-1 text-yellow-700">
                <Users className="w-3 h-3" /> {booking.booking_groups.name} ({booking.booking_groups.reference})
              </Link>
            )}
            {booking.split_from_id && (
              <Link href={`/admin/bookings/${booking.split_from_id}`} className="text-yellow-700">
                split from earlier booking
              </Link>
            )}
            {booking.overbook_reason && <Tag tone="red">Overbooked: {booking.overbook_reason}</Tag>}
          </p>
        </div>
        <StatusPill status={booking.status} />
      </div>

      {flags.checkedIn && (
        <div className="mb-5">
          <Notice tone="ok">
            Checked in to room {booking.rooms?.room_number}. {flags.keys}
          </Notice>
        </div>
      )}
      {flags.checkedOut && (
        <div className="mb-5">
          <Notice tone="ok">Checked out. The room is marked dirty for housekeeping. {flags.sent}</Notice>
        </div>
      )}
      {booking.status === "tentative" && booking.hold_until && (
        <div className="mb-5">
          <Notice tone="warn">
            Tentative hold until {fmtDateTime(booking.hold_until)}. Night audit releases it after that unless it is confirmed.
          </Notice>
        </div>
      )}

      {/* ── Actions ── */}
      <Card className="p-4 mb-6">
          <div className="flex flex-wrap gap-2 items-start">
            {open && booking.status !== "waitlisted" && can(session, "frontdesk.checkin") && booking.check_in <= today && (
              <Link href={`/admin/bookings/${id}/check-in`} className={buttonClass}>
                <span className="flex items-center gap-1.5">
                  <LogIn className="w-3.5 h-3.5" /> Check in
                </span>
              </Link>
            )}
            {inHouse && can(session, "frontdesk.checkout") && (
              <Link href={`/admin/bookings/${id}/check-out`} className={buttonClass}>
                <span className="flex items-center gap-1.5">
                  <LogOut className="w-3.5 h-3.5" /> Check out
                </span>
              </Link>
            )}

            {["tentative", "waitlisted"].includes(booking.status) && can(session, "bookings.edit") && (
              <details className="relative">
                <summary className={`${secondaryButtonClass} list-none`}>
                  {booking.status === "waitlisted" ? "Promote & confirm" : "Confirm"}
                </summary>
                <div className="absolute z-10 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-md p-4">
                  <ActionForm action={confirmBooking} submitLabel="Confirm booking" className="space-y-3">
                    <input type="hidden" name="id" value={id} />
                    <Check name="send_confirmation" defaultChecked label="Send the confirmation to the guest" />
                    {can(session, "bookings.overbook") && (
                      <Field label="Overbooking reason (only if full)">
                        <input name="overbook_reason" className={inputClass} />
                      </Field>
                    )}
                  </ActionForm>
                </div>
              </details>
            )}

            {booking.status === "confirmed" && can(session, "bookings.edit") && (
              <ActionForm action={sendBookingEmail} submitLabel="Resend confirmation" pendingLabel="Sending…" submitClassName={secondaryButtonClass} className="">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="template" value="confirmation" />
              </ActionForm>
            )}

            {open && can(session, "bookings.cancel") && (
              <details className="relative">
                <summary className={`${dangerButtonClass} list-none`}>Cancel</summary>
                <div className="absolute z-10 mt-2 w-96 max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-md p-4">
                  <ActionForm
                    action={cancelBooking}
                    submitLabel="Cancel booking"
                    submitClassName={dangerButtonClass}
                    confirmMessage="Cancel this booking?"
                    className="space-y-3"
                  >
                    <input type="hidden" name="id" value={id} />
                    <p className="text-xs text-slate-700">
                      {cancelPreview.amount > 0 ? (
                        <>
                          Penalty: <strong>{fmtMoney(cancelPreview.amount)}</strong> — {cancelPreview.explanation}
                        </>
                      ) : (
                        cancelPreview.explanation
                      )}
                    </p>
                    <Field label="Reason">
                      <input name="reason" required className={inputClass} />
                    </Field>
                    {cancelPreview.amount > 0 && can(session, "bookings.waive_penalty") && (
                      <Check name="waive_penalty" label="Waive the penalty" />
                    )}
                    <Check name="notify_guest" defaultChecked label="Tell the guest" />
                  </ActionForm>
                </div>
              </details>
            )}

            {["tentative", "confirmed"].includes(booking.status) &&
              booking.check_in <= settings.business_date &&
              can(session, "bookings.cancel") && (
                <details className="relative">
                  <summary className={`${secondaryButtonClass} list-none`}>No-show</summary>
                  <div className="absolute z-10 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-md p-4">
                    <ActionForm action={markNoShow} submitLabel="Mark no-show" className="space-y-3">
                      <input type="hidden" name="id" value={id} />
                      <p className="text-xs text-slate-700">
                        {noShowPreview.amount > 0 ? `Penalty ${fmtMoney(noShowPreview.amount)}. ` : ""}
                        {noShowPreview.explanation}
                      </p>
                      {noShowPreview.amount > 0 && can(session, "bookings.waive_penalty") && (
                        <Check name="waive_penalty" label="Waive the penalty" />
                      )}
                    </ActionForm>
                  </div>
                </details>
              )}

            {["cancelled", "no_show"].includes(booking.status) && can(session, "bookings.edit") && (
              <ActionForm action={reinstateBooking} submitLabel="Reinstate" submitClassName={secondaryButtonClass} className="">
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            )}

            {card && (
              <Link href={`/admin/bookings/${id}/registration-card`} className={secondaryButtonClass}>
                <span className="flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Registration card
                </span>
              </Link>
            )}
            <Link href={`/admin/bookings/${id}/folio`} className={secondaryButtonClass}>
              <span className="flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Bill
              </span>
            </Link>
          </div>
        </Card>

      <nav className="flex gap-1 border-b border-slate-200 mb-6" aria-label="Booking sections">
        {[
          { key: "overview", label: "Overview" },
          { key: "folio", label: `Folio${folio.totals.balance > 0 ? ` · ${fmtMoney(folio.totals.balance)} due` : ""}` },
          { key: "edit", label: "Edit" },
          { key: "activity", label: "Activity" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/admin/bookings/${id}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              tab === t.key ? "border-yellow-500 text-slate-900 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {tab === "overview" && (<>
          {/* ── Stay ── */}
          <Card className="p-5">
            <SectionTitle>Stay</SectionTitle>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Arrival">{fmtDate(booking.check_in)}</Stat>
              <Stat label="Departure">{fmtDate(booking.check_out)}</Stat>
              <Stat label="Nights">{nightsBetween(booking.check_in, booking.check_out)}</Stat>
              <Stat label="Guests">
                {booking.adults} adult(s)
                {booking.children > 0 && `, ${booking.children} child(ren)`}
              </Stat>
              <Stat label="Room type">
                {booking.rooms_count} × {booking.room_types?.name ?? "—"}
              </Stat>
              <Stat label="Room">{booking.rooms?.room_number ?? "Unassigned"}</Stat>
              <Stat label="Rate plan">{plan ? `${plan.name} · ${MEAL_PLAN_LABELS[plan.meal_plan]}` : "—"}</Stat>
              <Stat label="Source">{BOOKING_SOURCE_LABELS[booking.source]}</Stat>
              <Stat label="Payment">{booking.payment_method ? PAYMENT_METHOD_LABELS[booking.payment_method] : "—"}</Stat>
              <Stat label="Company">{booking.companies?.name ?? "—"}</Stat>
              <Stat label="Total">{fmtMoney(booking.total_amount)}</Stat>
              <Stat label="Deposit due">{fmtMoney(booking.deposit_required)}</Stat>
              {booking.eta && <Stat label="ETA">{booking.eta.slice(0, 5)}</Stat>}
              {(booking.preferred_floor !== null || booking.preferred_view) && (
                <Stat label="Preference">
                  {[booking.preferred_floor !== null && `floor ${booking.preferred_floor}`, booking.preferred_view]
                    .filter(Boolean)
                    .join(", ")}
                </Stat>
              )}
              {booking.cancellation_reason && (
                <Stat label={booking.status === "no_show" ? "No-show" : "Cancelled"}>
                  {booking.cancellation_reason}
                  {booking.penalty_amount ? ` · penalty ${fmtMoney(booking.penalty_amount)}${booking.penalty_waived ? " (waived)" : ""}` : ""}
                </Stat>
              )}
            </dl>

            {plan && (
              <p className="mt-4 text-[11px] text-slate-600">
                {plan.is_refundable
                  ? `Free cancellation until ${plan.free_cancellation_hours} hours before arrival, then ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)}.`
                  : `Non-refundable: ${describePenalty(plan.cancellation_penalty, plan.cancellation_penalty_percent)}.`}{" "}
                No-show: {describePenalty(plan.no_show_penalty, plan.no_show_penalty_percent)}.
              </p>
            )}

            {(booking.rate_breakdown ?? []).length > 0 && (
              <details className="mt-3">
                <summary className="text-[11px] text-yellow-700 cursor-pointer">Nightly rates</summary>
                <ul className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs text-slate-700">
                  {booking.rate_breakdown.map((n) => (
                    <li key={n.date}>
                      {fmtDate(n.date)}: {fmtMoney(n.rate)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {booking.special_requests && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 font-semibold mb-1">Special requests</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{booking.special_requests}</p>
              </div>
            )}

            {(splits ?? []).length > 0 && (
              <p className="mt-4 text-xs text-slate-700">
                Continues as{" "}
                {(splits ?? []).map((s) => (
                  <Link key={s.id} href={`/admin/bookings/${s.id}`} className="text-yellow-700 font-mono mr-2">
                    {s.reference}
                  </Link>
                ))}
              </p>
            )}
          </Card>

          {/* ── Room ── */}
          {!closed && (can(session, "bookings.edit") || can(session, "frontdesk.checkin")) && (
            <Card className="p-5">
              <SectionTitle>{inHouse ? "Move room" : "Room assignment"}</SectionTitle>

              {inHouse ? (
                <ActionForm action={moveRoom} submitLabel="Move guest" className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="To room" hint="Vacant, inspected rooms of this type, best match first.">
                      <select name="room_id" required className={inputClass} defaultValue="">
                        <option value="" disabled>
                          Choose…
                        </option>
                        {ranked.map(({ room, reasons }) => (
                          <option key={room.id} value={room.id}>
                            {room.room_number}
                            {reasons.length ? ` — ${reasons.join(", ")}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reason">
                      <input name="reason" required placeholder="AC fault, guest request, upgrade…" className={inputClass} />
                    </Field>
                  </div>
                </ActionForm>
              ) : booking.rooms_count > 1 ? (
                <p className="text-sm text-slate-700">
                  This booking holds {booking.rooms_count} rooms. Split it into one booking per room (below) to assign each room.
                </p>
              ) : (
                <div className="space-y-4">
                  <ActionForm action={assignRoom} submitLabel="Assign" className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={id} />
                    <div className="flex-1 min-w-[220px]">
                      <Field label="Room">
                        <select name="room_id" defaultValue={booking.room_id ?? ""} className={inputClass}>
                          <option value="">Unassigned</option>
                          {booking.room_id && booking.rooms && (
                            <option value={booking.room_id}>{booking.rooms.room_number} (current)</option>
                          )}
                          {ranked
                            .filter(({ room }) => room.id !== booking.room_id)
                            .map(({ room, reasons }) => (
                              <option key={room.id} value={room.id}>
                                {room.room_number}
                                {reasons.length ? ` — ${reasons.join(", ")}` : ""}
                              </option>
                            ))}
                        </select>
                      </Field>
                    </div>
                  </ActionForm>
                  <ActionForm action={assignRoom} submitLabel="Auto-assign best room" submitClassName={secondaryButtonClass} className="">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="auto" value="1" />
                  </ActionForm>
                </div>
              )}

              {ineligible.length > 0 && (
                <details className="mt-3">
                  <summary className="text-[11px] text-slate-500 cursor-pointer">
                    {ineligible.length} room(s) of this type not offered
                  </summary>
                  <ul className="mt-2 text-xs text-slate-600 space-y-0.5">
                    {ineligible.map(({ room, why }) => (
                      <li key={room.id}>
                        {room.room_number}: {why}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {can(session, "bookings.edit") && ["tentative", "confirmed", "checked_in"].includes(booking.status) && (
                <details className="mt-5 pt-4 border-t border-slate-100">
                  <summary className="text-xs text-yellow-700 cursor-pointer">Split this booking</summary>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <ActionForm action={splitBooking} submitLabel="Split by date" submitClassName={secondaryButtonClass} className="space-y-3">
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="mode" value="date" />
                      <Field label="Second part starts" hint="For a room or rate change part-way through the stay.">
                        <input type="date" name="split_date" min={booking.check_in} max={booking.check_out} className={inputClass} />
                      </Field>
                    </ActionForm>
                    {booking.rooms_count > 1 && !inHouse && (
                      <ActionForm action={splitBooking} submitLabel="One booking per room" submitClassName={secondaryButtonClass} className="space-y-3">
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="mode" value="rooms" />
                        <p className="text-xs text-slate-700">
                          Turns this {booking.rooms_count}-room booking into {booking.rooms_count} bookings of one room each.
                        </p>
                      </ActionForm>
                    )}
                  </div>
                </details>
              )}

              {(moves ?? []).length > 0 && (
                <ul className="mt-4 text-xs text-slate-700 space-y-1">
                  {(moves ?? []).map((m) => (
                    <li key={m.id}>
                      {fmtDateTime(m.moved_at)}: {(m.from as { room_number: string } | null)?.room_number ?? "—"} →{" "}
                      {(m.to as { room_number: string } | null)?.room_number ?? "—"} · {m.reason}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* ── Requests ── */}
          {can(session, "frontdesk.requests") && (inHouse || open) && (
            <Card className="p-5">
              <SectionTitle>Requests &amp; messages</SectionTitle>
              {((requests ?? []) as GuestRequest[]).length > 0 && (
                <ul className="mb-4 space-y-2">
                  {((requests ?? []) as GuestRequest[]).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Tag tone={r.status === "open" ? "amber" : "neutral"}>{REQUEST_KIND_LABELS[r.kind]}</Tag>
                      <span className={r.status === "open" ? "text-slate-900" : "text-slate-500 line-through"}>{r.description}</span>
                      {r.due_at && <span className="text-[11px] text-slate-500">due {fmtDateTime(r.due_at)}</span>}
                      {r.status === "open" && (
                        <form action={updateGuestRequest} className="ml-auto">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="status" value="done" />
                          <button className="text-[11px] text-yellow-700 cursor-pointer">Mark done</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={createGuestRequest} submitLabel="Log" className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <input type="hidden" name="booking_id" value={id} />
                <Field label="Type">
                  <select name="kind" className={inputClass} defaultValue="request">
                    {Object.entries(REQUEST_KIND_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Details">
                    <input name="description" required className={inputClass} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Date">
                    <input type="date" name="due_date" defaultValue={today} className={inputClass} />
                  </Field>
                  <Field label="Time">
                    <input type="time" name="due_time" className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </Card>
          )}
          </>)}

          {/* ── Folio ── */}
          {tab === "folio" && (
            <div className="space-y-5">
              <FolioPanel
                bookingId={id}
                entries={folio.entries}
                totals={folio.totals}
                depositRequired={Number(booking.deposit_required)}
                canPay={can(session, "folio.payment")}
                canPost={can(session, "folio.post")}
                canAdjust={can(session, "folio.adjust")}
                today={today}
              />
              <BillingPanel
                bookingId={id}
                folios={(folios ?? []) as Folio[]}
                entries={folio.entries}
                invoices={(invoices ?? []) as Invoice[]}
                payments={(payments ?? []) as PaymentTransaction[]}
                companies={companies}
                balance={folio.totals.balance}
                depositRequired={Number(booking.deposit_required)}
                depositPaid={folio.totals.deposits}
                refundThreshold={Number(settings.refund_approval_threshold)}
                gatewayReady={razorpayConfigured() && settings.online_payments_enabled}
                gatewayTestMode={isTestMode()}
                canInvoice={can(session, "folio.invoice")}
                canPay={can(session, "folio.payment")}
                canAdjust={can(session, "folio.adjust")}
              />
              <SettlementPanel
                bookingId={id}
                guestId={booking.guest_id}
                guestName={booking.contact_name}
                memberNo={booking.guests?.loyalty_member_no ?? null}
                folios={(folios ?? []) as Folio[]}
                entries={folio.entries}
                companies={companies}
                currencies={(currencyRows ?? []) as Currency[]}
                baseCurrency={settings.currency}
                multiCurrency={settings.multi_currency_enabled}
                tiers={(loyaltyTierRows ?? []) as LoyaltyTier[]}
                tierKey={booking.guests?.loyalty_opt_in ? (booking.guests?.loyalty_tier ?? null) : null}
                pointsBalance={Number(pointsBalance ?? 0)}
                minRedeem={settings.loyalty_min_redeem_points}
                programName={settings.loyalty_program_name}
                loyaltyEnabled={settings.loyalty_enabled}
                canCityLedger={can(session, "folio.city_ledger")}
                canPay={can(session, "folio.payment")}
                canRedeem={can(session, "loyalty.redeem")}
              />
            </div>
          )}

          {/* ── Amend ── */}
          {tab === "edit" && (closed || !can(session, "bookings.edit") ? (
            <Card className="p-5"><p className="text-sm text-slate-500">This booking is closed and can no longer be changed.</p></Card>
          ) : (
            <Card className="p-5">
              <SectionTitle>Edit booking</SectionTitle>
              <p className="text-[11px] text-slate-500 -mt-2 mb-4">
                Date, room and rate changes are recorded with your name and the time under Activity.
              </p>
              <EditBookingForm
                booking={booking}
                roomTypes={(roomTypes ?? []) as RoomType[]}
                plans={(plans ?? []) as RatePlan[]}
                companies={companies}
                canOverbook={can(session, "bookings.overbook")}
              />
            </Card>
          ))}

          {/* ── Activity ── */}
          {tab === "activity" && (<>
          <Card className="p-5">
            <SectionTitle>Messages sent</SectionTitle>
            {(sent ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">Nothing sent yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {(sent ?? []).map((n) => (
                  <li key={n.id}>
                    <span className="text-slate-900">
                      {n.channel === "email" ? "Email" : "SMS"} · {n.template.replace(/_/g, " ")}
                    </span>{" "}
                    <Tag tone={n.status === "sent" ? "green" : n.status === "failed" ? "red" : "neutral"}>{n.status}</Tag>
                    <span className="block text-slate-500">
                      {fmtDateTime(n.created_at)} → {n.recipient}
                      {n.error ? ` · ${n.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5 text-sm">
            <Stat label="Created">{fmtDateTime(booking.created_at)}</Stat>
            <div className="mt-3">
              <Stat label="Last updated">{fmtDateTime(booking.updated_at)}</Stat>
            </div>
            {booking.checked_in_at && (
              <div className="mt-3">
                <Stat label="Checked in">{fmtDateTime(booking.checked_in_at)}</Stat>
              </div>
            )}
            {booking.checked_out_at && (
              <div className="mt-3">
                <Stat label="Checked out">{fmtDateTime(booking.checked_out_at)}</Stat>
              </div>
            )}
          </Card>
          {can(session, "audit.view") && (
            <Card className="p-5">
              <SectionTitle>History</SectionTitle>
              <HistoryList
                entries={(history ?? []) as AuditEntry[]}
                names={
                  new Map<string, string>([
                    ...((rooms ?? []) as Room[]).map((r) => [r.id, `room ${r.room_number}`] as [string, string]),
                    ...((roomTypes ?? []) as RoomType[]).map((t) => [t.id, t.name] as [string, string]),
                    ...((plans ?? []) as RatePlan[]).map((p) => [p.id, p.name] as [string, string]),
                    ...companies.map((c) => [c.id, c.name] as [string, string]),
                  ])
                }
              />
            </Card>
          )}
          </>)}
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Guest</SectionTitle>
            <div className="space-y-3 text-sm">
              <p className="flex items-start gap-2 text-slate-700">
                <User className="w-4 h-4 text-yellow-700 shrink-0 mt-0.5" />
                <span>
                  {booking.contact_name || booking.guests?.full_name || "—"}
                  {booking.guest_id && can(session, "guests.view") && (
                    <Link href={`/admin/guests/${booking.guest_id}`} className="block text-xs text-yellow-700 hover:text-yellow-800 mt-0.5">
                      Guest profile &amp; history
                    </Link>
                  )}
                </span>
              </p>
              {(booking.contact_phone || booking.guests?.phone) && (
                <a href={`tel:${booking.contact_phone || booking.guests?.phone}`} className="flex items-start gap-2 text-yellow-700 hover:text-yellow-800">
                  <Phone className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{booking.contact_phone || booking.guests?.phone}</span>
                </a>
              )}
              {(booking.contact_email || booking.guests?.email) && (
                <a href={`mailto:${booking.contact_email || booking.guests?.email}`} className="flex items-start gap-2 text-yellow-700 hover:text-yellow-800 break-all">
                  <Mail className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{booking.contact_email || booking.guests?.email}</span>
                </a>
              )}
              <p className="flex items-start gap-2 text-slate-700">
                <IdCard className="w-4 h-4 text-yellow-700 shrink-0 mt-0.5" />
                <span>
                  {idOnFile ? `${ID_TYPE_LABELS[idOnFile.id_type] ?? idOnFile.id_type} ending ${idOnFile.id_last4}` : "No ID on file"}
                  {booking.guest_id && can(session, "guests.view_id") && (
                    <Link href={`/admin/bookings/${id}/identity`} className="block text-xs text-yellow-700 hover:text-yellow-800 mt-0.5">
                      View ID &amp; scans
                    </Link>
                  )}
                </span>
              </p>
            </div>
          </Card>

          {inHouse && can(session, "frontdesk.checkin") && (
            <Card className="p-5">
              <SectionTitle>Key cards</SectionTitle>
              <ActionForm action={reissueKeys} submitLabel="Issue keys" submitClassName={secondaryButtonClass} className="flex items-end gap-2">
                <input type="hidden" name="booking_id" value={id} />
                <Field label="Cards">
                  <input type="number" name="cards" min={1} max={10} defaultValue={1} className={`${inputClass} w-20`} />
                </Field>
              </ActionForm>
              {(keyEvents ?? []).length > 0 && (
                <ul className="mt-3 text-[11px] text-slate-600 space-y-0.5">
                  {(keyEvents ?? []).map((k) => (
                    <li key={k.id}>
                      {fmtDateTime(k.created_at)} · {k.action} {k.cards} · {k.status}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

        </div>
      </div>
    </>
  );
}

/** Readable labels for the fields that appear in booking history. */
const FIELD_LABELS: Record<string, string> = {
  check_in: "arrival",
  check_out: "departure",
  room_id: "room",
  room_type_id: "room type",
  rate_plan_id: "rate plan",
  quoted_rate: "nightly rate",
  total_amount: "total",
  rate_breakdown: "nightly rates",
  rooms_count: "rooms",
  status: "status",
  payment_method: "payment method",
  overbook_reason: "overbooking reason",
};

function HistoryList({ entries, names }: { entries: AuditEntry[]; names: Map<string, string> }) {
  if (entries.length === 0) return <p className="text-sm text-slate-500">No changes recorded.</p>;
  const show = (v: unknown) =>
    v === null || v === undefined || v === ""
      ? "—"
      : Array.isArray(v) || typeof v === "object"
        ? "…"
        : (names.get(String(v)) ?? String(v).replace(/_/g, " "));

  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="text-xs border-l-2 border-slate-200 pl-3">
          <p className="text-slate-900">
            {e.action === "insert"
              ? "Booking created"
              : e.changed
                  .filter((k) => !["updated_at", "hold_until", "confirmation_sent_at"].includes(k))
                  .map((k) => (
                    <span key={k} className="mr-3 inline-block">
                      {FIELD_LABELS[k] ?? k.replace(/_/g, " ")}: {show(e.before?.[k])} → <strong className="font-medium">{show(e.after?.[k])}</strong>
                    </span>
                  ))}
            {e.summary}
          </p>
          <p className="text-slate-500 mt-0.5">
            {e.actor_name} · {fmtDateTime(e.occurred_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}
