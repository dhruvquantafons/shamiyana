import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requirePermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import { getSettings, hhmm } from "../../../../../lib/settings";
import { loadFolio } from "../../../../../lib/folio";
import { rankRooms } from "../../../../../lib/room-assignment";
import { timingFee, isEarly } from "../../../../../lib/policies";
import { rateForNight } from "../../../../../lib/pricing";
import { todayIn, nowTimeIn } from "../../../../../lib/dates";
import type { Booking, Room } from "../../../../../lib/types";
import { Card, Notice, fmtDate, fmtMoney } from "../../../../components/ui";
import CheckInForm from "./CheckInForm";

export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("frontdesk.checkin");
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data } = await supabase
    .from("bookings")
    .select("*, guests(id, full_name, email, phone, tags, blacklist_reason), room_types(id, name), rooms(id, room_number)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const booking = data as Booking;
  if (booking.status === "checked_in") redirect(`/admin/bookings/${id}`);

  const today = todayIn(settings.timezone);
  const now = nowTimeIn(settings.timezone);

  const [{ data: rooms }, { data: stays }, { data: blocks }, { data: guest }, folio] = await Promise.all([
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
    booking.guest_id
      ? supabase.from("guests").select("nationality, address").eq("id", booking.guest_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadFolio(supabase, id),
  ]);

  const { ranked, ineligible } = rankRooms(
    {
      roomTypeId: booking.room_type_id,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      adults: booking.adults,
      preferredFloor: booking.preferred_floor,
      preferredView: booking.preferred_view,
      isVip: booking.is_vip,
      forImmediateCheckIn: true,
    },
    (rooms ?? []) as Room[],
    stays ?? [],
    blocks ?? [],
  );

  // Keep the pre-assigned room selected if it is ready; otherwise suggest the best.
  const assignedReady = ranked.find((r) => r.room.id === booking.room_id);
  const suggested = assignedReady?.room.id ?? ranked[0]?.room.id ?? "";

  const early = booking.check_in === today && isEarly(now, settings.check_in_time);
  const earlyFee = early
    ? timingFee(
        settings.early_checkin_fee_type,
        Number(settings.early_checkin_fee_value),
        rateForNight(booking.rate_breakdown, booking.check_in, booking.quoted_rate),
      )
    : 0;

  const blockers: string[] = [];
  if (!["tentative", "confirmed"].includes(booking.status)) blockers.push(`This booking is ${booking.status.replace("_", " ")}.`);
  if (booking.check_in > today) blockers.push(`Arrival is ${fmtDate(booking.check_in)}. Amend the dates to check in early.`);
  if (booking.check_out <= today) blockers.push("The stay has already ended.");
  if (booking.rooms_count > 1) blockers.push("Split this booking into one booking per room first (booking page → Split).");

  return (
    <>
      <Link
        href={`/admin/bookings/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {booking.reference}
      </Link>

      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Check in {booking.contact_name}</h1>
      <p className="text-sm text-slate-600 mt-1 mb-6">
        {booking.room_types?.name} · {fmtDate(booking.check_in)} → {fmtDate(booking.check_out)} · {booking.adults} adult(s)
        {booking.children ? `, ${booking.children} child(ren)` : ""} · check-in time {hhmm(settings.check_in_time)}
      </p>

      {booking.guests?.tags?.includes("Blacklisted") && (
        <div className="mb-4">
          <Notice tone="error">
            This guest is blacklisted{booking.guests.blacklist_reason ? `: ${booking.guests.blacklist_reason}` : "."} Check with a
            manager before checking them in.
          </Notice>
        </div>
      )}

      {blockers.length > 0 ? (
        <Notice tone="error">
          {blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </Notice>
      ) : (
        <Card className="p-5 max-w-4xl">
          <CheckInForm
            bookingId={id}
            guestName={booking.guests?.full_name || booking.contact_name}
            nationality={(guest as { nationality?: string } | null)?.nationality ?? "Indian"}
            address={(guest as { address?: string } | null)?.address ?? ""}
            rooms={ranked.map(({ room, reasons }) => ({ id: room.id, label: `${room.room_number}${reasons.length ? ` — ${reasons.join(", ")}` : ""}` }))}
            notReady={ineligible.map(({ room, why }) => `${room.room_number}: ${why}`)}
            suggestedRoom={suggested}
            depositRequired={Number(booking.deposit_required)}
            paid={folio.totals.payments}
            guaranteed={booking.payment_method === "corporate_billing" || booking.payment_method === "ota_prepaid"}
            earlyFee={earlyFee}
            earlyTime={early ? now : null}
            canTakePayment={can(session, "folio.payment")}
            fmt={{ deposit: fmtMoney(booking.deposit_required), paid: fmtMoney(folio.totals.payments), earlyFee: fmtMoney(earlyFee) }}
          />
        </Card>
      )}
    </>
  );
}
