"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { addDays, todayIn } from "../lib/dates";
import { proposeRates, checkPromo, type RuleLimits } from "../lib/revenue";
import type {
  AdjustmentKind,
  DiscountKind,
  ForecastRow,
  MealPlan,
  PackageBasis,
  PricingAdjustment,
  PricingRule,
  PromoCode,
  RateSeason,
  RoomType,
} from "../lib/types";
import { type ActionState, str, num, int, bool, oneOf, uuidOrNull, dateStr } from "./form-utils";

/**
 * Module 4 — revenue and dynamic pricing.
 *
 * The rule engine itself is app/lib/revenue.ts, which is pure and tested. What
 * happens here is the part that needs the database: fetch the forecast, run
 * the rules over it, and reconcile the proposals against the decisions already
 * on record. Reconciling matters more than it sounds — the engine is meant to
 * be re-run daily, and a naive rewrite would knock every approved rate back
 * into the approval queue each morning and stop the hotel selling.
 */

const ADJUSTMENT_KINDS: AdjustmentKind[] = ["percent", "amount", "fixed"];
const DISCOUNT_KINDS: DiscountKind[] = ["percent", "amount"];
const MEAL_PLANS: MealPlan[] = ["EP", "CP", "MAP", "AP"];
const PACKAGE_BASES: PackageBasis[] = [
  "per_stay",
  "per_night",
  "per_person_per_stay",
  "per_person_per_night",
];

function revalidateRevenue() {
  revalidatePath("/admin/revenue", "layout");
  revalidatePath("/admin/bookings/new");
  // A live rate change is the price the public site quotes.
  revalidatePath("/", "layout");
}

const uuidList = (fd: FormData, key: string) =>
  fd
    .getAll(key)
    .map(String)
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v));

const dateOrNull = (fd: FormData, key: string) => dateStr(fd, key) || null;

const intOrNull = (fd: FormData, key: string, min: number, max: number) => {
  const n = num(fd, key);
  if (n === null || !Number.isInteger(n)) return null;
  return Math.min(max, Math.max(min, n));
};

// ── Pricing rules ───────────────────────────────────────────────────────────

export async function savePricingRule(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 120);
  if (!name) return { error: "Give the rule a name." };

  const days = fd
    .getAll("days_of_week")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  const row = {
    name,
    description: str(fd, "description", 1000),
    room_type_id: uuidOrNull(fd, "room_type_id"),
    min_occupancy: intOrNull(fd, "min_occupancy", 0, 100),
    max_occupancy: intOrNull(fd, "max_occupancy", 0, 100),
    // No boxes ticked means the rule is not limited by day of week.
    days_of_week: days.length > 0 ? [...new Set(days)].sort() : [0, 1, 2, 3, 4, 5, 6],
    start_date: dateOrNull(fd, "start_date"),
    end_date: dateOrNull(fd, "end_date"),
    occasion: str(fd, "occasion", 120),
    min_lead_days: intOrNull(fd, "min_lead_days", 0, 3650),
    max_lead_days: intOrNull(fd, "max_lead_days", 0, 3650),
    adjustment_kind: oneOf(fd, "adjustment_kind", ADJUSTMENT_KINDS, "percent"),
    adjustment_value: num(fd, "adjustment_value") ?? 0,
    floor_rate: Math.max(0, num(fd, "floor_rate") ?? 0),
    ceiling_rate: Math.max(0, num(fd, "ceiling_rate") ?? 0),
    priority: int(fd, "priority", 0, -100, 100),
    is_active: bool(fd, "is_active"),
  };

  if (row.adjustment_kind !== "fixed" && row.adjustment_value === 0) {
    return { error: "A rule that changes the rate by nothing would do nothing." };
  }
  if (row.min_occupancy !== null && row.max_occupancy !== null && row.max_occupancy < row.min_occupancy) {
    return { error: "The occupancy range ends below where it starts." };
  }
  if (row.start_date && row.end_date && row.end_date < row.start_date) {
    return { error: "The date range ends before it starts." };
  }
  if (row.min_lead_days !== null && row.max_lead_days !== null && row.max_lead_days < row.min_lead_days) {
    return { error: "The lead-time range ends below where it starts." };
  }
  if (row.floor_rate > 0 && row.ceiling_rate > 0 && row.ceiling_rate < row.floor_rate) {
    return { error: "The ceiling is below the floor." };
  }

  const { error } = id
    ? await supabase.from("pricing_rules").update(row).eq("id", id)
    : await supabase.from("pricing_rules").insert(row);

  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return {
    success: id
      ? `Saved ${name}. Run the rules to price nights with it.`
      : `Added ${name}. Run the rules to price nights with it.`,
  };
}

export async function deletePricingRule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "No rule to remove." };

  const { error } = await supabase.from("pricing_rules").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  // Rates the rule already set stay live: they are decisions that were taken,
  // and pulling them silently would move prices the desk has been quoting.
  return { success: "Rule removed. Rates it has already set are still live — clear them if you no longer want them." };
}

// ── Running the rules ───────────────────────────────────────────────────────

/**
 * Prices every night in the forecast window with the current rules.
 *
 * Reconciliation, night by night:
 *   • a proposal matching a live rate from the same rule is left alone, so an
 *     approval survives the engine running again
 *   • any other proposal replaces what is there — the old row is expired and
 *     the new one goes live or into the queue, by the threshold
 *   • a live or waiting rate with no proposal behind it any more is expired,
 *     because the condition that justified it has stopped being true
 */
export async function runPricingRules(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("revenue.manage");
  const supabase = await createClient();
  const settings = await getSettings();

  const today = todayIn(settings.timezone);
  const days = int(fd, "days", settings.revenue_forecast_days, 7, 365);
  const until = addDays(today, days);

  const [forecast, rules, roomTypes, seasons, existing] = await Promise.all([
    supabase.rpc("revenue_forecast", { p_from: today, p_to: until }),
    supabase.from("pricing_rules").select("*").eq("is_active", true),
    supabase.from("room_types").select("*").eq("is_active", true),
    supabase.from("rate_seasons").select("*").gte("end_date", today),
    supabase
      .from("pricing_adjustments")
      .select("*")
      .in("status", ["pending", "applied"])
      .gte("stay_date", today)
      .lte("stay_date", until),
  ]);

  if (forecast.error) return { error: friendlyDbError(forecast.error.message) };
  if ((rules.data ?? []).length === 0) {
    return { error: "There are no active pricing rules to run." };
  }

  const limits: RuleLimits = {
    floorRate: Number(settings.revenue_floor_rate),
    ceilingRate: Number(settings.revenue_ceiling_rate),
    autoApprovePercent: Number(settings.revenue_auto_approve_percent),
  };

  const proposals = proposeRates(
    (forecast.data ?? []) as ForecastRow[],
    (rules.data ?? []) as PricingRule[],
    (roomTypes.data ?? []) as RoomType[],
    (seasons.data ?? []) as RateSeason[],
    limits,
    today,
  );

  const live = (existing.data ?? []) as PricingAdjustment[];
  const keyOf = (stayDate: string, roomTypeId: string) => `${stayDate}|${roomTypeId}`;
  const liveByKey = new Map(live.map((a) => [keyOf(a.stay_date, a.room_type_id), a]));
  const proposedKeys = new Set(proposals.map((p) => keyOf(p.stay_date, p.room_type_id)));

  const expire: string[] = [];
  const insert: Record<string, unknown>[] = [];

  for (const p of proposals) {
    const current = liveByKey.get(keyOf(p.stay_date, p.room_type_id));
    const unchanged =
      current &&
      current.rule_id === p.rule_id &&
      Number(current.proposed_rate) === p.proposed_rate &&
      Number(current.base_rate) === p.base_rate;
    if (unchanged) continue;

    if (current) expire.push(current.id);
    insert.push({
      stay_date: p.stay_date,
      room_type_id: p.room_type_id,
      rule_id: p.rule_id,
      rule_name: p.rule_name,
      occasion: p.occasion,
      base_rate: p.base_rate,
      proposed_rate: p.proposed_rate,
      change_percent: p.change_percent,
      occupancy_percent: p.occupancy_percent,
      rooms_sold: p.rooms_sold,
      capacity: p.capacity,
      status: p.autoApproves ? "applied" : "pending",
      threshold_percent: limits.autoApprovePercent,
      created_by: session.staff.id,
      // A change that needs nobody's approval is decided the moment it is made.
      decided_at: p.autoApproves ? new Date().toISOString() : null,
    });
  }

  // Rates whose rule no longer matches this night.
  for (const a of live) {
    if (!proposedKeys.has(keyOf(a.stay_date, a.room_type_id))) expire.push(a.id);
  }

  // Expire first: a night may hold only one live or waiting rate per type.
  if (expire.length > 0) {
    const { error } = await supabase
      .from("pricing_adjustments")
      .update({ status: "expired", decided_at: new Date().toISOString() })
      .in("id", expire);
    if (error) return { error: friendlyDbError(error.message) };
  }

  if (insert.length > 0) {
    const { error } = await supabase.from("pricing_adjustments").insert(insert);
    if (error) return { error: friendlyDbError(error.message) };
  }

  const applied = insert.filter((r) => r.status === "applied").length;
  const pending = insert.length - applied;

  revalidateRevenue();

  if (insert.length === 0 && expire.length === 0) {
    return { success: `Rules run to ${until}. Every night is already at the rate the rules ask for.` };
  }
  const parts = [
    applied > 0 ? `${applied} rate${applied === 1 ? "" : "s"} live` : "",
    pending > 0 ? `${pending} waiting for approval` : "",
    expire.length > 0 ? `${expire.length} withdrawn` : "",
  ].filter(Boolean);
  return { success: `Rules run to ${until}: ${parts.join(", ")}.` };
}

/** Approves or rejects rates waiting in the queue. */
export async function decideAdjustments(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.approve");
  const supabase = await createClient();

  const ids = uuidList(fd, "ids");
  if (ids.length === 0) return { error: "Pick at least one rate to decide on." };

  // Which button was pressed. Read explicitly rather than defaulting, so a
  // decision is never taken by omission in either direction.
  const decision = str(fd, "decision", 10);
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Choose whether to approve or reject." };
  }
  const approve = decision === "approve";

  const { data, error } = await supabase.rpc("pricing_adjustment_decide", {
    p_ids: ids,
    p_approve: approve,
    p_note: str(fd, "note", 500),
  });
  if (error) return { error: friendlyDbError(error.message) };

  const n = Number(data ?? 0);
  if (n === 0) return { error: "Those rates have already been decided." };

  revalidateRevenue();
  return {
    success: approve
      ? `${n} rate${n === 1 ? "" : "s"} approved and now selling.`
      : `${n} rate${n === 1 ? "" : "s"} rejected. Those nights sell at the ordinary rate.`,
  };
}

/** Withdraws a live rate, so the night sells at its ordinary rate again. */
export async function clearAdjustments(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const ids = uuidList(fd, "ids");
  if (ids.length === 0) return { error: "Pick at least one rate to clear." };

  const { error } = await supabase
    .from("pricing_adjustments")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .in("id", ids)
    .in("status", ["pending", "applied"]);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: "Cleared. Those nights sell at their ordinary rate." };
}

// ── Competitor rates ────────────────────────────────────────────────────────

export async function saveCompetitor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 120);
  if (!name) return { error: "Name the property you are tracking." };

  const row = {
    name,
    source: str(fd, "source", 200),
    notes: str(fd, "notes", 1000),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
  };

  const { error } = id
    ? await supabase.from("competitor_properties").update(row).eq("id", id)
    : await supabase.from("competitor_properties").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: `Saved ${name}.` };
}

export async function deleteCompetitor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "No property to remove." };

  const { error } = await supabase.from("competitor_properties").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: "Removed, along with the rates recorded against it." };
}

/** Records one rate read for one competitor on one night. */
export async function saveCompetitorRate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("revenue.manage");
  const supabase = await createClient();

  const competitorId = uuidOrNull(fd, "competitor_id");
  const stayDate = dateStr(fd, "stay_date");
  if (!competitorId) return { error: "Pick the property this rate is for." };
  if (!stayDate) return { error: "Pick the night this rate is for." };

  const soldOut = bool(fd, "sold_out");
  const rate = num(fd, "rate");
  if (!soldOut && (rate === null || rate < 0)) {
    return { error: "Enter the rate, or mark the night sold out." };
  }

  const row = {
    competitor_id: competitorId,
    stay_date: stayDate,
    room_type_id: uuidOrNull(fd, "room_type_id"),
    rate: soldOut ? 0 : (rate ?? 0),
    meal_plan: oneOf(fd, "meal_plan", MEAL_PLANS, "EP"),
    tax_inclusive: bool(fd, "tax_inclusive"),
    sold_out: soldOut,
    note: str(fd, "note", 300),
    observed_at: new Date().toISOString(),
    observed_by: session.staff.id,
  };

  // Re-reading the same night for the same property updates the reading.
  const { error } = await supabase
    .from("competitor_rates")
    .upsert(row, { onConflict: "competitor_id,stay_date,room_type_id" });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: `Recorded for ${stayDate}.` };
}

export async function deleteCompetitorRate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "No reading to remove." };

  const { error } = await supabase.from("competitor_rates").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: "Reading removed." };
}

// ── Promo codes ─────────────────────────────────────────────────────────────

export async function savePromoCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  const code = str(fd, "code", 24).toUpperCase().replace(/\s+/g, "");
  const name = str(fd, "name", 120);

  if (!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code)) {
    return { error: "A code is 3 to 24 characters: letters, numbers, hyphens and underscores." };
  }
  if (!name) return { error: "Give the offer a name, so staff know what the code is for." };

  const kind = oneOf(fd, "discount_kind", DISCOUNT_KINDS, "percent");
  const value = num(fd, "discount_value") ?? 0;
  if (value <= 0) return { error: "The discount has to be more than nothing." };
  if (kind === "percent" && value > 100) return { error: "A percentage discount cannot be more than 100%." };

  const row = {
    code,
    name,
    description: str(fd, "description", 1000),
    discount_kind: kind,
    discount_value: value,
    max_discount: Math.max(0, num(fd, "max_discount") ?? 0),
    room_type_ids: uuidList(fd, "room_type_ids"),
    rate_plan_ids: uuidList(fd, "rate_plan_ids"),
    valid_from: dateOrNull(fd, "valid_from"),
    valid_to: dateOrNull(fd, "valid_to"),
    stay_from: dateOrNull(fd, "stay_from"),
    stay_to: dateOrNull(fd, "stay_to"),
    min_nights: intOrNull(fd, "min_nights", 1, 365),
    min_amount: Math.max(0, num(fd, "min_amount") ?? 0),
    max_redemptions: intOrNull(fd, "max_redemptions", 1, 1000000),
    max_per_guest: intOrNull(fd, "max_per_guest", 1, 1000),
    is_public: bool(fd, "is_public"),
    is_active: bool(fd, "is_active"),
  };

  if (row.valid_from && row.valid_to && row.valid_to < row.valid_from) {
    return { error: "The code expires before it starts." };
  }
  if (row.stay_from && row.stay_to && row.stay_to < row.stay_from) {
    return { error: "The stay window ends before it starts." };
  }

  const { error } = id
    ? await supabase.from("promo_codes").update(row).eq("id", id)
    : await supabase.from("promo_codes").insert({ ...row, created_by: session.staff.id });

  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: `Saved ${code}.` };
}

export async function deletePromoCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("revenue.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "No code to remove." };

  const { count } = await supabase
    .from("promo_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("promo_code_id", id);

  // A redeemed code is part of the record of what a guest was charged, so it
  // is switched off rather than deleted.
  if ((count ?? 0) > 0) {
    const { error } = await supabase.from("promo_codes").update({ is_active: false }).eq("id", id);
    if (error) return { error: friendlyDbError(error.message) };
    revalidateRevenue();
    return {
      success: `That code has been used ${count} time(s), so it has been switched off rather than deleted — the bookings that used it keep their discount.`,
    };
  }

  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  return { success: "Code removed." };
}

/**
 * Checks a code against a stay, for the desk and the booking portal.
 *
 * Returns the discount rather than applying it: the booking flow re-checks
 * and records the redemption when the booking is actually taken, so a code
 * cannot be spent by looking at it.
 */
export async function validatePromoCode(input: {
  code: string;
  checkIn: string;
  checkOut: string;
  roomTypeId: string;
  ratePlanId: string | null;
  amount: number;
  email?: string;
}): Promise<{ ok: boolean; discount: number; message: string; codeId: string | null }> {
  await requirePermission("bookings.create");
  const supabase = await createClient();
  const settings = await getSettings();

  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, discount: 0, message: "", codeId: null };

  const { data } = await supabase.from("promo_codes").select("*").eq("code", code).maybeSingle();
  const promo = (data ?? null) as PromoCode | null;

  const guestRedemptions =
    promo && promo.max_per_guest !== null && input.email
      ? ((
          await supabase
            .from("promo_redemptions")
            .select("id", { count: "exact", head: true })
            .eq("promo_code_id", promo.id)
            .ilike("email", input.email.trim())
        ).count ?? 0)
      : 0;

  const result = checkPromo(promo, {
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanId,
    amount: input.amount,
    today: todayIn(settings.timezone),
    guestRedemptions,
  });

  return {
    ok: result.ok,
    discount: result.discount,
    message: result.ok
      ? `${promo?.name} applied: ₹${result.discount.toLocaleString("en-IN")} off.`
      : (result.reason ?? "That promo code cannot be used for this stay."),
    codeId: result.ok ? (promo?.id ?? null) : null,
  };
}

// ── Package components ──────────────────────────────────────────────────────

export async function savePackageComponent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  const ratePlanId = uuidOrNull(fd, "rate_plan_id");
  const name = str(fd, "name", 120);

  if (!ratePlanId) return { error: "Pick the package this belongs to." };
  if (!name) return { error: "Name what is included." };

  const row = {
    rate_plan_id: ratePlanId,
    name,
    description: str(fd, "description", 500),
    retail_value: Math.max(0, num(fd, "retail_value") ?? 0),
    basis: oneOf(fd, "basis", PACKAGE_BASES, "per_stay"),
    quantity: int(fd, "quantity", 1, 1, 99),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 999),
  };

  const { error } = id
    ? await supabase.from("package_components").update(row).eq("id", id)
    : await supabase.from("package_components").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  revalidatePath("/admin/rates/plans");
  return { success: `Saved ${name}.` };
}

export async function deletePackageComponent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();

  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Nothing to remove." };

  const { error } = await supabase.from("package_components").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRevenue();
  revalidatePath("/admin/rates/plans");
  return { success: "Removed from the package." };
}

// The approval threshold, forecast horizon and rate guard rails are property
// settings, so they are edited with the rest of them in actions.ts rather than
// by a second writer of the same row.
