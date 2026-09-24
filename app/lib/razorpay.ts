import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay, the property's payment gateway (SOW Module 7: "integration-ready
 * payment gateway connection", §6.1 PCI-DSS).
 *
 *   RAZORPAY_KEY_ID          Public key id, "rzp_test_…" or "rzp_live_…"
 *   RAZORPAY_KEY_SECRET      Server-only secret. Never sent to the browser.
 *   RAZORPAY_WEBHOOK_SECRET  Signs the webhook, set in the Razorpay dashboard.
 *
 * Money is taken with **payment links** rather than an embedded checkout, so
 * no card data ever reaches this application: the guest pays on Razorpay's own
 * page. That keeps us out of PCI-DSS scope, which storing or proxying card
 * details would not.
 *
 * Amounts cross the wire in paise (the smallest currency unit), which is why
 * every amount here is an integer.
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

export interface GatewayResult<T> {
  ok: boolean;
  data: T | null;
  error: string;
}

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function webhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

/** True for test-mode keys, so the panel can say so out loud. */
export function isTestMode() {
  return (process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test");
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const fromPaise = (paise: number) => Math.round(paise) / 100;

function authHeader() {
  const pair = `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

async function call<T>(path: string, init: RequestInit): Promise<GatewayResult<T>> {
  if (!razorpayConfigured()) {
    return { ok: false, data: null, error: "Online payments are not configured (RAZORPAY_KEY_ID)." };
  }
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) {
      return { ok: false, data: null, error: body.error?.description ?? `Razorpay returned HTTP ${res.status}.` };
    }
    return { ok: true, data: body as T, error: "" };
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : "Could not reach Razorpay." };
  }
}

export interface PaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  expire_by?: number;
}

/**
 * Creates a link the guest can pay from an email, an SMS or the front desk
 * screen. `referenceId` is our own booking reference, which Razorpay shows on
 * the receipt and returns in the webhook.
 */
export async function createPaymentLink(input: {
  amount: number;
  currency: string;
  description: string;
  referenceId: string;
  customer: { name: string; email: string; phone: string };
  notify: boolean;
  expiresInMinutes: number;
  notes: Record<string, string>;
}): Promise<GatewayResult<PaymentLink>> {
  // Razorpay rejects an expiry under 15 minutes away.
  const minutes = Math.max(input.expiresInMinutes, 16);
  return call<PaymentLink>("/payment_links", {
    method: "POST",
    body: JSON.stringify({
      amount: toPaise(input.amount),
      currency: input.currency,
      description: input.description.slice(0, 2048),
      reference_id: input.referenceId,
      expire_by: Math.floor(Date.now() / 1000) + minutes * 60,
      customer: {
        name: input.customer.name,
        ...(input.customer.email ? { email: input.customer.email } : {}),
        ...(input.customer.phone ? { contact: input.customer.phone } : {}),
      },
      notify: { sms: input.notify && Boolean(input.customer.phone), email: input.notify && Boolean(input.customer.email) },
      reminder_enable: true,
      notes: input.notes,
    }),
  });
}

export async function cancelPaymentLink(linkId: string) {
  return call<PaymentLink>(`/payment_links/${linkId}/cancel`, { method: "POST" });
}

export async function fetchPaymentLink(linkId: string) {
  return call<PaymentLink & { payments?: { payment_id: string; status: string }[] }>(
    `/payment_links/${linkId}`,
    { method: "GET" },
  );
}

export interface Refund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

/**
 * Sends money back through the original payment. Razorpay refuses a refund
 * larger than the captured amount, so the caller does not have to.
 */
export async function refundPayment(paymentId: string, amount: number, notes: Record<string, string>) {
  return call<Refund>(`/payments/${paymentId}/refund`, {
    method: "POST",
    body: JSON.stringify({ amount: toPaise(amount), speed: "normal", notes }),
  });
}

/**
 * Checks the signature Razorpay puts on every webhook. Without this anyone
 * who found the endpoint could credit a folio, so a missing secret means the
 * request is rejected rather than trusted.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
