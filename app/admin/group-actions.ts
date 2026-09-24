"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { loadPricingData } from "../lib/rate-data";
import { quoteStay } from "../lib/pricing";
import { friendlyDbError, isOverbooked } from "../lib/db-errors";
import type { PaymentMethod } from "../lib/types";
import { type ActionState, str, int, oneOf, oneOfOrNull, dateStr, uuidOrNull } from "./form-utils";

const PAYMENT_METHODS: PaymentMethod[] = [
  "cash", "card", "upi", "bank_transfer", "online_gateway", "corporate_billing", "ota_prepaid", "wallet", "other",
];

/** Largest block one form can create; bigger groups add rooms afterwards. */
const MAX_ROOMS = 120;

/**
 * Blocks rooms under one master booking (SOW: "block 10+ rooms under one
 * master booking with individual guest names added later"). Each room is its
 * own booking so it can be assigned, checked in and billed separately; the
 * rooming list fills in the names later.
 */
export async function createGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.groups");
  const supabase = await createClient();
  const settings = await getSettings();

  const name = str(fd, "name", 200);
  const checkIn = dateStr(fd, "check_in");
  const checkOut = dateStr(fd, "check_out");
  const ratePlanId = uuidOrNull(fd, "rate_plan_id");
  const status = oneOf(fd, "status", ["tentative", "confirmed"] as const, "tentative");

  if (!name) return { error: "Name the group." };
  if (!checkIn || !checkOut || checkOut <= checkIn) return { error: "Check the dates." };
  if (!ratePlanId) return { error: "Choose a rate plan." };

  const pricing = await loadPricingData(supabase);
  const plan = pricing.plans.find((p) => p.id === ratePlanId) ?? null;
  if (!plan) return { error: "Rate plan not found." };

  const adultsPerRoom = int(fd, "adults_per_room", 2, 1, 10);
  const holdUntil =
    status === "tentative" ? new Date(Date.now() + settings.hold_hours * 3600000).toISOString() : "";

  const rooms: Record<string, unknown>[] = [];
  const problems: string[] = [];

  for (const type of pricing.roomTypes) {
    const count = int(fd, `rooms_${type.id}`, 0, 0, MAX_ROOMS);
    if (count === 0) continue;

    const quote = quoteStay({
      roomType: type,
      plan,
      checkIn,
      checkOut,
      adults: adultsPerRoom,
      children: 0,
      rooms: 1,
      seasons: pricing.seasons,
      restrictions: pricing.restrictions,
      extraCharges: pricing.extraCharges,
      adjustments: pricing.adjustments,
    });
    problems.push(...quote.violations);

    for (let i = 0; i < count; i++) {
      rooms.push({
        room_type_id: type.id,
        rate_plan_id: plan.id,
        company_id: uuidOrNull(fd, "company_id") ?? "",
        check_in: checkIn,
        check_out: checkOut,
        adults: adultsPerRoom,
        status,
        source: oneOf(fd, "source", ["phone", "email", "corporate", "travel_agent", "walk_in"] as const, "email"),
        payment_method: oneOfOrNull(fd, "payment_method", PAYMENT_METHODS) ?? "",
        quoted_rate: quote.averageNightly,
        total_amount: quote.total,
        rate_breakdown: quote.nights,
        deposit_required: quote.deposit,
        hold_until: holdUntil,
        contact_name: `${name} — room ${rooms.length + 1}`,
        overbook_reason: can(session, "bookings.overbook") ? str(fd, "overbook_reason", 500) : "",
      });
    }
  }

  if (rooms.length === 0) return { error: "Block at least one room." };
  if (rooms.length > MAX_ROOMS) return { error: `Block at most ${MAX_ROOMS} rooms at once.` };
  if (problems.length) return { error: [...new Set(problems)].join(" ") };

  const { data: groupId, error } = await supabase.rpc("create_booking_group", {
    p_group: {
      name,
      company_id: uuidOrNull(fd, "company_id") ?? "",
      rate_plan_id: plan.id,
      organiser_name: str(fd, "organiser_name", 200),
      organiser_phone: str(fd, "organiser_phone", 50),
      organiser_email: str(fd, "organiser_email", 200),
      check_in: checkIn,
      check_out: checkOut,
      notes: str(fd, "notes"),
    },
    p_rooms: rooms,
  });

  if (error) return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };

  revalidatePath("/admin/groups");
  revalidatePath("/admin/bookings");
  redirect(`/admin/groups/${groupId}`);
}

/** Saves guest names against each room in the group. */
export async function saveRoomingList(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("bookings.groups");
  const supabase = await createClient();
  const groupId = uuidOrNull(fd, "group_id");
  if (!groupId) return { error: "Group not found." };

  const ids = fd.getAll("booking_id").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  let changed = 0;

  for (const id of ids) {
    const name = str(fd, `name_${id}`, 200);
    const phone = str(fd, `phone_${id}`, 50);
    const email = str(fd, `email_${id}`, 200).toLowerCase();
    const adults = int(fd, `adults_${id}`, 0, 0, 10);
    const update: Record<string, unknown> = { contact_phone: phone, contact_email: email };
    if (name) update.contact_name = name;
    if (adults > 0) update.adults = adults;

    const { error, count } = await supabase
      .from("bookings")
      .update(update, { count: "exact" })
      .eq("id", id)
      .eq("group_id", groupId);
    if (error) return { error: friendlyDbError(error.message) };
    changed += count ?? 0;
  }

  revalidatePath(`/admin/groups/${groupId}`);
  return { success: `Rooming list saved (${changed} room(s)).` };
}

export async function addRoomsToGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.groups");
  const supabase = await createClient();
  const groupId = uuidOrNull(fd, "group_id");
  const roomTypeId = uuidOrNull(fd, "room_type_id");
  const count = int(fd, "count", 1, 1, 50);
  if (!groupId || !roomTypeId) return { error: "Choose a room type." };

  const { data: group } = await supabase.from("booking_groups").select("*").eq("id", groupId).single();
  if (!group) return { error: "Group not found." };

  const pricing = await loadPricingData(supabase);
  const type = pricing.roomTypes.find((t) => t.id === roomTypeId);
  const plan = pricing.plans.find((p) => p.id === group.rate_plan_id) ?? null;
  if (!type) return { error: "Room type not found." };

  const quote = quoteStay({
    roomType: type,
    plan,
    checkIn: group.check_in,
    checkOut: group.check_out,
    adults: 2,
    children: 0,
    rooms: 1,
    seasons: pricing.seasons,
    restrictions: pricing.restrictions,
    extraCharges: pricing.extraCharges,
    adjustments: pricing.adjustments,
  });

  const { count: existing } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  const { error } = await supabase.from("bookings").insert(
    Array.from({ length: count }, (_, i) => ({
      group_id: groupId,
      company_id: group.company_id,
      rate_plan_id: group.rate_plan_id,
      room_type_id: type.id,
      check_in: group.check_in,
      check_out: group.check_out,
      adults: 2,
      status: oneOf(fd, "status", ["tentative", "confirmed"] as const, "confirmed"),
      source: "phone",
      quoted_rate: quote.averageNightly,
      total_amount: quote.total,
      rate_breakdown: quote.nights,
      deposit_required: quote.deposit,
      contact_name: `${group.name} — room ${(existing ?? 0) + i + 1}`,
      created_by: session.staff.id,
    })),
  );
  if (error) return { error: friendlyDbError(error.message), overbooked: isOverbooked(error.message) };

  revalidatePath(`/admin/groups/${groupId}`);
  return { success: `${count} room(s) added.` };
}

/** Confirms every tentative room in the group. */
export async function confirmGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("bookings.groups");
  const supabase = await createClient();
  const groupId = uuidOrNull(fd, "group_id");
  if (!groupId) return { error: "Group not found." };

  const { error, count } = await supabase
    .from("bookings")
    .update({ status: "confirmed", hold_until: null }, { count: "exact" })
    .eq("group_id", groupId)
    .eq("status", "tentative");
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/admin/groups/${groupId}`);
  revalidatePath("/admin/bookings");
  return { success: `${count ?? 0} room(s) confirmed.` };
}

/**
 * Releases every room in the group that has not arrived. Penalties for
 * groups are negotiated per contract, so none are posted automatically; post
 * any agreed charge on a room's folio.
 */
export async function cancelGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("bookings.groups");
  if (!can(session, "bookings.cancel")) return { error: "Your role cannot cancel bookings." };
  const supabase = await createClient();
  const groupId = uuidOrNull(fd, "group_id");
  const reason = str(fd, "reason", 500);
  if (!groupId) return { error: "Group not found." };
  if (!reason) return { error: "Give a reason." };

  const { error, count } = await supabase
    .from("bookings")
    .update(
      {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: session.staff.id,
        cancellation_reason: `Group cancelled: ${reason}`,
        hold_until: null,
      },
      { count: "exact" },
    )
    .eq("group_id", groupId)
    .in("status", ["tentative", "confirmed", "waitlisted"]);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/admin/groups/${groupId}`);
  revalidatePath("/admin/bookings");
  return { success: `${count ?? 0} room(s) released.` };
}
