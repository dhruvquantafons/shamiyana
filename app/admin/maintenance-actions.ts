"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/server";
import { requirePermission, requireAnyPermission, type Session } from "../lib/auth";
import { can } from "../lib/permissions";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { todayIn } from "../lib/dates";
import { alertSupervisors, alertTicketAssigned, type TicketForAlert } from "../lib/staff-alerts";
import { MT_PRIORITIES, type MaintenanceTicket, type AssetCategory, ASSET_CATEGORY_LABELS } from "../lib/types";
import { type ActionState, str, int, bool, oneOf, dateStr, uuidOrNull } from "./form-utils";

/**
 * Module 11 — Maintenance / Engineering.
 *
 * Status flow: Open → In progress (⇄ On hold) → Resolved. A ticket that
 * affects a room takes it out of order until resolved (mt_block_room /
 * mt_release_room in 0011_maintenance.sql).
 */

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function revalidateMt(id?: string) {
  revalidatePath("/admin/maintenance", "layout");
  if (id) revalidatePath(`/admin/maintenance/${id}`);
  revalidatePath("/admin/rooms");
  revalidatePath("/admin/front-desk");
  revalidatePath("/admin");
}

function photosFrom(fd: FormData): { files: File[]; error?: string } {
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_PHOTOS) return { files: [], error: `Attach at most ${MAX_PHOTOS} photos at a time.` };
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type)) return { files: [], error: `${f.name}: use a JPEG, PNG, WebP or HEIC photo.` };
    if (f.size > MAX_PHOTO_BYTES) return { files: [], error: `${f.name} is over 5 MB.` };
  }
  return { files };
}

async function storePhotos(
  supabase: SupabaseClient,
  ticketId: string,
  files: File[],
  stage: "report" | "resolution",
  staffId: string,
): Promise<string | null> {
  const stamp = Date.now();
  const rows: Record<string, unknown>[] = [];
  for (const [i, file] of files.entries()) {
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${ticketId}/${stage}-${stamp}-${i}.${ext}`;
    const { error } = await supabase.storage.from("maintenance-photos").upload(path, file, { contentType: file.type });
    if (error) return `Could not store ${file.name}: ${error.message}`;
    rows.push({ ticket_id: ticketId, storage_path: path, stage, uploaded_by: staffId });
  }
  if (rows.length) {
    const { error } = await supabase.from("maintenance_photos").insert(rows);
    if (error) return friendlyDbError(error.message);
  }
  return null;
}

async function loadTicket(supabase: SupabaseClient, id: string | null) {
  if (!id) return null;
  const { data } = await supabase
    .from("maintenance_tickets")
    .select("*, rooms(room_number), assets(code, name)")
    .eq("id", id)
    .maybeSingle();
  return (data as MaintenanceTicket | null) ?? null;
}

/** Engineers work their own tickets, or pick up unassigned ones; supervisors any. */
function mayWork(session: Session, t: MaintenanceTicket) {
  return (
    can(session, "maintenance.manage") ||
    (can(session, "maintenance.work") && (t.assigned_to === session.staff.id || t.assigned_to === null))
  );
}

/** Explains why a room could not be taken out of order. */
function blockError(message: string) {
  const inUse = message.match(/ROOM_IN_USE: (.+)/);
  if (inUse) {
    return `The room was not taken out of order because ${inUse[1]} is assigned to it. Move the guest, then use "Take room out of order" on the ticket.`;
  }
  return friendlyDbError(message);
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export async function createTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("maintenance.report");
  const supabase = await createClient();

  const title = str(fd, "title", 150);
  const roomId = uuidOrNull(fd, "room_id");
  const assetId = uuidOrNull(fd, "asset_id");
  const location = str(fd, "location", 200);
  const affectsRoom = bool(fd, "affects_room");
  if (!title) return { error: "Say what the problem is." };
  if (!roomId && !assetId && !location) return { error: "Choose the room or asset, or say where the problem is." };
  if (affectsRoom && !roomId) return { error: "Choose the room to take out of order." };
  const photos = photosFrom(fd);
  if (photos.error) return { error: photos.error };

  const manage = can(session, "maintenance.manage");
  const assignee = manage ? uuidOrNull(fd, "assigned_to") : null;

  const { data, error } = await supabase
    .from("maintenance_tickets")
    .insert({
      title,
      description: str(fd, "description", 4000),
      room_id: roomId,
      asset_id: assetId,
      location,
      priority: oneOf(fd, "priority", MT_PRIORITIES, "medium"),
      reported_by: session.staff.id,
      assigned_to: assignee,
      assigned_at: assignee ? new Date().toISOString() : null,
    })
    .select("*, rooms(room_number)")
    .single();
  if (error || !data) return { error: friendlyDbError(error?.message ?? "Could not save the ticket.") };
  const ticket = data as MaintenanceTicket;

  const notes: string[] = [];
  const photoError = await storePhotos(supabase, ticket.id, photos.files, "report", session.staff.id);
  if (photoError) notes.push(photoError);

  if (affectsRoom) {
    const { error: blockErr } = await supabase.rpc("mt_block_room", { p_ticket: ticket.id });
    notes.push(blockErr ? blockError(blockErr.message) : `Room ${ticket.rooms?.room_number} is out of order until this is fixed.`);
  }
  if (ticket.priority === "urgent") {
    await alertSupervisors(supabase, ticket, "urgent", session.staff.id);
    notes.push("The engineering supervisor has been alerted.");
  }

  revalidateMt(ticket.id);
  return { success: [`${ticket.reference} raised.`, ...notes].join(" ") };
}

export async function startTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  if (!mayWork(session, t)) return { error: "This ticket is assigned to someone else." };
  if (!["open", "on_hold"].includes(t.status)) return { error: "This ticket is not open." };

  const { error } = await supabase
    .from("maintenance_tickets")
    .update({
      status: "in_progress",
      started_at: t.started_at ?? new Date().toISOString(),
      hold_reason: "",
      // Whoever starts an unassigned ticket takes it.
      assigned_to: t.assigned_to ?? session.staff.id,
      assigned_at: t.assigned_at ?? new Date().toISOString(),
    })
    .eq("id", t.id);
  if (error) return { error: friendlyDbError(error.message) };
  revalidateMt(t.id);
  return { success: "Work started." };
}

export async function holdTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  if (!mayWork(session, t)) return { error: "This ticket is assigned to someone else." };
  if (t.status !== "in_progress") return { error: "Only work in progress can be put on hold." };
  const reason = str(fd, "hold_reason", 300);
  if (!reason) return { error: "Say why it is on hold, e.g. waiting for a spare part." };

  const { error } = await supabase.from("maintenance_tickets").update({ status: "on_hold", hold_reason: reason }).eq("id", t.id);
  if (error) return { error: friendlyDbError(error.message) };
  revalidateMt(t.id);
  return { success: "On hold." };
}

export async function resolveTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  if (!mayWork(session, t)) return { error: "This ticket is assigned to someone else." };
  if (!["open", "in_progress", "on_hold"].includes(t.status)) return { error: "This ticket is already closed." };
  const note = str(fd, "resolution_note", 2000);
  if (!note) return { error: "Say what was done." };
  const photos = photosFrom(fd);
  if (photos.error) return { error: photos.error };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("maintenance_tickets")
    .update({
      status: "resolved",
      resolution_note: note,
      resolved_at: now,
      resolved_by: session.staff.id,
      started_at: t.started_at ?? now,
      assigned_to: t.assigned_to ?? session.staff.id,
    })
    .eq("id", t.id);
  if (error) return { error: friendlyDbError(error.message) };

  const photoError = await storePhotos(supabase, t.id, photos.files, "resolution", session.staff.id);
  const { data: released } = await supabase.rpc("mt_release_room", { p_ticket: t.id });

  revalidateMt(t.id);
  return {
    success: [
      `${t.reference} resolved.`,
      released ? `Room ${t.rooms?.room_number} is back in inventory, marked dirty for housekeeping.` : "",
      photoError ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export async function reopenTicket(fd: FormData) {
  await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return;
  await supabase
    .from("maintenance_tickets")
    .update({ status: "open", resolved_at: null, resolved_by: null, hold_reason: "" })
    .eq("id", id)
    .in("status", ["resolved", "cancelled"]);
  revalidateMt(id);
}

export async function cancelTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  const reason = str(fd, "reason", 500);
  if (!reason) return { error: "Say why it is cancelled." };
  const { error } = await supabase
    .from("maintenance_tickets")
    .update({ status: "cancelled", resolution_note: `Cancelled: ${reason}`, resolved_by: session.staff.id, resolved_at: new Date().toISOString() })
    .eq("id", t.id);
  if (error) return { error: friendlyDbError(error.message) };
  await supabase.rpc("mt_release_room", { p_ticket: t.id });
  revalidateMt(t.id);
  return { success: "Cancelled." };
}

export async function assignTicket(fd: FormData) {
  const session = await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return;
  const staffId = uuidOrNull(fd, "assigned_to");

  const { data: ticket } = await supabase
    .from("maintenance_tickets")
    .update({ assigned_to: staffId, assigned_at: staffId ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id, reference, title, priority, due_at, location, assigned_to, rooms(room_number)")
    .maybeSingle();

  // SOW Module 16, trigger event "ticket assigned": the person who now owns
  // the job hears about it. Unassigning tells nobody.
  const settings = await getSettings();
  if (ticket && staffId && settings.notify_staff_ticket_assigned) {
    await alertTicketAssigned(
      supabase,
      ticket as unknown as TicketForAlert,
      staffId,
      session.staff.id,
    );
  }

  revalidateMt(id);
}

export async function setTicketPriority(fd: FormData) {
  const session = await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return;
  const priority = oneOf(fd, "priority", MT_PRIORITIES, t.priority);
  if (priority === t.priority) return;
  const { data } = await supabase
    .from("maintenance_tickets")
    .update({ priority })
    .eq("id", t.id)
    .select("*, rooms(room_number)")
    .single();
  if (data && priority === "urgent") await alertSupervisors(supabase, data as MaintenanceTicket, "urgent", session.staff.id);
  revalidateMt(t.id);
}

export async function blockRoomForTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("maintenance.report");
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  const { error } = await supabase.rpc("mt_block_room", { p_ticket: t.id });
  if (error) return { error: blockError(error.message) };
  revalidateMt(t.id);
  return { success: `Room ${t.rooms?.room_number} is out of order until this ticket is resolved.` };
}

export async function addTicketPhotos(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("maintenance.report");
  const supabase = await createClient();
  const t = await loadTicket(supabase, uuidOrNull(fd, "id"));
  if (!t) return { error: "Ticket not found." };
  const photos = photosFrom(fd);
  if (photos.error) return { error: photos.error };
  if (photos.files.length === 0) return { error: "Choose a photo." };
  const stage = t.status === "resolved" ? "resolution" : "report";
  const err = await storePhotos(supabase, t.id, photos.files, stage, session.staff.id);
  if (err) return { error: err };
  revalidateMt(t.id);
  return { success: `${photos.files.length} photo(s) added.` };
}

// ── Assets ──────────────────────────────────────────────────────────────────

const CATEGORIES = Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[];

export async function saveAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 150);
  if (!name) return { error: "Name the asset." };
  const payload = {
    name,
    category: oneOf(fd, "category", CATEGORIES, "other"),
    room_id: uuidOrNull(fd, "room_id"),
    location: str(fd, "location", 200),
    make: str(fd, "make", 100),
    model: str(fd, "model", 100),
    serial_number: str(fd, "serial_number", 100),
    installed_on: dateStr(fd, "installed_on") || null,
    warranty_until: dateStr(fd, "warranty_until") || null,
    notes: str(fd, "notes", 2000),
    is_active: id ? bool(fd, "is_active") : true,
  };
  const { data, error } = id
    ? await supabase.from("assets").update(payload).eq("id", id).select("id").single()
    : await supabase.from("assets").insert(payload).select("id").single();
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/admin/maintenance/assets", "layout");
  if (!id) redirect(`/admin/maintenance/assets/${data.id}`);
  return { success: "Asset saved." };
}

// ── Preventive schedules ────────────────────────────────────────────────────

export async function saveSchedule(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const title = str(fd, "title", 150);
  const nextDue = dateStr(fd, "next_due_on");
  const roomId = uuidOrNull(fd, "room_id");
  const assetId = uuidOrNull(fd, "asset_id");
  const location = str(fd, "location", 200);
  if (!title) return { error: "Name the job, e.g. AC servicing." };
  if (!nextDue) return { error: "Choose when it is next due." };
  if (!roomId && !assetId && !location) return { error: "Choose the asset or room, or say where." };

  const payload = {
    title,
    description: str(fd, "description", 2000),
    asset_id: assetId,
    room_id: roomId,
    location,
    interval_days: int(fd, "interval_days", 90, 1, 3650),
    next_due_on: nextDue,
    priority: oneOf(fd, "priority", MT_PRIORITIES, "medium"),
    assigned_to: uuidOrNull(fd, "assigned_to"),
    is_active: id ? bool(fd, "is_active") : true,
  };
  const { error } = id
    ? await supabase.from("maintenance_schedules").update(payload).eq("id", id)
    : await supabase.from("maintenance_schedules").insert({ ...payload, created_by: session.staff.id });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateMt();
  return { success: "Schedule saved." };
}

export async function deleteSchedule(fd: FormData) {
  await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (id) await supabase.from("maintenance_schedules").delete().eq("id", id);
  revalidateMt();
}

export async function generatePreventive(): Promise<ActionState> {
  await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mt_generate_preventive", {
    p_date: todayIn((await getSettings()).timezone),
  });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateMt();
  return { success: data ? `${data} preventive ticket(s) raised.` : "Nothing is due." };
}

// ── Targets ─────────────────────────────────────────────────────────────────

export async function saveSla(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("maintenance.manage");
  const supabase = await createClient();
  const hours = (k: string, d: number) => int(fd, k, d, 1, 2160);
  const low = hours("low", 72);
  const medium = hours("medium", 24);
  const high = hours("high", 8);
  const urgent = hours("urgent", 2);
  if (!(urgent <= high && high <= medium && medium <= low)) {
    return { error: "Higher priorities should have shorter targets: Urgent ≤ High ≤ Medium ≤ Low." };
  }
  const { error } = await supabase.rpc("set_mt_sla", { p_low: low, p_medium: medium, p_high: high, p_urgent: urgent });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateMt();
  return { success: "Targets saved. They apply to new tickets and to tickets whose priority changes." };
}
