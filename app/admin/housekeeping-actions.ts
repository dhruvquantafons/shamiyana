"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/server";
import { requirePermission, requireAnyPermission, type Session } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { todayIn } from "../lib/dates";
import type { ChecklistEntry, HkChecklistItem, HousekeepingTask } from "../lib/types";
import { type ActionState, str, int, bool, oneOf, dateStr, uuidOrNull } from "./form-utils";

/**
 * Module 5 — Housekeeping.
 *
 * Room status flow: Dirty → Cleaning (task started) → Clean (task done) →
 * Inspected (supervisor passed it: ready for guest). A failed inspection
 * returns the room to Dirty and the task to its housekeeper.
 */

function revalidateHk() {
  revalidatePath("/admin/housekeeping", "layout");
  revalidatePath("/admin/rooms");
  revalidatePath("/admin/front-desk");
  revalidatePath("/admin");
}

async function hotelToday() {
  return todayIn((await getSettings()).timezone);
}

async function loadTask(supabase: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await supabase
    .from("housekeeping_tasks")
    .select("*, rooms(id, room_number, floor, status, housekeeping_status, dnd)")
    .eq("id", id)
    .maybeSingle();
  return (data as HousekeepingTask | null) ?? null;
}

/** Housekeepers act on their own tasks; supervisors on any. */
function mayWork(session: Session, task: HousekeepingTask) {
  return can(session, "housekeeping.assign") || task.assigned_to === session.staff.id;
}

async function setRoomHk(supabase: SupabaseClient, roomId: string, status: string, extra: Record<string, unknown> = {}) {
  await supabase
    .from("rooms")
    .update({ housekeeping_status: status, housekeeping_updated_at: new Date().toISOString(), ...extra })
    .eq("id", roomId);
}

// ── Planning ────────────────────────────────────────────────────────────────

export async function generateTasks(): Promise<ActionState> {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hk_generate_tasks", { p_date: await hotelToday() });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHk();
  return { success: data ? `${data} task(s) created and assigned.` : "Nothing new to add — every room is covered." };
}

export async function createTask(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const roomId = uuidOrNull(fd, "room_id");
  if (!roomId) return { error: "Choose a room." };
  const kind = oneOf(fd, "kind", ["checkout", "deep_clean"] as const, "checkout");

  const { data: id, error } = await supabase.rpc("hk_create_task", {
    p_room: roomId,
    p_kind: kind,
    p_date: await hotelToday(),
  });
  if (error) return { error: friendlyDbError(error.message) };
  if (!id) return { error: "That room already has an open task of this kind today." };

  const assignee = uuidOrNull(fd, "assigned_to");
  if (assignee) {
    await supabase.from("housekeeping_tasks").update({ assigned_to: assignee, assigned_at: new Date().toISOString() }).eq("id", id);
  }
  // Starting a clean means the room is not ready, whatever it showed before.
  const { data: room } = await supabase.from("rooms").select("housekeeping_status, status").eq("id", roomId).single();
  if (room && room.status !== "occupied" && room.housekeeping_status === "inspected") {
    await setRoomHk(supabase, roomId, "dirty");
  }

  revalidateHk();
  return { success: "Task added." };
}

export async function reassignTask(fd: FormData) {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return;
  const staffId = uuidOrNull(fd, "assigned_to");
  await supabase
    .from("housekeeping_tasks")
    .update({ assigned_to: staffId, assigned_at: staffId ? new Date().toISOString() : null })
    .eq("id", id);
  revalidateHk();
}

// ── Working a task ──────────────────────────────────────────────────────────

export async function startTask(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("housekeeping.tasks");
  const supabase = await createClient();
  const task = await loadTask(supabase, uuidOrNull(fd, "id"));
  if (!task) return { error: "Task not found." };
  if (!mayWork(session, task)) return { error: "This task is assigned to someone else." };
  if (task.status !== "pending") return { error: "This task has already been started." };

  const { error } = await supabase
    .from("housekeeping_tasks")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      // Whoever starts an unassigned task takes it.
      assigned_to: task.assigned_to ?? session.staff.id,
    })
    .eq("id", task.id)
    .eq("status", "pending");
  if (error) return { error: friendlyDbError(error.message) };

  await setRoomHk(supabase, task.room_id, "cleaning");
  revalidateHk();
  return { success: "Started. The timer is running." };
}

export async function completeTask(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("housekeeping.tasks");
  const supabase = await createClient();
  const task = await loadTask(supabase, uuidOrNull(fd, "id"));
  if (!task) return { error: "Task not found." };
  if (!mayWork(session, task)) return { error: "This task is assigned to someone else." };
  if (task.status !== "in_progress") return { error: "Start the task first." };

  const { data: items } = await supabase.from("hk_checklist_items").select("*").eq("is_active", true).order("sort_order");
  const checklist: ChecklistEntry[] = ((items ?? []) as HkChecklistItem[]).map((i) => ({
    item_id: i.id,
    label: i.label,
    category: i.category,
    done: bool(fd, `done_${i.id}`),
    qty: int(fd, `qty_${i.id}`, 0, 0, 99),
  }));
  const missed = checklist.filter((c) => c.category !== "minibar" && !c.done);
  if (missed.length && !bool(fd, "confirm_incomplete")) {
    return { error: `Not ticked: ${missed.map((m) => m.label).join(", ")}. Tick them, or confirm finishing without them.` };
  }

  const { error } = await supabase
    .from("housekeeping_tasks")
    .update({
      status: "cleaned",
      completed_at: new Date().toISOString(),
      completed_by: session.staff.id,
      checklist,
    })
    .eq("id", task.id);
  if (error) return { error: friendlyDbError(error.message) };

  await setRoomHk(supabase, task.room_id, "clean");
  revalidateHk();
  return { success: "Done. Waiting for the supervisor to inspect." };
}

export async function inspectTask(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("housekeeping.inspect");
  const supabase = await createClient();
  const task = await loadTask(supabase, uuidOrNull(fd, "id"));
  if (!task) return { error: "Task not found." };
  if (task.status !== "cleaned") return { error: "This room is not waiting for inspection." };

  const passed = oneOf(fd, "result", ["pass", "fail"] as const, "pass") === "pass";
  const note = str(fd, "note", 500);
  if (!passed && !note) return { error: "Say what needs redoing." };

  const { error } = await supabase
    .from("housekeeping_tasks")
    .update(
      passed
        ? { status: "inspected", inspected_at: new Date().toISOString(), inspected_by: session.staff.id, inspection_note: note }
        : {
            status: "pending",
            started_at: null,
            completed_at: null,
            inspection_note: note,
            failed_count: task.failed_count + 1,
            inspected_by: session.staff.id,
          },
    )
    .eq("id", task.id);
  if (error) return { error: friendlyDbError(error.message) };

  await setRoomHk(
    supabase,
    task.room_id,
    passed ? "inspected" : "dirty",
    passed && task.kind === "deep_clean" ? { last_deep_clean_on: task.task_date } : {},
  );
  revalidateHk();
  return { success: passed ? `Room ${task.rooms?.room_number} is ready for guests.` : "Sent back for re-cleaning." };
}

// ── Do Not Disturb ──────────────────────────────────────────────────────────

export async function setDnd(fd: FormData) {
  await requireAnyPermission(["rooms.status", "housekeeping.tasks", "frontdesk.requests"]);
  const supabase = await createClient();
  const id = uuidOrNull(fd, "room_id");
  if (!id) return;
  await supabase.from("rooms").update({ dnd: bool(fd, "dnd"), dnd_updated_at: new Date().toISOString() }).eq("id", id);
  revalidateHk();
}

// ── Lost & found ────────────────────────────────────────────────────────────

export async function logLostItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("housekeeping.lost_found");
  const supabase = await createClient();
  const description = str(fd, "description", 500);
  const foundOn = dateStr(fd, "found_on") || (await hotelToday());
  const roomId = uuidOrNull(fd, "room_id");
  if (!description) return { error: "Describe the item." };
  if (!roomId && !str(fd, "location")) return { error: "Choose the room, or say where it was found." };

  const { data, error } = await supabase
    .from("lost_found_items")
    .insert({
      room_id: roomId,
      location: str(fd, "location", 200),
      found_on: foundOn,
      description,
      found_by: session.staff.id,
    })
    .select("reference")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/housekeeping/lost-found");
  return { success: `Logged as ${data.reference}.` };
}

// ── Setup ───────────────────────────────────────────────────────────────────

export async function saveZone(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  const floors = [
    ...new Set(
      str(fd, "floors", 200)
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= -5 && n <= 200),
    ),
  ].sort((a, b) => a - b);
  if (!name) return { error: "Name the zone." };
  if (floors.length === 0) return { error: "List the floors in this zone, e.g. 1, 2." };

  const { error } = id
    ? await supabase.from("housekeeping_zones").update({ name, floors }).eq("id", id)
    : await supabase.from("housekeeping_zones").insert({ name, floors });
  if (error) return { error: error.code === "23505" ? "A zone with that name exists." : friendlyDbError(error.message) };

  revalidateHk();
  return { success: "Zone saved." };
}

export async function deleteZone(fd: FormData) {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (id) await supabase.from("housekeeping_zones").delete().eq("id", id);
  revalidateHk();
}

export async function setStaffDuty(fd: FormData) {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "staff_id");
  if (!id) return;
  await supabase.rpc("set_hk_staff", {
    p_staff: id,
    p_zone: uuidOrNull(fd, "zone_id"),
    p_on_duty: bool(fd, "on_duty"),
  });
  revalidateHk();
}

export async function saveChecklistItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("housekeeping.assign");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const label = str(fd, "label", 120);
  if (!label) return { error: "Name the item." };
  const payload = {
    label,
    category: oneOf(fd, "category", ["linen", "amenities", "minibar"] as const, "amenities"),
    par_qty: int(fd, "par_qty", 1, 0, 99),
    sort_order: int(fd, "sort_order", 50, 0, 999),
    is_active: id ? bool(fd, "is_active") : true,
  };
  const { error } = id
    ? await supabase.from("hk_checklist_items").update(payload).eq("id", id)
    : await supabase.from("hk_checklist_items").insert(payload);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateHk();
  return { success: "Checklist saved." };
}
