"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { todayIn } from "../lib/dates";
import { checkRedemption, tierByKey } from "../lib/loyalty";
import type { LoyaltyTier } from "../lib/types";
import { type ActionState, str, num, bool, int, uuidOrNull } from "./form-utils";

/**
 * Module 8 — loyalty points and membership tiers.
 *
 * Earning, redeeming, expiry and tier moves all happen inside database
 * functions: a redemption has to take points and credit the folio in one
 * transaction, or a guest could pay a bill with points they no longer have.
 * These actions validate the form, call the function, and turn its refusals
 * into sentences for the desk.
 */

function revalidateGuest(guestId?: string | null, bookingId?: string | null) {
  if (guestId) revalidatePath(`/admin/guests/${guestId}`);
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin/guests/loyalty");
  revalidatePath("/admin/guests");
}

// ── Membership ──────────────────────────────────────────────────────────────

/** Enrols a guest and gives them a membership number and the entry tier. */
export async function enrollInLoyalty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("guests.edit");
  const supabase = await createClient();
  const settings = await getSettings();
  const guestId = uuidOrNull(fd, "guest_id");
  if (!guestId) return { error: "Guest not found." };

  if (!settings.loyalty_enabled) {
    return { error: `${settings.loyalty_program_name} is switched off. Turn it on under Guests → Loyalty.` };
  }

  const { data, error } = await supabase.rpc("loyalty_enroll", { p_guest: guestId });
  if (error) return { error: friendlyDbError(error.message) };

  // A new member's tier is set from the stays they have already had, so a
  // long-standing guest is not made to start again at the entry tier.
  await supabase.rpc("loyalty_evaluate_tier", { p_guest: guestId, p_date: todayIn(settings.timezone) });

  revalidateGuest(guestId);
  return { success: `Enrolled in ${settings.loyalty_program_name} as ${data ?? "a member"}.` };
}

/** Takes a guest out of the programme at their request. Points are kept, so
 *  rejoining restores the balance; erasure removes them (see guest privacy). */
export async function leaveLoyalty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("guests.edit");
  const supabase = await createClient();
  const guestId = uuidOrNull(fd, "guest_id");
  if (!guestId) return { error: "Guest not found." };

  const { error } = await supabase.from("guests").update({ loyalty_opt_in: false }).eq("id", guestId);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateGuest(guestId);
  return { success: "Membership paused. The points balance is kept if they rejoin." };
}

/** Re-checks one guest's tier against their rolling twelve months. */
export async function reevaluateTier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.manage");
  const supabase = await createClient();
  const settings = await getSettings();
  const guestId = uuidOrNull(fd, "guest_id");
  if (!guestId) return { error: "Guest not found." };

  const { data, error } = await supabase.rpc("loyalty_evaluate_tier", {
    p_guest: guestId,
    p_date: todayIn(settings.timezone),
  });
  if (error) return { error: friendlyDbError(error.message) };

  const { data: tier } = await supabase.from("loyalty_tiers").select("name").eq("key", data).maybeSingle();

  revalidateGuest(guestId);
  return { success: `Tier reviewed — now ${tier?.name ?? data ?? "unchanged"}.` };
}

// ── Points ──────────────────────────────────────────────────────────────────

/**
 * Redeems points against a bill. The value is checked here first so the desk
 * gets a helpful sentence rather than a database error, and checked again by
 * the database, which is what actually holds the line.
 */
export async function redeemPoints(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.redeem");
  const supabase = await createClient();
  const settings = await getSettings();

  const guestId = uuidOrNull(fd, "guest_id");
  const bookingId = uuidOrNull(fd, "booking_id");
  const folioId = uuidOrNull(fd, "folio_id");
  const points = num(fd, "points");
  if (!guestId || !bookingId) return { error: "Booking not found." };
  if (points === null) return { error: "Enter how many points to redeem." };

  // Pre-flight, purely to give a better message than the database would.
  const [{ data: tierRows }, { data: guest }, { data: balance }, { data: owed }] = await Promise.all([
    supabase.from("loyalty_tiers").select("*"),
    supabase.from("guests").select("loyalty_tier, loyalty_opt_in").eq("id", guestId).maybeSingle(),
    supabase.rpc("loyalty_balance", { p_guest: guestId }),
    folioId
      ? supabase.rpc("folio_balance_of", { p_folio: folioId })
      : Promise.resolve({ data: null as number | null }),
  ]);

  if (!guest?.loyalty_opt_in) return { error: "Enrol the guest in the loyalty programme first." };

  const tiers = (tierRows ?? []) as LoyaltyTier[];
  const tier = tierByKey(tiers, guest.loyalty_tier);
  if (owed !== null && typeof owed === "number") {
    const check = checkRedemption({
      points,
      balance: Number(balance ?? 0),
      owed: Number(owed),
      minimum: settings.loyalty_min_redeem_points,
      tier,
    });
    if (!check.allowed) return { error: check.reason };
  }

  const { data: value, error } = await supabase.rpc("loyalty_redeem", {
    p_guest: guestId,
    p_booking: bookingId,
    p_folio: folioId,
    p_points: Math.trunc(points),
    p_note: str(fd, "note", 200),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateGuest(guestId, bookingId);
  return {
    success: `Redeemed ${Math.trunc(points).toLocaleString("en-IN")} points — ${Number(value ?? 0).toFixed(2)} ${settings.currency} off the bill.`,
  };
}

/** A manager's correction: goodwill points, or taking back points given in error. */
export async function adjustPoints(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.manage");
  const supabase = await createClient();
  const guestId = uuidOrNull(fd, "guest_id");
  const points = num(fd, "points");
  const reason = str(fd, "reason", 300);
  const direction = bool(fd, "take_away") ? -1 : 1;
  if (!guestId) return { error: "Guest not found." };
  if (points === null || points === 0) return { error: "Enter a number of points." };
  if (!reason) return { error: "Give a reason for the correction." };

  const { data, error } = await supabase.rpc("loyalty_adjust", {
    p_guest: guestId,
    p_points: Math.trunc(Math.abs(points)) * direction,
    p_reason: reason,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateGuest(guestId);
  return {
    success: `${direction > 0 ? "Added" : "Removed"} ${Math.trunc(Math.abs(points)).toLocaleString("en-IN")} points. Balance is now ${Number(data ?? 0).toLocaleString("en-IN")}.`,
  };
}

// ── Programme setup ─────────────────────────────────────────────────────────

/** Turns the programme on or off and sets the rules that apply to everyone. */
export async function saveLoyaltyProgram(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.manage");
  const supabase = await createClient();

  const { data: row } = await supabase.from("property_settings").select("id").maybeSingle();
  if (!row) return { error: "Property settings are not set up yet." };

  const { error } = await supabase
    .from("property_settings")
    .update({
      loyalty_enabled: bool(fd, "loyalty_enabled"),
      loyalty_program_name: str(fd, "loyalty_program_name", 60) || "Shamiyana Rewards",
      loyalty_expiry_months: int(fd, "loyalty_expiry_months", 24, 0, 120),
      loyalty_min_redeem_points: int(fd, "loyalty_min_redeem_points", 500, 0, 1_000_000),
    })
    .eq("id", row.id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/guests/loyalty");
  revalidatePath("/admin/settings");
  return { success: "Programme settings saved." };
}

/** Creates or edits one membership tier. */
export async function saveLoyaltyTier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.manage");
  const supabase = await createClient();

  const key = str(fd, "key", 20).toLowerCase();
  const name = str(fd, "name", 40);
  const earn = num(fd, "earn_rate");
  const redeem = num(fd, "redeem_rate");
  if (!/^[a-z_]{2,20}$/.test(key)) {
    return { error: "Use a short lower-case key for the tier, such as gold or inner_circle." };
  }
  if (!name) return { error: "Give the tier a name." };
  if (earn === null || earn < 0) return { error: "Enter the earn rate — points per unit of currency spent." };
  if (redeem === null || redeem < 0) return { error: "Enter the redemption rate — what one point is worth." };

  const { error } = await supabase.from("loyalty_tiers").upsert(
    {
      key,
      name,
      sort_order: int(fd, "sort_order", 1, 0, 100),
      min_nights: int(fd, "min_nights", 0, 0, 1000),
      min_spend: num(fd, "min_spend") ?? 0,
      earn_rate: earn,
      redeem_rate: redeem,
      perks: str(fd, "perks", 1000),
      colour: str(fd, "colour", 20) || "slate",
      is_active: bool(fd, "is_active"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/guests/loyalty");
  return { success: `${name} saved.` };
}

/**
 * Re-checks every member's tier. Night audit does this nightly; this is the
 * button for after the thresholds have been changed.
 */
export async function reevaluateAllTiers(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("loyalty.manage");
  // Guards against an empty POST re-running a sweep over every member.
  if (!bool(fd, "all")) return { error: "Use the button on the Loyalty page to review every member." };
  const supabase = await createClient();
  const settings = await getSettings();

  const { data, error } = await supabase.rpc("loyalty_evaluate_all", { p_date: todayIn(settings.timezone) });
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/guests/loyalty");
  revalidatePath("/admin/guests");
  return { success: `Reviewed ${Number(data ?? 0)} member${Number(data ?? 0) === 1 ? "" : "s"}.` };
}
