import type { FolioEntry, FolioKind } from "../../../../lib/types";
import { PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import type { FolioTotals } from "../../../../lib/policies";
import { recordPayment, postCharge, voidFolioEntry } from "../../../booking-actions";
import {
  Card,
  Field,
  Check,
  SectionTitle,
  Tag,
  fmtDate,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

const CREDIT: FolioKind[] = ["payment", "adjustment"];

const KIND_LABEL: Record<FolioKind, string> = {
  room: "Room",
  fee: "Fee",
  penalty: "Penalty",
  extra: "Extra",
  payment: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * The guest's running bill: room charges and tax from night audit, fees,
 * extras, penalties, and payments. Entries are never edited — mistakes are
 * voided with a reason, which keeps the ledger auditable.
 */
export default function FolioPanel({
  bookingId,
  entries,
  totals,
  depositRequired,
  canPay,
  canPost,
  canAdjust,
  today,
}: {
  bookingId: string;
  entries: FolioEntry[];
  totals: FolioTotals;
  depositRequired: number;
  canPay: boolean;
  canPost: boolean;
  canAdjust: boolean;
  today: string;
}) {
  return (
    <Card className="p-5">
      <SectionTitle
        action={
          <span className={`text-sm font-medium ${totals.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {totals.balance > 0 ? `Balance due ${fmtMoney(totals.balance)}` : totals.balance < 0 ? `In credit ${fmtMoney(-totals.balance)}` : "Settled"}
          </span>
        }
      >
        Folio
      </SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs">
        <p>
          <span className="text-slate-500 block">Charges</span>
          {fmtMoney(totals.charges)}
        </p>
        <p>
          <span className="text-slate-500 block">Tax</span>
          {fmtMoney(totals.tax)}
        </p>
        <p>
          <span className="text-slate-500 block">Paid</span>
          {fmtMoney(totals.payments)}
        </p>
        <p>
          <span className="text-slate-500 block">Deposit</span>
          {fmtMoney(totals.deposits)} of {fmtMoney(depositRequired)}
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 mb-4">
          Nothing posted yet. Night audit posts room charges each night of the stay.
        </p>
      ) : (
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-xs">
            <thead>
              <tr className={tableHeadClass}>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Item</th>
                <th className="py-2 pr-3 font-semibold text-right">Amount</th>
                <th className="py-2 pr-3 font-semibold text-right">Tax</th>
                {canAdjust && <th className="py-2 font-semibold" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => {
                const credit = CREDIT.includes(e.kind);
                return (
                  <tr key={e.id} className={e.voided_at ? "text-slate-400 line-through" : "text-slate-700"}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(e.stay_date ?? e.created_at.slice(0, 10))}</td>
                    <td className="py-2 pr-3">
                      <Tag tone={credit ? "green" : e.kind === "penalty" ? "red" : "neutral"}>{KIND_LABEL[e.kind]}</Tag>{" "}
                      {e.description}
                      {e.method && ` · ${PAYMENT_METHOD_LABELS[e.method]}`}
                      {e.reference && ` · ${e.reference}`}
                      {e.voided_at && <span className="no-underline"> (void: {e.void_reason})</span>}
                      {e.fx_currency && e.fx_amount !== null && (
                        <span className="block text-[10px] text-slate-500 no-underline">
                          Paid {e.fx_currency} {Number(e.fx_amount).toLocaleString("en-IN")} at{" "}
                          {Number(e.fx_rate)} per unit
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {credit ? "−" : ""}
                      {fmtMoney(e.amount)}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {Number(e.tax_amount) ? `${fmtMoney(e.tax_amount)} (${Number(e.tax_rate)}%)` : ""}
                    </td>
                    {canAdjust && (
                      <td className="py-2 text-right">
                        {!e.voided_at && (
                          <details className="relative inline-block text-left">
                            <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                              Void
                            </summary>
                            <div className="absolute right-0 z-10 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                              <ActionForm action={voidFolioEntry} submitLabel="Void entry" submitClassName={secondaryButtonClass} className="space-y-2">
                                <input type="hidden" name="id" value={e.id} />
                                <input name="reason" required placeholder="Reason" className={inputClass} />
                              </ActionForm>
                            </div>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
        {canPay && (
          <ActionForm action={recordPayment} submitLabel="Record" submitClassName={secondaryButtonClass} className="space-y-3">
            <p className="text-xs font-medium text-yellow-700">Payment or refund</p>
            <input type="hidden" name="booking_id" value={bookingId} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₹)">
                <input type="number" name="amount" min={0.01} step="0.01" required defaultValue={totals.balance > 0 ? totals.balance : undefined} className={inputClass} />
              </Field>
              <Field label="Type">
                <select name="kind" defaultValue="payment" className={inputClass}>
                  <option value="payment">Payment</option>
                  <option value="refund">Refund</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
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
              <Field label="Reference">
                <input name="reference" className={inputClass} />
              </Field>
            </div>
            <Check
              name="send_receipt"
              label="Email a receipt"
              hint="For a payment taken remotely. Refunds never send one."
            />
            <Check name="is_deposit" label="This is a deposit" />
          </ActionForm>
        )}

        {canPost && (
          <ActionForm action={postCharge} submitLabel="Post charge" submitClassName={secondaryButtonClass} className="space-y-3">
            <p className="text-xs font-medium text-yellow-700">Charge</p>
            <input type="hidden" name="booking_id" value={bookingId} />
            <Field label="Description">
              <input name="description" required placeholder="Laundry, airport transfer, minibar…" className={inputClass} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount (₹)">
                <input type="number" name="amount" min={0.01} step="0.01" required className={inputClass} />
              </Field>
              <Field label="Tax %">
                <input type="number" name="tax_rate" min={0} max={100} step="0.01" defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Kind">
                <select name="kind" defaultValue="extra" className={inputClass}>
                  <option value="extra">Extra</option>
                  <option value="fee">Fee</option>
                </select>
              </Field>
            </div>
            <input type="hidden" name="stay_date" value={today} />
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
