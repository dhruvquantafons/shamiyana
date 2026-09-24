"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requirePermission } from "../lib/auth";
import { getSettings } from "../lib/settings";
import { friendlyDbError } from "../lib/db-errors";
import { sendKotTicket } from "../lib/integrations";
import { checkChargeToRoom } from "../lib/pos";
import type { PosLineModifier, PosOrder, PosOrderLine } from "../lib/types";
import { type ActionState, str, num, int, bool, uuidOrNull, oneOf, lines as formLines } from "./form-utils";

/**
 * Module 6 — Point of Sale.
 *
 * Every money movement and anything that has to touch two tables at once runs
 * inside a database function: adding a line freezes its price and tax,
 * charging to a room posts folio entries and records the payment together, and
 * a points redemption takes the points and credits the bill in one go. These
 * actions validate the form, call the function, and turn its refusals into
 * sentences for the till.
 */

function revalidateOrder(orderId?: string | null, outletId?: string | null) {
  if (orderId) revalidatePath(`/admin/pos/orders/${orderId}`);
  if (outletId) revalidatePath(`/admin/pos/${outletId}`);
  revalidatePath("/admin/pos");
}

// ── Bills ───────────────────────────────────────────────────────────────────

/** Opens a bill and goes straight to it, which is what a waiter wants. */
export async function openOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const outletId = uuidOrNull(fd, "outlet_id");
  if (!outletId) return { error: "Choose an outlet." };

  const { data, error } = await supabase.rpc("pos_open_order", {
    p_outlet: outletId,
    p_table: str(fd, "table_no", 20),
    p_room: uuidOrNull(fd, "room_id"),
    p_booking: uuidOrNull(fd, "booking_id"),
    p_guest: str(fd, "guest_name", 120),
    p_covers: int(fd, "covers", 1, 0, 200),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(data as string, outletId);
  redirect(`/admin/pos/orders/${data}`);
}

/** Adds an item to an open bill. */
export async function addLine(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  const itemId = uuidOrNull(fd, "item_id");
  const qty = num(fd, "qty");
  if (!orderId || !itemId) return { error: "Choose an item." };
  if (qty === null || qty <= 0) return { error: "Enter how many." };

  // Checkboxes give one value per chosen modifier.
  const modifiers = fd
    .getAll("modifier_id")
    .map((v) => String(v))
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v))
    .slice(0, 20);

  const { error } = await supabase.rpc("pos_add_line", {
    p_order: orderId,
    p_item: itemId,
    p_qty: qty,
    p_modifiers: modifiers,
    p_notes: str(fd, "notes", 200),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(orderId);
  return { success: "Added." };
}

/** Voids a line with a reason; the totals recompute themselves. */
export async function voidLine(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("pos.order");
  const supabase = await createClient();
  const lineId = uuidOrNull(fd, "line_id");
  const reason = str(fd, "reason", 200);
  if (!lineId) return { error: "Line not found." };
  if (!reason) return { error: "Give a reason for taking this off the bill." };

  const { data: line } = await supabase
    .from("pos_order_lines")
    .select("order_id, kot_sent_at")
    .eq("id", lineId)
    .maybeSingle();
  if (!line) return { error: "Line not found." };

  const { error } = await supabase
    .from("pos_order_lines")
    .update({ voided_at: new Date().toISOString(), voided_by: session.staff.id, void_reason: reason })
    .eq("id", lineId)
    .is("voided_at", null);
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(line.order_id);
  return {
    success: line.kot_sent_at
      ? "Taken off the bill. It had already gone to the kitchen — tell them."
      : "Taken off the bill.",
  };
}

/** Table, room, guest, covers, notes and the tip. */
export async function updateOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  if (!orderId) return { error: "Bill not found." };

  const tip = num(fd, "tip_amount");
  const { error } = await supabase
    .from("pos_orders")
    .update({
      table_no: str(fd, "table_no", 20),
      room_id: uuidOrNull(fd, "room_id"),
      booking_id: uuidOrNull(fd, "booking_id"),
      guest_name: str(fd, "guest_name", 120),
      covers: int(fd, "covers", 1, 0, 200),
      notes: str(fd, "notes", 500),
      tip_amount: tip !== null && tip >= 0 ? tip : 0,
    })
    .eq("id", orderId)
    .neq("status", "void");
  if (error) return { error: friendlyDbError(error.message) };

  // The tip is part of the total, so the frozen totals have to catch up.
  const { error: recalcError } = await supabase.rpc("pos_recalc_order", { p_order: orderId });
  if (recalcError) return { error: friendlyDbError(recalcError.message) };

  revalidateOrder(orderId);
  return { success: "Bill updated." };
}

/**
 * Splits a bill: opens a second one in the same outlet and moves the chosen
 * lines onto it. The guest who is paying separately gets their own bill.
 */
export async function splitOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  if (!orderId) return { error: "Bill not found." };

  const lineIds = fd
    .getAll("line_id")
    .map((v) => String(v))
    .filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  if (lineIds.length === 0) return { error: "Choose the lines to move onto the new bill." };

  const { data: order } = await supabase
    .from("pos_orders")
    .select("outlet_id, table_no, room_id, booking_id, guest_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Bill not found." };

  const { data: newOrder, error: openError } = await supabase.rpc("pos_open_order", {
    p_outlet: order.outlet_id,
    p_table: order.table_no,
    p_room: order.room_id,
    p_booking: order.booking_id,
    p_guest: str(fd, "guest_name", 120),
    p_covers: 1,
  });
  if (openError) return { error: friendlyDbError(openError.message) };

  const { data: moved, error } = await supabase.rpc("pos_move_lines", {
    p_lines: lineIds,
    p_target: newOrder,
  });
  if (error) {
    // Leaving an empty bill behind would clutter the outlet, so clear it up.
    await supabase.rpc("pos_void_order", { p_order: newOrder, p_reason: "Split abandoned" });
    return { error: friendlyDbError(error.message) };
  }

  await supabase.from("pos_orders").update({ split_from_id: orderId }).eq("id", newOrder);

  revalidateOrder(orderId, order.outlet_id);
  revalidateOrder(newOrder as string);
  return { success: `Moved ${moved} ${Number(moved) === 1 ? "line" : "lines"} onto a new bill.` };
}

/** Merges this bill into another open one and voids the empty shell. */
export async function mergeOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  const targetId = uuidOrNull(fd, "target_id");
  if (!orderId || !targetId) return { error: "Choose the bill to merge into." };
  if (orderId === targetId) return { error: "That is the same bill." };

  const { data: lineRows } = await supabase
    .from("pos_order_lines")
    .select("id")
    .eq("order_id", orderId)
    .is("voided_at", null);
  const lineIds = (lineRows ?? []).map((l) => l.id as string);
  if (lineIds.length === 0) return { error: "There is nothing on this bill to merge." };

  const { error } = await supabase.rpc("pos_move_lines", { p_lines: lineIds, p_target: targetId });
  if (error) return { error: friendlyDbError(error.message) };

  const { error: voidError } = await supabase.rpc("pos_void_order", {
    p_order: orderId,
    p_reason: "Merged into another bill",
  });
  if (voidError) return { error: friendlyDbError(voidError.message) };

  revalidateOrder(orderId);
  revalidateOrder(targetId);
  redirect(`/admin/pos/orders/${targetId}`);
}

export async function voidOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  const reason = str(fd, "reason", 300);
  if (!orderId) return { error: "Bill not found." };
  if (!reason) return { error: "Give a reason for voiding this bill." };

  const { error } = await supabase.rpc("pos_void_order", { p_order: orderId, p_reason: reason });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(orderId);
  return { success: "Bill voided." };
}

// ── Kitchen ─────────────────────────────────────────────────────────────────

/**
 * Fires the unsent lines to the kitchen. The database marks them first, so a
 * line is never sent twice even if the display is unreachable; whether the
 * ticket reached a screen is reported separately.
 */
export async function sendKot(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.order");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  if (!orderId) return { error: "Bill not found." };

  const { data: order } = await supabase
    .from("pos_orders")
    .select("*, pos_outlets(name), rooms(room_number)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Bill not found." };

  const { data: lineRows } = await supabase
    .from("pos_order_lines")
    .select("*")
    .eq("order_id", orderId)
    .is("voided_at", null)
    .is("kot_sent_at", null)
    .order("created_at");
  const unsent = (lineRows ?? []) as PosOrderLine[];
  if (unsent.length === 0) return { error: "Everything on this bill has already gone to the kitchen." };

  const { data: fired, error } = await supabase.rpc("pos_send_kot", { p_order: orderId });
  if (error) return { error: friendlyDbError(error.message) };

  const typed = order as unknown as PosOrder;
  const delivery = await sendKotTicket({
    order: typed.number,
    outlet: typed.pos_outlets?.name ?? "",
    table: typed.table_no,
    room: typed.rooms?.room_number ?? "",
    guest: typed.guest_name,
    covers: typed.covers,
    placedAt: new Date().toISOString(),
    lines: unsent.map((l) => ({
      name: l.name,
      qty: Number(l.qty),
      modifiers: (l.modifiers as PosLineModifier[]).map((m) => m.name),
      notes: l.notes,
    })),
  });

  revalidateOrder(orderId);
  const count = `${fired} ${Number(fired) === 1 ? "item" : "items"}`;
  if (delivery.status === "sent") return { success: `${count} sent to the kitchen.` };
  if (delivery.status === "skipped") return { success: `${count} marked as fired. Print the ticket for the kitchen.` };
  return {
    success: `${count} marked as fired, but the kitchen display did not answer (${delivery.error}). Print the ticket.`,
  };
}

// ── Settling ────────────────────────────────────────────────────────────────

/** Cash, card or UPI at the till. */
export async function takePayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.pay");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  const amount = num(fd, "amount");
  if (!orderId) return { error: "Bill not found." };
  if (amount === null || amount <= 0) return { error: "Enter the amount taken." };

  const { error } = await supabase.rpc("pos_take_payment", {
    p_order: orderId,
    p_kind: oneOf(fd, "kind", ["cash", "card", "upi", "other"] as const, "cash"),
    p_amount: amount,
    p_reference: str(fd, "reference", 120),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(orderId);
  return { success: "Payment taken." };
}

/**
 * Charges the bill to a guest's room. Checked here first so the till gets a
 * helpful sentence, and checked again by the database, which holds the line.
 */
export async function chargeToRoom(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.pay");
  const supabase = await createClient();
  const settings = await getSettings();
  const orderId = uuidOrNull(fd, "order_id");
  const bookingId = uuidOrNull(fd, "booking_id");
  const folioId = uuidOrNull(fd, "folio_id");
  if (!orderId) return { error: "Bill not found." };
  if (!bookingId) return { error: "Choose the room the guest is staying in." };

  // Pre-flight, purely for a better message than the database would give.
  const [{ data: balance }, { data: booking }, { data: charged }] = await Promise.all([
    supabase.rpc("pos_order_balance", { p_order: orderId }),
    supabase.from("bookings").select("status").eq("id", bookingId).maybeSingle(),
    supabase
      .from("pos_payments")
      .select("amount")
      .eq("kind", "room_charge")
      .eq("booking_id", bookingId)
      .is("voided_at", null),
  ]);

  const check = checkChargeToRoom({
    owed: Number(balance ?? 0),
    bookingStatus: booking?.status ?? null,
    alreadyCharged: (charged ?? []).reduce((s, p) => s + Number(p.amount), 0),
    limit: Number(settings.pos_room_charge_limit),
  });
  if (!check.allowed) return { error: check.reason };

  const { error } = await supabase.rpc("pos_charge_to_room", {
    p_order: orderId,
    p_booking: bookingId,
    p_folio: folioId,
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(orderId);
  revalidatePath(`/admin/bookings/${bookingId}`);
  return { success: "Charged to the room. It is on the guest's folio now." };
}

/** Settles part or all of a bill with loyalty points. */
export async function redeemPointsAtPos(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.pay");
  const supabase = await createClient();
  const orderId = uuidOrNull(fd, "order_id");
  const guestId = uuidOrNull(fd, "guest_id");
  const points = num(fd, "points");
  if (!orderId) return { error: "Bill not found." };
  if (!guestId) return { error: "Choose the member redeeming points." };
  if (points === null || points <= 0) return { error: "Enter how many points to redeem." };

  const { data: value, error } = await supabase.rpc("pos_redeem_points", {
    p_order: orderId,
    p_guest: guestId,
    p_points: Math.trunc(points),
  });
  if (error) return { error: friendlyDbError(error.message) };

  revalidateOrder(orderId);
  revalidatePath(`/admin/guests/${guestId}`);
  return { success: `Redeemed ${Math.trunc(points).toLocaleString("en-IN")} points — ${Number(value ?? 0).toFixed(2)} off.` };
}

/** Reverses a payment taken in error. The bill reopens for settling again. */
export async function voidPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await requirePermission("pos.pay");
  const supabase = await createClient();
  const paymentId = uuidOrNull(fd, "payment_id");
  const reason = str(fd, "reason", 300);
  if (!paymentId) return { error: "Payment not found." };
  if (!reason) return { error: "Give a reason for reversing this payment." };

  const { data: payment } = await supabase
    .from("pos_payments")
    .select("order_id, kind")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { error: "Payment not found." };
  if (payment.kind === "room_charge") {
    return {
      error:
        "A room charge is already on the guest's folio. Void it there instead, so the folio and the bill stay in step.",
    };
  }
  if (payment.kind === "loyalty_points") {
    return { error: "Points cannot be put back from here. Add them again as a correction on the guest's profile." };
  }

  const { error } = await supabase
    .from("pos_payments")
    .update({ voided_at: new Date().toISOString(), voided_by: session.staff.id, void_reason: reason })
    .eq("id", paymentId)
    .is("voided_at", null);
  if (error) return { error: friendlyDbError(error.message) };

  await supabase.from("pos_orders").update({ status: "open", closed_at: null }).eq("id", payment.order_id);

  revalidateOrder(payment.order_id);
  return { success: "Payment reversed. The bill is open again." };
}

// ── Menu management ─────────────────────────────────────────────────────────

const OUTLET_KINDS = [
  "restaurant", "bar", "spa", "gift_shop", "mini_bar", "room_service", "laundry",
] as const;

export async function saveOutlet(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const code = str(fd, "code", 6).toUpperCase();
  const name = str(fd, "name", 80);
  if (!/^[A-Z0-9]{2,6}$/.test(code)) {
    return { error: "Use a short code of 2–6 letters or digits, such as RST." };
  }
  if (!name) return { error: "Give the outlet a name." };

  const row = {
    code,
    name,
    kind: oneOf(fd, "kind", OUTLET_KINDS, "restaurant"),
    tax_rate: Math.min(100, Math.max(0, num(fd, "tax_rate") ?? 0)),
    tax_inclusive: bool(fd, "tax_inclusive"),
    service_charge_percent: Math.min(100, Math.max(0, num(fd, "service_charge_percent") ?? 0)),
    orders_by: oneOf(fd, "orders_by", ["table", "room", "either"] as const, "either"),
    sends_kot: bool(fd, "sends_kot"),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 100),
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("pos_outlets").update(row).eq("id", id)
    : await supabase.from("pos_outlets").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/pos/menu");
  revalidatePath("/admin/pos");
  return { success: `${name} saved.` };
}

export async function saveCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const outletId = uuidOrNull(fd, "outlet_id");
  const name = str(fd, "name", 60);
  if (!outletId) return { error: "Choose an outlet." };
  if (!name) return { error: "Give the category a name." };

  const rate = num(fd, "tax_rate");
  const row = {
    outlet_id: outletId,
    name,
    // Blank inherits the outlet's rate, which is the common case.
    tax_rate: rate === null ? null : Math.min(100, Math.max(0, rate)),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 1000),
  };

  const { error } = id
    ? await supabase.from("pos_categories").update(row).eq("id", id)
    : await supabase.from("pos_categories").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/pos/menu");
  return { success: `${name} saved.` };
}

export async function saveItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const outletId = uuidOrNull(fd, "outlet_id");
  const name = str(fd, "name", 120);
  const price = num(fd, "price");
  if (!outletId) return { error: "Choose an outlet." };
  if (!name) return { error: "Give the item a name." };
  if (price === null || price < 0) return { error: "Enter a price." };

  const rate = num(fd, "tax_rate");
  const row = {
    outlet_id: outletId,
    category_id: uuidOrNull(fd, "category_id"),
    code: str(fd, "code", 30),
    name,
    description: str(fd, "description", 300),
    price,
    tax_rate: rate === null ? null : Math.min(100, Math.max(0, rate)),
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 10000),
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("pos_items").update(row).eq("id", id)
    : await supabase.from("pos_items").insert(row);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/pos/menu");
  return { success: `${name} saved.` };
}

/**
 * Saves a modifier and, in one step, which items it may be used on — a
 * modifier nobody can apply is just clutter.
 */
export async function saveModifier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const id = uuidOrNull(fd, "id");
  const outletId = uuidOrNull(fd, "outlet_id");
  const name = str(fd, "name", 60);
  if (!outletId) return { error: "Choose an outlet." };
  if (!name) return { error: "Give the modifier a name, such as “No ice”." };

  const row = {
    outlet_id: outletId,
    name,
    price_delta: num(fd, "price_delta") ?? 0,
    is_active: bool(fd, "is_active"),
    sort_order: int(fd, "sort_order", 0, 0, 1000),
  };

  const saved = id
    ? await supabase.from("pos_modifiers").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("pos_modifiers").insert(row).select("id").maybeSingle();
  if (saved.error) return { error: friendlyDbError(saved.error.message) };

  const modifierId = saved.data?.id ?? id;
  if (modifierId) {
    const itemIds = fd
      .getAll("item_id")
      .map((v) => String(v))
      .filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    await supabase.from("pos_item_modifiers").delete().eq("modifier_id", modifierId);
    if (itemIds.length > 0) {
      const { error } = await supabase
        .from("pos_item_modifiers")
        .insert(itemIds.map((item_id) => ({ item_id, modifier_id: modifierId })));
      if (error) return { error: friendlyDbError(error.message) };
    }
  }

  revalidatePath("/admin/pos/menu");
  return { success: `${name} saved.` };
}

/**
 * Adds several items to one category at once, typed one per line. Entering a
 * menu item by item through a form is the slowest part of setting up an
 * outlet, and a hotel has hundreds.
 *
 * Each line reads "Name | price", e.g. "Rista | 950".
 */
export async function addItemsInBulk(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("pos.manage");
  const supabase = await createClient();
  const outletId = uuidOrNull(fd, "outlet_id");
  const categoryId = uuidOrNull(fd, "category_id");
  if (!outletId) return { error: "Choose an outlet." };

  const rows: { outlet_id: string; category_id: string | null; name: string; price: number; sort_order: number }[] = [];
  const rejected: string[] = [];

  formLines(fd, "items", 200).forEach((raw, index) => {
    const [namePart, pricePart] = raw.split("|");
    const name = (namePart ?? "").trim().slice(0, 120);
    const price = Number((pricePart ?? "").trim());
    if (!name || !Number.isFinite(price) || price < 0) {
      rejected.push(raw);
      return;
    }
    rows.push({ outlet_id: outletId, category_id: categoryId, name, price, sort_order: index });
  });

  if (rows.length === 0) {
    return { error: 'Nothing to add. Write one item per line as "Name | price", for example "Rista | 950".' };
  }

  const { error } = await supabase.from("pos_items").insert(rows);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath("/admin/pos/menu");
  return {
    success:
      `Added ${rows.length} ${rows.length === 1 ? "item" : "items"}.` +
      (rejected.length ? ` ${rejected.length} line(s) were skipped: no price.` : ""),
  };
}
