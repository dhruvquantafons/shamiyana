import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type { PricingAdjustment, RoomType } from "../../../../lib/types";
import { decideAdjustments, clearAdjustments } from "../../../revenue-actions";
import {
  Card,
  EmptyState,
  Notice,
  Tag,
  checkboxClass,
  dangerButtonClass,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

function changeTag(pct: number) {
  const up = pct >= 0;
  return (
    <Tag tone={up ? "green" : "red"}>
      {up ? "+" : ""}
      {pct}%
    </Tag>
  );
}

function Rows({
  rows,
  typeName,
  selectable,
}: {
  rows: PricingAdjustment[];
  typeName: (id: string) => string;
  selectable: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={tableHeadClass}>
          {selectable && <th className="w-10 px-5 py-2" />}
          <th className="text-left px-3 py-2">Night</th>
          <th className="text-left px-3 py-2">Room type</th>
          <th className="text-right px-3 py-2">Was</th>
          <th className="text-right px-3 py-2">Becomes</th>
          <th className="text-right px-3 py-2">Change</th>
          <th className="text-right px-3 py-2">Occupancy</th>
          <th className="text-left px-5 py-2">Rule</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} className="border-t border-slate-100">
            {selectable && (
              <td className="px-5 py-2">
                <input type="checkbox" name="ids" value={a.id} className={checkboxClass} defaultChecked />
              </td>
            )}
            <td className="px-3 py-2 whitespace-nowrap">{a.stay_date}</td>
            <td className="px-3 py-2">{typeName(a.room_type_id)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtMoney(a.base_rate)}</td>
            <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtMoney(a.proposed_rate)}</td>
            <td className="px-3 py-2 text-right">{changeTag(Number(a.change_percent))}</td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-500">
              {a.occupancy_percent === null ? "—" : `${a.occupancy_percent}%`}
              {a.capacity ? (
                <span className="text-xs text-slate-400"> ({a.rooms_sold}/{a.capacity})</span>
              ) : null}
            </td>
            <td className="px-5 py-2 text-xs">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-600">{a.rule_name}</span>
                {a.occasion && <Tag tone="violet">{a.occasion}</Tag>}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ApprovalsPage() {
  const session = await requireAnyPermission(["revenue.view", "revenue.manage", "revenue.approve"]);
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const approve = can(session, "revenue.approve");
  const manage = can(session, "revenue.manage");

  const [{ data: adjustments }, { data: types }] = await Promise.all([
    supabase
      .from("pricing_adjustments")
      .select("*")
      .in("status", ["pending", "applied"])
      .gte("stay_date", today)
      .order("stay_date"),
    supabase.from("room_types").select("id, name"),
  ]);

  const list = (adjustments ?? []) as PricingAdjustment[];
  const typeList = (types ?? []) as Pick<RoomType, "id" | "name">[];
  const typeName = (id: string) => typeList.find((t) => t.id === id)?.name ?? "—";

  const pending = list.filter((a) => a.status === "pending");
  const live = list.filter((a) => a.status === "applied");

  return (
    <div className="space-y-6">
      <Notice>
        A rate change of more than {settings.revenue_auto_approve_percent}% either way waits here before it sells.
        Anything smaller went live on its own. Each row was judged against the threshold in force when the rules ran, so
        changing the threshold now does not quietly approve what is already waiting.
      </Notice>

      <Card className="p-0 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold">Waiting for approval</h2>
          {pending.length > 0 && <Tag tone="amber">{pending.length}</Tag>}
        </div>

        {pending.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState message="Nothing is waiting. Run the rules from the Forecast tab to price more nights." />
          </div>
        ) : approve ? (
          <ActionForm
            action={decideAdjustments}
            submitLabel="Approve selected"
            pendingLabel="Deciding…"
            className="space-y-0"
            submitName="decision"
            submitValue="approve"
            footer={
              <>
                <input
                  name="note"
                  placeholder="Note (optional)"
                  className={`${inputClass} max-w-xs`}
                  aria-label="Note"
                />
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className={secondaryButtonClass}
                >
                  Reject selected
                </button>
              </>
            }
          >
            <Rows rows={pending} typeName={typeName} selectable />
            <div className="px-5 pt-4" />
          </ActionForm>
        ) : (
          <>
            <Rows rows={pending} typeName={typeName} selectable={false} />
            <p className="text-xs text-slate-500 px-5 py-4">
              Your role can see these but not decide on them. A manager has to approve a change this size.
            </p>
          </>
        )}
      </Card>

      <Card className="p-0 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold">Live rates set by rules</h2>
          {live.length > 0 && <Tag tone="green">{live.length}</Tag>}
        </div>

        {live.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState message="No rule is setting a rate at the moment — every night sells at its seasonal rate." />
          </div>
        ) : manage ? (
          <ActionForm
            action={clearAdjustments}
            submitLabel="Clear selected"
            submitClassName={dangerButtonClass}
            pendingLabel="Clearing…"
            confirmMessage="Clear these rates? Those nights go back to their seasonal rate."
            className="space-y-0"
          >
            <Rows rows={live} typeName={typeName} selectable />
            <div className="px-5 pt-4" />
          </ActionForm>
        ) : (
          <Rows rows={live} typeName={typeName} selectable={false} />
        )}
      </Card>
    </div>
  );
}
