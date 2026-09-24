import { createPublicClient } from "./supabase/server";
import { hasSupabaseConfig } from "./supabase/config";
import { ROOMS_FALLBACK, EXTRA_CHARGES_FALLBACK } from "./rates-fallback";
import type { RoomType, ExtraCharge } from "./types";

export { hasSupabaseConfig };

/**
 * Tariff for the public site.
 *
 * Reads the rates an administrator set in the admin panel. If Supabase is not
 * configured yet, or the query fails, the published tariff is served from code
 * instead — the marketing site must never show an empty rate card.
 */
export async function getPublicRates(): Promise<{
  rooms: RoomType[];
  charges: ExtraCharge[];
  live: boolean;
}> {
  if (!hasSupabaseConfig()) {
    return { rooms: ROOMS_FALLBACK, charges: EXTRA_CHARGES_FALLBACK, live: false };
  }

  try {
    const supabase = createPublicClient();
    const [{ data: rooms }, { data: charges }] = await Promise.all([
      supabase
        .from("room_types")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("extra_charges")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
    ]);

    if (!rooms?.length) {
      return { rooms: ROOMS_FALLBACK, charges: EXTRA_CHARGES_FALLBACK, live: false };
    }

    return {
      rooms: rooms as RoomType[],
      charges: (charges ?? []) as ExtraCharge[],
      live: true,
    };
  } catch {
    return { rooms: ROOMS_FALLBACK, charges: EXTRA_CHARGES_FALLBACK, live: false };
  }
}

/**
 * The settings the public website and the guest portal may read.
 *
 * property_settings is staff-only, and a guest is not staff, so this goes
 * through portal_settings() in the database — which returns only the fields
 * that are public anyway. Reading it with the cookie-free client keeps the
 * marketing pages statically rendered, which is what holds them inside the
 * SOW's three-second page-load target.
 */
export interface PortalSettings {
  propertyName: string;
  currency: string;
  multiCurrency: boolean;
  defaultLanguage: string;
  languages: string[];
  taxLabel: string;
  bestRateMessage: string;
  phone: string;
  email: string;
}

const PORTAL_FALLBACK: PortalSettings = {
  propertyName: "Hotel Shamiyana",
  currency: "INR",
  multiCurrency: false,
  defaultLanguage: "en",
  languages: ["en"],
  taxLabel: "Inclusive of taxes",
  bestRateMessage: "",
  phone: "0194-3500113",
  email: "info@hotelshamiyana.com",
};

export async function getPortalSettings(): Promise<PortalSettings> {
  if (!hasSupabaseConfig()) return PORTAL_FALLBACK;

  try {
    const supabase = createPublicClient();
    const { data } = await supabase.rpc("portal_settings").maybeSingle();
    if (!data) return PORTAL_FALLBACK;

    const row = data as {
      property_name: string | null;
      currency: string | null;
      multi_currency_enabled: boolean | null;
      default_language: string | null;
      languages: string[] | null;
      tax_label: string | null;
      best_rate_message: string | null;
      phone: string | null;
      email: string | null;
    };

    return {
      propertyName: row.property_name || PORTAL_FALLBACK.propertyName,
      currency: row.currency || PORTAL_FALLBACK.currency,
      multiCurrency: Boolean(row.multi_currency_enabled),
      defaultLanguage: row.default_language || "en",
      languages: row.languages?.length ? row.languages : ["en"],
      taxLabel: row.tax_label || PORTAL_FALLBACK.taxLabel,
      bestRateMessage: row.best_rate_message ?? "",
      phone: row.phone || PORTAL_FALLBACK.phone,
      email: row.email || PORTAL_FALLBACK.email,
    };
  } catch {
    return PORTAL_FALLBACK;
  }
}
