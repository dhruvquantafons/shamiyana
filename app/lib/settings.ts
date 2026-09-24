import { cache } from "react";
import { createClient } from "./supabase/server";
import type { PropertySettings } from "./types";
import { parseTaxSlabs, type TaxSlab } from "./tax";

/** Used when the settings row cannot be read, e.g. before migration 0005. */
export const DEFAULT_SETTINGS: PropertySettings = {
  name: "Hotel Shamiyana",
  legal_name: "",
  address: "",
  city: "Srinagar",
  state: "Jammu & Kashmir",
  country: "India",
  postcode: "",
  phone: "0194-3500113",
  email: "info@hotelshamiyana.com",
  gstin: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  check_in_time: "14:00:00",
  check_out_time: "12:00:00",
  business_date: new Date().toISOString().slice(0, 10),
  tax_inclusive: true,
  tax_slabs: [
    { up_to: 7500, rate: 5 },
    { up_to: null, rate: 18 },
  ],
  tax_label: "GST",
  early_checkin_fee_type: "percent",
  early_checkin_fee_value: 50,
  late_checkout_fee_type: "percent",
  late_checkout_fee_value: 50,
  hold_hours: 24,
  session_timeout_minutes: 30,
  password_min_length: 10,
  password_max_age_days: 90,
  max_failed_logins: 5,
  lockout_minutes: 15,
  id_document_retention_days: 365,
  hk_default_minutes: 30,
  hk_deep_clean_days: 30,
  mt_sla_low_hours: 72,
  mt_sla_medium_hours: 24,
  mt_sla_high_hours: 8,
  mt_sla_urgent_hours: 2,
  hr_geofence_lat: null,
  hr_geofence_lng: null,
  hr_geofence_radius_m: 200,
  hr_require_geofence: false,
  hr_late_grace_minutes: 10,
  default_language: "en",
  languages: ["en"],
  invoice_prefix: "INV",
  invoice_terms: "",
  refund_approval_threshold: 5000,
  online_payments_enabled: false,
  multi_currency_enabled: false,
  ar_reminder_days: 7,
  loyalty_enabled: false,
  loyalty_program_name: "Shamiyana Rewards",
  loyalty_expiry_months: 24,
  loyalty_min_redeem_points: 500,
  pos_room_charge_limit: 0,
  event_quote_approval_threshold: 100000,
  event_service_charge_percent: 0,
  event_advance_percent: 25,
  event_terms: "",
  monthly_operating_cost: 0,
  best_rate_message:
    "Book direct for our best available rate. Find a lower public rate for the same room and dates elsewhere, and we will match it.",
  notify_pre_arrival_days: 3,
  notify_checkin_days: 1,
  notify_post_stay_days: 1,
  notify_staff_new_booking: true,
  notify_staff_vip_arrival: true,
  notify_staff_ticket_assigned: true,
  revenue_auto_approve_percent: 10,
  revenue_forecast_days: 60,
  revenue_floor_rate: 0,
  revenue_ceiling_rate: 0,
  updated_at: new Date(0).toISOString(),
};

/** Property settings for the signed-in staff member's request. */
export const getSettings = cache(async (): Promise<PropertySettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("property_settings").select("*").maybeSingle();
  return data ? ({ ...DEFAULT_SETTINGS, ...data } as PropertySettings) : DEFAULT_SETTINGS;
});

export function taxSlabsOf(settings: PropertySettings): TaxSlab[] {
  return parseTaxSlabs(settings.tax_slabs);
}

/** HH:MM from a Postgres time value. */
export function hhmm(time: string) {
  return time.slice(0, 5);
}
