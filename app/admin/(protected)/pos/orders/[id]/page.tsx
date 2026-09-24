import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer, ChefHat } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import { getSettings } from "../../../../../lib/settings";
import { orderBalance, amountPaid, taxBands, unsentLines, checkChargeToRoom } from "../../../../../lib/pos";
import { maxRedeemablePoints, redemptionValue, tierByKey } from "../../../../../lib/loyalty";
import type {
  Booking,
  Folio,
  LoyaltyTier,
  Outlet,
  PosCategory,
  PosItem,
  PosModifier,
  PosOrder,
  PosOrderLine,
  PosPayment,
  Room,
} from "../../../../../lib/types";
import {
  OUTLET_KIND_LABELS,
  POS_ORDER_STATUS_LABELS,
  POS_PAYMENT_KIND_LABELS,
} from "../../../../../lib/types";
import {
  addLine,
  voidLine,
  updateOrder,
  splitOrder,
  mergeOrder,
  sendKot,
  takePayment,
  chargeToRoom,
  redeemPointsAtPos,
  voidOrder,
  voidPayment,
} from "../../../../pos-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  Stat,
  Tag,
  fmtDateTime,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../../components/ui";
import ActionForm from "../../../../components/ActionForm";
import LiveRefresh from "../../../../components/LiveRefresh";

/**
 * One bill: what has been ordered, what it comes to, and how it gets paid.
 *
 * Items are added from the menu below, each with its own small form, so the
 * whole screen works without any client-side JavaScript — a tablet on a weak
 * hotel wifi still takes orders.
 */
export default async function PosOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["pos.view", "pos.order", "pos.pay"]);
  const { id } = await params;
  const supabase = await createClient();
  const settings = await getSettings();

  const { data: orderRow } = await supabase
    .from("pos_orders")
    .select("*, pos_outlets(*), rooms(room_number), bookings(reference, contact_name, status)")
    .eq("id", id)
    .maybeSingle();
  if (!orderRow) notFound();
  const order = orderRow as unknown as PosOrder & { pos_outlets: Outlet };
  const outlet = order.pos_outlets;

  const [
    { data: lineRows },
    { data: payRows },
    { data: catRows },
    { data: itemRows },
    { data: modRows },
    { data: linkRows },
    { data: inHouseRows },
    { data: roomRows },
    { data: otherOpenRows },
    { data: tierRows },
  ] = await Promise.all([
    supabase.from("pos_order_lines").select("*").eq("order_id", id).order("created_at"),
    supabase.from("pos_payments").select("*").eq("order_id", id).order("created_at"),
    supabase.from("pos_categories").select("*").eq("outlet_id", outlet.id).eq("is_active", true).order("sort_order"),
    supabase.from("pos_items").select("*").eq("outlet_id", outlet.id).eq("is_active", true).order("sort_order"),
    supabase.from("pos_modifiers").select("*").eq("outlet_id", outlet.id).eq("is_active", true).order("sort_order"),
    supabase.from("pos_item_modifiers").select("item_id, modifier_id"),
    supabase
      .from("bookings")
      .select("id, reference, contact_name, guest_id, room_id, rooms(room_number)")
      .eq("status", "checked_in")
      .order("check_in"),
    supabase.from("rooms").select("id, room_number").order("room_number"),
    supabase
      .from("pos_orders")
      .select("id, number, table_no, grand_total")
      .eq("outlet_id", outlet.id)
      .eq("status", "open")
      .neq("id", id),
    supabase.from("loyalty_tiers").select("*").order("sort_order"),
  ]);

  const lines = (lineRows ?? []) as PosOrderLine[];
  const payments = (payRows ?? []) as PosPayment[];
  const categories = (catRows ?? []) as PosCategory[];
  const items = (itemRows ?? []) as PosItem[];
  const modifiers = (modRows ?? []) as PosModifier[];
  const links = (linkRows ?? []) as { item_id: string; modifier_id: string }[];
  const inHouse = (inHouseRows ?? []) as unknown as (Pick<
    Booking,
    "id" | "reference" | "contact_name" | "guest_id" | "room_id"
  > & { rooms: { room_number: string } | null })[];
  const rooms = (roomRows ?? []) as Pick<Room, "id" | "room_number">[];
  const otherOpen = (otherOpenRows ?? []) as Pick<PosOrder, "id" | "number" | "table_no" | "grand_total">[];
  const tiers = (tierRows ?? []) as LoyaltyTier[];

  const live = lines.filter((l) => !l.voided_at);
  const balance = orderBalance(order, payments);
  const paid = amountPaid(payments);
  const bands = taxBands(lines);
  const unsent = unsentLines(lines);
  const isOpen = order.status === "open";
  const isVoid = order.status === "void";

  const canOrder = can(session, "pos.order") && isOpen;
  const canPay = can(session, "pos.pay") && !isVoid;
  const canManage = can(session, "pos.manage");

  // ── Charge to room: who, and is it allowed ──
  const booking = order.booking_id ? inHouse.find((b) => b.id === order.booking_id) : undefined;
  const { data: folioRows } = order.booking_id
    ? await supabase.from("folios").select("*, companies(id, name)").eq("booking_id", order.booking_id).order("created_at")
    : { data: null };
  const folios = (folioRows ?? []) as Folio[];

  const { data: chargedRows } = order.booking_id
    ? await supabase
        .from("pos_payments")
        .select("amount")
        .eq("kind", "room_charge")
        .eq("booking_id", order.booking_id)
        .is("voided_at", null)
    : { data: null };
  const alreadyCharged = (chargedRows ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const roomCheck = checkChargeToRoom({
    owed: balance,
    bookingStatus: order.booking_id ? (order.bookings?.status ?? "checked_in") : null,
    alreadyCharged,
    limit: Number(settings.pos_room_charge_limit),
  });

  // ── Loyalty ──
  const guestId = booking?.guest_id ?? null;
  const { data: guestRow } = guestId
    ? await supabase
        .from("guests")
        .select("id, full_name, loyalty_opt_in, loyalty_member_no, loyalty_tier")
        .eq("id", guestId)
        .maybeSingle()
    : { data: null };
  const { data: pointsBalance } = guestId
    ? await supabase.rpc("loyalty_balance", { p_guest: guestId })
    : { data: 0 };
  const tier = guestRow?.loyalty_opt_in ? tierByKey(tiers, guestRow.loyalty_tier) : null;
  const maxPoints = maxRedeemablePoints(Number(pointsBalance ?? 0), balance, tier);

  const modifiersFor = (itemId: string) => {
    const allowed = new Set(links.filter((l) => l.item_id === itemId).map((l) => l.modifier_id));
    return modifiers.filter((m) => allowed.has(m.id));
  };

  const uncategorised = items.filter((i) => !i.category_id);

  return (
    <div className="space-y-6">
      <LiveRefresh tables={["pos_order_lines", "pos_payments", "pos_orders"]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/pos/${outlet.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {outlet.name}
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href={`/admin/pos/orders/${id}/bill`}
            className="inline-flex items-center gap-1.5 text-yellow-700 hover:underline"
          >
            <Printer className="w-3.5 h-3.5" /> Print bill
          </Link>
          {outlet.sends_kot && (
            <Link
              href={`/admin/pos/orders/${id}/kot`}
              className="inline-flex items-center gap-1.5 text-yellow-700 hover:underline"
            >
              <ChefHat className="w-3.5 h-3.5" /> Kitchen ticket
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900 font-mono mr-1">{order.number}</h2>
        <Tag tone={order.status === "settled" ? "green" : isVoid ? "red" : order.status === "billed" ? "amber" : "neutral"}>
          {POS_ORDER_STATUS_LABELS[order.status]}
        </Tag>
        <span className="text-xs text-slate-500">
          {outlet.name} · {OUTLET_KIND_LABELS[outlet.kind]}
        </span>
      </div>

      {isVoid && <Notice tone="warn">This bill was voided{order.void_reason ? `: ${order.void_reason}` : ""}.</Notice>}
      {order.split_from_id && (
        <Notice tone="info">
          Split from{" "}
          <Link href={`/admin/pos/orders/${order.split_from_id}`} className="underline">
            another bill
          </Link>
          .
        </Notice>
      )}

      {/* ── Summary ── */}
      <Card className="p-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <Stat label="Table">{order.table_no || "—"}</Stat>
          <Stat label="Room">{order.rooms?.room_number ?? "—"}</Stat>
          <Stat label="Guest">{order.guest_name || order.bookings?.contact_name || "—"}</Stat>
          <Stat label="Covers">{order.covers}</Stat>
          <Stat label="Total">{fmtMoney(order.grand_total)}</Stat>
          <Stat label="Owed">
            <span className={balance > 0 ? "text-rose-700" : "text-emerald-700"}>{fmtMoney(balance)}</span>
          </Stat>
        </dl>
        <p className="mt-3 text-[11px] text-slate-500">
          Opened {fmtDateTime(order.opened_at)}
          {order.closed_at && ` · closed ${fmtDateTime(order.closed_at)}`}
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── The bill ── */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <div className="px-4 pt-4">
              <SectionTitle
                action={
                  canOrder && outlet.sends_kot && unsent.length > 0 ? (
                    <ActionForm action={sendKot} submitLabel={`Send ${unsent.length} to kitchen`} submitClassName={secondaryButtonClass}>
                      <input type="hidden" name="order_id" value={id} />
                    </ActionForm>
                  ) : undefined
                }
              >
                Ordered
              </SectionTitle>
            </div>
            {lines.length === 0 ? (
              <EmptyState message="Nothing on this bill yet. Add from the menu below." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={tableHeadClass}>
                      <th className="py-2 px-4 font-semibold">Item</th>
                      <th className="py-2 pr-3 font-semibold text-right">Qty</th>
                      <th className="py-2 pr-3 font-semibold text-right">Unit</th>
                      <th className="py-2 pr-3 font-semibold text-right">Net</th>
                      <th className="py-2 pr-3 font-semibold text-right">Tax</th>
                      <th className="py-2 pr-4 font-semibold" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {lines.map((l) => (
                      <tr key={l.id} className={l.voided_at ? "text-slate-400 line-through" : ""}>
                        <td className="py-2 px-4">
                          {l.name}
                          {l.modifiers.length > 0 && (
                            <span className="block text-[10px] text-slate-500 no-underline">
                              {l.modifiers.map((m) => m.name).join(", ")}
                            </span>
                          )}
                          {l.notes && <span className="block text-[10px] text-slate-500 no-underline">{l.notes}</span>}
                          {l.kot_sent_at && (
                            <span className="block text-[10px] text-emerald-700 no-underline">Sent to kitchen</span>
                          )}
                          {l.voided_at && (
                            <span className="block text-[10px] text-rose-700 no-underline">Off: {l.void_reason}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">{Number(l.qty)}</td>
                        <td className="py-2 pr-3 text-right">{fmtMoney(l.unit_price)}</td>
                        <td className="py-2 pr-3 text-right">{fmtMoney(l.net_amount)}</td>
                        <td className="py-2 pr-3 text-right">
                          {Number(l.tax_amount) ? `${fmtMoney(l.tax_amount)} (${Number(l.tax_rate)}%)` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {canOrder && !l.voided_at && (
                            <details className="relative inline-block text-left">
                              <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                                Take off
                              </summary>
                              <div className="absolute right-0 z-10 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                                <ActionForm action={voidLine} submitLabel="Take off the bill" submitClassName={secondaryButtonClass} className="space-y-2">
                                  <input type="hidden" name="line_id" value={l.id} />
                                  <input name="reason" required placeholder="Reason" className={inputClass} />
                                </ActionForm>
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Totals ── */}
            {live.length > 0 && (
              <div className="px-4 py-4 border-t border-slate-100">
                <div className="ml-auto max-w-xs space-y-1 text-xs">
                  {bands.map((b) => (
                    <p key={b.rate} className="flex justify-between text-slate-600">
                      <span>Taxable at {b.rate}%</span>
                      <span>
                        {fmtMoney(b.net)} + {fmtMoney(b.tax)}
                      </span>
                    </p>
                  ))}
                  <p className="flex justify-between">
                    <span className="text-slate-600">Items</span>
                    <span>{fmtMoney(order.net_total)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-slate-600">{settings.tax_label}</span>
                    <span>{fmtMoney(Number(order.tax_total) + Number(order.service_tax))}</span>
                  </p>
                  {Number(order.service_net) > 0 && (
                    <p className="flex justify-between">
                      <span className="text-slate-600">Service charge ({outlet.service_charge_percent}%)</span>
                      <span>{fmtMoney(order.service_net)}</span>
                    </p>
                  )}
                  {Number(order.tip_amount) > 0 && (
                    <p className="flex justify-between">
                      <span className="text-slate-600">Tip</span>
                      <span>{fmtMoney(order.tip_amount)}</span>
                    </p>
                  )}
                  <p className="flex justify-between border-t border-slate-900 pt-1.5 font-semibold text-slate-900">
                    <span>Total</span>
                    <span>{fmtMoney(order.grand_total)}</span>
                  </p>
                  {paid > 0 && (
                    <p className="flex justify-between text-emerald-700">
                      <span>Paid</span>
                      <span>−{fmtMoney(paid)}</span>
                    </p>
                  )}
                  <p className="flex justify-between font-semibold">
                    <span>Owed</span>
                    <span className={balance > 0 ? "text-rose-700" : "text-emerald-700"}>{fmtMoney(balance)}</span>
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* ── Add from the menu ── */}
          {canOrder && (
            <Card className="p-5">
              <SectionTitle>Add to the bill</SectionTitle>
              {items.length === 0 ? (
                <p className="text-xs text-slate-500">This outlet has no menu items yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...categories, null].map((category) => {
                    const own = category ? items.filter((i) => i.category_id === category.id) : uncategorised;
                    if (own.length === 0) return null;
                    return (
                      <details key={category?.id ?? "none"} open={categories.length <= 1}>
                        <summary className="text-xs font-medium text-yellow-700 cursor-pointer py-1">
                          {category?.name ?? "Other"} ({own.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {own.map((item) => {
                            const mods = modifiersFor(item.id);
                            return (
                              <li key={item.id} className="border border-slate-200 rounded-lg p-3">
                                <ActionForm
                                  action={addLine}
                                  submitLabel="Add"
                                  submitClassName={secondaryButtonClass}
                                  className="space-y-2"
                                >
                                  <input type="hidden" name="order_id" value={id} />
                                  <input type="hidden" name="item_id" value={item.id} />
                                  <div className="flex flex-wrap items-end justify-between gap-3">
                                    <div>
                                      <p className="text-sm text-slate-900">{item.name}</p>
                                      <p className="text-[11px] text-slate-500">
                                        {fmtMoney(item.price)}
                                        {item.description ? ` · ${item.description}` : ""}
                                      </p>
                                    </div>
                                    <div className="w-20">
                                      <Field label="Qty">
                                        <input
                                          type="number"
                                          name="qty"
                                          min={0.001}
                                          step="1"
                                          defaultValue={1}
                                          className={inputClass}
                                        />
                                      </Field>
                                    </div>
                                  </div>
                                  {mods.length > 0 && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      {mods.map((m) => (
                                        <Check
                                          key={m.id}
                                          name="modifier_id"
                                          value={m.id}
                                          label={`${m.name}${Number(m.price_delta) ? ` (${fmtMoney(m.price_delta)})` : ""}`}
                                        />
                                      ))}
                                    </div>
                                  )}
                                  <input
                                    name="notes"
                                    maxLength={200}
                                    placeholder="Note for the kitchen — mild, no onion…"
                                    className={inputClass}
                                  />
                                </ActionForm>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* ── Settling ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Payments taken */}
          {payments.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Paid</SectionTitle>
              <ul className="space-y-2 text-xs">
                {payments.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 ${p.voided_at ? "text-slate-400 line-through" : ""}`}>
                    <span>
                      <Tag tone={p.kind === "room_charge" ? "violet" : p.kind === "loyalty_points" ? "gold" : "green"}>
                        {POS_PAYMENT_KIND_LABELS[p.kind]}
                      </Tag>
                      {p.points && <span className="text-slate-500"> {p.points.toLocaleString("en-IN")} pts</span>}
                      {p.reference && <span className="text-slate-500"> · {p.reference}</span>}
                      {p.voided_at && (
                        <span className="block text-[10px] text-rose-700 no-underline">Reversed: {p.void_reason}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{fmtMoney(p.amount)}</span>
                      {canPay && !p.voided_at && p.kind !== "room_charge" && p.kind !== "loyalty_points" && (
                        <details className="relative inline-block text-left">
                          <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                            Reverse
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                            <ActionForm action={voidPayment} submitLabel="Reverse" submitClassName={secondaryButtonClass} className="space-y-2">
                              <input type="hidden" name="payment_id" value={p.id} />
                              <input name="reason" required placeholder="Reason" className={inputClass} />
                            </ActionForm>
                          </div>
                        </details>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Take payment */}
          {canPay && balance > 0 && (
            <Card className="p-5">
              <SectionTitle>Take payment</SectionTitle>
              <ActionForm action={takePayment} submitLabel="Record payment" submitClassName={secondaryButtonClass} className="space-y-3">
                <input type="hidden" name="order_id" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="How">
                    <select name="kind" defaultValue="cash" className={inputClass}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label={`Amount (${settings.currency})`}>
                    <input
                      type="number"
                      name="amount"
                      min={0.01}
                      step="0.01"
                      max={balance}
                      required
                      defaultValue={balance}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label="Reference" hint="Optional — card slip or UPI id.">
                  <input name="reference" maxLength={120} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}

          {/* Charge to room */}
          {canPay && balance > 0 && (
            <Card className="p-5">
              <SectionTitle>Charge to a room</SectionTitle>
              {!order.booking_id ? (
                <p className="text-xs text-slate-500">
                  This bill is not linked to a stay. Choose an in-house guest under <strong>Bill details</strong> below
                  first — only a guest who is checked in may charge to their room.
                </p>
              ) : !roomCheck.allowed ? (
                <Notice tone="warn">{roomCheck.reason}</Notice>
              ) : (
                <ActionForm action={chargeToRoom} submitLabel={`Charge ${fmtMoney(balance)} to the room`} submitClassName={secondaryButtonClass} className="space-y-3">
                  <input type="hidden" name="order_id" value={id} />
                  <input type="hidden" name="booking_id" value={order.booking_id} />
                  <p className="text-xs text-slate-700">
                    {order.bookings?.contact_name}
                    {order.bookings?.reference && <span className="text-slate-500"> · {order.bookings.reference}</span>}
                  </p>
                  {folios.length > 1 && (
                    <Field label="Which bill on the stay">
                      <select name="folio_id" defaultValue="" className={inputClass}>
                        <option value="">Master</option>
                        {folios
                          .filter((f) => f.kind !== "master")
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label || "Folio"}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  <p className="text-[11px] text-slate-500">
                    Posts to the guest&apos;s folio, one line per tax rate so the tax invoice stays correct.
                    {settings.pos_room_charge_limit > 0 &&
                      ` This stay carries ${fmtMoney(alreadyCharged)} of a ${fmtMoney(settings.pos_room_charge_limit)} outlet limit.`}
                  </p>
                </ActionForm>
              )}
            </Card>
          )}

          {/* Loyalty points */}
          {canPay && balance > 0 && settings.loyalty_enabled && tier && guestRow && (
            <Card className="p-5">
              <SectionTitle>Loyalty points</SectionTitle>
              <div className="flex flex-wrap items-center gap-2 -mt-1 mb-3 text-xs">
                <Tag tone="gold">{tier.name}</Tag>
                <span className="text-slate-600">
                  {guestRow.full_name} · {Number(pointsBalance ?? 0).toLocaleString("en-IN")} points
                </span>
              </div>
              {maxPoints < settings.loyalty_min_redeem_points ? (
                <p className="text-xs text-slate-500">
                  Not enough points for a redemption here — the smallest is{" "}
                  {settings.loyalty_min_redeem_points.toLocaleString("en-IN")}.
                </p>
              ) : (
                <ActionForm action={redeemPointsAtPos} submitLabel="Redeem points" submitClassName={secondaryButtonClass} className="space-y-3">
                  <input type="hidden" name="order_id" value={id} />
                  <input type="hidden" name="guest_id" value={guestRow.id} />
                  <Field
                    label="Points"
                    hint={`Up to ${maxPoints.toLocaleString("en-IN")} fit this bill — ${fmtMoney(redemptionValue(maxPoints, tier))}.`}
                  >
                    <input
                      type="number"
                      name="points"
                      min={settings.loyalty_min_redeem_points}
                      max={maxPoints}
                      step={1}
                      required
                      defaultValue={maxPoints}
                      className={inputClass}
                    />
                  </Field>
                </ActionForm>
              )}
            </Card>
          )}

          {/* Bill details */}
          {canOrder && (
            <Card className="p-5">
              <SectionTitle>Bill details</SectionTitle>
              <ActionForm action={updateOrder} submitLabel="Save" submitClassName={secondaryButtonClass} className="space-y-3">
                <input type="hidden" name="order_id" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Table">
                    <input name="table_no" maxLength={20} defaultValue={order.table_no} className={inputClass} />
                  </Field>
                  <Field label="Covers">
                    <input type="number" name="covers" min={0} max={200} defaultValue={order.covers} className={inputClass} />
                  </Field>
                </div>
                <Field label="Room">
                  <select name="room_id" defaultValue={order.room_id ?? ""} className={inputClass}>
                    <option value="">—</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.room_number}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="In-house guest" hint="Needed to charge to a room or redeem points.">
                  <select name="booking_id" defaultValue={order.booking_id ?? ""} className={inputClass}>
                    <option value="">Not a resident</option>
                    {inHouse.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.rooms?.room_number ? `${b.rooms.room_number} — ` : ""}
                        {b.contact_name} ({b.reference})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Name on the bill">
                  <input name="guest_name" maxLength={120} defaultValue={order.guest_name} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Tip (${settings.currency})`} hint="Not taxed.">
                    <input type="number" name="tip_amount" min={0} step="0.01" defaultValue={Number(order.tip_amount)} className={inputClass} />
                  </Field>
                </div>
                <Field label="Notes">
                  <input name="notes" maxLength={500} defaultValue={order.notes} className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}

          {/* Split and merge */}
          {canOrder && live.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Split or merge</SectionTitle>
              <ActionForm action={splitOrder} submitLabel="Move to a new bill" submitClassName={secondaryButtonClass} className="space-y-3">
                <input type="hidden" name="order_id" value={id} />
                <p className="text-[11px] text-slate-500">
                  Tick what the other guest is paying for. It moves onto a bill of its own.
                </p>
                <div className="space-y-1">
                  {live.map((l) => (
                    <Check key={l.id} name="line_id" value={l.id} label={`${l.name} — ${fmtMoney(Number(l.net_amount) + Number(l.tax_amount))}`} />
                  ))}
                </div>
                <Field label="Name on the new bill" hint="Optional.">
                  <input name="guest_name" maxLength={120} className={inputClass} />
                </Field>
              </ActionForm>

              {otherOpen.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <ActionForm action={mergeOrder} submitLabel="Merge into that bill" submitClassName={secondaryButtonClass} className="space-y-3">
                    <input type="hidden" name="order_id" value={id} />
                    <Field label="Merge this bill into" hint="Everything moves across and this bill is voided.">
                      <select name="target_id" required defaultValue="" className={inputClass}>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {otherOpen.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.number}
                            {o.table_no ? ` — table ${o.table_no}` : ""} ({fmtMoney(o.grand_total)})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </ActionForm>
                </div>
              )}
            </Card>
          )}

          {/* Void */}
          {canManage && !isVoid && payments.filter((p) => !p.voided_at).length === 0 && (
            <Card className="p-5">
              <SectionTitle>Void this bill</SectionTitle>
              <ActionForm action={voidOrder} submitLabel="Void bill" submitClassName={secondaryButtonClass} className="space-y-2">
                <input type="hidden" name="order_id" value={id} />
                <input name="reason" required maxLength={300} placeholder="Reason" className={inputClass} />
                <p className="text-[11px] text-slate-500">
                  Kept with its number and reason for the auditor. A bill that has taken payment cannot be voided —
                  reverse the payment first.
                </p>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
