"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requirePermission, requireSession, requireAnyPermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { addDays, dayOfWeek, eachNight, isIsoDate, todayIn, zonedTime } from "../lib/dates";
import type { LeaveKind, ShiftColor } from "../lib/types";
import { LEAVE_KIND_LABELS } from "../lib/types";
import { type ActionState, str, int, num, bool, oneOf, dateStr, uuidOrNull } from "./form-utils";

/** Module 12 — HR & Staff Management. */

function revalidateHr() {
  revalidatePath("/admin/hr", "layout");
  revalidatePath("/admin");
}

function attendanceError(message: string) {
  const far = message.match(/GEOFENCE: (\d+) m/);
  if (far) return `You are ${Number(far[1]).toLocaleString("en-IN")} m from the hotel. Clock in when you are on site.`;
  if (message.includes("GEOFENCE")) return "Allow location access on this device — clock-in has to be from the hotel.";
  if (message.includes("ALREADY_IN")) return "You are already clocked in.";
  if (message.includes("NOT_IN")) return "You are not clocked in.";
  return friendlyDbError(message);
}

const coord = (fd: FormData, key: string, limit: number) => {
  const n = num(fd, key);
  return n !== null && Math.abs(n) <= limit ? n : null;
};

// ── Self-service ────────────────────────────────────────────────────────────

/** Clock in (mode "in") or out (mode "out") for the signed-in staff member. */
export async function clock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession();
  const supabase = await createClient();
  const out = str(fd, "mode") === "out";
  const { error } = await supabase.rpc(out ? "clock_out" : "clock_in", {
    p_lat: coord(fd, "lat", 90),
    p_lng: coord(fd, "lng", 180),
  });
  if (error) return { error: attendanceError(error.message) };
  revalidateHr();
  return { success: out ? "Clocked out." : "Clocked in." };
}

const LEAVE_KINDS = Object.keys(LEAVE_KIND_LABELS) as LeaveKind[];

export async function requestLeave(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireSession();
  const supabase = await createClient();
  const today = todayIn((await getSettings()).timezone);
  const start = dateStr(fd, "start_date");
  const end = dateStr(fd, "end_date") || start;
  if (!start || !isIsoDate(start) || !isIsoDate(end)) return { error: "Choose the dates." };
  if (end < start) return { error: "The last day cannot be before the first." };
  if (start < addDays(today, -30)) return { error: "Leave can be recorded at most 30 days back." };
  if (eachNight(start, addDays(end, 1)).length > 90) return { error: "Request at most 90 days at a time." };

  const { data: overlap } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("staff_id", session.staff.id)
    .in("status", ["pending", "approved"])
    .lte("start_date", end)
    .gte("end_date", start)
    .limit(1);
  if (overlap?.length) return { error: "You already have leave requested for some of those days." };

  const { error } = await supabase.from("leave_requests").insert({
    staff_id: session.staff.id,
    kind: oneOf(fd, "kind", LEAVE_KINDS, "casual"),
    start_date: start,
    end_date: end,
    reason: str(fd, "reason", 500),
  });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: "Leave requested. Your manager will approve or decline it." };
}

export async function cancelLeave(fd: FormData) {
  const session = await requireSession();
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (!id) return;
  await supabase
    .from("leave_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("staff_id", session.staff.id)
    .eq("status", "pending");
  revalidateHr();
}

// ── Leave approval ──────────────────────────────────────────────────────────

export async function decideLeave(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("hr.approve_leave");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const approve = oneOf(fd, "decision", ["approve", "reject"] as const, "approve") === "approve";
  const note = str(fd, "note", 500);
  if (!id) return { error: "Request not found." };
  if (!approve && !note) return { error: "Say why it is declined." };

  const { data: req } = await supabase.from("leave_requests").select("staff_id, status").eq("id", id).maybeSingle();
  if (!req) return { error: "Request not found." };
  if (req.staff_id === session.staff.id) return { error: "Someone else has to approve your own leave." };
  if (req.status !== "pending") return { error: "This request has already been decided." };

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status: approve ? "approved" : "rejected",
      decided_by: session.staff.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: approve ? "Approved." : "Declined." };
}

// ── Staff HR profile ────────────────────────────────────────────────────────

export async function saveHrProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "staff_id");
  if (!id) return { error: "Staff member not found." };
  const off = str(fd, "weekly_off");
  const { error } = await supabase.rpc("set_staff_hr", {
    p_staff: id,
    p_code: str(fd, "employee_code", 30),
    p_department: uuidOrNull(fd, "department_id"),
    p_designation: str(fd, "job_title", 100),
    p_joining: dateStr(fd, "joining_date") || null,
    p_shift: uuidOrNull(fd, "default_shift_id"),
    p_weekly_off: off === "" ? null : int(fd, "weekly_off", 0, 0, 6),
    p_phone: str(fd, "phone", 30),
    p_address: str(fd, "address", 500),
    p_emergency: str(fd, "emergency_contact", 200),
  });
  if (error) {
    return { error: error.code === "23505" ? "Another staff member already has that employee ID." : friendlyDbError(error.message) };
  }
  revalidateHr();
  return { success: "Profile saved." };
}

export async function addFeedback(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requireAnyPermission(["hr.manage", "frontdesk.requests"]);
  const supabase = await createClient();
  const staffId = uuidOrNull(fd, "staff_id");
  if (!staffId) return { error: "Choose the staff member." };
  const { error } = await supabase.from("staff_feedback").insert({
    staff_id: staffId,
    rating: int(fd, "rating", 5, 1, 5),
    comment: str(fd, "comment", 1000),
    source: oneOf(fd, "source", ["guest", "manager"] as const, "guest"),
    recorded_by: session.staff.id,
  });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: "Feedback recorded." };
}

// ── Roster ──────────────────────────────────────────────────────────────────

/**
 * Saves the week grid. Each cell is named cell:<staff id>:<date> and holds a
 * shift type id, "off" for a rostered day off, or "" for not rostered.
 */
export async function saveRoster(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("hr.manage");
  const supabase = await createClient();

  const upserts: Record<string, unknown>[] = [];
  const clears: { staff_id: string; shift_date: string }[] = [];
  for (const [key, raw] of fd.entries()) {
    const m = key.match(/^cell:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i);
    if (!m || typeof raw !== "string") continue;
    const [, staffId, date] = m;
    if (raw === "") clears.push({ staff_id: staffId, shift_date: date });
    else
      upserts.push({
        staff_id: staffId,
        shift_date: date,
        shift_type_id: raw === "off" ? null : /^[0-9a-f-]{36}$/i.test(raw) ? raw : null,
        updated_by: session.staff.id,
        updated_at: new Date().toISOString(),
      });
  }

  if (upserts.length) {
    const { error } = await supabase.from("staff_shifts").upsert(upserts, { onConflict: "staff_id,shift_date" });
    if (error) return { error: friendlyDbError(error.message) };
  }
  if (clears.length) {
    // Only cells that had a value need deleting.
    const dates = clears.map((c) => c.shift_date).sort();
    const { data: existing } = await supabase
      .from("staff_shifts")
      .select("id, staff_id, shift_date")
      .gte("shift_date", dates[0])
      .lte("shift_date", dates[dates.length - 1]);
    const wanted = new Set(clears.map((c) => `${c.staff_id}:${c.shift_date}`));
    const ids = (existing ?? []).filter((e) => wanted.has(`${e.staff_id}:${e.shift_date}`)).map((e) => e.id);
    if (ids.length) await supabase.from("staff_shifts").delete().in("id", ids);
  }
  revalidateHr();
  return { success: "Roster saved." };
}

/** Fills empty cells of the week from each person's shift pattern. */
export async function fillRosterFromPatterns(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("hr.manage");
  const supabase = await createClient();
  const week = dateStr(fd, "week");
  if (!week) return { error: "Week not found." };
  const days = eachNight(week, addDays(week, 7));

  const [{ data: people }, { data: existing }] = await Promise.all([
    supabase.from("staff").select("id, default_shift_id, weekly_off").eq("is_active", true).not("default_shift_id", "is", null),
    supabase.from("staff_shifts").select("staff_id, shift_date").gte("shift_date", week).lt("shift_date", addDays(week, 7)),
  ]);
  const taken = new Set((existing ?? []).map((e) => `${e.staff_id}:${e.shift_date}`));
  const rows = (people ?? []).flatMap((p) =>
    days
      .filter((d) => !taken.has(`${p.id}:${d}`))
      .map((d) => ({
        staff_id: p.id,
        shift_date: d,
        shift_type_id: p.weekly_off === dayOfWeek(d) ? null : p.default_shift_id,
        updated_by: session.staff.id,
      })),
  );
  if (rows.length === 0) return { success: "Nothing to fill — set shift patterns on the Staff tab, or the week is already full." };
  const { error } = await supabase.from("staff_shifts").insert(rows);
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: `${rows.length} day(s) filled from shift patterns.` };
}

/** Copies last week's roster into the empty cells of this week. */
export async function copyPreviousWeek(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("hr.manage");
  const supabase = await createClient();
  const week = dateStr(fd, "week");
  if (!week) return { error: "Week not found." };
  const prev = addDays(week, -7);

  const [{ data: last }, { data: existing }] = await Promise.all([
    supabase.from("staff_shifts").select("staff_id, shift_date, shift_type_id").gte("shift_date", prev).lt("shift_date", week),
    supabase.from("staff_shifts").select("staff_id, shift_date").gte("shift_date", week).lt("shift_date", addDays(week, 7)),
  ]);
  const taken = new Set((existing ?? []).map((e) => `${e.staff_id}:${e.shift_date}`));
  const rows = (last ?? [])
    .map((s) => ({ staff_id: s.staff_id, shift_date: addDays(s.shift_date, 7), shift_type_id: s.shift_type_id, updated_by: session.staff.id }))
    .filter((r) => !taken.has(`${r.staff_id}:${r.shift_date}`));
  if (rows.length === 0) return { success: "Nothing to copy." };
  const { error } = await supabase.from("staff_shifts").insert(rows);
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: `${rows.length} day(s) copied from last week.` };
}

// ── Attendance (HR) ─────────────────────────────────────────────────────────

export async function saveAttendance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("hr.manage");
  const supabase = await createClient();
  const settings = await getSettings();
  const id = uuidOrNull(fd, "id");
  const staffId = uuidOrNull(fd, "staff_id");
  const date = dateStr(fd, "work_date");
  const inTime = str(fd, "in_time", 5);
  const outTime = str(fd, "out_time", 5);
  if (!staffId || !date) return { error: "Choose the staff member and date." };
  if (!/^\d{2}:\d{2}$/.test(inTime)) return { error: "Enter the clock-in time." };
  if (outTime && !/^\d{2}:\d{2}$/.test(outTime)) return { error: "Enter the clock-out time as HH:MM." };

  const clockIn = zonedTime(date, inTime, settings.timezone);
  // A clock-out earlier than the clock-in is the next morning (night shift).
  const clockOut = outTime ? zonedTime(outTime > inTime ? date : addDays(date, 1), outTime, settings.timezone) : null;
  if (clockIn.getTime() > Date.now() + 5 * 60000) return { error: "Clock-in cannot be in the future." };

  const payload = {
    staff_id: staffId,
    work_date: date,
    clock_in: clockIn.toISOString(),
    clock_out: clockOut?.toISOString() ?? null,
    notes: str(fd, "notes", 300),
  };
  const { error } = id
    ? await supabase.from("attendance").update(payload).eq("id", id)
    : await supabase.from("attendance").insert({ ...payload, method: "manual", recorded_by: session.staff.id });
  if (error) {
    return { error: error.code === "23505" ? "That person is still clocked in — close the open record first." : friendlyDbError(error.message) };
  }
  revalidateHr();
  return { success: "Attendance saved." };
}

export async function deleteAttendance(fd: FormData) {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (id) await supabase.from("attendance").delete().eq("id", id);
  revalidateHr();
}

// ── Setup ───────────────────────────────────────────────────────────────────

export async function saveDepartment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  if (!name) return { error: "Name the department." };
  const payload = { name, sort_order: int(fd, "sort_order", 50, 0, 999) };
  const { error } = id
    ? await supabase.from("departments").update(payload).eq("id", id)
    : await supabase.from("departments").insert(payload);
  if (error) return { error: error.code === "23505" ? "That department exists." : friendlyDbError(error.message) };
  revalidateHr();
  return { success: "Saved." };
}

export async function deleteDepartment(fd: FormData) {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  if (id) await supabase.from("departments").delete().eq("id", id);
  revalidateHr();
}

const COLORS: ShiftColor[] = ["slate", "yellow", "orange", "indigo", "emerald", "rose", "sky", "violet"];

export async function saveShiftType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 60);
  const t = (k: string) => (/^\d{2}:\d{2}$/.test(str(fd, k, 5)) ? str(fd, k, 5) : "");
  const start = t("start_time");
  const end = t("end_time");
  const start2 = t("start_time_2");
  const end2 = t("end_time_2");
  if (!name) return { error: "Name the shift." };
  if (!start || !end) return { error: "Enter the start and end times." };
  if (Boolean(start2) !== Boolean(end2)) return { error: "A split shift needs both second-half times." };

  const payload = {
    name,
    start_time: start,
    end_time: end,
    start_time_2: start2 || null,
    end_time_2: end2 || null,
    color: oneOf(fd, "color", COLORS, "slate"),
    sort_order: int(fd, "sort_order", 50, 0, 999),
    is_active: id ? bool(fd, "is_active") : true,
  };
  const { error } = id
    ? await supabase.from("shift_types").update(payload).eq("id", id)
    : await supabase.from("shift_types").insert(payload);
  if (error) return { error: error.code === "23505" ? "A shift with that name exists." : friendlyDbError(error.message) };
  revalidateHr();
  return { success: "Shift saved." };
}

export async function saveGeofence(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("hr.manage");
  const supabase = await createClient();
  const lat = coord(fd, "lat", 90);
  const lng = coord(fd, "lng", 180);
  if ((lat === null) !== (lng === null)) return { error: "Enter both latitude and longitude, or neither." };
  const required = bool(fd, "required");
  if (required && lat === null) return { error: "Set the hotel's location before requiring it." };
  const { error } = await supabase.rpc("set_hr_geofence", {
    p_lat: lat,
    p_lng: lng,
    p_radius: int(fd, "radius", 200, 20, 5000),
    p_required: required,
    p_grace: int(fd, "grace", 10, 0, 240),
  });
  if (error) return { error: friendlyDbError(error.message) };
  revalidateHr();
  return { success: "Attendance settings saved." };
}
