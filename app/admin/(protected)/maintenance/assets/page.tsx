import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { todayIn } from "../../../../lib/dates";
import { getSettings } from "../../../../lib/settings";
import type { Asset, Room } from "../../../../lib/types";
import { ASSET_CATEGORY_LABELS } from "../../../../lib/types";
import { saveAsset } from "../../../maintenance-actions";
import { Card, EmptyState, Tag, secondaryButtonClass, tableHeadClass, fmtDate } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import AssetFields from "./AssetFields";
import { OPEN_STATUSES } from "../shared";

export default async function AssetsPage() {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const supabase = await createClient();
  const today = todayIn((await getSettings()).timezone);
  const [{ data }, { data: rooms }, { data: open }] = await Promise.all([
    supabase.from("assets").select("*, rooms(room_number)").order("is_active", { ascending: false }).order("name"),
    supabase.from("rooms").select("id, room_number").order("room_number"),
    supabase.from("maintenance_tickets").select("asset_id").in("status", OPEN_STATUSES).not("asset_id", "is", null),
  ]);
  const assets = (data ?? []) as Asset[];
  const openCount = (id: string) => (open ?? []).filter((t) => t.asset_id === id).length;

  return (
    <div className="space-y-6">
      {can(session, "maintenance.manage") && (
        <details>
          <summary className={`${secondaryButtonClass} list-none w-fit`}>Add an asset</summary>
          <Card className="p-4 mt-3">
            <ActionForm action={saveAsset} submitLabel="Add asset" className="space-y-3">
              <AssetFields rooms={(rooms ?? []) as Pick<Room, "id" | "room_number">[]} />
            </ActionForm>
          </Card>
        </details>
      )}

      <Card>
        {assets.length === 0 ? (
          <EmptyState message="No assets registered yet. Add the AC units, lifts, boilers and other equipment you maintain." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2.5 font-medium">Asset</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Where</th>
                  <th className="px-4 py-2.5 font-medium">Warranty</th>
                  <th className="px-4 py-2.5 font-medium">Open tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assets.map((a) => (
                  <tr key={a.id} className={a.is_active ? "" : "opacity-60"}>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/maintenance/assets/${a.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                        {a.name}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {a.code}
                        {[a.make, a.model].filter(Boolean).length > 0 && ` · ${[a.make, a.model].filter(Boolean).join(" ")}`}
                        {!a.is_active && " · retired"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{ASSET_CATEGORY_LABELS[a.category]}</td>
                    <td className="px-4 py-2.5">{[a.rooms?.room_number && `Room ${a.rooms.room_number}`, a.location].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {a.warranty_until ? (
                        <span className={a.warranty_until < today ? "text-slate-500" : "text-emerald-700"}>
                          {a.warranty_until < today ? "Expired " : "Until "}
                          {fmtDate(a.warranty_until)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5">{openCount(a.id) ? <Tag tone="amber">{openCount(a.id)}</Tag> : "—"}</td>
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
