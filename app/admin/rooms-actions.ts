"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { todayIn } from "../lib/dates";
import { applyBlockNow, blockClashes, releaseBlocks } from "../lib/room-blocks";
import type { HousekeepingStatus } from "../lib/types";
import { type ActionState, str, num, bool, oneOf, dateStr, uuidOrNull } from "./form-utils";

const HK: HousekeepingStatus[] = ["dirty", "cleaning", "clean", "inspected"];

function revalidateRooms() {
  revalidatePath("/admin/rooms");
  revalidatePath("/admin/maintenance", "layout");
  revalidatePath("/admin/tape-chart");
  revalidatePath("/admin/front-desk");
  revalidatePath("/admin");
}

function roomFields(fd: FormData) {
  const maxAdults = num(fd, "max_adults");
  const maxChildren = num(fd, "max_children");
  const floor = num(fd, "floor");
  return {
    room_type_id: uuidOrNull(fd, "room_type_id"),
    floor: floor === null ? null : Math.round(floor),
    view: str(fd, "view", 80),
    bed_configuration: str(fd, "bed_configuration", 80),
    max_adults: maxAdults === null ? null : Math.min(20, Math.max(1, Math.round(maxAdults))),
    max_children: maxChildren === null ? null : Math.min(20, Math.max(0, Math.round(maxChildren))),
    is_smoking: bool(fd, "is_smoking"),
    is_accessible: bool(fd, "is_accessible"),
    connecting_room_id: uuidOrNull(fd, "connecting_room_id"),
    notes: str(fd, "notes", 500),
  };
}

export async function createRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rooms.manage");
  const supabase = await createClient();

  const roomNumber = str(fd, "room_number", 20);
  const fields = roomFields(fd);
  if (!roomNumber) return { error: "Room number is required." };
  if (!fields.room_type_id) return { error: "Pick a room type." };

  const { error } = await supabase.from("rooms").insert({ room_number: roomNumber, ...fields });
  if (error) {
    return { error: error.code === "23505" ? `Room ${roomNumber} already exists.` : friendlyDbError(error.message) };
  }

  revalidateRooms();
  return { success: `Room ${roomNumber} added.` };
}

export async function updateRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rooms.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const fields = roomFields(fd);
  if (!id) return { error: "Room not found." };
  if (!fields.room_type_id) return { error: "Pick a room type." };
  if (fields.connecting_room_id === id) return { error: "A room cannot connect to itself." };

  const { error } = await supabase
    .from("rooms")
    .update({ ...fields, room_number: str(fd, "room_number", 20) || undefined })
    .eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRooms();
  return { success: "Room updated." };
}

export async function deleteRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("rooms.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Room not found." };

  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("room_id", id);
  if ((count ?? 0) > 0) {
    return { error: `Room has ${count} booking(s) on record. Block it out of service instead of deleting it.` };
  }

  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateRooms();
  return { success: "Room removed." };
}

/** Housekeeping status only. Occupancy follows check-in and check-out. */
export async function updateHousekeepingStatus(fd: FormData) {
  const session = await requirePermission("rooms.status");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return;
  const status = oneOf(fd, "housekeeping_status", HK, "dirty");
  // Only a supervisor's inspection makes a room ready for guests (Module 5).
  if (status === "inspected" && !can(session, "housekeeping.inspect")) return;

  await supabase
    .from("rooms")
    .update({
      housekeeping_status: status,
      housekeeping_updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidateRooms();
}

/**
 * Takes a room off sale for a date range (SOW: "block/unblock rooms for
 * maintenance with reason tracking"; out-of-order rooms are removed from
 * bookable inventory). Refused while a stay is assigned to the room for those
 * dates, so no guest is silently left without a room.
 */
export async function createBlock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("rooms.block");
  const supabase = await createClient();
  const settings = await getSettings();

  const roomId = uuidOrNull(fd, "room_id");
  const kind = oneOf(fd, "kind", ["out_of_order", "out_of_service"] as const, "out_of_order");
  const start = dateStr(fd, "start_date");
  const end = dateStr(fd, "end_date") || null;
  const reason = str(fd, "reason", 500);

  if (!roomId) return { error: "Choose a room." };
  if (!start) return { error: "Choose the first day of the block." };
  if (end && end < start) return { error: "The block cannot end before it starts." };
  if (!reason) return { error: "Give a reason — it is passed to maintenance." };

  const clashing = await blockClashes(supabase, roomId, start, end);
  if (clashing.length) return { error: `Reassign first: ${clashing.join(", ")}.` };

  // The database also raises a maintenance ticket for the block.
  const { error } = await supabase.from("room_blocks").insert({
    room_id: roomId,
    kind,
    start_date: start,
    end_date: end,
    reason,
    created_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };

  await applyBlockNow(supabase, roomId, kind, start, todayIn(settings.timezone));

  revalidateRooms();
  return { success: "Room blocked and flagged to maintenance. It is out of inventory for those dates." };
}

export async function releaseBlock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("rooms.block");
  const supabase = await createClient();
  const settings = await getSettings();
  const id = uuidOrNull(fd, "id");
  if (!id) return { error: "Block not found." };

  const { released, stillBlocked, error } = await releaseBlocks(
    supabase,
    { id },
    session.staff.id,
    str(fd, "release_note", 500),
    todayIn(settings.timezone),
  );
  if (error) return { error: friendlyDbError(error) };
  if (!released) return { error: "That block was already released." };

  revalidateRooms();
  return { success: stillBlocked ? "Released. Another block still covers today." : "Released. The room is back in inventory, marked dirty for housekeeping." };
}
