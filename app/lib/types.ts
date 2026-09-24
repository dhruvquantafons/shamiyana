/**
 * Roles are rows in the `roles` table, each with a configurable permission
 * set (see permissions.ts). The key is stable; the display name is editable.
 */
export type StaffRole = string;

export interface Role {
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  is_superuser: boolean;
  requires_2fa: boolean;
  sort_order: number;
}

export type BookingStatus =
  | "tentative"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show"
  | "waitlisted";

export type BookingSource =
  | "walk_in"
  | "phone"
  | "email"
  | "website"
  | "ota"
  | "travel_agent"
  | "corporate"
  | "mobile_app";

export type RoomStatus = "available" | "occupied" | "out_of_order" | "out_of_service";
export type HousekeepingStatus = "dirty" | "cleaning" | "clean" | "inspected";
export type BlockKind = "out_of_order" | "out_of_service";

export type RateType = "bar" | "corporate" | "package" | "promotional" | "group";
export type PenaltyKind = "none" | "first_night" | "full_stay" | "percent";
export type MealPlan = "EP" | "CP" | "MAP" | "AP";

export type PaymentMethod =
  | "cash"
  | "card"
  | "upi"
  | "bank_transfer"
  | "online_gateway"
  | "corporate_billing"
  | "ota_prepaid"
  | "wallet"
  | "loyalty_points"
  | "other";

export type FolioKind = "room" | "fee" | "penalty" | "extra" | "payment" | "refund" | "adjustment";

export interface Staff {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  job_title: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  last_seen_at: string | null;
  password_changed_at: string;
  must_change_password: boolean;
  hk_zone_id?: string | null;
  on_duty?: boolean;
  employee_code?: string | null;
  department_id?: string | null;
  joining_date?: string | null;
  default_shift_id?: string | null;
  weekly_off?: number | null;
  address?: string;
  emergency_contact?: string;
  sessions_revoked_at?: string | null;
  /** The property this person belongs to (SOW Module 14). */
  property_id?: string | null;
  /** Head office: sees and works at every property in the group. */
  all_properties?: boolean;
  /** Which property they are currently looking at, if not their own. */
  active_property_id?: string | null;
}

/**
 * One hotel in the group (SOW Module 14).
 *
 * Carries every field of PropertySettings — before 0024 this was a single row
 * called property_settings, and each property now holds its own copy — plus
 * the handful that tell one property from another.
 */
export interface Property extends PropertySettings {
  id: string;
  code: string;
  brand: string;
  is_active: boolean;
  /** Answers the public website and anything with no staff session behind it. */
  is_default: boolean;
  sort_order: number;
  created_at: string;
}

/** A row of the central dashboard: one property's performance. */
export interface GroupPerformance {
  property_id: string;
  code: string;
  name: string;
  brand: string;
  nights: number;
  rooms_available: number;
  rooms_sold: number;
  occupancy: number;
  room_revenue: number;
  total_revenue: number;
  adr: number;
  revpar: number;
}

/** Rooms free at each property, for taking a booking from one screen. */
export interface GroupAvailability {
  property_id: string;
  code: string;
  name: string;
  room_type_id: string;
  room_type: string;
  free: number;
}

/** Head office's copy of the settings it can push to every property. */
export interface GroupSettings {
  group_name: string;
  best_rate_message: string;
  invoice_terms: string;
  event_terms: string;
  default_language: string;
  languages: string[];
  loyalty_enabled: boolean;
  loyalty_program_name: string;
  loyalty_expiry_months: number;
  loyalty_min_redeem_points: number;
  tax_inclusive: boolean;
  tax_slabs: unknown;
  tax_label: string;
  updated_at: string;
}

/** What push_central_config() knows how to copy down. */
export const CENTRAL_CONFIG_ITEMS = {
  brand: "Brand standards — best-rate message, invoice and event terms, languages",
  loyalty: "Loyalty programme rules — name, expiry, minimum redemption",
  tax: "Tax template — slabs, label, inclusive or exclusive pricing",
} as const;

export type CentralConfigItem = keyof typeof CENTRAL_CONFIG_ITEMS;

export interface RoomType {
  id: string;
  slug: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  size: string;
  occupancy: string;
  view: string;
  base_rate: number;
  weekend_rate: number | null;
  cleaning_minutes?: number | null;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  amenities: string[];
  gallery: string[];
  image: string;
  highlights: string[];
  is_active: boolean;
  sort_order: number;
  updated_at: string;
}

export type ExtraChargeKind = "extra_adult" | "child_no_bed" | "meal" | "child_meal" | "other";

export interface ExtraCharge {
  id: string;
  label: string;
  amount: number;
  kind: ExtraChargeKind;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

export interface Room {
  id: string;
  room_number: string;
  room_type_id: string;
  floor: number | null;
  status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  housekeeping_updated_at: string | null;
  view: string;
  bed_configuration: string;
  max_adults: number | null;
  max_children: number | null;
  is_smoking: boolean;
  is_accessible: boolean;
  connecting_room_id: string | null;
  dnd?: boolean;
  dnd_updated_at?: string | null;
  last_deep_clean_on?: string | null;
  notes: string;
  created_at: string;
  room_types?: Pick<RoomType, "name" | "slug"> | null;
}

export interface RoomBlock {
  id: string;
  room_id: string;
  kind: BlockKind;
  start_date: string;
  end_date: string | null;
  reason: string;
  created_by: string | null;
  created_at: string;
  released_at: string | null;
  release_note: string;
  ticket_id?: string | null;
  rooms?: Pick<Room, "room_number"> | null;
  maintenance_tickets?: { id: string; reference: string; status: string } | null;
}

export interface Company {
  id: string;
  name: string;
  gstin: string;
  contact_name: string;
  email: string;
  phone: string;
  billing_address: string;
  credit_limit: number | null;
  payment_terms_days: number;
  notes: string;
  is_active: boolean;
}

export interface RatePlan {
  id: string;
  code: string;
  name: string;
  rate_type: RateType;
  description: string;
  meal_plan: MealPlan;
  /** 'fixed' sells the plan at adjustment_value outright, for packages. */
  adjustment_kind: AdjustmentKind;
  adjustment_value: number;
  room_type_ids: string[];
  company_id: string | null;
  inclusions: string[];
  is_refundable: boolean;
  free_cancellation_hours: number;
  cancellation_penalty: PenaltyKind;
  cancellation_penalty_percent: number;
  no_show_penalty: PenaltyKind;
  no_show_penalty_percent: number;
  deposit_percent: number;
  min_los: number | null;
  max_los: number | null;
  los_discount_min_nights: number | null;
  los_discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface RateSeason {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  room_type_id: string | null;
  days_of_week: number[];
  adjustment_kind: "percent" | "amount" | "fixed";
  adjustment_value: number;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface RateRestriction {
  id: string;
  start_date: string;
  end_date: string;
  room_type_id: string | null;
  rate_plan_id: string | null;
  min_los: number | null;
  max_los: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  note: string;
}

export interface ChannelAllocation {
  id: string;
  room_type_id: string;
  source: BookingSource;
  rooms: number;
}

export interface Guest {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string;
  city: string;
  country: string;
  nationality: string;
  tags: string[];
  notes: string;
  preferences: string;
  company_id: string | null;
  date_of_birth: string | null;
  anniversary: string | null;
  language: string;
  dietary: string;
  preferred_room_type_id: string | null;
  preferred_floor: number | null;
  blacklist_reason: string;
  marketing_opt_in: boolean;
  erased_at: string | null;
  loyalty_opt_in: boolean;
  loyalty_member_no: string | null;
  loyalty_tier: string | null;
  loyalty_joined_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface GuestStats {
  guest_id: string;
  stays: number;
  nights: number;
  last_stay: string | null;
  first_stay: string | null;
  next_arrival: string | null;
  cancellations: number;
  no_shows: number;
  total_spend: number;
}

export interface GuestFeedback {
  id: string;
  booking_id: string | null;
  guest_id: string | null;
  token: string | null;
  requested_at: string | null;
  submitted_at: string | null;
  overall: number | null;
  room: number | null;
  service: number | null;
  cleanliness: number | null;
  food: number | null;
  comment: string;
  source: "guest" | "desk";
  recorded_by: string | null;
  created_at: string;
}

/** Tags staff set by hand. Repeat Guest and Corporate are derived. */
export const MANUAL_GUEST_TAGS = ["VIP", "Blacklisted"] as const;
export const GUEST_TAGS = ["VIP", "Blacklisted", "Repeat Guest", "Corporate"] as const;
export type GuestTag = (typeof GUEST_TAGS)[number];

/** Every tag that applies, including the derived ones. */
export function guestTags(g: Pick<Guest, "tags" | "company_id">, stats?: Pick<GuestStats, "stays"> | null): GuestTag[] {
  const tags = new Set<GuestTag>((g.tags ?? []).filter((t): t is GuestTag => (GUEST_TAGS as readonly string[]).includes(t)));
  if ((stats?.stays ?? 0) >= 2) tags.add("Repeat Guest");
  if (g.company_id) tags.add("Corporate");
  return GUEST_TAGS.filter((t) => tags.has(t));
}

export const LANGUAGES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ur: "Urdu",
  ks: "Kashmiri",
  ar: "Arabic",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
};

export type MessageTemplateKey =
  | "request_received"
  | "confirmation"
  | "cancellation"
  | "final_bill"
  // SOW Module 16: the pre-arrival reminder, the check-in instructions and
  // the post-stay thank-you. Sent on a timer by the nightly job.
  | "pre_arrival"
  | "checkin_instructions"
  | "post_stay"
  // Trigger events: "payment received" and "booking modified".
  | "payment_receipt"
  | "booking_modified";

/** Messages the nightly job sends, keyed off a date rather than an action. */
export const TIMED_TEMPLATES = ["pre_arrival", "checkin_instructions", "post_stay"] as const;
export type TimedTemplate = (typeof TIMED_TEMPLATES)[number];

export type NotificationKind = "guest" | "staff";

export interface Notification {
  id: string;
  booking_id: string | null;
  guest_id: string | null;
  staff_id: string | null;
  kind: NotificationKind;
  channel: "email" | "sms";
  template: string;
  recipient: string;
  subject: string;
  body: string;
  status: "sent" | "skipped" | "failed";
  provider_id: string;
  error: string;
  created_by: string | null;
  created_at: string;
  bookings?: { id: string; reference: string } | null;
  staff?: { id: string; full_name: string } | null;
}

export interface MessageTemplate {
  template: MessageTemplateKey;
  language: string;
  subject: string;
  body: string;
  footer: string;
  sms: string;
  updated_by?: string | null;
  updated_at?: string;
}

export interface NightRate {
  date: string;
  rate: number;
}

export interface Booking {
  id: string;
  reference: string;
  guest_id: string | null;
  room_type_id: string | null;
  room_id: string | null;
  rate_plan_id: string | null;
  company_id: string | null;
  group_id: string | null;
  split_from_id: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rooms_count: number;
  status: BookingStatus;
  source: BookingSource;
  payment_method: PaymentMethod | null;
  /** The code as the guest typed it, kept even when it was not honoured. */
  promo_code: string;
  /** The code actually applied, and what it took off (Module 4). */
  promo_code_id: string | null;
  promo_discount: number;
  quoted_rate: number | null;
  total_amount: number | null;
  rate_breakdown: NightRate[];
  deposit_required: number;
  hold_until: string | null;
  preferred_floor: number | null;
  preferred_view: string;
  is_vip: boolean;
  eta: string | null;
  special_requests: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  cancelled_at: string | null;
  cancellation_reason: string;
  penalty_amount: number | null;
  penalty_waived: boolean;
  overbook_reason: string;
  confirmation_sent_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  guests?:
    | (Pick<Guest, "id" | "full_name" | "email" | "phone"> &
        Partial<
          Pick<Guest, "tags" | "blacklist_reason" | "loyalty_opt_in" | "loyalty_member_no" | "loyalty_tier">
        >)
    | null;
  room_types?: Pick<RoomType, "id" | "name"> | null;
  rooms?: Pick<Room, "id" | "room_number"> | null;
  rate_plans?: Pick<RatePlan, "id" | "code" | "name"> | null;
  companies?: Pick<Company, "id" | "name"> | null;
}

export interface BookingGroup {
  id: string;
  reference: string;
  name: string;
  company_id: string | null;
  rate_plan_id: string | null;
  organiser_name: string;
  organiser_phone: string;
  organiser_email: string;
  check_in: string;
  check_out: string;
  notes: string;
  created_at: string;
}

export interface FolioEntry {
  id: string;
  booking_id: string;
  folio_id: string;
  kind: FolioKind;
  description: string;
  stay_date: string | null;
  amount: number;
  tax_amount: number;
  tax_rate: number;
  method: PaymentMethod | null;
  reference: string;
  is_deposit: boolean;
  /** Set when the guest settled in a currency other than the property's. */
  fx_currency: string | null;
  fx_amount: number | null;
  fx_rate: number | null;
  night_audit_date: string | null;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

// ── Module 7: Billing & invoicing ───────────────────────────────────────────

export type FolioType = "master" | "split";

export interface Folio {
  id: string;
  booking_id: string;
  kind: FolioType;
  label: string;
  company_id: string | null;
  closed_at: string | null;
  created_at: string;
  companies?: Pick<Company, "id" | "name"> | null;
}

/** A charge as it was frozen onto an invoice. */
export interface InvoiceLine {
  date: string;
  description: string;
  kind: string;
  net: number;
  tax_rate: number;
  tax: number;
  total: number;
}

/** Charges grouped by tax rate — the rate-wise summary a GST invoice shows. */
export interface TaxBand {
  rate: number;
  net: number;
  tax: number;
}

export type InvoiceStatus = "issued" | "cancelled";

export interface Invoice {
  id: string;
  number: string;
  series: string;
  financial_year: string;
  seq: number;
  /** Null on an event invoice, which belongs to an event rather than a stay. */
  booking_id: string | null;
  folio_id: string | null;
  event_id: string | null;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_gstin: string;
  company_id: string | null;
  place_of_supply: string;
  currency: string;
  net_total: number;
  tax_total: number;
  grand_total: number;
  tax_breakdown: TaxBand[];
  lines: InvoiceLine[];
  status: InvoiceStatus;
  cancelled_at: string | null;
  cancel_reason: string;
  issued_at: string;
  issued_by: string | null;
  /** The rate a foreign-currency copy of this invoice reprints at. */
  fx_currency: string | null;
  fx_rate: number | null;
  bookings?: Pick<Booking, "reference" | "check_in" | "check_out"> | null;
  /** Joined on an event invoice, which has a function rather than a stay. */
  event_bookings?: { number: string; title: string; event_date: string } | null;
}

export type PaymentTxStatus = "created" | "paid" | "cancelled" | "expired" | "failed" | "refunded";

export interface PaymentTransaction {
  id: string;
  booking_id: string;
  folio_id: string | null;
  provider: "razorpay";
  provider_link_id: string | null;
  provider_ref: string | null;
  short_url: string;
  purpose: "deposit" | "settlement";
  amount: number;
  currency: string;
  status: PaymentTxStatus;
  folio_entry_id: string | null;
  paid_at: string | null;
  expires_at: string | null;
  last_event: string;
  created_at: string;
}

export type RefundStatus = "pending" | "approved" | "rejected" | "processed" | "failed";

export interface RefundRequest {
  id: string;
  booking_id: string;
  folio_id: string | null;
  amount: number;
  reason: string;
  method: PaymentMethod;
  payment_tx_id: string | null;
  status: RefundStatus;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  folio_entry_id: string | null;
  processed_at: string | null;
  error: string;
  bookings?: Pick<Booking, "reference" | "contact_name"> | null;
}

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  processed: "Refunded",
  failed: "Failed",
};

export interface GuestRequest {
  id: string;
  booking_id: string | null;
  room_id: string | null;
  kind: "wake_up_call" | "housekeeping" | "maintenance" | "message" | "request" | "complaint";
  description: string;
  due_at: string | null;
  status: "open" | "done" | "cancelled";
  created_at: string;
  completed_at: string | null;
}

export interface PropertySettings {
  name: string;
  legal_name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postcode: string;
  phone: string;
  email: string;
  gstin: string;
  currency: string;
  timezone: string;
  check_in_time: string;
  check_out_time: string;
  business_date: string;
  tax_inclusive: boolean;
  tax_slabs: unknown;
  tax_label: string;
  early_checkin_fee_type: "none" | "percent" | "flat";
  early_checkin_fee_value: number;
  late_checkout_fee_type: "none" | "percent" | "flat";
  late_checkout_fee_value: number;
  hold_hours: number;
  session_timeout_minutes: number;
  password_min_length: number;
  password_max_age_days: number;
  max_failed_logins: number;
  lockout_minutes: number;
  id_document_retention_days: number;
  hk_default_minutes: number;
  hk_deep_clean_days: number;
  mt_sla_low_hours: number;
  mt_sla_medium_hours: number;
  mt_sla_high_hours: number;
  mt_sla_urgent_hours: number;
  hr_geofence_lat: number | null;
  hr_geofence_lng: number | null;
  hr_geofence_radius_m: number;
  hr_require_geofence: boolean;
  hr_late_grace_minutes: number;
  default_language: string;
  languages: string[];
  invoice_prefix: string;
  invoice_terms: string;
  refund_approval_threshold: number;
  online_payments_enabled: boolean;
  multi_currency_enabled: boolean;
  ar_reminder_days: number;
  loyalty_enabled: boolean;
  loyalty_program_name: string;
  loyalty_expiry_months: number;
  loyalty_min_redeem_points: number;
  pos_room_charge_limit: number;
  event_quote_approval_threshold: number;
  event_service_charge_percent: number;
  event_advance_percent: number;
  event_terms: string;
  monthly_operating_cost: number;
  /** Best-rate guarantee wording on the booking portal (Module 17). */
  best_rate_message: string;
  /** Notification timings and staff alerts (Module 16). 0 days = off. */
  notify_pre_arrival_days: number;
  notify_checkin_days: number;
  notify_post_stay_days: number;
  notify_staff_new_booking: boolean;
  notify_staff_vip_arrival: boolean;
  notify_staff_ticket_assigned: boolean;
  revenue_auto_approve_percent: number;
  revenue_forecast_days: number;
  revenue_floor_rate: number;
  revenue_ceiling_rate: number;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  module: string;
  table_name: string;
  record_id: string | null;
  action: string;
  summary: string;
  changed: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export type HkTaskKind = "checkout" | "deep_clean";
export type HkTaskStatus = "pending" | "in_progress" | "cleaned" | "inspected" | "cancelled";

export interface ChecklistEntry {
  item_id: string;
  label: string;
  category: "linen" | "amenities" | "minibar";
  done: boolean;
  qty: number;
}

export interface HousekeepingTask {
  id: string;
  room_id: string;
  task_date: string;
  kind: HkTaskKind;
  status: HkTaskStatus;
  priority: "normal" | "high";
  assigned_to: string | null;
  target_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  inspected_at: string | null;
  inspection_note: string;
  failed_count: number;
  checklist: ChecklistEntry[];
  notes: string;
  created_at: string;
  rooms?: Pick<Room, "id" | "room_number" | "floor" | "status" | "housekeeping_status" | "dnd"> | null;
}

export interface HkZone {
  id: string;
  name: string;
  floors: number[];
  sort_order: number;
}

export interface HkChecklistItem {
  id: string;
  category: "linen" | "amenities" | "minibar";
  label: string;
  par_qty: number;
  sort_order: number;
  is_active: boolean;
}

export interface LostFoundItem {
  id: string;
  reference: string;
  room_id: string | null;
  location: string;
  found_on: string;
  description: string;
  category: "electronics" | "documents" | "jewellery" | "clothing" | "money" | "other";
  booking_id: string | null;
  storage_location: string;
  status: "stored" | "returned" | "disposed";
  returned_to: string;
  resolved_at: string | null;
  notes: string;
  created_at: string;
  rooms?: Pick<Room, "room_number"> | null;
  bookings?: Pick<Booking, "id" | "reference" | "contact_name" | "contact_phone"> | null;
}

export const HK_KIND_LABELS: Record<HkTaskKind, string> = {
  checkout: "Check-out clean",
  deep_clean: "Deep clean",
};

export const HK_STATUS_LABELS: Record<HkTaskStatus, string> = {
  pending: "To do",
  in_progress: "Cleaning",
  cleaned: "Awaiting inspection",
  inspected: "Ready for guest",
  cancelled: "Cancelled",
};

export const CHECKLIST_CATEGORY_LABELS = { linen: "Linen", amenities: "Amenities", minibar: "Minibar" } as const;

// ── Labels ─────────────────────────────────────────────────────────────────

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
  checked_in: "Checked In",
  checked_out: "Checked Out",
  cancelled: "Cancelled",
  no_show: "No Show",
  waitlisted: "Waitlisted",
};

export const BOOKING_SOURCE_LABELS: Record<BookingSource, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  email: "Email",
  website: "Website",
  ota: "OTA",
  travel_agent: "Travel Agent",
  corporate: "Corporate",
  mobile_app: "Mobile App",
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  available: "Available",
  occupied: "Occupied",
  out_of_order: "Out of Order",
  out_of_service: "Out of Service",
};

export const HOUSEKEEPING_STATUS_LABELS: Record<HousekeepingStatus, string> = {
  dirty: "Dirty",
  cleaning: "Cleaning",
  clean: "Clean",
  inspected: "Inspected",
};

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  bar: "Best Available Rate",
  corporate: "Corporate",
  package: "Package",
  promotional: "Promotional",
  group: "Group",
};

export const PENALTY_LABELS: Record<PenaltyKind, string> = {
  none: "No charge",
  first_night: "First night",
  full_stay: "Full stay",
  percent: "Percentage of stay",
};

export const MEAL_PLAN_LABELS: Record<MealPlan, string> = {
  EP: "Room only (EP)",
  CP: "Breakfast (CP)",
  MAP: "Breakfast + one meal (MAP)",
  AP: "All meals (AP)",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Credit / debit card",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  online_gateway: "Online payment",
  corporate_billing: "Company bill (direct billing)",
  ota_prepaid: "Prepaid via OTA",
  wallet: "Wallet",
  loyalty_points: "Loyalty points",
  other: "Other",
};

export const ID_TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  aadhaar: "Aadhaar",
  driving_licence: "Driving licence",
  voter_id: "Voter ID",
  pan: "PAN card",
  other: "Other",
};

export type GuestDocumentKind = "id_front" | "id_back" | "photo" | "visa" | "signature" | "other";

export interface GuestDocument {
  id: string;
  guest_id: string;
  booking_id: string | null;
  kind: GuestDocumentKind;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

export const DOCUMENT_KIND_LABELS: Record<GuestDocumentKind, string> = {
  id_front: "ID — front",
  id_back: "ID — back",
  photo: "Guest photo",
  visa: "Visa",
  signature: "Signature",
  other: "Other document",
};

export const REQUEST_KIND_LABELS: Record<GuestRequest["kind"], string> = {
  wake_up_call: "Wake-up call",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  message: "Message",
  request: "Request",
  complaint: "Complaint",
};

/** Tailwind classes per booking status, used by the status pill. */
export const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  tentative: "bg-amber-50 text-amber-800 border-amber-200",
  confirmed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  checked_in: "bg-blue-50 text-blue-800 border-blue-200",
  checked_out: "bg-slate-100 text-slate-700 border-slate-200",
  cancelled: "bg-rose-50 text-rose-800 border-rose-200",
  no_show: "bg-orange-50 text-orange-800 border-orange-200",
  waitlisted: "bg-violet-50 text-violet-800 border-violet-200",
};

/** Statuses that hold inventory. Must match enforce_booking_inventory(). */
export const OCCUPYING_STATUSES: BookingStatus[] = ["tentative", "confirmed", "checked_in"];

/** The room board's combined view, in the SOW's terms. */
export function roomBoardLabel(room: Pick<Room, "status" | "housekeeping_status">) {
  if (room.status === "occupied") return "Occupied";
  if (room.status === "out_of_order") return "Out of Order";
  if (room.status === "out_of_service") return "Out of Service";
  return room.housekeeping_status === "dirty" || room.housekeeping_status === "cleaning"
    ? "Vacant Dirty"
    : "Vacant Clean";
}

// ── Module 11: Maintenance ──────────────────────────────────────────────────

export type MtPriority = "low" | "medium" | "high" | "urgent";
export type MtStatus = "open" | "in_progress" | "on_hold" | "resolved" | "cancelled";
export type MtSource = "staff" | "guest_request" | "room_block" | "preventive";
export type AssetCategory =
  | "hvac"
  | "electrical"
  | "plumbing"
  | "elevator"
  | "boiler"
  | "kitchen"
  | "laundry"
  | "furniture"
  | "it"
  | "safety"
  | "other";

export interface MaintenanceTicket {
  id: string;
  reference: string;
  title: string;
  description: string;
  room_id: string | null;
  asset_id: string | null;
  location: string;
  priority: MtPriority;
  status: MtStatus;
  source: MtSource;
  request_id: string | null;
  schedule_id: string | null;
  affects_room: boolean;
  assigned_to: string | null;
  assigned_at: string | null;
  reported_by: string | null;
  due_at: string;
  started_at: string | null;
  hold_reason: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
  rooms?: { room_number: string } | null;
  assets?: { code: string; name: string } | null;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  category: AssetCategory;
  room_id: string | null;
  location: string;
  make: string;
  model: string;
  serial_number: string;
  installed_on: string | null;
  warranty_until: string | null;
  notes: string;
  is_active: boolean;
  created_at: string;
  rooms?: { room_number: string } | null;
}

export interface MaintenanceSchedule {
  id: string;
  title: string;
  description: string;
  asset_id: string | null;
  room_id: string | null;
  location: string;
  interval_days: number;
  next_due_on: string;
  priority: MtPriority;
  assigned_to: string | null;
  is_active: boolean;
  last_generated_on: string | null;
  created_at: string;
  rooms?: { room_number: string } | null;
  assets?: { code: string; name: string } | null;
}

export interface MaintenancePhoto {
  id: string;
  ticket_id: string;
  storage_path: string;
  stage: "report" | "resolution";
  uploaded_by: string | null;
  uploaded_at: string;
}

export const MT_PRIORITIES: MtPriority[] = ["low", "medium", "high", "urgent"];

export const MT_PRIORITY_LABELS: Record<MtPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const MT_STATUS_LABELS: Record<MtStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

export const MT_SOURCE_LABELS: Record<MtSource, string> = {
  staff: "Reported by staff",
  guest_request: "Guest request",
  room_block: "Room taken out of order",
  preventive: "Preventive schedule",
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  hvac: "AC / heating",
  electrical: "Electrical",
  plumbing: "Plumbing",
  elevator: "Elevator",
  boiler: "Boiler / hot water",
  kitchen: "Kitchen equipment",
  laundry: "Laundry",
  furniture: "Furniture & fixtures",
  it: "IT & TV",
  safety: "Fire & safety",
  other: "Other",
};

// ── Module 12: HR ───────────────────────────────────────────────────────────

export interface Department {
  id: string;
  name: string;
  sort_order: number;
}

export type ShiftColor = "slate" | "yellow" | "orange" | "indigo" | "emerald" | "rose" | "sky" | "violet";

export interface ShiftType {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  start_time_2: string | null;
  end_time_2: string | null;
  color: ShiftColor;
  sort_order: number;
  is_active: boolean;
}

export interface StaffShift {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_type_id: string | null;
  notes: string;
}

export type AttendanceMethod = "manual" | "self" | "mobile" | "biometric";

export interface AttendanceRecord {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  method: AttendanceMethod;
  in_distance_m: number | null;
  out_distance_m: number | null;
  notes: string;
  recorded_by: string | null;
  created_at: string;
}

export type LeaveKind = "casual" | "sick" | "earned" | "unpaid" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  staff_id: string;
  kind: LeaveKind;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
}

export interface StaffFeedback {
  id: string;
  staff_id: string;
  booking_id: string | null;
  rating: number;
  comment: string;
  source: "guest" | "manager";
  recorded_by: string | null;
  created_at: string;
}

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  casual: "Casual leave",
  sick: "Sick leave",
  earned: "Earned leave",
  unpaid: "Unpaid leave",
  other: "Other",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  manual: "Manual entry",
  self: "Self clock-in",
  mobile: "Phone (location checked)",
  biometric: "Biometric device",
};

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Module 7: City ledger and multi-currency ────────────────────────────────

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  rate_to_base: number;
  decimals: number;
  is_active: boolean;
  updated_at: string;
}

export type CityLedgerKind = "charge" | "payment" | "adjustment" | "writeoff";

export const CITY_LEDGER_KIND_LABELS: Record<CityLedgerKind, string> = {
  charge: "Charge",
  payment: "Payment received",
  adjustment: "Credit note",
  writeoff: "Written off",
};

export interface CityLedgerEntry {
  id: string;
  company_id: string;
  kind: CityLedgerKind;
  amount: number;
  description: string;
  booking_id: string | null;
  folio_id: string | null;
  invoice_id: string | null;
  folio_entry_id: string | null;
  due_date: string | null;
  method: PaymentMethod | null;
  reference: string;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
  companies?: Pick<Company, "name"> | null;
  bookings?: Pick<Booking, "reference"> | null;
  invoices?: Pick<Invoice, "number"> | null;
}

// ── Module 8: Loyalty ───────────────────────────────────────────────────────

export interface LoyaltyTier {
  key: string;
  name: string;
  sort_order: number;
  min_nights: number;
  min_spend: number;
  earn_rate: number;
  redeem_rate: number;
  perks: string;
  colour: string;
  is_active: boolean;
}

export type LoyaltyTxKind = "earn" | "redeem" | "expire" | "adjust";

export const LOYALTY_TX_LABELS: Record<LoyaltyTxKind, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  expire: "Expired",
  adjust: "Correction",
};

export interface LoyaltyTransaction {
  id: string;
  guest_id: string;
  kind: LoyaltyTxKind;
  points: number;
  remaining: number;
  base_amount: number;
  booking_id: string | null;
  invoice_id: string | null;
  folio_entry_id: string | null;
  source_id: string | null;
  tier: string | null;
  description: string;
  expires_on: string | null;
  created_at: string;
  guests?: Pick<Guest, "full_name" | "loyalty_member_no"> | null;
  bookings?: Pick<Booking, "reference"> | null;
}

export interface LoyaltyTierChange {
  id: string;
  guest_id: string;
  from_tier: string | null;
  to_tier: string | null;
  reason: string;
  nights: number;
  spend: number;
  changed_at: string;
}


// ── Module 6: Point of Sale ─────────────────────────────────────────────────

/** The seven outlet types the SOW names. */
export type OutletKind =
  | "restaurant"
  | "bar"
  | "spa"
  | "gift_shop"
  | "mini_bar"
  | "room_service"
  | "laundry";

export const OUTLET_KIND_LABELS: Record<OutletKind, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  spa: "Spa / Wellness",
  gift_shop: "Gift Shop",
  mini_bar: "Mini-Bar",
  room_service: "Room Service",
  laundry: "Laundry",
};

export interface Outlet {
  id: string;
  code: string;
  name: string;
  kind: OutletKind;
  tax_rate: number;
  tax_inclusive: boolean;
  service_charge_percent: number;
  orders_by: "table" | "room" | "either";
  sends_kot: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface PosCategory {
  id: string;
  outlet_id: string;
  name: string;
  /** Null inherits the outlet's rate. */
  tax_rate: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface PosItem {
  id: string;
  outlet_id: string;
  category_id: string | null;
  code: string;
  name: string;
  description: string;
  price: number;
  /** Null inherits the category's rate, then the outlet's. */
  tax_rate: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface PosModifier {
  id: string;
  outlet_id: string;
  name: string;
  price_delta: number;
  is_active: boolean;
  sort_order: number;
}

export type PosOrderStatus = "open" | "billed" | "settled" | "void";

export const POS_ORDER_STATUS_LABELS: Record<PosOrderStatus, string> = {
  open: "Open",
  billed: "Part paid",
  settled: "Settled",
  void: "Void",
};

/** A modifier as frozen onto a line at the moment it was ordered. */
export interface PosLineModifier {
  name: string;
  price_delta: number;
}

export interface PosOrder {
  id: string;
  number: string;
  outlet_id: string;
  table_no: string;
  room_id: string | null;
  booking_id: string | null;
  guest_name: string;
  covers: number;
  status: PosOrderStatus;
  net_total: number;
  tax_total: number;
  service_net: number;
  service_tax: number;
  tip_amount: number;
  grand_total: number;
  notes: string;
  split_from_id: string | null;
  opened_at: string;
  closed_at: string | null;
  voided_at: string | null;
  void_reason: string;
  pos_outlets?: Pick<Outlet, "name" | "code" | "kind" | "sends_kot"> | null;
  rooms?: { room_number: string } | null;
  bookings?: Pick<Booking, "reference" | "contact_name" | "status"> | null;
}

export interface PosOrderLine {
  id: string;
  order_id: string;
  item_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  modifiers: PosLineModifier[];
  notes: string;
  net_amount: number;
  tax_rate: number;
  tax_amount: number;
  kot_sent_at: string | null;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

export type PosPaymentKind = "cash" | "card" | "upi" | "room_charge" | "loyalty_points" | "other";

export const POS_PAYMENT_KIND_LABELS: Record<PosPaymentKind, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  room_charge: "Charged to room",
  loyalty_points: "Loyalty points",
  other: "Other",
};

export interface PosPayment {
  id: string;
  order_id: string;
  kind: PosPaymentKind;
  amount: number;
  booking_id: string | null;
  folio_id: string | null;
  points: number | null;
  reference: string;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}


// ── Module 13: Reporting ────────────────────────────────────────────────────

export type ReportFrequency = "daily" | "weekly" | "monthly";

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  daily: "Every day",
  weekly: "Every Monday",
  monthly: "First of the month",
};

export interface ReportSchedule {
  id: string;
  name: string;
  report: string;
  frequency: ReportFrequency;
  recipients: string;
  is_active: boolean;
  last_sent_at: string | null;
  last_status: string;
  created_at: string;
}


// ── Module 10: Banquets, conferences and events ─────────────────────────────

export interface EventSpace {
  id: string;
  code: string;
  name: string;
  description: string;
  floor: number | null;
  area_sqft: number | null;
  rental_full_day: number;
  rental_half_day: number;
  rental_per_hour: number;
  min_charge: number;
  tax_rate: number;
  setup_minutes: number;
  teardown_minutes: number;
  is_active: boolean;
  sort_order: number;
}

export interface EventLayout {
  id: string;
  space_id: string;
  name: string;
  capacity: number;
  notes: string;
  is_active: boolean;
  sort_order: number;
}

export type MealPeriod = "breakfast" | "lunch" | "hi_tea" | "dinner" | "full_day" | "custom";

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  hi_tea: "Hi-tea",
  dinner: "Dinner",
  full_day: "Full day",
  custom: "Other",
};

export interface EventPackage {
  id: string;
  code: string;
  name: string;
  description: string;
  meal_period: MealPeriod;
  price_per_head: number;
  tax_rate: number;
  min_pax: number;
  inclusions: string[];
  is_active: boolean;
  sort_order: number;
}

export interface EventEquipment {
  id: string;
  /** Null when the item travels between spaces rather than living in one. */
  space_id: string | null;
  name: string;
  description: string;
  unit: string;
  rental_price: number;
  tax_rate: number;
  qty_available: number;
  is_active: boolean;
  sort_order: number;
}

export type EventType =
  | "conference"
  | "residential_conference"
  | "corporate_meeting"
  | "training"
  | "wedding"
  | "reception"
  | "banquet"
  | "birthday"
  | "exhibition"
  | "other";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  conference: "Conference",
  residential_conference: "Residential conference",
  corporate_meeting: "Corporate meeting",
  training: "Training",
  wedding: "Wedding",
  reception: "Reception",
  banquet: "Banquet",
  birthday: "Birthday",
  exhibition: "Exhibition",
  other: "Other",
};

export type EventStatus = "enquiry" | "quoted" | "confirmed" | "completed" | "cancelled";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  enquiry: "Enquiry",
  quoted: "Quoted",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type RentalBasis = "full_day" | "half_day" | "hourly" | "custom" | "waived";

export const RENTAL_BASIS_LABELS: Record<RentalBasis, string> = {
  full_day: "Full day",
  half_day: "Half day",
  hourly: "By the hour",
  custom: "Agreed amount",
  waived: "No hall charge",
};

export interface EventBooking {
  id: string;
  number: string;
  financial_year: string;
  seq: number;
  space_id: string;
  layout_id: string | null;
  title: string;
  event_type: EventType;
  guest_id: string | null;
  company_id: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  payment_terms: string;
  booking_id: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  setup_from: string;
  teardown_to: string;
  pax_expected: number;
  pax_guaranteed: number;
  pax_actual: number | null;
  package_id: string | null;
  menu_notes: string;
  rental_basis: RentalBasis;
  rental_hours: number;
  rental_override: number | null;
  discount_percent: number;
  rental_net: number;
  rental_tax: number;
  catering_net: number;
  catering_tax: number;
  equipment_net: number;
  equipment_tax: number;
  other_net: number;
  other_tax: number;
  service_net: number;
  service_tax: number;
  discount_amount: number;
  net_total: number;
  tax_total: number;
  grand_total: number;
  tax_breakdown: TaxBand[];
  status: EventStatus;
  quoted_at: string | null;
  quoted_by: string | null;
  approval_required: boolean;
  approved_at: string | null;
  approved_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  contract_signed_on: string | null;
  contract_signed_name: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string;
  beo_setup_notes: string;
  beo_service_notes: string;
  beo_av_notes: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Joined for the diary and the documents. */
  event_spaces?: Pick<EventSpace, "name" | "code" | "tax_rate"> | null;
  event_layouts?: Pick<EventLayout, "name" | "capacity"> | null;
  event_packages?: Pick<EventPackage, "name" | "price_per_head" | "tax_rate" | "inclusions"> | null;
  companies?: Pick<Company, "name" | "gstin" | "billing_address"> | null;
  guests?: Pick<Guest, "full_name" | "phone" | "email"> | null;
  bookings?: Pick<Booking, "reference" | "check_in" | "check_out"> | null;
}

export type EventLineKind = "equipment" | "food_extra" | "decor" | "other";

export const EVENT_LINE_KIND_LABELS: Record<EventLineKind, string> = {
  equipment: "Equipment",
  food_extra: "Food and drink",
  decor: "Decor",
  other: "Other",
};

export interface EventLine {
  id: string;
  event_id: string;
  kind: EventLineKind;
  equipment_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  tax_rate: number;
  net_amount: number;
  tax_amount: number;
  sort_order: number;
  created_at: string;
}

export type EventPaymentKind = "advance" | "payment" | "refund" | "room_charge" | "company_account";

export const EVENT_PAYMENT_KIND_LABELS: Record<EventPaymentKind, string> = {
  advance: "Deposit",
  payment: "Payment",
  refund: "Refund",
  room_charge: "Billed to a room",
  company_account: "Billed to a company",
};

export interface EventPayment {
  id: string;
  event_id: string;
  kind: EventPaymentKind;
  amount: number;
  method: PaymentMethod | null;
  reference: string;
  notes: string;
  booking_id: string | null;
  folio_id: string | null;
  city_ledger_entry_id: string | null;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

// ── Module 4: Revenue & dynamic pricing ─────────────────────────────────────

export type AdjustmentKind = "percent" | "amount" | "fixed";
export type PricingAdjustmentStatus = "pending" | "applied" | "rejected" | "expired";
export type PackageBasis = "per_stay" | "per_night" | "per_person_per_stay" | "per_person_per_night";
export type DiscountKind = "percent" | "amount";

export const PACKAGE_BASIS_LABELS: Record<PackageBasis, string> = {
  per_stay: "Once per stay",
  per_night: "Each night",
  per_person_per_stay: "Per person, once",
  per_person_per_night: "Per person, each night",
};

export const PRICING_ADJUSTMENT_STATUS_LABELS: Record<PricingAdjustmentStatus, string> = {
  pending: "Waiting for approval",
  applied: "Live",
  rejected: "Rejected",
  expired: "Expired",
};

export interface PackageComponent {
  id: string;
  rate_plan_id: string;
  name: string;
  description: string;
  retail_value: number;
  basis: PackageBasis;
  quantity: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface PricingRule {
  id: string;
  name: string;
  description: string;
  room_type_id: string | null;
  min_occupancy: number | null;
  max_occupancy: number | null;
  days_of_week: number[];
  start_date: string | null;
  end_date: string | null;
  occasion: string;
  min_lead_days: number | null;
  max_lead_days: number | null;
  adjustment_kind: AdjustmentKind;
  adjustment_value: number;
  floor_rate: number;
  ceiling_rate: number;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingAdjustment {
  id: string;
  stay_date: string;
  room_type_id: string;
  rule_id: string | null;
  rule_name: string;
  occasion: string;
  base_rate: number;
  proposed_rate: number;
  change_percent: number;
  occupancy_percent: number | null;
  rooms_sold: number | null;
  capacity: number | null;
  status: PricingAdjustmentStatus;
  threshold_percent: number;
  note: string;
  created_at: string;
  created_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  room_types?: Pick<RoomType, "id" | "name"> | null;
}

export interface CompetitorProperty {
  id: string;
  name: string;
  source: string;
  notes: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface CompetitorRate {
  id: string;
  competitor_id: string;
  stay_date: string;
  room_type_id: string | null;
  rate: number;
  meal_plan: MealPlan;
  tax_inclusive: boolean;
  sold_out: boolean;
  note: string;
  observed_at: string;
  observed_by: string | null;
  competitor_properties?: Pick<CompetitorProperty, "id" | "name"> | null;
}

export interface PromoCode {
  id: string;
  code: string;
  name: string;
  description: string;
  discount_kind: DiscountKind;
  discount_value: number;
  max_discount: number;
  room_type_ids: string[];
  rate_plan_ids: string[];
  valid_from: string | null;
  valid_to: string | null;
  stay_from: string | null;
  stay_to: string | null;
  min_nights: number | null;
  min_amount: number;
  max_redemptions: number | null;
  max_per_guest: number | null;
  redemption_count: number;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface PromoRedemption {
  id: string;
  promo_code_id: string;
  booking_id: string;
  guest_id: string | null;
  email: string;
  discount_amount: number;
  redeemed_at: string;
}

/** One night of the forecast, for one room type. */
export interface ForecastRow {
  stay_date: string;
  room_type_id: string;
  capacity: number;
  rooms_sold: number;
  revenue_on_books: number;
}
