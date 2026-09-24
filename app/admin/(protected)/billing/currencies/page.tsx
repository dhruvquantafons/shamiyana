import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { fromBase } from "../../../../lib/currency";
import type { Currency } from "../../../../lib/types";
import { saveCurrency, updateExchangeRates } from "../../../city-ledger-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDateTime,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * Exchange rates (SOW Module 7: "Currency conversion support for
 * international guests").
 *
 * Every amount the system stores stays in the property's own currency, so
 * that reports, invoices and the city ledger can never disagree with each
 * other. What lives here is the rate used to *quote* a price to a guest and
 * to convert what they hand over at the desk. The rate that applied at the
 * moment of payment is copied onto the folio line, so a receipt reprints
 * with the same numbers years later even after the rate has moved.
 */
export default async function CurrenciesPage() {
  const session = await requireAnyPermission(["folio.view", "folio.invoice", "settings.manage"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const manage = can(session, "settings.manage");

  const { data } = await supabase.from("currencies").select("*").order("code");
  const currencies = (data ?? []) as Currency[];
  const base = currencies.find((c) => c.code === settings.currency);
  const others = currencies.filter((c) => c.code !== settings.currency);
  const sample = 10000;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Base currency" value={settings.currency} hint="Everything is stored in this" />
        <StatCard label="Currencies set up" value={currencies.length} hint={`${others.filter((c) => c.is_active).length} offered to guests`} />
        <StatCard
          label="Multi-currency"
          value={settings.multi_currency_enabled ? "On" : "Off"}
          hint={settings.multi_currency_enabled ? "The desk can settle in these" : "Turn on under Settings"}
        />
        <StatCard
          label="Rates last touched"
          value={currencies.length ? fmtDateTime(currencies.map((c) => c.updated_at).sort().at(-1)!).split(",")[0] : "—"}
        />
      </div>

      {!settings.multi_currency_enabled && (
        <Notice tone="info">
          Multi-currency is switched off, so the desk cannot yet take a payment in these currencies. Rates can still be
          maintained here. Turn it on under <strong>Settings → Billing</strong>.
        </Notice>
      )}

      {!base && (
        <Notice tone="warn">
          The property&apos;s own currency, <strong>{settings.currency}</strong>, is not in the table below. Add it at a
          rate of 1 so foreign amounts have something to convert against.
        </Notice>
      )}

      {/* ── The morning rate update ── */}
      <Card className="p-5">
        <SectionTitle>Today&apos;s rates</SectionTitle>
        <p className="text-[11px] text-slate-500 -mt-2 mb-4">
          How much one unit of each currency is worth in {settings.currency}. Change as many as you like and save once.
        </p>

        {others.length === 0 ? (
          <EmptyState message="No foreign currencies have been set up yet. Add one below." />
        ) : (
          <ActionForm
            action={updateExchangeRates}
            submitLabel="Save rates"
            submitClassName={secondaryButtonClass}
            className="space-y-3"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={tableHeadClass}>
                    <th className="py-2 px-3 font-semibold">Currency</th>
                    <th className="py-2 pr-3 font-semibold">1 unit in {settings.currency}</th>
                    <th className="py-2 pr-3 font-semibold text-right">
                      {new Intl.NumberFormat("en-IN").format(sample)} {settings.currency} buys
                    </th>
                    <th className="py-2 pr-3 font-semibold">Updated</th>
                    <th className="py-2 pr-3 font-semibold">Offered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {others.map((c) => (
                    <tr key={c.code}>
                      <td className="py-2 px-3">
                        <span className="font-mono text-slate-900">{c.code}</span>{" "}
                        <span className="text-slate-500">{c.name}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {manage ? (
                          <input
                            type="number"
                            name={`rate_${c.code}`}
                            step="0.000001"
                            min="0.000001"
                            defaultValue={Number(c.rate_to_base)}
                            className={`${inputClass} max-w-[10rem]`}
                            aria-label={`Rate for ${c.code}`}
                          />
                        ) : (
                          Number(c.rate_to_base)
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-500">
                        {c.symbol || c.code} {fromBase(sample, c).toLocaleString("en-IN")}
                      </td>
                      <td className="py-2 pr-3 text-slate-500">{fmtDateTime(c.updated_at)}</td>
                      <td className="py-2 pr-3">
                        {c.is_active ? <Tag tone="green">Yes</Tag> : <Tag tone="neutral">No</Tag>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!manage && <p className="text-[11px] text-slate-500">Only an administrator can change rates.</p>}
          </ActionForm>
        )}
      </Card>

      {/* ── Add or edit one ── */}
      {manage && (
        <Card className="p-5">
          <SectionTitle>Add or edit a currency</SectionTitle>
          <ActionForm
            action={saveCurrency}
            submitLabel="Save currency"
            submitClassName={secondaryButtonClass}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Code" hint="Three letters, e.g. USD.">
                <input name="code" required maxLength={3} placeholder="USD" className={`${inputClass} uppercase`} />
              </Field>
              <Field label="Name">
                <input name="name" required maxLength={60} placeholder="US Dollar" className={inputClass} />
              </Field>
              <Field label="Symbol" hint="Optional.">
                <input name="symbol" maxLength={6} placeholder="$" className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={`1 unit in ${settings.currency}`}>
                <input type="number" name="rate_to_base" step="0.000001" min="0.000001" required className={inputClass} />
              </Field>
              <Field label="Decimal places" hint="0 for currencies without minor units, such as JPY.">
                <input type="number" name="decimals" min={0} max={4} defaultValue={2} className={inputClass} />
              </Field>
              <div className="flex items-end">
                <Check name="is_active" defaultChecked label="Offer this currency to guests" />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Saving an existing code updates it. The property&apos;s own currency is always held at a rate of 1.
            </p>
          </ActionForm>
        </Card>
      )}

      <p className="text-[11px] text-slate-500">
        A payment taken in another currency is credited to the folio in {settings.currency}, with the amount handed over
        and the rate used recorded on the same line.
      </p>
    </div>
  );
}
