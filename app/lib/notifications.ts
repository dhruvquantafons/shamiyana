import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, sendSms, type DeliveryResult } from "./integrations";
import type { Booking, MessageTemplate, MessageTemplateKey, PropertySettings } from "./types";
import { MEAL_PLAN_LABELS } from "./types";
import { hhmm } from "./settings";
import { pickTemplate, renderTemplate } from "./message-templates";
import { SITE } from "./site";

/**
 * Guest messages about a booking (SOW Module 1: "automatic booking
 * confirmation email/SMS with a unique reservation ID"; Module 2: express
 * check-out bill). Every attempt, including skipped ones, is written to the
 * notifications table so the desk can see what the guest was actually sent.
 */

export type Template = MessageTemplateKey;

type BookingForMessage = Pick<
  Booking,
  | "id"
  | "reference"
  | "check_in"
  | "check_out"
  | "adults"
  | "children"
  | "rooms_count"
  | "total_amount"
  | "contact_name"
  | "contact_email"
  | "contact_phone"
  | "cancellation_reason"
  | "penalty_amount"
> & {
  room_type_name?: string | null;
  rate_plan_name?: string | null;
  meal_plan?: string | null;
  cancellation_policy?: string | null;
  guest_id?: string | null;
};

export interface BillLine {
  label: string;
  amount: number;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const longDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

function compose(
  template: Template,
  text: Omit<MessageTemplate, "template" | "language">,
  b: BookingForMessage,
  hotel: PropertySettings,
  extra: { bill?: { lines: BillLine[]; balance: number }; feedbackLink?: string; amount?: number },
) {
  const first = (b.contact_name || "Guest").split(" ")[0];
  const stay = `${longDate(b.check_in)} to ${longDate(b.check_out)}`;
  const guests = `${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ""}`;

  const values: Record<string, string> = {
    GuestName: b.contact_name || "Guest",
    FirstName: first,
    Reference: b.reference,
    CheckInDate: longDate(b.check_in),
    CheckOutDate: longDate(b.check_out),
    StayDates: stay,
    RoomType: b.room_type_name ?? "Room",
    Guests: guests,
    Total: money(b.total_amount),
    Balance: money(extra.bill?.balance ?? 0),
    HotelName: hotel.name,
    HotelPhone: hotel.phone,
    HotelEmail: hotel.email,
    FeedbackLink: extra.feedbackLink ?? "",
    Amount: extra.amount === undefined ? "" : money(extra.amount),
    CheckInTime: hhmm(hotel.check_in_time),
    CheckOutTime: hhmm(hotel.check_out_time),
  };

  // The details table is built from the booking; the words around it come
  // from the editable template.
  const rows: [string, string][] = [
    ["Reservation", b.reference],
    ["Stay", stay],
    ["Room", `${b.rooms_count} × ${b.room_type_name ?? "Room"}`],
    ["Guests", guests],
  ];
  if (b.rate_plan_name) {
    const meal = b.meal_plan ? ` · ${MEAL_PLAN_LABELS[b.meal_plan as keyof typeof MEAL_PLAN_LABELS] ?? b.meal_plan}` : "";
    rows.push(["Rate", `${b.rate_plan_name}${meal}`]);
  }
  switch (template) {
    case "confirmation":
      rows.push(["Total", money(b.total_amount)]);
      rows.push(["Check-in / out", `from ${hhmm(hotel.check_in_time)} / by ${hhmm(hotel.check_out_time)}`]);
      if (b.cancellation_policy) rows.push(["Cancellation", b.cancellation_policy]);
      break;
    case "cancellation":
      if (b.penalty_amount) rows.push(["Cancellation charge", money(b.penalty_amount)]);
      break;
    case "final_bill":
      for (const line of extra.bill?.lines ?? []) rows.push([line.label, money(line.amount)]);
      rows.push(["Balance", money(extra.bill?.balance ?? 0)]);
      break;
    case "pre_arrival":
    case "checkin_instructions":
      rows.push(["Check-in / out", `from ${hhmm(hotel.check_in_time)} / by ${hhmm(hotel.check_out_time)}`]);
      break;
    case "booking_modified":
      rows.push(["Total", money(b.total_amount)]);
      rows.push(["Check-in / out", `from ${hhmm(hotel.check_in_time)} / by ${hhmm(hotel.check_out_time)}`]);
      break;
    case "payment_receipt":
      if (extra.amount !== undefined) rows.push(["Payment received", money(extra.amount)]);
      rows.push(["Balance", money(extra.bill?.balance ?? 0)]);
      break;
    // post_stay carries no figures: it is a thank-you, not a statement.
  }

  const subject = renderTemplate(text.subject, values);
  const intro = renderTemplate(text.body, values);
  const outro = renderTemplate(text.footer, values);
  const sms = renderTemplate(text.sms, values);
  const contact = [hotel.phone, hotel.email].filter(Boolean).join(" · ");
  const paragraphs = (t: string) =>
    t
      .split(/\n{2,}|\n/)
      .filter(Boolean)
      .map((p) => `<p style="font-size:15px;line-height:1.6;color:#3a3935">${linkify(esc(p))}</p>`)
      .join("\n");

  const plain = [
    `Dear ${first},`,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(outro ? ["", outro] : []),
    "",
    `${hotel.name}${contact ? ` — ${contact}` : ""}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:Georgia,serif;color:#1c1b1a">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a88956;margin:0 0 20px">${esc(hotel.name)}</p>
<p style="font-size:16px">Dear ${esc(first)},</p>
${paragraphs(intro)}
<table style="width:100%;border-collapse:collapse;margin:20px 0;font-family:Arial,sans-serif;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e0d8;color:#7a7771;width:40%">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e0d8">${esc(v)}</td></tr>`).join("\n")}
</table>
${paragraphs(outro)}
<p style="font-size:12px;color:#9a9490;margin-top:28px;font-family:Arial,sans-serif">${esc(hotel.name)}${contact ? ` · ${esc(contact)}` : ""}</p>
</div></body></html>`;

  return { subject, text: plain, html, sms };
}

/** Makes https links in already-escaped text clickable. */
const linkify = (escaped: string) =>
  escaped.replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#a88956">${url}</a>`);

/** Composes a message without sending it — for the template editor's preview. */
export function previewMessage(
  template: Template,
  text: Omit<MessageTemplate, "template" | "language">,
  hotel: PropertySettings,
) {
  const sample: BookingForMessage = {
    id: "",
    reference: "SR-1042",
    check_in: "2026-10-05",
    check_out: "2026-10-07",
    adults: 2,
    children: 0,
    rooms_count: 1,
    total_amount: 18998,
    contact_name: "Asha Mehta",
    contact_email: "",
    contact_phone: "",
    cancellation_reason: "",
    penalty_amount: 0,
    room_type_name: "Premier Room",
    rate_plan_name: "Best Available Rate",
    meal_plan: "CP",
  };
  return compose(template, text, sample, hotel, {
    bill: { lines: [{ label: "Room charges", amount: 16100 }, { label: "GST", amount: 2898 }], balance: 0 },
    feedbackLink: `${SITE.url}/feedback/sample`,
  });
}

export interface SendSummary {
  email: DeliveryResult | null;
  sms: DeliveryResult | null;
}

/**
 * Sends a booking message by email and SMS where the guest gave those
 * details, and records each attempt. `db` must be able to insert into
 * notifications: the staff member's client, or the service client for the
 * public website.
 */
export async function sendBookingMessage(
  db: SupabaseClient,
  template: Template,
  booking: BookingForMessage,
  hotel: PropertySettings,
  options: {
    staffId?: string | null;
    bill?: { lines: BillLine[]; balance: number };
    sms?: boolean;
    feedbackLink?: string;
    /** The payment just taken, for a receipt. */
    amount?: number;
  } = {},
): Promise<SendSummary> {
  // The guest's language when a template exists for it, else the property's.
  const [{ data: templateRows }, { data: guest }] = await Promise.all([
    db.from("message_templates").select("*").eq("template", template),
    booking.guest_id
      ? db.from("guests").select("language").eq("id", booking.guest_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const text = pickTemplate((templateRows ?? []) as MessageTemplate[], template, [
    (guest as { language?: string } | null)?.language,
    hotel.default_language,
  ]);
  const message = compose(template, text, booking, hotel, {
    bill: options.bill,
    feedbackLink: options.feedbackLink,
    amount: options.amount,
  });
  const summary: SendSummary = { email: null, sms: null };
  const rows: Record<string, unknown>[] = [];

  if (booking.contact_email) {
    summary.email = await sendEmail({
      to: booking.contact_email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    rows.push({
      booking_id: booking.id,
      guest_id: booking.guest_id ?? null,
      kind: "guest",
      channel: "email",
      template,
      recipient: booking.contact_email,
      subject: message.subject,
      body: message.text,
      status: summary.email.status,
      provider_id: summary.email.providerId,
      error: summary.email.error,
      created_by: options.staffId ?? null,
    });
  }

  if (booking.contact_phone && options.sms !== false) {
    summary.sms = await sendSms({ to: booking.contact_phone, body: message.sms });
    rows.push({
      booking_id: booking.id,
      guest_id: booking.guest_id ?? null,
      kind: "guest",
      channel: "sms",
      template,
      recipient: booking.contact_phone,
      subject: "",
      body: message.sms,
      status: summary.sms.status,
      provider_id: summary.sms.providerId,
      error: summary.sms.error,
      created_by: options.staffId ?? null,
    });
  }

  if (rows.length) await db.from("notifications").insert(rows);
  return summary;
}

/** One line for the desk about what went out. */
export function describeSend(summary: SendSummary) {
  const part = (label: string, r: DeliveryResult | null) =>
    !r ? null : r.status === "sent" ? `${label} sent` : r.status === "skipped" ? `${label} not configured` : `${label} failed (${r.error})`;
  const parts = [part("Email", summary.email), part("SMS", summary.sms)].filter(Boolean);
  return parts.length ? parts.join(", ") + "." : "No email or phone on file, so nothing was sent.";
}
