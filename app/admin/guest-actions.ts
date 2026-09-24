"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requirePermission, requireAnyPermission } from "../lib/auth";
import { friendlyDbError } from "../lib/db-errors";
import { LANGUAGES } from "../lib/types";
import { type ActionState, str, int, num, bool, dateStr, uuidOrNull } from "./form-utils";

/** Module 8 — Guest CRM. */

function revalidateGuest(id?: string) {
  revalidatePath("/admin/guests", "layout");
  if (id) revalidatePath(`/admin/guests/${id}`);
}

export async function updateGuestProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("guests.edit");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Guest not found." };
  const name = str(fd, "full_name", 200);
  if (!name) return { error: "The guest needs a name." };
  const email = str(fd, "email", 200).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email address does not look right." };

  const blacklisted = bool(fd, "blacklisted");
  const reason = str(fd, "blacklist_reason", 500);
  if (blacklisted && !reason) return { error: "Say why the guest is blacklisted — the desk sees this at booking and check-in." };

  const { data: current } = await supabase.from("guests").select("tags, erased_at").eq("id", id).maybeSingle();
  if (!current) return { error: "Guest not found." };
  if (current.erased_at) return { error: "This guest's data was erased; the profile cannot be edited." };
  const tags = new Set<string>((current.tags ?? []).filter((t: string) => t !== "VIP" && t !== "Blacklisted"));
  if (bool(fd, "vip")) tags.add("VIP");
  if (blacklisted) tags.add("Blacklisted");

  const language = str(fd, "language", 2);
  const floor = num(fd, "preferred_floor");
  const { error } = await supabase
    .from("guests")
    .update({
      full_name: name,
      email: email || null,
      phone: str(fd, "phone", 50) || null,
      address: str(fd, "address", 500),
      city: str(fd, "city", 100),
      country: str(fd, "country", 100) || "India",
      nationality: str(fd, "nationality", 80) || "Indian",
      date_of_birth: dateStr(fd, "date_of_birth") || null,
      anniversary: dateStr(fd, "anniversary") || null,
      language: language in LANGUAGES ? language : "en",
      dietary: str(fd, "dietary", 300),
      preferences: str(fd, "preferences", 1000),
      preferred_room_type_id: uuidOrNull(fd, "preferred_room_type_id"),
      preferred_floor: floor !== null && Number.isInteger(floor) && floor >= -5 && floor <= 200 ? floor : null,
      company_id: uuidOrNull(fd, "company_id"),
      notes: str(fd, "notes", 4000),
      marketing_opt_in: bool(fd, "marketing_opt_in"),
      tags: [...tags],
      blacklist_reason: blacklisted ? reason : "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };
  revalidateGuest(id);
  return { success: "Profile saved." };
}

/** Feedback taken by the desk (in person, by phone, from a review site). */
export async function recordFeedback(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["guests.edit", "frontdesk.checkout"]);
  const supabase = await createClient();
  const guestId = uuidOrNull(fd, "guest_id");
  const bookingId = uuidOrNull(fd, "booking_id");
  if (!guestId) return { error: "Guest not found." };
  const score = (k: string) => {
    const v = int(fd, k, 0, 0, 5);
    return v >= 1 ? v : null;
  };
  const overall = score("overall");
  if (!overall) return { error: "Give an overall rating." };

  const fields = {
    overall,
    room: score("room"),
    service: score("service"),
    cleanliness: score("cleanliness"),
    food: score("food"),
    comment: str(fd, "comment", 2000),
    submitted_at: new Date().toISOString(),
    source: "desk" as const,
    recorded_by: session.staff.id,
    token: null,
  };

  if (bookingId) {
    const { data: existing } = await supabase.from("guest_feedback").select("id, submitted_at").eq("booking_id", bookingId).maybeSingle();
    if (existing?.submitted_at) return { error: "Feedback for this stay is already recorded." };
    const { error } = existing
      ? await supabase.from("guest_feedback").update(fields).eq("id", existing.id)
      : await supabase.from("guest_feedback").insert({ ...fields, booking_id: bookingId, guest_id: guestId });
    if (error) return { error: friendlyDbError(error.message) };
  } else {
    const { error } = await supabase.from("guest_feedback").insert({ ...fields, guest_id: guestId });
    if (error) return { error: friendlyDbError(error.message) };
  }
  revalidateGuest(guestId);
  return { success: "Feedback recorded." };
}

export async function mergeGuests(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("guests.privacy");
  const supabase = await createClient();
  const keep = uuidOrNull(fd, "keep_id");
  const drop = uuidOrNull(fd, "drop_id");
  if (!keep || !drop) return { error: "Choose the profile to merge." };
  if (keep === drop) return { error: "Choose two different profiles." };
  const { error } = await supabase.rpc("merge_guests", { p_keep: keep, p_drop: drop });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateGuest(keep);
  redirect(`/admin/guests/${keep}?merged=1`);
}

/** Right to erasure: removes personal data but keeps the stays' financial records. */
export async function eraseGuest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("guests.privacy");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Guest not found." };
  if (str(fd, "confirm", 10) !== "ERASE") return { error: "Type ERASE to confirm." };

  // Scans and signatures first: the rows pointing to them go with the erase.
  const { data: docs } = await supabase.from("guest_documents").select("storage_path").eq("guest_id", id);
  const { data: cards } = await supabase
    .from("registration_cards")
    .select("signature_path, bookings!inner(guest_id)")
    .eq("bookings.guest_id", id);
  const paths = [
    ...(docs ?? []).map((d) => d.storage_path as string),
    ...(cards ?? []).map((c) => c.signature_path as string | null).filter((p): p is string => !!p),
  ];
  if (paths.length) {
    const { error } = await supabase.storage.from("guest-documents").remove([...new Set(paths)]);
    if (error) return { error: `Could not remove the stored scans: ${error.message}` };
  }

  const { error } = await supabase.rpc("erase_guest", { p_guest: id });
  if (error) return { error: friendlyDbError(error.message) };

  // The loyalty membership and its points history are personal data too, so
  // they go with the erase. The folio lines a redemption produced are
  // financial record and stay.
  const { error: loyaltyError } = await supabase.rpc("loyalty_erase", { p_guest: id });
  if (loyaltyError) return { error: friendlyDbError(loyaltyError.message) };

  revalidateGuest(id);
  return { success: "Personal data erased. Stays and amounts are kept for tax records." };
}
