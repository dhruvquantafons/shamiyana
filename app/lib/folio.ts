import type { SupabaseClient } from "@supabase/supabase-js";
import type { Booking, FolioEntry, PropertySettings } from "./types";
import { rateForNight } from "./pricing";
import { splitRoomTax } from "./tax";
import { taxSlabsOf } from "./settings";
import { eachNight } from "./dates";
import { folioTotals } from "./policies";

type ChargeableBooking = Pick<
  Booking,
  "id" | "check_in" | "check_out" | "rooms_count" | "rate_breakdown" | "quoted_rate"
> & { rooms?: { room_number: string } | null };

/**
 * Posts the room charge (and its tax) for each given night that has not been
 * charged yet. Night audit uses it for one night across every in-house
 * booking; check-out uses it to catch any night an audit missed.
 *
 * A unique index guarantees one room charge per booking per night, so a
 * retry can never double-charge.
 */
export async function postRoomCharges(
  supabase: SupabaseClient,
  bookings: ChargeableBooking[],
  nights: (b: ChargeableBooking) => string[],
  settings: PropertySettings,
  staffId: string,
  auditDate: string | null = null,
): Promise<{ posted: number; revenue: number; tax: number; error: string | null }> {
  if (bookings.length === 0) return { posted: 0, revenue: 0, tax: 0, error: null };

  const { data: existing } = await supabase
    .from("folio_entries")
    .select("booking_id, stay_date")
    .eq("kind", "room")
    .is("voided_at", null)
    .in("booking_id", bookings.map((b) => b.id));

  const done = new Set((existing ?? []).map((e) => `${e.booking_id}:${e.stay_date}`));
  const slabs = taxSlabsOf(settings);
  const rows: Record<string, unknown>[] = [];
  let revenue = 0;
  let tax = 0;

  for (const b of bookings) {
    for (const night of nights(b)) {
      if (done.has(`${b.id}:${night}`)) continue;
      const rate = rateForNight(b.rate_breakdown, night, b.quoted_rate);
      // Slabs apply per room per night, so split one room's rate then scale.
      const split = splitRoomTax(rate, slabs, settings.tax_inclusive);
      const net = Math.round(split.net * b.rooms_count * 100) / 100;
      const t = Math.round(split.tax * b.rooms_count * 100) / 100;
      revenue += net;
      tax += t;
      rows.push({
        booking_id: b.id,
        kind: "room",
        description: `${b.rooms?.room_number ? `Room ${b.rooms.room_number}` : "Room"} — night of ${night}${b.rooms_count > 1 ? ` × ${b.rooms_count}` : ""}`,
        stay_date: night,
        amount: net,
        tax_amount: t,
        tax_rate: split.rate,
        night_audit_date: auditDate,
        created_by: staffId,
      });
    }
  }

  if (rows.length === 0) return { posted: 0, revenue: 0, tax: 0, error: null };
  const { error } = await supabase.from("folio_entries").insert(rows);
  return {
    posted: error ? 0 : rows.length,
    revenue: error ? 0 : revenue,
    tax: error ? 0 : tax,
    error: error?.message ?? null,
  };
}

/** Nights of a stay up to, not including, `until`. */
export function nightsBefore(b: Pick<Booking, "check_in" | "check_out">, until: string) {
  return eachNight(b.check_in, b.check_out < until ? b.check_out : until);
}

export async function loadFolio(supabase: SupabaseClient, bookingId: string) {
  const { data } = await supabase
    .from("folio_entries")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at");
  const entries = (data ?? []) as FolioEntry[];
  return { entries, totals: folioTotals(entries) };
}

/** Folio lines grouped for the guest's bill. */
export function billLines(entries: FolioEntry[], taxLabel: string) {
  const live = entries.filter((e) => !e.voided_at);
  const sum = (kinds: string[], field: "amount" | "tax_amount" = "amount") =>
    live.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + Number(e[field]), 0);

  const lines = [
    { label: "Room charges", amount: sum(["room"]) },
    { label: taxLabel, amount: sum(["room", "fee", "extra", "penalty"], "tax_amount") },
    { label: "Fees", amount: sum(["fee"]) },
    { label: "Extras", amount: sum(["extra"]) },
    { label: "Penalties", amount: sum(["penalty"]) },
    { label: "Refunds", amount: sum(["refund"]) },
    { label: "Payments received", amount: -sum(["payment", "adjustment"]) },
  ];
  return lines.filter((l) => l.amount !== 0).map((l) => ({ ...l, amount: Math.round(l.amount * 100) / 100 }));
}
