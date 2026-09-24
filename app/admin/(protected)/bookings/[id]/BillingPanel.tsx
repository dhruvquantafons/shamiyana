import Link from "next/link";
import type { Folio, FolioEntry, Invoice, PaymentTransaction } from "../../../../lib/types";
import { PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import {
  createFolio,
  moveFolioEntry,
  issueInvoice,
  cancelInvoice,
  createPaymentRequest,
  cancelPaymentRequest,
  requestRefund,
} from "../../../billing-actions";
import {
  Card,
  Field,
  Check,
  SectionTitle,
  Tag,
  Notice,
  fmtDateTime,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * Module 7 on the booking screen: the stay's separate bills, the tax invoices
 * raised against them, online payment links, and asking for a refund.
 *
 * The running ledger itself stays in FolioPanel above this; everything here
 * either produces a tax document or moves money through the gateway.
 */
export default function BillingPanel({
  bookingId,
  folios,
  entries,
  invoices,
  payments,
  companies,
  balance,
  depositRequired,
  depositPaid,
  refundThreshold,
  gatewayReady,
  gatewayTestMode,
  canInvoice,
  canPay,
  canAdjust,
}: {
  bookingId: string;
  folios: Folio[];
  entries: FolioEntry[];
  invoices: Invoice[];
  payments: PaymentTransaction[];
  companies: { id: string; name: string }[];
  balance: number;
  depositRequired: number;
  depositPaid: number;
  refundThreshold: number;
  gatewayReady: boolean;
  gatewayTestMode: boolean;
  canInvoice: boolean;
  canPay: boolean;
  canAdjust: boolean;
}) {
  const live = entries.filter((e) => !e.voided_at);
  const invoicedFolios = new Set(invoices.filter((i) => i.status === "issued").map((i) => i.folio_id));
  const openLinks = payments.filter((p) => p.status === "created");
  const depositOutstanding = Math.max(0, depositRequired - depositPaid);
  const labelOf = (f: Folio) => f.label || (f.kind === "master" ? "Master" : "Folio");

  return (
    <div className="space-y-5">
      {/* ── Bills on this stay ── */}
      <Card className="p-5">
        <SectionTitle>Bills on this stay</SectionTitle>
        <p className="text-[11px] text-slate-500 -mt-2 mb-4">
          Split a stay when someone else pays part of it — room charges to the company, extras to the guest. Every
          charge starts on the master bill.
        </p>

        <div className="space-y-2 mb-4">
          {folios.map((f) => {
            const folioEntries = live.filter((e) => e.folio_id === f.id);
            const total = folioEntries.reduce(
              (s, e) =>
                s +
                (["payment", "adjustment"].includes(e.kind)
                  ? -Number(e.amount)
                  : Number(e.amount) + Number(e.tax_amount)),
              0,
            );
            const invoice = invoices.find((i) => i.folio_id === f.id && i.status === "issued");
            return (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2"
              >
                <span className="text-sm">
                  <Tag tone={f.kind === "master" ? "neutral" : "green"}>{f.kind === "master" ? "Master" : "Split"}</Tag>{" "}
                  {labelOf(f)}
                  {f.companies?.name && <span className="text-xs text-slate-500"> · {f.companies.name}</span>}
                  <span className="text-xs text-slate-500">
                    {" "}
                    · {folioEntries.length} {folioEntries.length === 1 ? "line" : "lines"}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <span className={total > 0 ? "text-rose-700" : "text-slate-600"}>{fmtMoney(total)}</span>
                  {invoice ? (
                    <Link
                      href={`/admin/bookings/${bookingId}/invoice/${invoice.id}`}
                      className="font-mono text-yellow-700 hover:underline"
                    >
                      {invoice.number}
                    </Link>
                  ) : (
                    canInvoice &&
                    folioEntries.length > 0 && (
                      <ActionForm action={issueInvoice} submitLabel="Issue invoice" submitClassName={secondaryButtonClass}>
                        <input type="hidden" name="folio_id" value={f.id} />
                      </ActionForm>
                    )
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {canAdjust && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
            <ActionForm action={createFolio} submitLabel="Open folio" submitClassName={secondaryButtonClass} className="space-y-3">
              <p className="text-xs font-medium text-yellow-700">New split folio</p>
              <input type="hidden" name="booking_id" value={bookingId} />
              <Field label="Name">
                <input name="label" required placeholder="Company, Extras, Mr Khan…" maxLength={60} className={inputClass} />
              </Field>
              <Field label="Bill to company" hint="Optional — used on the invoice.">
                <select name="company_id" defaultValue="" className={inputClass}>
                  <option value="">The guest</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>

            {folios.length > 1 && (
              <ActionForm action={moveFolioEntry} submitLabel="Move" submitClassName={secondaryButtonClass} className="space-y-3">
                <p className="text-xs font-medium text-yellow-700">Move a charge</p>
                <Field label="Charge">
                  <select name="entry_id" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {live
                      .filter((e) => !invoicedFolios.has(e.folio_id))
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.description} — {fmtMoney(Number(e.amount) + Number(e.tax_amount))}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="To folio">
                  <select name="folio_id" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {folios
                      .filter((f) => !invoicedFolios.has(f.id))
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {labelOf(f)}
                        </option>
                      ))}
                  </select>
                </Field>
              </ActionForm>
            )}
          </div>
        )}
      </Card>

      {/* ── Online payment ── */}
      {canPay && (
        <Card className="p-5">
          <SectionTitle>Online payment</SectionTitle>
          {!gatewayReady ? (
            <Notice tone="warn">
              Online payments are switched off. Add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code>,
              then turn them on under Settings. Payments taken at the desk are recorded on the folio as usual.
            </Notice>
          ) : (
            <>
              {gatewayTestMode && (
                <Notice tone="warn">
                  Razorpay is in <strong>test mode</strong>. No real money moves; switch to live keys before go-live.
                </Notice>
              )}

              {openLinks.length > 0 && (
                <div className="space-y-2 my-4">
                  {openLinks.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                    >
                      <span>
                        <Tag tone="neutral">Awaiting payment</Tag> {fmtMoney(p.amount)}
                        {p.purpose === "deposit" && " deposit"}
                        {p.expires_at && <span className="text-slate-500"> · expires {fmtDateTime(p.expires_at)}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        {p.short_url && (
                          <a
                            href={p.short_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-yellow-700 hover:underline break-all"
                          >
                            {p.short_url}
                          </a>
                        )}
                        <ActionForm action={cancelPaymentRequest} submitLabel="Cancel" submitClassName={secondaryButtonClass}>
                          <input type="hidden" name="id" value={p.id} />
                        </ActionForm>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <ActionForm action={createPaymentRequest} submitLabel="Create payment link" submitClassName={secondaryButtonClass} className="space-y-3 pt-4 border-t border-slate-100">
                <input type="hidden" name="booking_id" value={bookingId} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Amount (₹)">
                    <input
                      type="number"
                      name="amount"
                      min={1}
                      step="0.01"
                      required
                      defaultValue={depositOutstanding > 0 ? depositOutstanding : balance > 0 ? balance : undefined}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="For">
                    <select name="purpose" defaultValue={depositOutstanding > 0 ? "deposit" : "settlement"} className={inputClass}>
                      <option value="deposit">Deposit</option>
                      <option value="settlement">Settling the bill</option>
                    </select>
                  </Field>
                  <Field label="Folio">
                    <select name="folio_id" defaultValue="" className={inputClass}>
                      {folios.map((f) => (
                        <option key={f.id} value={f.id}>
                          {labelOf(f)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Check name="notify" defaultChecked label="Let Razorpay email and text the link to the guest" />
                <p className="text-[11px] text-slate-500">
                  The folio is credited only when Razorpay confirms the money arrived, so the balance here always
                  matches what was actually paid.
                </p>
              </ActionForm>
            </>
          )}
        </Card>
      )}

      {/* ── Refunds ── */}
      {canPay && (
        <Card className="p-5">
          <SectionTitle>Refund</SectionTitle>
          <ActionForm action={requestRefund} submitLabel="Request refund" submitClassName={secondaryButtonClass} className="space-y-3">
            <input type="hidden" name="booking_id" value={bookingId} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Amount (₹)">
                <input type="number" name="amount" min={0.01} step="0.01" required className={inputClass} />
              </Field>
              <Field label="Back by">
                <select name="method" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Folio">
                <select name="folio_id" defaultValue="" className={inputClass}>
                  {folios.map((f) => (
                    <option key={f.id} value={f.id}>
                      {labelOf(f)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Reason">
              <input name="reason" required maxLength={300} placeholder="Cancelled within free period, overcharge…" className={inputClass} />
            </Field>
            {payments.some((p) => p.status === "paid") && (
              <Field label="Against which online payment" hint="Needed to send money back through Razorpay.">
                <select name="payment_tx_id" defaultValue="" className={inputClass}>
                  <option value="">Not an online payment</option>
                  {payments
                    .filter((p) => p.status === "paid")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {fmtMoney(p.amount)} · {p.paid_at ? fmtDateTime(p.paid_at) : ""}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <p className="text-[11px] text-slate-500">
              Refunds of {fmtMoney(refundThreshold)} or more need a second person to approve them, and never the person
              who asked. Smaller refunds are paid out straight away.
            </p>
          </ActionForm>
        </Card>
      )}

      {/* ── Invoices raised ── */}
      {invoices.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Invoices</SectionTitle>
          <div className="space-y-2">
            {invoices.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 text-xs"
              >
                <span>
                  <Tag tone={i.status === "issued" ? "green" : "red"}>{i.status === "issued" ? "Issued" : "Cancelled"}</Tag>{" "}
                  <Link href={`/admin/bookings/${bookingId}/invoice/${i.id}`} className="font-mono text-yellow-700 hover:underline">
                    {i.number}
                  </Link>
                  <span className="text-slate-500"> · {fmtDateTime(i.issued_at)} · {i.bill_to_name}</span>
                  {i.status === "cancelled" && <span className="text-slate-500"> · {i.cancel_reason}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{fmtMoney(i.grand_total)}</span>
                  {canInvoice && i.status === "issued" && (
                    <details className="relative inline-block text-left">
                      <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                        Cancel
                      </summary>
                      <div className="absolute right-0 z-10 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                        <ActionForm action={cancelInvoice} submitLabel="Cancel invoice" submitClassName={secondaryButtonClass} className="space-y-2">
                          <input type="hidden" name="id" value={i.id} />
                          <input name="reason" required placeholder="Reason" className={inputClass} />
                          <p className="text-[10px] text-slate-500">
                            The number stays used and is never given to another invoice.
                          </p>
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
