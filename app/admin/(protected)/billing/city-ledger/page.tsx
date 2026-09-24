import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import {
  AGING_BUCKETS,
  AGING_LABELS,
  accountBalance,
  agingOf,
  agingTotals,
  overdueFirst,
  type Aging,
} from "../../../../lib/city-ledger";
import type { CityLedgerEntry, Company } from "../../../../lib/types";
import { Card, EmptyState, Notice, StatCard, Tag, fmtMoney, tableHeadClass } from "../../../components/ui";

/**
 * City ledger overview (SOW Module 7): what every corporate client owes, aged
 * by how long it has been outstanding.
 *
 * Payments are made against the account rather than a named invoice, because
 * that is how a hotel is actually paid — one transfer covering several stays.
 * So receipts are applied to the oldest charge first and whatever is left
 * unpaid is aged from its own due date. The chase list is ordered by how much
 * is *overdue*, not by how much is owed: a big account paying to terms needs
 * no phone call, a small one ninety days late does.
 */
export default async function CityLedgerPage() {
  await requireAnyPermission(["folio.view", "folio.city_ledger", "companies.manage"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const [{ data: companyRows }, { data: entryRows }] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    supabase.from("city_ledger_entries").select("*").order("created_at", { ascending: false }),
  ]);

  const companies = (companyRows ?? []) as Company[];
  const entries = (entryRows ?? []) as CityLedgerEntry[];

  const byCompany = new Map<string, CityLedgerEntry[]>();
  for (const e of entries) {
    const list = byCompany.get(e.company_id);
    if (list) list.push(e);
    else byCompany.set(e.company_id, [e]);
  }

  type Row = { company: Company; aging: Aging; balance: number; entries: CityLedgerEntry[] };
  const rows: Row[] = companies
    .map((company) => {
      const own = byCompany.get(company.id) ?? [];
      return { company, entries: own, balance: accountBalance(own), aging: agingOf(own, today) };
    })
    // An account nobody has ever used is noise on a receivables report.
    .filter((r) => r.entries.length > 0);

  const active = rows.filter((r) => r.aging.total > 0 || r.balance !== 0);
  const totals = agingTotals(rows.map((r) => r.aging));
  const overdue = Number((totals.total - totals.current).toFixed(2));
  const chase = overdueFirst(active).filter((r) => r.aging.total - r.aging.current > 0);
  const overLimit = active.filter(
    (r) => r.company.credit_limit !== null && r.balance > Number(r.company.credit_limit),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Owed to the hotel" value={fmtMoney(totals.total)} hint={`${active.length} open accounts`} />
        <StatCard label="Overdue" value={fmtMoney(overdue)} hint="Past its due date" />
        <StatCard label="Over 90 days" value={fmtMoney(totals["90+"])} hint="Needs a decision" />
        <StatCard label="Not yet due" value={fmtMoney(totals.current)} hint="Within payment terms" />
      </div>

      {overLimit.length > 0 && (
        <Notice tone="warn">
          <strong>Over the credit limit:</strong>{" "}
          {overLimit.map((r) => `${r.company.name} (${fmtMoney(r.balance)} of ${fmtMoney(Number(r.company.credit_limit))})`).join(", ")}
          . No further stay can be billed to these accounts until a payment is received or the limit is raised under{" "}
          <Link href="/admin/companies" className="underline">
            Companies
          </Link>
          .
        </Notice>
      )}

      {chase.length > 0 && (
        <Card className="p-5">
          <p className="text-xs font-medium text-yellow-700 mb-3">Chase list — most overdue first</p>
          <ul className="space-y-1.5 text-xs">
            {chase.slice(0, 8).map((r) => (
              <li key={r.company.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/billing/city-ledger/${r.company.id}`} className="text-yellow-700 hover:underline">
                  {r.company.name}
                </Link>
                <span className="text-slate-600">
                  {fmtMoney(r.aging.total - r.aging.current)} overdue
                  {r.aging["90+"] > 0 && <span className="text-rose-700"> · {fmtMoney(r.aging["90+"])} over 90 days</span>}
                  {r.company.phone && <span className="text-slate-500"> · {r.company.phone}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        {active.length === 0 ? (
          <EmptyState
            message={
              "Nothing is owed on any company account. A stay reaches the city ledger from a booking's Folio tab — " +
              "bill the folio to a company and its balance moves here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Company</th>
                  <th className="py-2 pr-3 font-semibold">Terms</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b} className="py-2 pr-3 font-semibold text-right">
                      {AGING_LABELS[b]}
                    </th>
                  ))}
                  <th className="py-2 pr-4 font-semibold text-right">Owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {active.map((r) => (
                  <tr key={r.company.id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <Link
                        href={`/admin/billing/city-ledger/${r.company.id}`}
                        className="text-slate-900 hover:text-yellow-700"
                      >
                        {r.company.name}
                      </Link>
                      {!r.company.is_active && (
                        <>
                          {" "}
                          <Tag tone="red">Closed</Tag>
                        </>
                      )}
                      {r.company.credit_limit !== null && r.balance > Number(r.company.credit_limit) && (
                        <>
                          {" "}
                          <Tag tone="amber">Over limit</Tag>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{r.company.payment_terms_days} days</td>
                    {AGING_BUCKETS.map((b) => (
                      <td
                        key={b}
                        className={`py-2 pr-3 text-right ${
                          r.aging[b] > 0 && (b === "90+" || b === "61-90") ? "text-rose-700" : ""
                        }`}
                      >
                        {r.aging[b] > 0 ? fmtMoney(r.aging[b]) : "—"}
                      </td>
                    ))}
                    <td className="py-2 pr-4 text-right font-medium text-slate-900">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-medium text-slate-900">
                  <td className="py-2 px-4" colSpan={2}>
                    Total
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b} className="py-2 pr-3 text-right">
                      {fmtMoney(totals[b])}
                    </td>
                  ))}
                  <td className="py-2 pr-4 text-right">{fmtMoney(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-slate-500">
        Receipts are applied to the oldest charge first, so paying an account moves the money out of the oldest bucket.
        A negative balance means the company has paid more than it owes.
      </p>
    </div>
  );
}
