import { createServiceClient } from "../../../../lib/supabase/server";
import { verifyWebhookSignature, webhookConfigured, fromPaise } from "../../../../lib/razorpay";

/**
 * Razorpay webhook (SOW Module 7: online payments).
 *
 *   POST /api/payments/razorpay/webhook
 *   X-Razorpay-Signature: <HMAC SHA256 of the raw body, RAZORPAY_WEBHOOK_SECRET>
 *
 * Subscribe to these events in the Razorpay dashboard:
 *   payment_link.paid       money arrived — credit the folio
 *   payment_link.cancelled  the desk or the guest gave up on the link
 *   payment_link.expired    the link ran out before it was paid
 *
 * This is the only place a guest's online payment reaches the folio. The desk
 * screen never credits a folio from the browser, because a browser can be
 * lied to; the gateway's signed message cannot.
 *
 * The endpoint is safe to call more than once with the same event: the
 * gateway payment id is unique on payment_transactions, and a transaction
 * that already has a folio entry is left alone. Razorpay retries on any
 * non-2xx reply, so genuine failures return 500 on purpose and anything we
 * deliberately ignore returns 200.
 *
 * Disabled until RAZORPAY_WEBHOOK_SECRET is set.
 */

interface LinkEntity {
  id?: string;
  status?: string;
  amount_paid?: number;
  notes?: { booking_id?: string; purpose?: string };
}

export async function POST(request: Request) {
  if (!webhookConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Payment webhook is not configured." }, { status: 503 });
  }

  // The signature covers the exact bytes sent, so the body must be read as
  // text and never re-serialised before checking.
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature") ?? "")) {
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: {
    event?: string;
    payload?: {
      payment_link?: { entity?: LinkEntity };
      payment?: { entity?: { id?: string; amount?: number } };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body is not JSON." }, { status: 400 });
  }

  const name = event.event ?? "";
  const link = event.payload?.payment_link?.entity;
  const payment = event.payload?.payment?.entity;
  if (!link?.id) return Response.json({ ok: true, ignored: "no payment link in payload" });

  const supabase = createServiceClient();
  const { data: tx } = await supabase
    .from("payment_transactions")
    .select("id, booking_id, folio_id, amount, status, purpose, folio_entry_id")
    .eq("provider_link_id", link.id)
    .maybeSingle();
  // A link we did not create, or one from another environment sharing the
  // same Razorpay account. Acknowledge it so Razorpay stops retrying.
  if (!tx) return Response.json({ ok: true, ignored: "unknown payment link" });

  if (name === "payment_link.cancelled" || name === "payment_link.expired") {
    await supabase
      .from("payment_transactions")
      .update({
        status: name === "payment_link.expired" ? "expired" : "cancelled",
        last_event: name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.id)
      .eq("status", "created");
    return Response.json({ ok: true });
  }

  if (name !== "payment_link.paid") {
    return Response.json({ ok: true, ignored: name });
  }

  // Already credited: this is a retry or a duplicate delivery.
  if (tx.folio_entry_id) return Response.json({ ok: true, ignored: "already posted" });

  // Trust the gateway's figure over ours — the guest may have been charged a
  // different amount if the link was edited in the Razorpay dashboard.
  const paid = typeof link.amount_paid === "number" ? fromPaise(link.amount_paid) : Number(tx.amount);
  if (!(paid > 0)) return Response.json({ ok: true, ignored: "no amount paid" });

  const { data: entry, error } = await supabase
    .from("folio_entries")
    .insert({
      booking_id: tx.booking_id,
      folio_id: tx.folio_id,
      kind: "payment",
      description: tx.purpose === "deposit" ? "Deposit paid online" : "Paid online",
      amount: paid,
      method: "online_gateway",
      reference: payment?.id ?? link.id,
      is_deposit: tx.purpose === "deposit",
    })
    .select("id")
    .single();

  if (error) {
    // Return 500 so Razorpay retries: the money is real and the folio must
    // end up reflecting it.
    await supabase
      .from("payment_transactions")
      .update({ last_event: `${name} (folio post failed: ${error.message})`, updated_at: new Date().toISOString() })
      .eq("id", tx.id);
    return Response.json({ error: "Could not post to the folio." }, { status: 500 });
  }

  await supabase
    .from("payment_transactions")
    .update({
      status: "paid",
      provider_ref: payment?.id ?? null,
      folio_entry_id: entry.id,
      paid_at: new Date().toISOString(),
      last_event: name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tx.id);

  return Response.json({ ok: true, posted: paid });
}
