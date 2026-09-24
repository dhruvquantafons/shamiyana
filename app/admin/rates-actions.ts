"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { friendlyDbError } from "../lib/db-errors";
import type { BookingSource, PenaltyKind, RateType } from "../lib/types";
import {
  type ActionState,
  str,
  num,
  int,
  bool,
  oneOf,
  dateStr,
  uuidOrNull,
  lines,
} from "./form-utils";

const RATE_TYPES: RateType[] = ["bar", "corporate", "package", "promotional", "group"];
const PENALTIES: PenaltyKind[] = ["none", "first_night", "full_stay", "percent"];
/** Channels that can be capped; staff-entered bookings are limited only by inventory. */
const CHANNELS: BookingSource[] = ["website", "ota", "travel_agent", "corporate", "mobile_app"];

function revalidateRates() {
  revalidatePath("/admin/rates", "layout");
  revalidatePath("/admin/bookings/new");
  // Rates appear on several statically rendered public pages; revalidating
  // the root layout refreshes every one of them.
  revalidatePath("/", "layout");
}

const numOrNull = (fd: FormData, key: string, min: number, max: number) => {
  const n = num(fd, key);
  return n === null ? null : Math.min(max, Math.max(min, n));
};

// ── Room types ──────────────────────────────────────────────────────────────

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function roomTypeFields(fd: FormData) {
  return {
    name: str(fd, "name", 120),
    category: slugify(str(fd, "category")) || "rooms",
    tagline: str(fd, "tagline", 300),
    description: str(fd, "description"),
    size: str(fd, "size", 60),
    occupancy: str(fd, "occupancy", 60),
    view: str(fd, "view", 80),
    highlights: lines(fd, "highlights", 6),
    amenities: lines(fd, "amenities", 40),
    base_rate: num(fd, "base_rate"),
    weekend_rate: numOrNull(fd, "weekend_rate", 0, 10_000_000),
    cleaning_minutes: numOrNull(fd, "cleaning_minutes", 5, 480),
    base_occupancy: int(fd, "base_occupancy", 2, 1, 20),
    max_adults: int(fd, "max_adults", 2, 1, 20),
    max_children: int(fd, "max_children", 1, 0, 20),
    is_active: bool(fd, "is_active"),
  };
}

export async function createRoomType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const fields = roomTypeFields(fd);

  if (!fields.name) return { error: "Give the room type a name." };
  if (fields.base_rate === null || fields.base_rate < 0) return { error: "Enter a valid nightly rate." };
  if (fields.base_occupancy > fields.max_adults) return { error: "Included adults cannot exceed the maximum." };

  const baseSlug = slugify(fields.name);
  if (!baseSlug) return { error: "That name cannot be turned into a web address." };

  const { data: lastRow } = await supabase
    .from("room_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = { ...fields, sort_order: (lastRow?.sort_order ?? 0) + 1 };
  let inserted = await supabase.from("room_types").insert({ ...payload, slug: baseSlug });
  if (inserted.error?.code === "23505") {
    inserted = await supabase
      .from("room_types")
      .insert({ ...payload, slug: `${baseSlug}-${Date.now().toString().slice(-4)}` });
  }
  if (inserted.error) return { error: friendlyDbError(inserted.error.message) };

  revalidateRates();
  revalidatePath("/admin/rooms");
  return { success: `${fields.name} created. Add a photo below, and it will appear on the website.` };
}

export async function updateRoomType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const fields = roomTypeFields(fd);

  if (!fields.name) return { error: "Name is required." };
  if (fields.base_rate === null || fields.base_rate < 0) return { error: "Enter a valid nightly rate." };
  if (fields.base_occupancy > fields.max_adults) return { error: "Included adults cannot exceed the maximum." };

  const { error } = await supabase.from("room_types").update(fields).eq("id", str(fd, "id"));
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRates();
  return { success: "Saved. The public site now shows these details." };
}

export async function deleteRoomType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const id = str(fd, "id");

  const [{ count: roomCount }, { count: bookingCount }] = await Promise.all([
    supabase.from("rooms").select("id", { count: "exact", head: true }).eq("room_type_id", id),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("room_type_id", id),
  ]);
  if ((roomCount ?? 0) > 0) {
    return { error: `Still used by ${roomCount} room(s) in inventory. Reassign or remove them first.` };
  }
  if ((bookingCount ?? 0) > 0) {
    return { error: `Used by ${bookingCount} booking(s). Untick "Show on website" to retire it instead.` };
  }

  const { error } = await supabase.from("room_types").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRates();
  return { success: "Room type deleted." };
}

export async function updateExtraCharge(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const amount = num(fd, "amount");
  if (amount === null || amount < 0) return { error: "Enter a valid amount." };

  const { error } = await supabase
    .from("extra_charges")
    .update({ label: str(fd, "label", 120), amount })
    .eq("id", str(fd, "id"));
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRates();
  return { success: "Charge updated." };
}

// ── Room photography ────────────────────────────────────────────────────────

const ROOM_PHOTO_BUCKET = "room-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${ROOM_PHOTO_BUCKET}/`;
  const at = url.indexOf(marker);
  return at === -1 ? null : url.slice(at + marker.length);
}

/**
 * Uploads a room photo. "cover" replaces the main image shown on the site;
 * "gallery" adds to the room type's photo set (SOW: room types "with photos").
 */
export async function uploadRoomPhoto(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");

  const id = str(fd, "id");
  const target = oneOf(fd, "target", ["cover", "gallery"] as const, "cover");
  const file = fd.get("photo");

  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return { error: "Use a JPEG, PNG, WebP or AVIF image." };
  if (file.size > MAX_PHOTO_BYTES) return { error: "That image is larger than 5 MB. Please compress it first." };

  const supabase = await createClient();
  const { data: roomType } = await supabase
    .from("room_types")
    .select("slug, image, gallery")
    .eq("id", id)
    .single();
  if (!roomType) return { error: "Room type not found." };

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const objectPath = `${roomType.slug}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(ROOM_PHOTO_BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  const {
    data: { publicUrl },
  } = supabase.storage.from(ROOM_PHOTO_BUCKET).getPublicUrl(objectPath);

  const update =
    target === "cover" ? { image: publicUrl } : { gallery: [...(roomType.gallery ?? []), publicUrl].slice(0, 20) };
  const { error: saveError } = await supabase.from("room_types").update(update).eq("id", id);
  if (saveError) {
    await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([objectPath]);
    return { error: friendlyDbError(saveError.message) };
  }

  if (target === "cover") {
    const previous = storagePathFromUrl(roomType.image ?? "");
    if (previous && previous !== objectPath && !(roomType.gallery ?? []).includes(roomType.image)) {
      await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([previous]);
    }
  }

  revalidateRates();
  return { success: target === "cover" ? "Main photo updated." : "Added to the gallery." };
}

export async function removeGalleryPhoto(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const id = str(fd, "id");
  const url = str(fd, "url", 1000);

  const { data: roomType } = await supabase.from("room_types").select("image, gallery").eq("id", id).single();
  if (!roomType) return { error: "Room type not found." };

  const { error } = await supabase
    .from("room_types")
    .update({ gallery: (roomType.gallery ?? []).filter((u: string) => u !== url) })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  const path = storagePathFromUrl(url);
  if (path && url !== roomType.image) await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([path]);

  revalidateRates();
  return { success: "Photo removed." };
}

// ── Rate plans ──────────────────────────────────────────────────────────────

export async function saveRatePlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");

  const code = str(fd, "code", 20).toUpperCase().replace(/\s+/g, "-");
  const name = str(fd, "name", 120);
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) {
    return { error: "Code: 2–20 letters, numbers, dashes or underscores (e.g. CORP-TCS)." };
  }
  if (!name) return { error: "Name the plan." };

  const minLos = numOrNull(fd, "min_los", 1, 365);
  const maxLos = numOrNull(fd, "max_los", 1, 365);
  if (minLos && maxLos && maxLos < minLos) return { error: "Maximum stay cannot be less than the minimum." };
  const validFrom = dateStr(fd, "valid_from") || null;
  const validTo = dateStr(fd, "valid_to") || null;
  if (validFrom && validTo && validTo < validFrom) return { error: "Check the validity dates." };

  const rateType = oneOf(fd, "rate_type", RATE_TYPES, "bar");
  const companyId = uuidOrNull(fd, "company_id");
  if (rateType === "corporate" && !companyId) return { error: "A corporate plan needs a company." };

  const isRefundable = bool(fd, "is_refundable");
  const payload = {
    code,
    name,
    rate_type: rateType,
    description: str(fd, "description", 1000),
    meal_plan: oneOf(fd, "meal_plan", ["EP", "CP", "MAP", "AP"] as const, "CP"),
    adjustment_kind: oneOf(fd, "adjustment_kind", ["percent", "amount", "fixed"] as const, "percent"),
    adjustment_value: num(fd, "adjustment_value") ?? 0,
    room_type_ids: fd.getAll("room_type_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
    company_id: rateType === "corporate" ? companyId : null,
    inclusions: lines(fd, "inclusions", 20),
    is_refundable: isRefundable,
    free_cancellation_hours: isRefundable ? int(fd, "free_cancellation_hours", 48, 0, 8760) : 0,
    cancellation_penalty: oneOf(fd, "cancellation_penalty", PENALTIES, "first_night"),
    cancellation_penalty_percent: numOrNull(fd, "cancellation_penalty_percent", 0, 100) ?? 0,
    no_show_penalty: oneOf(fd, "no_show_penalty", PENALTIES, "first_night"),
    no_show_penalty_percent: numOrNull(fd, "no_show_penalty_percent", 0, 100) ?? 0,
    deposit_percent: numOrNull(fd, "deposit_percent", 0, 100) ?? 0,
    min_los: minLos === null ? null : Math.round(minLos),
    max_los: maxLos === null ? null : Math.round(maxLos),
    los_discount_min_nights: numOrNull(fd, "los_discount_min_nights", 2, 365),
    los_discount_percent: numOrNull(fd, "los_discount_percent", 0, 100),
    valid_from: validFrom,
    valid_to: validTo,
    is_public: bool(fd, "is_public"),
    is_active: bool(fd, "is_active"),
  };

  const { error } = id
    ? await supabase.from("rate_plans").update(payload).eq("id", id)
    : await supabase.from("rate_plans").insert(payload);
  if (error) {
    return { error: error.code === "23505" ? `The code ${code} is already used.` : friendlyDbError(error.message) };
  }

  revalidateRates();
  return { success: id ? "Plan saved." : `${name} created.` };
}

// ── Seasons ─────────────────────────────────────────────────────────────────

export async function saveSeason(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");

  const name = str(fd, "name", 120);
  const start = dateStr(fd, "start_date");
  const end = dateStr(fd, "end_date");
  const value = num(fd, "adjustment_value");
  const days = fd.getAll("days_of_week").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

  if (!name) return { error: "Name the season." };
  if (!start || !end || end < start) return { error: "Check the season's dates." };
  if (value === null) return { error: "Enter the adjustment." };
  if (days.length === 0) return { error: "Choose at least one day of the week." };

  const kind = oneOf(fd, "adjustment_kind", ["percent", "amount", "fixed"] as const, "percent");
  if (kind === "fixed" && value < 0) return { error: "A fixed rate cannot be negative." };
  if (kind === "percent" && value <= -100) return { error: "A discount must be less than 100%." };

  const payload = {
    name,
    start_date: start,
    end_date: end,
    room_type_id: uuidOrNull(fd, "room_type_id"),
    days_of_week: [...new Set(days)].sort(),
    adjustment_kind: kind,
    adjustment_value: value,
    priority: int(fd, "priority", 0, -100, 100),
    is_active: bool(fd, "is_active"),
  };

  const { error } = id
    ? await supabase.from("rate_seasons").update(payload).eq("id", id)
    : await supabase.from("rate_seasons").insert(payload);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRates();
  return { success: id ? "Season saved." : "Season added." };
}

export async function deleteSeason(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("rate_seasons").delete().eq("id", str(fd, "id"));
  if (error) return { error: friendlyDbError(error.message) };
  revalidateRates();
  return { success: "Season removed." };
}

// ── Restrictions ────────────────────────────────────────────────────────────

export async function saveRestriction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();

  const start = dateStr(fd, "start_date");
  const end = dateStr(fd, "end_date") || start;
  if (!start || end < start) return { error: "Check the dates." };

  const minLos = numOrNull(fd, "min_los", 1, 365);
  const maxLos = numOrNull(fd, "max_los", 1, 365);
  const payload = {
    start_date: start,
    end_date: end,
    room_type_id: uuidOrNull(fd, "room_type_id"),
    rate_plan_id: uuidOrNull(fd, "rate_plan_id"),
    min_los: minLos === null ? null : Math.round(minLos),
    max_los: maxLos === null ? null : Math.round(maxLos),
    closed_to_arrival: bool(fd, "closed_to_arrival"),
    closed_to_departure: bool(fd, "closed_to_departure"),
    stop_sell: bool(fd, "stop_sell"),
    note: str(fd, "note", 300),
  };

  if (
    !payload.min_los &&
    !payload.max_los &&
    !payload.closed_to_arrival &&
    !payload.closed_to_departure &&
    !payload.stop_sell
  ) {
    return { error: "Set at least one restriction." };
  }
  if (payload.min_los && payload.max_los && payload.max_los < payload.min_los) {
    return { error: "Maximum stay cannot be less than the minimum." };
  }

  const { error } = await supabase.from("rate_restrictions").insert(payload);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRates();
  return { success: "Restriction added." };
}

export async function deleteRestriction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const { error } = await supabase.from("rate_restrictions").delete().eq("id", str(fd, "id"));
  if (error) return { error: friendlyDbError(error.message) };
  revalidateRates();
  return { success: "Restriction removed." };
}

// ── Channel allocations ─────────────────────────────────────────────────────

/** One form per room type: a cap per channel, blank for "no limit". */
export async function saveAllocations(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rates.manage");
  const supabase = await createClient();
  const roomTypeId = uuidOrNull(fd, "room_type_id");
  if (!roomTypeId) return { error: "Room type not found." };

  const upserts: { room_type_id: string; source: BookingSource; rooms: number }[] = [];
  const removals: BookingSource[] = [];
  for (const channel of CHANNELS) {
    const n = num(fd, `alloc_${channel}`);
    if (n === null) removals.push(channel);
    else upserts.push({ room_type_id: roomTypeId, source: channel, rooms: Math.max(0, Math.round(n)) });
  }

  if (upserts.length) {
    const { error } = await supabase
      .from("channel_allocations")
      .upsert(upserts, { onConflict: "room_type_id,source" });
    if (error) return { error: friendlyDbError(error.message) };
  }
  if (removals.length) {
    await supabase.from("channel_allocations").delete().eq("room_type_id", roomTypeId).in("source", removals);
  }

  revalidateRates();
  return { success: "Allocations saved." };
}

// ── Corporate accounts ──────────────────────────────────────────────────────

export async function saveCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("companies.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 200);
  if (!name) return { error: "Company name is required." };

  const gstin = str(fd, "gstin", 15).toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
    return { error: "A GSTIN is 15 characters, starting with the 2-digit state code." };
  }

  const payload = {
    name,
    gstin,
    contact_name: str(fd, "contact_name", 200),
    email: str(fd, "email", 200).toLowerCase(),
    phone: str(fd, "phone", 50),
    billing_address: str(fd, "billing_address", 1000),
    credit_limit: numOrNull(fd, "credit_limit", 0, 1_000_000_000),
    payment_terms_days: int(fd, "payment_terms_days", 30, 0, 365),
    notes: str(fd, "notes", 1000),
    is_active: bool(fd, "is_active"),
  };

  const { error } = id
    ? await supabase.from("companies").update(payload).eq("id", id)
    : await supabase.from("companies").insert(payload);
  if (error) {
    return { error: error.code === "23505" ? `${name} already exists.` : friendlyDbError(error.message) };
  }

  revalidatePath("/admin/companies");
  revalidatePath("/admin/bookings/new");
  return { success: id ? "Company saved." : `${name} added.` };
}
