"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { getCurrentProperty } from "../lib/properties";
import { friendlyDbError } from "../lib/db-errors";
import { noShowPenalty } from "../lib/policies";
import { postRoomCharges } from "../lib/folio";
import { addDays, zonedTime } from "../lib/dates";
import { escalateOverdueTickets } from "../lib/staff-alerts";
import type { Booking, FolioEntry, RatePlan } from "../lib/types";
import { type ActionState, bool } from "./form-utils";

/**
 * Night audit (SOW Module 2): closes the hotel's business day.
 *
 *   1. Posts room charges and tax for every in-house guest for the night.
 *   2. Marks expected arrivals who never came as no-shows (optional), posting
 *      the rate plan's no-show penalty.
 *   3. Releases tentative holds that have expired.
 *   4. Closes the day's folio entries (the cashier shifts).
 *   5. Syncs room availability with room blocks for tomorrow, schedules
 *      due deep cleans and preventive maintenance, and escalates overdue
 *      maintenance tickets.
 *   6. Purges identity scans past the retention period, retires expired
 *      loyalty points, re-checks every member's tier and totals the outlet
 *      takings.
 *   7. Stores the daily revenue report and rolls the business date forward.
 *
 * Each step is idempotent, so a run that fails part-way can be run again.
 */
export async function runNightAudit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("frontdesk.night_audit");
  const supabase = await createClient();
  const settings = await getSettings();
  const day = settings.business_date;
  const nextDay = addDays(day, 1);
  const staffId = session.staff.id;

  if (!bool(fd, "confirm")) return { error: `Tick the box to confirm closing ${day}.` };

  // Each property closes its own day, so every lookup here is keyed by both
  // (the primary key became (property_id, business_date) in 0024). Without the
  // property, a group owner with two hotels open would match two rows.
  const property = await getCurrentProperty();
  if (!property) return { error: "No property is selected." };

  const { data: existing } = await supabase
    .from("night_audits")
    .select("status")
    .eq("property_id", property.id)
    .eq("business_date", day)
    .maybeSingle();
  if (existing?.status === "completed") {
    return { error: `${day} has already been closed.` };
  }

  const { error: startError } = await supabase.from("night_audits").upsert(
    {
      property_id: property.id,
      business_date: day,
      status: "running",
      started_by: staffId,
      started_at: new Date().toISOString(),
      error: "",
    },
    { onConflict: "property_id,business_date" },
  );
  if (startError) return { error: friendlyDbError(startError.message) };

  const fail = async (message: string) => {
    await supabase.from("night_audits").update({ status: "failed", error: message })
      .eq("property_id", property.id)
      .eq("business_date", day);
    return { error: `Night audit stopped: ${friendlyDbError(message)} Fix the problem and run it again.` };
  };

  // ── 1. Room charges ──
  const { data: inHouseData, error: inHouseError } = await supabase
    .from("bookings")
    .select("id, reference, check_in, check_out, rooms_count, rate_breakdown, quoted_rate, contact_name, rooms(room_number)")
    .eq("status", "checked_in")
    .lte("check_in", day)
    .gt("check_out", day);
  if (inHouseError) return fail(inHouseError.message);

  const inHouse = (inHouseData ?? []) as unknown as (Booking & { rooms: { room_number: string } | null })[];
  const charges = await postRoomCharges(supabase, inHouse, () => [day], settings, staffId, day);
  if (charges.error) return fail(charges.error);

  // ── 2. No-shows ──
  const { data: dueData } = await supabase
    .from("bookings")
    .select("id, reference, contact_name, rooms_count, rate_breakdown, rate_plans(*)")
    .in("status", ["tentative", "confirmed"])
    .lte("check_in", day);
  const due = (dueData ?? []) as unknown as (Booking & { rate_plans: RatePlan | null })[];

  const noShows: { reference: string; guest: string; penalty: number }[] = [];
  if (bool(fd, "mark_no_shows") && can(session, "bookings.cancel")) {
    for (const b of due) {
      const penalty = noShowPenalty(b.rate_plans, b.rate_breakdown ?? [], b.rooms_count);
      const { error } = await supabase
        .from("bookings")
        .update({
          status: "no_show",
          cancelled_at: new Date().toISOString(),
          cancelled_by: staffId,
          cancellation_reason: `No-show at night audit for ${day}`,
          penalty_amount: penalty.amount,
          hold_until: null,
        })
        .eq("id", b.id)
        .in("status", ["tentative", "confirmed"]);
      if (error) return fail(error.message);
      if (penalty.amount > 0) {
        await supabase.from("folio_entries").insert({
          booking_id: b.id,
          kind: "penalty",
          description: penalty.explanation,
          amount: penalty.amount,
          night_audit_date: day,
          created_by: staffId,
        });
      }
      noShows.push({ reference: b.reference, guest: b.contact_name, penalty: penalty.amount });
    }
  }

  // ── 3. Expired holds ──
  const { data: expired } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: staffId,
      cancellation_reason: "Tentative hold expired",
      hold_until: null,
    })
    .eq("status", "tentative")
    .lt("hold_until", new Date().toISOString())
    .gt("check_in", day)
    .select("reference, contact_name");

  // ── Exceptions for the manager ──
  const { data: overstays } = await supabase
    .from("bookings")
    .select("reference, contact_name, check_out, rooms(room_number)")
    .eq("status", "checked_in")
    .lte("check_out", day);

  // ── 4. Close the day's folio entries ──
  const { error: closeError } = await supabase.rpc("close_folio_day", { p_date: day });
  if (closeError) return fail(closeError.message);

  const { data: dayEntries } = await supabase
    .from("folio_entries")
    .select("kind, amount, tax_amount, method, created_by, voided_at, staff:created_by(full_name, email)")
    .eq("night_audit_date", day)
    .is("voided_at", null);

  type DayEntry = Pick<FolioEntry, "kind" | "amount" | "tax_amount" | "method"> & {
    created_by: string | null;
    staff: { full_name: string; email: string } | null;
  };
  const entries = (dayEntries ?? []) as unknown as DayEntry[];
  const sumKind = (kinds: string[], field: "amount" | "tax_amount" = "amount") =>
    Math.round(entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + Number(e[field]), 0) * 100) / 100;

  const byMethod: Record<string, number> = {};
  const byCashier: Record<string, number> = {};
  for (const e of entries) {
    if (e.kind !== "payment" && e.kind !== "refund") continue;
    const signed = e.kind === "refund" ? -Number(e.amount) : Number(e.amount);
    const method = e.method ?? "other";
    byMethod[method] = Math.round(((byMethod[method] ?? 0) + signed) * 100) / 100;
    const who = e.staff?.full_name || e.staff?.email || "System";
    byCashier[who] = Math.round(((byCashier[who] ?? 0) + signed) * 100) / 100;
  }

  // ── 5. Room blocks → room availability for tomorrow ──
  const [{ data: rooms }, { data: blocks }] = await Promise.all([
    supabase.from("rooms").select("id, status"),
    supabase
      .from("room_blocks")
      .select("room_id, kind, start_date, end_date")
      .is("released_at", null)
      .lte("start_date", nextDay),
  ]);
  const activeBlock = new Map(
    (blocks ?? [])
      .filter((b) => b.end_date === null || b.end_date >= nextDay)
      .map((b) => [b.room_id as string, b.kind as string]),
  );
  let blocksApplied = 0;
  for (const room of rooms ?? []) {
    if (room.status === "occupied") continue;
    const kind = activeBlock.get(room.id);
    const target = kind ?? "available";
    if (room.status !== target) {
      const { error } = await supabase.from("rooms").update({ status: target }).eq("id", room.id);
      if (!error) blocksApplied += 1;
    }
  }

  // ── 5b. Tomorrow's housekeeping list: due deep cleans ──
  const { data: hkCreated } = await supabase.rpc("hk_generate_tasks", { p_date: nextDay });

  // ── 5c. Preventive maintenance due tomorrow; tickets past their target ──
  const { data: mtCreated } = await supabase.rpc("mt_generate_preventive", { p_date: nextDay });
  const mtEscalated = await escalateOverdueTickets(supabase, staffId);

  // ── 6. Identity document retention ──
  let purged = 0;
  if (can(session, "guests.view_id")) {
    const cutoff = new Date(Date.now() - settings.id_document_retention_days * 86400000).toISOString();
    const { data: old } = await supabase
      .from("guest_documents")
      .select("id, storage_path")
      .lt("uploaded_at", cutoff)
      .limit(500);
    if (old?.length) {
      const { error } = await supabase.storage.from("guest-documents").remove(old.map((d) => d.storage_path));
      if (!error) {
        await supabase.from("guest_documents").delete().in("id", old.map((d) => d.id));
        purged = old.length;
      }
    }
  }

  // ── 6b. Loyalty: retire expired points, re-check every member's tier ──
  //
  // Both are idempotent. Expiry only touches lots whose date has already
  // passed, and a tier review that finds nothing to change writes nothing,
  // so re-running a failed audit cannot double-count either.
  let pointsExpired = 0;
  let tiersReviewed = 0;
  if (settings.loyalty_enabled) {
    const { data: expiredPoints } = await supabase.rpc("loyalty_expire_points", { p_date: day });
    pointsExpired = Number(expiredPoints ?? 0);
    const { data: reviewed } = await supabase.rpc("loyalty_evaluate_all", { p_date: day });
    tiersReviewed = Number(reviewed ?? 0);
  }

  // ── 6c. Outlet takings ──
  //
  // A bill charged to a room already shows up in the folio figures below, but
  // one settled with cash at the restaurant never touches a folio. Without
  // this the daily revenue report would quietly understate the day's trade.
  const { data: posRows } = await supabase
    .from("pos_orders")
    .select("id, grand_total, pos_outlets(name), pos_payments(kind, amount, voided_at)")
    .eq("status", "settled")
    .gte("closed_at", zonedTime(day, "00:00", settings.timezone).toISOString())
    .lt("closed_at", zonedTime(nextDay, "00:00", settings.timezone).toISOString());

  const outletTakings: Record<string, number> = {};
  const outletByMethod: Record<string, number> = {};
  let posTotal = 0;
  for (const row of posRows ?? []) {
    const order = row as unknown as {
      grand_total: number;
      pos_outlets: { name: string } | null;
      pos_payments: { kind: string; amount: number; voided_at: string | null }[];
    };
    const name = order.pos_outlets?.name ?? "Outlet";
    outletTakings[name] = Math.round(((outletTakings[name] ?? 0) + Number(order.grand_total)) * 100) / 100;
    posTotal += Number(order.grand_total);
    for (const p of order.pos_payments ?? []) {
      if (p.voided_at) continue;
      outletByMethod[p.kind] = Math.round(((outletByMethod[p.kind] ?? 0) + Number(p.amount)) * 100) / 100;
    }
  }

  // ── 7. Daily revenue report ──
  const [{ count: sellable }, { count: arrivals }, { count: departures }, { count: cancellations }] = await Promise.all([
    supabase.from("rooms").select("id", { count: "exact", head: true }).neq("status", "out_of_service"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("check_in", day).eq("status", "checked_in"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("check_out", day).eq("status", "checked_out"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "cancelled")
      .gte("cancelled_at", zonedTime(day, "00:00", settings.timezone).toISOString())
      .lt("cancelled_at", zonedTime(nextDay, "00:00", settings.timezone).toISOString()),
  ]);

  const roomsSold = inHouse.reduce((s, b) => s + b.rooms_count, 0);
  const roomRevenue = sumKind(["room"]);
  const available = sellable ?? 0;

  const report = {
    business_date: day,
    rooms: {
      available,
      sold: roomsSold,
      occupancy_percent: available ? Math.round((roomsSold / available) * 1000) / 10 : 0,
    },
    revenue: {
      room: roomRevenue,
      fees: sumKind(["fee"]),
      extras: sumKind(["extra"]),
      penalties: sumKind(["penalty"]),
      tax: sumKind(["room", "fee", "extra", "penalty"], "tax_amount"),
      total: Math.round((sumKind(["room", "fee", "extra", "penalty"]) + sumKind(["room", "fee", "extra", "penalty"], "tax_amount")) * 100) / 100,
    },
    kpis: {
      adr: roomsSold ? Math.round((roomRevenue / roomsSold) * 100) / 100 : 0,
      revpar: available ? Math.round((roomRevenue / available) * 100) / 100 : 0,
    },
    payments: {
      by_method: byMethod,
      by_cashier: byCashier,
      total: Object.values(byMethod).reduce((s, v) => s + v, 0),
    },
    movements: {
      arrivals: arrivals ?? 0,
      departures: departures ?? 0,
      cancellations: cancellations ?? 0,
      no_shows: noShows,
      expired_holds: (expired ?? []).map((b) => ({ reference: b.reference, guest: b.contact_name })),
      pending_arrivals_left: bool(fd, "mark_no_shows") ? [] : due.map((b) => ({ reference: b.reference, guest: b.contact_name })),
    },
    exceptions: {
      overstays: (overstays ?? []).map((b) => ({
        reference: b.reference,
        guest: b.contact_name,
        room: (b.rooms as unknown as { room_number: string } | null)?.room_number ?? "",
        due_out: b.check_out,
      })),
    },
    housekeeping: { room_statuses_updated: blocksApplied, tasks_created: (hkCreated as number | null) ?? 0 },
    maintenance: { preventive_created: (mtCreated as number | null) ?? 0, escalated: mtEscalated },
    compliance: { id_documents_purged: purged },
    loyalty: { points_expired: pointsExpired, tiers_reviewed: tiersReviewed },
    outlets: {
      bills: (posRows ?? []).length,
      total: Math.round(posTotal * 100) / 100,
      by_outlet: outletTakings,
      by_method: outletByMethod,
    },
    posted_room_charges: charges.posted,
  };

  const { error: doneError } = await supabase
    .from("night_audits")
    .update({ status: "completed", completed_at: new Date().toISOString(), report, error: "" })
    .eq("property_id", property.id)
    .eq("business_date", day);
  if (doneError) return fail(doneError.message);

  const { error: rollError } = await supabase.rpc("advance_business_date", { p_closed: day });
  if (rollError) return fail(rollError.message);

  revalidatePath("/admin/night-audit");
  revalidatePath("/admin/front-desk");
  revalidatePath("/admin");
  redirect(`/admin/night-audit/${day}`);
}
