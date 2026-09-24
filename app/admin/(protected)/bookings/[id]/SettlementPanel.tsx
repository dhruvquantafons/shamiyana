import Link from "next/link";
import type { Currency, Folio, FolioEntry, LoyaltyTier } from "../../../../lib/types";
import { PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import { quoteSettlement } from "../../../../lib/currency";
import { maxRedeemablePoints, redemptionValue, tierByKey } from "../../../../lib/loyalty";
import { transferToCityLedger, takeForeignPayment } from "../../../city-ledger-actions";
import { redeemPoints } from "../../../loyalty-actions";
import {
  Card,
  Check,
  Field,
  Notice,
  SectionTitle,
  Tag,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * The three ways a bill gets settled other than cash at the desk, completing
 * Module 7 and the spending half of Module 8:
 *
 *   • Bill it to a company — the balance leaves the stay and joins that
 *     company's city ledger account, to be chased on payment terms.
 *   • Take it in another currency — credited in the property's own money at
 *     the rate used, which is recorded on the line.
 *   • Take it in loyalty points — worth what the guest's tier says, and never
 *     more than the bill.
 */
export default function SettlementPanel({
  bookingId,
  guestId,
  guestName,
  memberNo,
  folios,
  entries,
  companies,
  currencies,
  baseCurrency,
  multiCurrency,
  tiers,
  tierKey,
  pointsBalance,
  minRedeem,
  programName,
  loyaltyEnabled,
  canCityLedger,
  canPay,
  canRedeem,
}: {
  bookingId: string;
  guestId: string | null;
  guestName: string;
  memberNo: string | null;
  folios: Folio[];
  entries: FolioEntry[];
  companies: { id: string; name: string }[];
  currencies: Currency[];
  baseCurrency: string;
  multiCurrency: boolean;
  tiers: LoyaltyTier[];
  tierKey: string | null;
  pointsBalance: number;
  minRedeem: number;
  programName: string;
  loyaltyEnabled: boolean;
  canCityLedger: boolean;
  canPay: boolean;
  canRedeem: boolean;
}) {
  const live = entries.filter((e) => !e.voided_at);
  const labelOf = (f: Folio) => f.label || (f.kind === "master" ? "Master" : "Folio");

  const balanceOfFolio = (folioId: string) =>
    Number(
      live
        .filter((e) => e.folio_id === folioId)
        .reduce(
          (s, e) =>
            s + (["payment", "adjustment"].includes(e.kind) ? -Number(e.amount) : Number(e.amount) + Number(e.tax_amount)),
          0,
        )
        .toFixed(2),
    );

  // A folio already pushed onto a company's account shows a corporate-billing
  // credit; transferring it again would double-count the debt.
  const transferred = new Set(
    live.filter((e) => e.kind === "payment" && e.method === "corporate_billing").map((e) => e.folio_id),
  );
  const owing = folios
    .map((f) => ({ folio: f, balance: balanceOfFolio(f.id) }))
    .filter((f) => f.balance > 0 && !transferred.has(f.folio.id));

  const totalOwed = Number(folios.reduce((s, f) => s + Math.max(0, balanceOfFolio(f.id)), 0).toFixed(2));
  const tier = tierByKey(tiers, tierKey);
  const offered = currencies.filter((c) => c.is_active && c.code !== baseCurrency);
  const maxPoints = maxRedeemablePoints(pointsBalance, totalOwed, tier);

  const showLoyalty = loyaltyEnabled && canRedeem && guestId && tier;
  const showCurrency = multiCurrency && canPay && offered.length > 0;

  if (!canCityLedger && !showCurrency && !showLoyalty) return null;

  return (
    <div className="space-y-5">
      {/* ── Bill it to a company ── */}
      {canCityLedger && (
        <Card className="p-5">
          <SectionTitle>Bill a company (city ledger)</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-4">
            Moves what is still owed off this stay and onto the company&apos;s account, due on their payment terms. The
            stay then reads as settled, and the money is chased under{" "}
            <Link href="/admin/billing/city-ledger" className="text-yellow-700 hover:underline">
              Billing → City ledger
            </Link>
            .
          </p>

          {transferred.size > 0 && (
            <Notice tone="ok">
              {transferred.size === 1 ? "A bill on this stay has" : `${transferred.size} bills on this stay have`} already
              been billed to a company account.
            </Notice>
          )}

          {owing.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing left to bill — every folio on this stay is settled or already on a company account.
            </p>
          ) : (
            <ActionForm
              action={transferToCityLedger}
              submitLabel="Bill to the company"
              submitClassName={secondaryButtonClass}
              className="space-y-3"
            >
              <input type="hidden" name="booking_id" value={bookingId} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Which bill">
                  <select name="folio_id" required defaultValue={owing[0]?.folio.id} className={inputClass}>
                    {owing.map((o) => (
                      <option key={o.folio.id} value={o.folio.id}>
                        {labelOf(o.folio)} — {fmtMoney(o.balance)} owed
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Company">
                  <select name="company_id" required defaultValue={owing[0]?.folio.company_id ?? ""} className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Note" hint="Optional — appears on the company's statement.">
                <input name="note" maxLength={200} placeholder="PO 4471, conference delegates…" className={inputClass} />
              </Field>
              <p className="text-[11px] text-slate-500">
                Refused if it would take the company past its credit limit. Issue the tax invoice first if the company
                needs one — the invoice number is carried onto the statement.
              </p>
            </ActionForm>
          )}
        </Card>
      )}

      {/* ── Another currency ── */}
      {showCurrency && (
        <Card className="p-5">
          <SectionTitle>Take payment in another currency</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-4">
            The folio is credited in {baseCurrency} at the rate used, which is stored on the line so the receipt always
            reprints with the same numbers.
          </p>

          {totalOwed > 0 && (
            <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span className="text-slate-500">{fmtMoney(totalOwed)} owed is about:</span>
              {offered.map((c) => {
                const quote = quoteSettlement(totalOwed, c);
                return (
                  <span key={c.code}>
                    <span className="font-mono">{c.code}</span> {quote.foreign.toLocaleString("en-IN")}
                  </span>
                );
              })}
            </div>
          )}

          <ActionForm
            action={takeForeignPayment}
            submitLabel="Record payment"
            submitClassName={secondaryButtonClass}
            className="space-y-3"
          >
            <input type="hidden" name="booking_id" value={bookingId} />
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <Field label="Currency">
                <select name="currency" required defaultValue={offered[0]?.code} className={inputClass}>
                  {offered.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount taken">
                <input type="number" name="fx_amount" min={0.01} step="0.01" required className={inputClass} />
              </Field>
              <Field label="Rate" hint="Blank uses today's rate.">
                <input type="number" name="rate" min="0.000001" step="0.000001" className={inputClass} />
              </Field>
              <Field label="Taken by">
                <select name="method" defaultValue="cash" className={inputClass}>
                  {Object.entries(PAYMENT_METHOD_LABELS)
                    .filter(([v]) => !["loyalty_points", "corporate_billing"].includes(v))
                    .map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Folio">
                <select name="folio_id" defaultValue={folios[0]?.id} className={inputClass}>
                  {folios.map((f) => (
                    <option key={f.id} value={f.id}>
                      {labelOf(f)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reference" hint="Optional.">
                <input name="reference" maxLength={120} className={inputClass} />
              </Field>
            </div>
            <Check name="is_deposit" label="This is the deposit" />
            <p className="text-[11px] text-slate-500">
              Rates are maintained under{" "}
              <Link href="/admin/billing/currencies" className="text-yellow-700 hover:underline">
                Billing → Currencies
              </Link>
              . Fill the rate in only when a different one was agreed with the guest.
            </p>
          </ActionForm>
        </Card>
      )}

      {/* ── Loyalty points ── */}
      {showLoyalty && (
        <Card className="p-5">
          <SectionTitle>Redeem {programName} points</SectionTitle>
          <div className="flex flex-wrap items-center gap-2 -mt-1 mb-3 text-xs">
            <Tag tone="gold">{tier.name}</Tag>
            {memberNo && <span className="font-mono text-slate-500">{memberNo}</span>}
            <span className="text-slate-600">
              {pointsBalance.toLocaleString("en-IN")} points
              {pointsBalance > 0 && <> · worth {fmtMoney(redemptionValue(pointsBalance, tier))}</>}
            </span>
          </div>

          {pointsBalance < minRedeem ? (
            <p className="text-xs text-slate-500">
              {guestName} has {pointsBalance.toLocaleString("en-IN")} points; the smallest redemption is{" "}
              {minRedeem.toLocaleString("en-IN")}.
            </p>
          ) : totalOwed <= 0 ? (
            <p className="text-xs text-slate-500">Nothing left to settle on this stay.</p>
          ) : (
            <ActionForm
              action={redeemPoints}
              submitLabel="Redeem points"
              submitClassName={secondaryButtonClass}
              className="space-y-3"
            >
              <input type="hidden" name="booking_id" value={bookingId} />
              <input type="hidden" name="guest_id" value={guestId} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field
                  label="Points"
                  hint={`Up to ${maxPoints.toLocaleString("en-IN")} fit this bill — ${fmtMoney(redemptionValue(maxPoints, tier))}.`}
                >
                  <input
                    type="number"
                    name="points"
                    min={minRedeem}
                    max={maxPoints}
                    step={1}
                    required
                    defaultValue={maxPoints}
                    className={inputClass}
                  />
                </Field>
                <Field label="Folio">
                  <select name="folio_id" defaultValue={folios[0]?.id} className={inputClass}>
                    {folios.map((f) => (
                      <option key={f.id} value={f.id}>
                        {labelOf(f)} — {fmtMoney(balanceOfFolio(f.id))} owed
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Note" hint="Optional.">
                  <input name="note" maxLength={200} className={inputClass} />
                </Field>
              </div>
              <p className="text-[11px] text-slate-500">
                One point is worth {fmtMoney(Number(tier.redeem_rate))} at {tier.name}. Points come off the batch
                expiring soonest, and a redemption can never exceed what is owed.
              </p>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}
