import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, sendSms } from "./integrations";
import { SITE } from "./site";
import { MT_PRIORITY_LABELS, type MtPriority } from "./types";

/**
 * Alerts to the engineering supervisors (everyone whose role holds
 * maintenance.manage): an urgent ticket raised, or a ticket past its
 * resolution target. Sent by email and SMS when those are configured, and
 * logged in notifications either way. The maintenance board and dashboard
 * show the same alerts in the app.
 */

export interface TicketForAlert {
  id: string;
  reference: string;
  title: string;
  priority: MtPriority;
  due_at: string;
  location?: string;
  rooms?: { room_number: string } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function supervisors(db: SupabaseClient) {
  const { data: roles } = await db.from("role_permissions").select("role_key").eq("permission", "maintenance.manage");
  const keys = [...new Set((roles ?? []).map((r) => r.role_key as string))];
  if (keys.length === 0) return [];
  const { data } = await db.from("staff").select("id, email, phone, full_name").in("role", keys).eq("is_active", true);
  return (data ?? []) as { id: string; email: string; phone: string; full_name: string }[];
}

export async function alertSupervisors(
  db: SupabaseClient,
  ticket: TicketForAlert,
  reason: "urgent" | "escalated",
  staffId: string | null = null,
) {
  const where = ticket.rooms?.room_number ? `Room ${ticket.rooms.room_number}` : ticket.location || "";
  const head =
    reason === "urgent"
      ? `URGENT maintenance ticket ${ticket.reference}`
      : `${ticket.reference} is past its resolution target`;
  const subject = `${head}: ${ticket.title}${where ? ` (${where})` : ""}`;
  const link = `${SITE.url}/admin/maintenance/${ticket.id}`;
  const due = new Date(ticket.due_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const text = [
    subject,
    `Priority: ${MT_PRIORITY_LABELS[ticket.priority]}. Target: ${due}.`,
    reason === "escalated" ? "It has not been resolved in time — please follow up." : "Please assign it now.",
    link,
  ].join("\n");
  const html = `<p><strong>${escapeHtml(subject)}</strong></p>
<p>Priority: ${MT_PRIORITY_LABELS[ticket.priority]}. Target: ${escapeHtml(due)}.</p>
<p>${reason === "escalated" ? "It has not been resolved in time — please follow up." : "Please assign it now."}</p>
<p><a href="${link}">Open the ticket</a></p>`;
  const sms = `${head}: ${ticket.title}${where ? `, ${where}` : ""}. ${link}`;

  const rows: Record<string, unknown>[] = [];
  for (const person of await supervisors(db)) {
    if (person.email) {
      const r = await sendEmail({ to: person.email, subject, html, text });
      rows.push({ ticket_id: ticket.id, kind: "staff", staff_id: person.id, channel: "email", template: `mt_${reason}`, recipient: person.email, subject, body: text, status: r.status, provider_id: r.providerId, error: r.error, created_by: staffId });
    }
    if (person.phone) {
      const r = await sendSms({ to: person.phone, body: sms });
      rows.push({ ticket_id: ticket.id, kind: "staff", staff_id: person.id, channel: "sms", template: `mt_${reason}`, recipient: person.phone, subject: "", body: sms, status: r.status, provider_id: r.providerId, error: r.error, created_by: staffId });
    }
  }
  if (rows.length) await db.from("notifications").insert(rows);
}

/** Marks overdue tickets as escalated (once each) and alerts the supervisors. */
export async function escalateOverdueTickets(
  db: SupabaseClient,
  staffId: string | null = null,
  /** Which hotel. Omit to mean the caller's own (SOW Module 14). */
  propertyId: string | null = null,
) {
  const { data, error } = await db.rpc("mt_escalate_overdue", { p_property: propertyId });
  if (error || !data?.length) return 0;
  const tickets = data as (TicketForAlert & { room_id: string | null })[];
  const roomIds = tickets.map((t) => t.room_id).filter(Boolean) as string[];
  const { data: rooms } = roomIds.length
    ? await db.from("rooms").select("id, room_number").in("id", roomIds)
    : { data: [] };
  for (const t of tickets) {
    const room = (rooms ?? []).find((r) => r.id === t.room_id);
    await alertSupervisors(db, { ...t, rooms: room ? { room_number: room.room_number } : null }, "escalated", staffId);
  }
  return tickets.length;
}

// ── Staff notifications (SOW Module 16) ─────────────────────────────────────

/**
 * The staff who should hear about something, by what their role may do.
 *
 * Targeted by permission rather than by role name so that a property which
 * renames its roles, or adds one, keeps getting the right alerts without a
 * code change — the same reasoning as the maintenance supervisors above.
 */
async function withPermission(db: SupabaseClient, permission: string) {
  const { data: roles } = await db
    .from("role_permissions")
    .select("role_key")
    .eq("permission", permission);
  const keys = [...new Set((roles ?? []).map((r) => r.role_key as string))];
  if (keys.length === 0) return [];

  const { data } = await db
    .from("staff")
    .select("id, email, phone, full_name")
    .in("role", keys)
    .eq("is_active", true);
  return (data ?? []) as StaffRecipient[];
}

interface StaffRecipient {
  id: string;
  email: string;
  phone: string;
  full_name: string;
}

/**
 * Sends one alert to a list of staff and records it against each of them.
 *
 * Every attempt is logged, skipped ones included, so the notification history
 * answers "was anybody told?" rather than only "did it work?" — which is the
 * question that matters when a VIP arrives unannounced.
 */
async function alertStaff(
  db: SupabaseClient,
  people: StaffRecipient[],
  template: string,
  message: { subject: string; text: string; html: string; sms: string },
  link: { bookingId?: string | null; ticketId?: string | null } = {},
  staffId: string | null = null,
) {
  const rows: Record<string, unknown>[] = [];

  for (const person of people) {
    const base = {
      booking_id: link.bookingId ?? null,
      ticket_id: link.ticketId ?? null,
      kind: "staff",
      staff_id: person.id,
      template,
      created_by: staffId,
    };
    if (person.email) {
      const r = await sendEmail({
        to: person.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      rows.push({
        ...base,
        channel: "email",
        recipient: person.email,
        subject: message.subject,
        body: message.text,
        status: r.status,
        provider_id: r.providerId,
        error: r.error,
      });
    }
    if (person.phone) {
      const r = await sendSms({ to: person.phone, body: message.sms });
      rows.push({
        ...base,
        channel: "sms",
        recipient: person.phone,
        subject: "",
        body: message.sms,
        status: r.status,
        provider_id: r.providerId,
        error: r.error,
      });
    }
  }

  if (rows.length) await db.from("notifications").insert(rows);
  return rows.length;
}

const para = (lines: string[]) =>
  lines.map((l) => `<p style="font-size:15px;line-height:1.6">${escapeHtml(l)}</p>`).join("\n");

export interface BookingForAlert {
  id: string;
  reference: string;
  contact_name: string;
  check_in: string;
  check_out: string;
  rooms_count: number;
  total_amount: number | null;
  source: string;
  is_vip?: boolean;
  room_type_name?: string | null;
}

/** A booking has come in — told to whoever may work the reservations book. */
export async function alertNewBooking(
  db: SupabaseClient,
  booking: BookingForAlert,
  staffId: string | null = null,
) {
  const subject = `New booking ${booking.reference} — ${booking.contact_name}`;
  const link = `${SITE.url}/admin/bookings/${booking.id}`;
  const lines = [
    `${booking.contact_name} has booked ${booking.rooms_count} × ${booking.room_type_name ?? "room"}.`,
    `${booking.check_in} to ${booking.check_out}, via ${booking.source.replace(/_/g, " ")}.`,
  ];
  return alertStaff(
    db,
    await withPermission(db, "bookings.view"),
    "staff_new_booking",
    {
      subject,
      text: [subject, ...lines, link].join("\n"),
      html: `${para([subject, ...lines])}<p><a href="${link}">Open the booking</a></p>`,
      sms: `${subject}. ${booking.check_in}–${booking.check_out}. ${link}`,
    },
    { bookingId: booking.id },
    staffId,
  );
}

/** A guest flagged VIP is arriving — told to the desk before they walk in. */
export async function alertVipArrival(
  db: SupabaseClient,
  booking: BookingForAlert,
  staffId: string | null = null,
) {
  const subject = `VIP arriving: ${booking.contact_name} — ${booking.reference}`;
  const link = `${SITE.url}/admin/bookings/${booking.id}`;
  const lines = [
    `${booking.contact_name} is flagged VIP and arrives on ${booking.check_in}.`,
    `${booking.rooms_count} × ${booking.room_type_name ?? "room"}, departing ${booking.check_out}.`,
    "Please check the room personally and greet them by name.",
  ];
  return alertStaff(
    db,
    await withPermission(db, "frontdesk.view"),
    "staff_vip_arrival",
    {
      subject,
      text: [subject, ...lines, link].join("\n"),
      html: `${para([subject, ...lines])}<p><a href="${link}">Open the booking</a></p>`,
      sms: `${subject}. Arrives ${booking.check_in}. ${link}`,
    },
    { bookingId: booking.id },
    staffId,
  );
}

/**
 * A ticket has been given to somebody — told to that person alone.
 *
 * Unlike the other alerts this one has a single named recipient, so it does
 * not go by permission: the point is that the person holding the job hears
 * about it, not that the department does.
 */
export async function alertTicketAssigned(
  db: SupabaseClient,
  ticket: TicketForAlert,
  assigneeId: string,
  staffId: string | null = null,
) {
  const { data } = await db
    .from("staff")
    .select("id, email, phone, full_name")
    .eq("id", assigneeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return 0;

  const where = ticket.rooms?.room_number ? `Room ${ticket.rooms.room_number}` : ticket.location || "";
  const subject = `Assigned to you: ${ticket.reference} — ${ticket.title}`;
  const link = `${SITE.url}/admin/maintenance/${ticket.id}`;
  const due = new Date(ticket.due_at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines = [
    subject,
    `${where ? `${where}. ` : ""}Priority ${MT_PRIORITY_LABELS[ticket.priority]}, due ${due}.`,
  ];
  return alertStaff(
    db,
    [data as StaffRecipient],
    "staff_ticket_assigned",
    {
      subject,
      text: [...lines, link].join("\n"),
      html: `${para(lines)}<p><a href="${link}">Open the ticket</a></p>`,
      sms: `${subject}${where ? `, ${where}` : ""}. Due ${due}. ${link}`,
    },
    { ticketId: ticket.id },
    staffId,
  );
}
