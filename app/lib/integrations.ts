import "server-only";

/**
 * Outbound integrations, each switched on by environment variables and
 * harmless without them: the call is recorded as "skipped" rather than
 * failing the desk's work.
 *
 *   Email      RESEND_API_KEY, NOTIFY_FROM_EMAIL
 *   SMS        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *   Door locks DOOR_LOCK_WEBHOOK_URL, DOOR_LOCK_API_KEY (optional)
 *
 * Door locks follow SOW §5: "integration hooks only; hardware is out of
 * scope". The lock vendor's middleware receives a signed JSON request and
 * encodes the cards.
 */

export type DeliveryStatus = "sent" | "skipped" | "failed";

export interface DeliveryResult {
  status: DeliveryStatus;
  providerId: string;
  error: string;
}

const TIMEOUT_MS = 10_000;

async function post(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
}

export function smsConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
  );
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<DeliveryResult> {
  if (!emailConfigured()) {
    return { status: "skipped", providerId: "", error: "Email is not configured (RESEND_API_KEY)." };
  }
  try {
    const res = await post("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { status: "failed", providerId: "", error: body.message ?? `HTTP ${res.status}` };
    return { status: "sent", providerId: body.id ?? "", error: "" };
  } catch (e) {
    return { status: "failed", providerId: "", error: e instanceof Error ? e.message : "Email failed" };
  }
}

/** Indian numbers without a country code get +91. */
export function normalisePhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const bare = digits.replace(/^0+/, "");
  return bare.length === 10 ? `+91${bare}` : `+${bare}`;
}

export async function sendSms(message: { to: string; body: string }): Promise<DeliveryResult> {
  if (!smsConfigured()) {
    return { status: "skipped", providerId: "", error: "SMS is not configured (TWILIO_*)." };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  try {
    const res = await post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: normalisePhone(message.to),
        From: process.env.TWILIO_FROM_NUMBER!,
        Body: message.body,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { status: "failed", providerId: "", error: body.message ?? `HTTP ${res.status}` };
    return { status: "sent", providerId: body.sid ?? "", error: "" };
  } catch (e) {
    return { status: "failed", providerId: "", error: e instanceof Error ? e.message : "SMS failed" };
  }
}

export interface KeyCardRequest {
  action: "issue" | "revoke";
  reference: string;
  roomNumber: string;
  guestName: string;
  validFrom: string;
  validUntil: string;
  cards: number;
}

export async function sendKeyCardCommand(req: KeyCardRequest): Promise<DeliveryResult & { provider: string }> {
  const url = process.env.DOOR_LOCK_WEBHOOK_URL;
  if (!url) {
    return {
      status: "skipped",
      provider: "none",
      providerId: "",
      error: "No door lock system connected (DOOR_LOCK_WEBHOOK_URL). Encode keys at the lock terminal.",
    };
  }
  try {
    const res = await post(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DOOR_LOCK_API_KEY ? { Authorization: `Bearer ${process.env.DOOR_LOCK_API_KEY}` } : {}),
      },
      body: JSON.stringify(req),
    });
    const text = await res.text().catch(() => "");
    return {
      status: res.ok ? "sent" : "failed",
      provider: new URL(url).hostname,
      providerId: "",
      error: res.ok ? "" : text.slice(0, 500) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      status: "failed",
      provider: "webhook",
      providerId: "",
      error: e instanceof Error ? e.message : "Door lock request failed",
    };
  }
}


// ── Kitchen Order Tickets (Module 6) ───────────────────────────────────────

export interface KotTicket {
  order: string;
  outlet: string;
  table: string;
  room: string;
  guest: string;
  covers: number;
  placedAt: string;
  lines: { name: string; qty: number; modifiers: string[]; notes: string }[];
}

/**
 * Sends a kitchen ticket to a kitchen display or network printer.
 *
 * The SOW puts POS hardware out of scope (§2.2, "software integration only"),
 * so this is a hook in the same shape as the door locks above: with no
 * endpoint configured it stands down cleanly and the ticket is printed from
 * the browser instead. Nothing in the order flow depends on it succeeding.
 */
export async function sendKotTicket(ticket: KotTicket): Promise<DeliveryResult & { provider: string }> {
  const url = process.env.KOT_WEBHOOK_URL;
  if (!url) {
    return {
      status: "skipped",
      provider: "none",
      providerId: "",
      error: "No kitchen display connected (KOT_WEBHOOK_URL). Print the ticket instead.",
    };
  }
  try {
    const res = await post(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.KOT_API_KEY ? { Authorization: `Bearer ${process.env.KOT_API_KEY}` } : {}),
      },
      body: JSON.stringify(ticket),
    });
    return {
      status: res.ok ? "sent" : "failed",
      provider: new URL(url).hostname,
      providerId: "",
      error: res.ok ? "" : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      status: "failed",
      provider: new URL(url).hostname,
      providerId: "",
      error: e instanceof Error ? e.message : "Kitchen display unreachable",
    };
  }
}
