import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission, type Session } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import type { RefundRequest, Staff } from "../../../../lib/types";
import { REFUND_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "../../../../lib/types";
import { decideRefund } from "../../../billing-actions";
import {
  Card,
  EmptyState,
  SectionTitle,
  Tag,
  Notice,
  fmtDateTime,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

/**
 * Refunds waiting for a decision (SOW Module 7: "Refunds above a set amount
 * require manager or finance-head approval before processing").
 *
 * Approving one pays it out and posts it to the folio in the same step, so
 * the ledger can never disagree with what was actually refunded.
 */
export default async function RefundsPage() {
  const session: Session = await requireAnyPermission(["folio.view", "folio.refund_approve"]);
  const supabase = await createClient();
  const settings = await getSettings();

  const [{ data: rows }, { data: staffRows }] = await Promise.all([
    supabase
      .from("refund_requests")
      .select("*, bookings(reference, contact_name)")
      .order("requested_at", { ascending: false })
      .limit(100),
    supabase.from("staff").select("id, full_name"),
  ]);

  const requests = (rows ?? []) as RefundRequest[];
  const staff = (staffRows ?? []) as Pick<Staff, "id" | "full_name">[];
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const canApprove = can(session, "folio.refund_approve");

  const tone = (status: RefundRequest["status"]) =>
    status === "processed" ? "green" : status === "pending" ? "amber" : status === "rejected" || status === "failed" ? "red" : "blue";

  return (
    <div className="space-y-6">
      <Notice tone="info">
        Refunds of {fmtMoney(Number(settings.refund_approval_threshold))} or more need approval from someone other than
        the person who asked. Smaller ones are paid out as soon as they are requested.
      </Notice>

      <Card className="p-5">
        <SectionTitle>Awaiting approval</SectionTitle>
        {pending.length === 0 ? (
          <EmptyState message="No refunds are waiting for a decision." />
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="border border-amber-200 bg-amber-50/40 rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      {fmtMoney(r.amount)} · {PAYMENT_METHOD_LABELS[r.method]}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {r.bookings?.reference && (
                        <Link href={`/admin/bookings/${r.booking_id}`} className="font-mono text-yellow-700 hover:underline">
                          {r.bookings.reference}
                        </Link>
                      )}
                      {r.bookings?.contact_name && ` · ${r.bookings.contact_name}`}
                    </p>
                    <p className="text-xs text-slate-700 mt-1">{r.reason}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Asked by {nameOf(r.requested_by)} · {fmtDateTime(r.requested_at)}
                    </p>
                  </div>

                  {canApprove ? (
                    r.requested_by === session.staff.id ? (
                      <p className="text-xs text-slate-500 max-w-xs">
                        You asked for this refund, so someone else has to approve it.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 items-start">
                        <ActionForm action={decideRefund} submitLabel="Approve & pay" submitClassName={secondaryButtonClass}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="decision" value="approve" />
                        </ActionForm>
                        <details className="relative inline-block text-left">
                          <summary className="text-xs text-slate-500 hover:text-rose-700 cursor-pointer list-none px-2 py-1.5">
                            Refuse
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-md p-3">
                            <ActionForm action={decideRefund} submitLabel="Refuse refund" submitClassName={secondaryButtonClass} className="space-y-2">
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="decision" value="reject" />
                              <input name="note" required placeholder="Why it is refused" className={inputClass} />
                            </ActionForm>
                          </div>
                        </details>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-slate-500">Waiting for a manager or finance.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {requests.some((r) => r.status === "failed") && (
        <Notice tone="error">
          A refund could not be paid out. Open it below, check the reason, and raise a fresh request once the problem is
          fixed — the failed one is left on record.
        </Notice>
      )}

      <Card className="p-5">
        <SectionTitle>Decided</SectionTitle>
        {decided.length === 0 ? (
          <EmptyState message="Nothing decided yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 pr-3 font-semibold">Asked</th>
                  <th className="py-2 pr-3 font-semibold">Booking</th>
                  <th className="py-2 pr-3 font-semibold text-right">Amount</th>
                  <th className="py-2 pr-3 font-semibold">Reason</th>
                  <th className="py-2 pr-3 font-semibold">Asked by</th>
                  <th className="py-2 pr-3 font-semibold">Decided by</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(r.requested_at)}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/admin/bookings/${r.booking_id}`} className="font-mono text-yellow-700 hover:underline">
                        {r.bookings?.reference ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtMoney(r.amount)}</td>
                    <td className="py-2 pr-3">{r.reason}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{nameOf(r.requested_by)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{nameOf(r.decided_by)}</td>
                    <td className="py-2">
                      <Tag tone={tone(r.status)}>{REFUND_STATUS_LABELS[r.status]}</Tag>
                      {r.error && <span className="block text-[11px] text-rose-700 mt-0.5">{r.error}</span>}
                      {r.decision_note && <span className="block text-[11px] text-slate-500 mt-0.5">{r.decision_note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
