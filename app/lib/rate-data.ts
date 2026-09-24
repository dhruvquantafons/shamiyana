import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveAdjustment } from "./pricing";
import { checkPromo, type PromoCheck } from "./revenue";
import type {
  Company,
  ExtraCharge,
  PromoCode,
  RatePlan,
  RateRestriction,
  RateSeason,
  RoomType,
} from "./types";

export interface PricingData {
  roomTypes: RoomType[];
  plans: RatePlan[];
  seasons: RateSeason[];
  restrictions: RateRestriction[];
  extraCharges: ExtraCharge[];
  /** Live dynamic-pricing decisions for nights still on sale (Module 4). */
  adjustments: LiveAdjustment[];
}

/**
 * Everything quoteStay() needs, loaded in one round of parallel queries.
 * Seasons and restrictions are limited to those that can still affect a
 * booking made today.
 */
export async function loadPricingData(
  supabase: SupabaseClient,
  options: { from?: string; publicOnly?: boolean } = {},
): Promise<PricingData> {
  const from = options.from ?? new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);

  let plans = supabase.from("rate_plans").select("*").order("sort_order").order("name");
  let types = supabase.from("room_types").select("*").order("sort_order");
  if (options.publicOnly) {
    plans = plans.eq("is_active", true).eq("is_public", true);
    types = types.eq("is_active", true);
  }

  const [roomTypes, ratePlans, seasons, restrictions, extraCharges, adjustments] = await Promise.all([
    types,
    plans,
    supabase.from("rate_seasons").select("*").gte("end_date", from).order("start_date"),
    supabase.from("rate_restrictions").select("*").gte("end_date", from).order("start_date"),
    supabase.from("extra_charges").select("*").order("sort_order"),
    // Only live rates, and only for nights that can still be sold. A pending
    // proposal must never reach a quote.
    supabase
      .from("pricing_adjustments")
      .select("stay_date, room_type_id, proposed_rate, status")
      .eq("status", "applied")
      .gte("stay_date", from),
  ]);

  return {
    roomTypes: (roomTypes.data ?? []) as RoomType[],
    plans: (ratePlans.data ?? []) as RatePlan[],
    seasons: (seasons.data ?? []) as RateSeason[],
    restrictions: (restrictions.data ?? []) as RateRestriction[],
    extraCharges: (extraCharges.data ?? []) as ExtraCharge[],
    adjustments: (adjustments.data ?? []) as LiveAdjustment[],
  };
}

/**
 * Looks a promo code up and checks it against a stay.
 *
 * The one place a code is turned into money, so the desk and the public site
 * cannot come to different answers about what a guest is owed. The caller
 * decides what to do when it fails: the desk shows the reason and stops, the
 * website mentions it and takes the booking anyway.
 *
 * `publicOnly` hides codes the desk applies by hand, so a guest cannot guess
 * their way into one.
 */
export async function resolvePromo(
  supabase: SupabaseClient,
  code: string,
  stay: Omit<PromoCheck, "publicOnly" | "guestRedemptions">,
  options: { publicOnly?: boolean; email?: string } = {},
): Promise<{ codeId: string | null; discount: number; reason?: string }> {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return { codeId: null, discount: 0 };

  const { data } = await supabase.from("promo_codes").select("*").eq("code", wanted).maybeSingle();
  const promo = (data ?? null) as PromoCode | null;

  const email = options.email?.trim() ?? "";
  const guestRedemptions =
    promo && promo.max_per_guest !== null && email
      ? ((
          await supabase
            .from("promo_redemptions")
            .select("id", { count: "exact", head: true })
            .eq("promo_code_id", promo.id)
            .ilike("email", email)
        ).count ?? 0)
      : 0;

  const result = checkPromo(promo, {
    ...stay,
    publicOnly: options.publicOnly ?? false,
    guestRedemptions,
  });

  return result.ok
    ? { codeId: promo?.id ?? null, discount: result.discount }
    : { codeId: null, discount: 0, reason: result.reason };
}

export async function loadCompanies(supabase: SupabaseClient): Promise<Company[]> {
  const { data } = await supabase.from("companies").select("*").eq("is_active", true).order("name");
  return (data ?? []) as Company[];
}
