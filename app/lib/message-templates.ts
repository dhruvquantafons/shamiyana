/**
 * Guest message templates (SOW Module 15: "email templates"; Module 16:
 * "admins must be able to edit templates without needing a developer, using
 * placeholders like {GuestName}, {CheckInDate}").
 *
 * The database holds the editable text per template and language
 * (message_templates); these defaults are the fallback and match the seed in
 * 0013_guest_crm_and_admin.sql.
 */
import type { MessageTemplate, MessageTemplateKey } from "./types";

export const TEMPLATE_LABELS: Record<MessageTemplateKey, { name: string; when: string }> = {
  request_received: { name: "Request received", when: "A guest sends a booking request from the website." },
  confirmation: { name: "Booking confirmation", when: "The desk confirms a booking, or sends it again." },
  cancellation: { name: "Cancellation", when: "A booking is cancelled." },
  final_bill: { name: "Final bill", when: "Express check-out emails the bill." },
  pre_arrival: {
    name: "Pre-arrival reminder",
    when: "A set number of days before arrival, by the nightly job.",
  },
  checkin_instructions: {
    name: "Check-in instructions",
    when: "Shortly before arrival: times, what to bring, how to reach us.",
  },
  post_stay: {
    name: "Post-stay thank-you",
    when: "A set number of days after departure, with the feedback link.",
  },
  payment_receipt: { name: "Payment receipt", when: "A payment is recorded against the booking." },
  booking_modified: { name: "Booking updated", when: "Dates, room or rate change on a confirmed booking." },
};

export const PLACEHOLDERS: Record<string, string> = {
  GuestName: "Guest's full name",
  FirstName: "Guest's first name",
  Reference: "Reservation number, e.g. SR-1042",
  CheckInDate: "Arrival date",
  CheckOutDate: "Departure date",
  StayDates: "Arrival to departure",
  RoomType: "Room type booked",
  Guests: "Adults and children",
  Total: "Booking total",
  Balance: "Balance on the final bill",
  Amount: "Payment just received (receipt only)",
  CheckInTime: "Earliest check-in time",
  CheckOutTime: "Latest check-out time",
  HotelName: "Property name (Settings)",
  HotelPhone: "Property phone",
  HotelEmail: "Property email",
  FeedbackLink: "Link to the guest's feedback form (final bill only)",
};

export const DEFAULT_TEMPLATES: Record<MessageTemplateKey, Omit<MessageTemplate, "template" | "language">> = {
  request_received: {
    subject: "We have your request — {Reference}",
    body: "Thank you for choosing {HotelName}. We have received your booking request and our front desk will confirm availability with you shortly. This is not yet a confirmation.",
    footer: "",
    sms: "{HotelName}: we have your request {Reference} for {StayDates}. We will confirm shortly.",
  },
  confirmation: {
    subject: "Booking confirmed — {Reference}",
    body: "Your stay at {HotelName} is confirmed. Please quote reservation {Reference} in any correspondence.",
    footer: "Please bring a government-issued photo ID for every adult. Foreign nationals need their passport and visa.",
    sms: "{HotelName}: booking confirmed {Reference}. {StayDates}. Total {Total}.",
  },
  cancellation: {
    subject: "Booking cancelled — {Reference}",
    body: "Your reservation {Reference} at {HotelName} has been cancelled.",
    footer: "",
    sms: "{HotelName}: booking {Reference} has been cancelled.",
  },
  final_bill: {
    subject: "Your bill — {Reference}",
    body: "Thank you for staying at {HotelName}. Your final bill is below.",
    footer: "We would love to hear about your stay: {FeedbackLink}",
    sms: "{HotelName}: thank you for staying. Your bill for {Reference} is in your email. Balance {Balance}.",
  },
  pre_arrival: {
    subject: "Looking forward to seeing you — {Reference}",
    body: "We are looking forward to welcoming you to {HotelName} on {CheckInDate}. Your reservation {Reference} is confirmed and your room is being prepared.",
    footer: "If your plans have changed, or you would like to arrange an airport pick-up or an early check-in, simply reply to this email or call us on {HotelPhone}.",
    sms: "{HotelName}: we look forward to seeing you on {CheckInDate}. Reservation {Reference}. Call {HotelPhone} for anything you need.",
  },
  checkin_instructions: {
    subject: "Your arrival tomorrow — {Reference}",
    body: "Your stay at {HotelName} begins tomorrow, {CheckInDate}. Check-in is from {CheckInTime}, and check-out on {CheckOutDate} is by {CheckOutTime}.",
    footer: "Please bring a government-issued photo ID for every adult; foreign nationals need their passport and visa. If you expect to arrive late, do let us know on {HotelPhone} so we can hold your room.",
    sms: "{HotelName}: see you tomorrow. Check-in from {CheckInTime}. Bring photo ID. Reservation {Reference}.",
  },
  post_stay: {
    subject: "Thank you for staying with us — {Reference}",
    body: "Thank you for choosing {HotelName}, {FirstName}. It was a pleasure having you with us, and we hope the valley treated you kindly.",
    footer: "If you have a moment, we would be grateful to hear how we did: {FeedbackLink}",
    sms: "{HotelName}: thank you for staying with us. We would love your feedback: {FeedbackLink}",
  },
  payment_receipt: {
    subject: "Payment received — {Reference}",
    body: "Thank you — we have received your payment of {Amount} towards reservation {Reference}.",
    footer: "Your balance is now {Balance}. This message is a receipt of payment; your tax invoice is issued at check-out.",
    sms: "{HotelName}: payment of {Amount} received for {Reference}. Balance {Balance}.",
  },
  booking_modified: {
    subject: "Your booking has been updated — {Reference}",
    body: "Your reservation {Reference} at {HotelName} has been updated. The current details are below — please check them and tell us if anything is not as you expected.",
    footer: "If you did not ask for this change, please call us at once on {HotelPhone}.",
    sms: "{HotelName}: booking {Reference} updated. {StayDates}. Call {HotelPhone} if this is wrong.",
  },
};

/**
 * Fills {Placeholders}. Unknown names are left as written, so a typo is
 * visible rather than silently blank. A line whose placeholder has no value
 * (e.g. no feedback link) is dropped, so it never reads "…your stay: ".
 */
export function renderTemplate(text: string, values: Record<string, string>): string {
  return text
    .split("\n")
    .filter((line) => !/\{(\w+)\}/.test(line) || ![...line.matchAll(/\{(\w+)\}/g)].some(([, k]) => k in values && !values[k]))
    .map((line) => line.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m)))
    .join("\n")
    .trim();
}

/** Placeholders in a text that are not recognised — shown as a warning in the editor. */
export function unknownPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(([, k]) => k).filter((k) => !(k in PLACEHOLDERS)))];
}

/** The template to use: the guest's language, else the property default, else English, else the built-in text. */
export function pickTemplate(
  rows: MessageTemplate[],
  template: MessageTemplateKey,
  languages: (string | null | undefined)[],
): Omit<MessageTemplate, "template" | "language"> {
  for (const lang of [...languages, "en"]) {
    const row = lang && rows.find((r) => r.template === template && r.language === lang);
    if (row) return row;
  }
  return DEFAULT_TEMPLATES[template];
}
