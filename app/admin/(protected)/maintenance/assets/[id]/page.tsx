import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../../lib/auth";
import { can } from "../../../../../lib/permissions";
import type { Asset, MaintenanceSchedule, MaintenanceTicket, Room } from "../../../../../lib/types";
import { ASSET_CATEGORY_LABELS, MT_PRIORITY_LABELS, MT_STATUS_LABELS } from "../../../../../lib/types";
import { saveAsset } from "../../../../maintenance-actions";
import { Card, Check, EmptyState, SectionTitle, Stat, Tag, tableHeadClass, fmtDate, fmtDateTime } from "../../../../components/ui";
import ActionForm from "../../../../components/ActionForm";
import AssetFields from "../AssetFields";
import { PRIORITY_TONE, STATUS_TONE } from "../../shared";

/** One asset and its maintenance history (SOW: "its own maintenance history log"). */
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["maintenance.work", "maintenance.manage"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data }, { data: tickets }, { data: schedules }, { data: rooms }] = await Promise.all([
    supabase.from("assets").select("*, rooms(room_number)").eq("id", id).maybeSingle(),
    supabase.from("maintenance_tickets").select("*").eq("asset_id", id).order("created_at", { ascending: false }),
    supabase.from("maintenance_schedules").select("*").eq("asset_id", id).order("next_due_on"),
    supabase.from("rooms").select("id, room_number").order("room_number"),
  ]);
  if (!data) notFound();
  const asset = data as Asset;
  const history = (tickets ?? []) as MaintenanceTicket[];
  const plans = (schedules ?? []) as MaintenanceSchedule[];
  const resolved = history.filter((t) => t.status === "resolved");

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/admin/maintenance/assets" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
        <ArrowLeft className="w-3.5 h-3.5" /> Assets
      </Link>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{asset.name}</h2>
        <p className="text-sm text-slate-500">
          {asset.code} · {ASSET_CATEGORY_LABELS[asset.category]}
          {!asset.is_active && " · retired"}
        </p>
      </div>

      <Card className="p-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Tickets">{history.length}</Stat>
          <Stat label="Resolved">{resolved.length}</Stat>
          <Stat label="Last repaired">{resolved[0]?.resolved_at ? fmtDateTime(resolved[0].resolved_at) : "—"}</Stat>
          <Stat label="Next service">{plans.find((p) => p.is_active) ? fmtDate(plans.find((p) => p.is_active)!.next_due_on) : "—"}</Stat>
        </dl>
      </Card>

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Maintenance history</SectionTitle>
        </div>
        {history.length === 0 ? (
          <EmptyState message="No tickets for this asset yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="px-4 py-2.5 font-medium">Raised</th>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">What was done</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-600">{fmtDateTime(t.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/maintenance/${t.id}`} className="text-slate-900 hover:text-yellow-800">
                      {t.title}
                    </Link>
                    <span className="block text-xs text-slate-500">{t.reference}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag tone={PRIORITY_TONE[t.priority]}>{MT_PRIORITY_LABELS[t.priority]}</Tag>
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag tone={STATUS_TONE[t.status]}>{MT_STATUS_LABELS[t.status]}</Tag>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{t.resolution_note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {can(session, "maintenance.manage") && (
        <Card className="p-5">
          <SectionTitle>Details</SectionTitle>
          <ActionForm action={saveAsset} submitLabel="Save asset" className="space-y-3">
            <input type="hidden" name="id" value={asset.id} />
            <AssetFields asset={asset} rooms={(rooms ?? []) as Pick<Room, "id" | "room_number">[]} />
            <Check name="is_active" label="In use" defaultChecked={asset.is_active} hint="Untick when the asset is retired; its history is kept." />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
