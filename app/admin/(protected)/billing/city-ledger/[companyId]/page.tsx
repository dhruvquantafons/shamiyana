import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import { getSettings } from "../../../../../lib/settings";
import { todayIn } from "../../../../../lib/dates";
import {
  AGING_BUCKETS,
  AGING_LABELS,
  accountBalance,
  agingOf,
  openCharges,
  totalCharged,
  totalCredited,
} from "../../../../../lib/city-ledger";
import type { CityLedgerEntry, Company } from "../../../../../lib/types";
import { CITY_LEDGER_KIND_LABELS, PAYMENT_METHOD_LABELS } from "../../../../../lib/types";
import { recordCityLedgerPayment, creditCityLedger, voidCityLedgerEntry } from "../../../../city-ledger-actions";
import {
  Card,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../../components/ui";
import ActionForm from "../../../../components/ActionForm";
import PrintButton from "../../../../components/PrintButton";

/**
 * One company's statement of account (SOW Module 7). Everything that has ever
 * moved on the account, what is still open and how overdue it is, and the
 * forms finance needs: record a receipt, raise a credit note, write a debt
 * off, or undo a transfer that should not have been made.
 */
export default async function CompanyStatementPage({ params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireAnyPermission(["folio.view", "folio.city_ledger", "companies.manage"]);
  const { companyId } = await params;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const manage = can(session, "folio.city_ledger");

  const [{ data: companyRow }, { data: entryRows }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
    supabase
      .from("city_ledger_entries")
      .select("*, bookings(reference), invoices(number)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
  ]);

  if (!companyRow) notFound();
  const company = companyRow as Company;
  const entries = (entryRows ?? []) as CityLedgerEntry[];

  const balance = accountBalance(entries);
  const aging = agingOf(entries, today);
  const open = openCharges(entries, today);
  const overdue = Number((aging.total - aging.current).toFixed(2));
  const overLimit = company.credit_limit !== null && balance > Number(company.credit_limit);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/admin/billing/city-ledger"
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> All accounts
        </Link>
        <PrintButton />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold tracking-tight text-slate-900">{company.name}</p>
            <p className="text-xs text-slate-600 mt-0.5">
              {[company.contact_name, company.email, company.phone].filter(Boolean).join(" · ") || "No contact on file"}
            </p>
            {company.gstin && <p className="text-xs text-slate-500 mt-0.5">GSTIN {company.gstin}</p>}
            <p className="text-xs text-slate-500 mt-0.5">
              Payment terms {company.payment_terms_days} days
              {company.credit_limit !== null && ` · credit limit ${fmtMoney(Number(company.credit_limit))}`}
              {company.credit_limit === null && " · no credit limit"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Statement as at</p>
            <p className="text-sm text-slate-900">{fmtDate(today)}</p>
            {!company.is_active && <Tag tone="red">Account closed</Tag>}
          </div>
        </div>
      </Card>

      {overLimit && (
        <Notice tone="warn">
          This account is over its credit limit, so no further stay can be billed to it. Record a receipt below, or
          raise the limit under{" "}
          <Link href="/admin/companies" className="underline">
            Companies
          </Link>
          .
        </Notice>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Owed now" value={fmtMoney(balance)} hint={`${open.length} open ${open.length === 1 ? "charge" : "charges"}`} />
        <StatCard label="Overdue" value={fmtMoney(overdue)} hint="Past its due date" />
        <StatCard label="Charged ever" value={fmtMoney(totalCharged(entries))} />
        <StatCard label="Credited ever" value={fmtMoney(totalCredited(entries))} hint="Receipts, credit notes, write-offs" />
      </div>

      {/* ── Aging ── */}
      <Card className="p-5">
        <SectionTitle>How overdue it is</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-1">
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="border border-slate-200 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{AGING_LABELS[b]}</p>
              <p className={`text-sm font-medium ${aging[b] > 0 && (b === "90+" || b === "61-90") ? "text-rose-700" : "text-slate-900"}`}>
                {fmtMoney(aging[b])}
              </p>
            </div>
          ))}
        </div>
        {open.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-xs">
            <p className="text-[11px] text-slate-500">
              Receipts are applied to the oldest charge first, so these are what is still unpaid.
            </p>
            {open.map((o) => (
              <div key={o.entry.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {o.entry.description || "Charge"}
                  {o.entry.bookings?.reference && <span className="text-slate-500"> · {o.entry.bookings.reference}</span>}
                  {o.entry.invoices?.number && (
                    <span className="font-mono text-slate-500"> · {o.entry.invoices.number}</span>
                  )}
                </span>
                <span className="text-slate-600">
                  {fmtMoney(o.outstanding)}
                  {o.entry.due_date && (
                    <span className={o.daysOverdue > 0 ? "text-rose-700" : "text-slate-500"}>
                      {" "}
                      · due {fmtDate(o.entry.due_date)}
                      {o.daysOverdue > 0 ? ` · ${o.daysOverdue} days late` : ""}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Receipts and credits ── */}
      {manage && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 print:hidden">
          <Card className="p-5">
            <SectionTitle>Record a receipt</SectionTitle>
            <ActionForm
              action={recordCityLedgerPayment}
              submitLabel="Record payment"
              submitClassName={secondaryButtonClass}
              className="space-y-3"
            >
              <input type="hidden" name="company_id" value={company.id} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${settings.currency})`}>
                  <input
                    type="number"
                    name="amount"
                    min={0.01}
                    step="0.01"
                    required
                    defaultValue={balance > 0 ? balance : undefined}
                    className={inputClass}
                  />
                </Field>
                <Field label="Received by">
                  <select name="method" defaultValue="bank_transfer" className={inputClass}>
                    {Object.entries(PAYMENT_METHOD_LABELS)
                      .filter(([v]) => v !== "loyalty_points")
                      .map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Reference" hint="Cheque or transfer number, so it can be traced.">
                <input name="reference" maxLength={120} className={inputClass} />
              </Field>
              <Field label="Note" hint="Optional.">
                <input name="description" maxLength={300} placeholder="Payment received on account" className={inputClass} />
              </Field>
              <p className="text-[11px] text-slate-500">
                Applied to the oldest unpaid charge first. A receipt larger than the balance leaves the account in
                credit.
              </p>
            </ActionForm>
          </Card>

          <Card className="p-5">
            <SectionTitle>Credit note or write-off</SectionTitle>
            <ActionForm
              action={creditCityLedger}
              submitLabel="Record credit"
              submitClassName={secondaryButtonClass}
              className="space-y-3"
            >
              <input type="hidden" name="company_id" value={company.id} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${settings.currency})`}>
                  <input type="number" name="amount" min={0.01} step="0.01" required className={inputClass} />
                </Field>
                <Field label="Kind">
                  <select name="kind" defaultValue="adjustment" className={inputClass}>
                    <option value="adjustment">Credit note — agreed reduction</option>
                    <option value="writeoff">Write off — given up as uncollectable</option>
                  </select>
                </Field>
              </div>
              <Field label="Reason" hint="Kept on the statement and in the audit log.">
                <input
                  name="description"
                  required
                  maxLength={300}
                  placeholder="Agreed goodwill on the late check-in dispute…"
                  className={inputClass}
                />
              </Field>
              <Field label="Reference" hint="Optional.">
                <input name="reference" maxLength={120} className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      )}

      {/* ── Every movement ── */}
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Statement</SectionTitle>
        </div>
        {entries.length === 0 ? (
          <EmptyState message="Nothing has been posted to this account yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">What</th>
                  <th className="py-2 pr-3 font-semibold">Detail</th>
                  <th className="py-2 pr-3 font-semibold">Due</th>
                  <th className="py-2 pr-3 font-semibold text-right">Charge</th>
                  <th className="py-2 pr-3 font-semibold text-right">Credit</th>
                  {manage && <th className="py-2 pr-4 font-semibold print:hidden" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {entries.map((e) => {
                  const voided = Boolean(e.voided_at);
                  return (
                    <tr key={e.id} className={voided ? "text-slate-400 line-through" : ""}>
                      <td className="py-2 px-4 whitespace-nowrap">{fmtDate(e.created_at.slice(0, 10))}</td>
                      <td className="py-2 pr-3">
                        <Tag
                          tone={
                            e.kind === "charge" ? "neutral" : e.kind === "payment" ? "green" : e.kind === "writeoff" ? "red" : "blue"
                          }
                        >
                          {CITY_LEDGER_KIND_LABELS[e.kind]}
                        </Tag>
                      </td>
                      <td className="py-2 pr-3">
                        {e.description}
                        {e.bookings?.reference && <span className="text-slate-500"> · {e.bookings.reference}</span>}
                        {e.invoices?.number && <span className="font-mono text-slate-500"> · {e.invoices.number}</span>}
                        {e.method && <span className="text-slate-500"> · {PAYMENT_METHOD_LABELS[e.method]}</span>}
                        {e.reference && <span className="text-slate-500"> · {e.reference}</span>}
                        {voided && <span className="block text-[10px] text-rose-700 no-underline">Voided — {e.void_reason}</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                        {e.due_date ? fmtDate(e.due_date) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">{e.kind === "charge" ? fmtMoney(e.amount) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{e.kind !== "charge" ? fmtMoney(e.amount) : "—"}</td>
                      {manage && (
                        <td className="py-2 pr-4 text-right print:hidden">
                          {!voided && (
                            <details className="relative inline-block text-left">
                              <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer list-none">
                                Void
                              </summary>
                              <div className="absolute right-0 z-10 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                                <ActionForm
                                  action={voidCityLedgerEntry}
                                  submitLabel="Void entry"
                                  submitClassName={secondaryButtonClass}
                                  className="space-y-2"
                                >
                                  <input type="hidden" name="entry_id" value={e.id} />
                                  <input name="reason" required placeholder="Reason" className={inputClass} />
                                  <p className="text-[10px] text-slate-500 no-underline">
                                    {e.kind === "charge"
                                      ? "The balance goes back onto the guest's folio."
                                      : "The credit is reversed; the entry stays on the statement."}
                                  </p>
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
      </Card>

      <p className="text-[11px] text-slate-500">
        Statement printed {fmtDateTime(new Date().toISOString())} · {settings.name}
      </p>
    </div>
  );
}
