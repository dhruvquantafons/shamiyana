import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import type { MaintenancePhoto, MaintenanceTicket } from "../../../../lib/types";
import { MT_PRIORITIES, MT_PRIORITY_LABELS, MT_SOURCE_LABELS, MT_STATUS_LABELS } from "../../../../lib/types";
import {
  addTicketPhotos,
  blockRoomForTicket,
  cancelTicket,
  holdTicket,
  reopenTicket,
  resolveTicket,
  setTicketPriority,
  startTicket,
  assignTicket,
} from "../../../maintenance-actions";
import {
  Card,
  Field,
  Notice,
  SectionTitle,
  Stat,
  Tag,
  inputClass,
  secondaryButtonClass,
  dangerButtonClass,
  fmtDate,
  fmtDateTime,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { DueTag, OPEN_STATUSES, PRIORITY_TONE, STATUS_TONE, nameOf, staffWith, whereOf } from "../shared";

const PHOTO_INPUT = (
  <input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="text-sm" />
);

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAnyPermission(["maintenance.report", "maintenance.work", "maintenance.manage"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("maintenance_tickets")
    .select("*, rooms(room_number), assets(id, code, name), guest_requests(booking_id)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as MaintenanceTicket & { assets: { id: string; code: string; name: string } | null; guest_requests: { booking_id: string | null } | null };

  const [{ data: photoRows }, { data: blocks }, { data: people }, engineers] = await Promise.all([
    supabase.from("maintenance_photos").select("*").eq("ticket_id", id).order("uploaded_at"),
    supabase.from("room_blocks").select("id, start_date, released_at").eq("ticket_id", id).order("created_at", { ascending: false }),
    supabase.from("staff").select("id, full_name, email"),
    staffWith(supabase, "maintenance.work"),
  ]);
  const photos = (photoRows ?? []) as MaintenancePhoto[];
  const { data: signed } = photos.length
    ? await supabase.storage.from("maintenance-photos").createSignedUrls(photos.map((p) => p.storage_path), 600)
    : { data: [] };
  const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const everyone = (people ?? []) as { id: string; full_name: string; email: string }[];

  const manage = can(session, "maintenance.manage");
  const mine = t.assigned_to === session.staff.id || t.assigned_to === null;
  const canWork = manage || (can(session, "maintenance.work") && mine);
  const isOpen = OPEN_STATUSES.includes(t.status);
  const activeBlock = (blocks ?? []).find((b) => !b.released_at);

  const gallery = (stage: "report" | "resolution") => {
    const list = photos.filter((p) => p.stage === stage);
    if (list.length === 0) return null;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {list.map((p) => {
          const url = urlFor.get(p.storage_path);
          return url ? (
            <a key={p.id} href={url} target="_blank" rel="noreferrer" className="block border border-slate-200 rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={url} alt={`Photo of ${t.title}`} className="w-full h-32 object-cover" />
            </a>
          ) : null;
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/admin/maintenance" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
        <ArrowLeft className="w-3.5 h-3.5" /> Tickets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t.title}</h2>
          <p className="text-sm text-slate-500">
            {t.reference} · {whereOf(t)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag tone={PRIORITY_TONE[t.priority]}>{MT_PRIORITY_LABELS[t.priority]}</Tag>
          <Tag tone={STATUS_TONE[t.status]}>{MT_STATUS_LABELS[t.status]}</Tag>
          <DueTag ticket={t} />
        </div>
      </div>

      {t.escalated_at && isOpen && (
        <Notice tone="error">Past its resolution target — escalated to the engineering supervisor {fmtDateTime(t.escalated_at)}.</Notice>
      )}
      {t.status === "on_hold" && t.hold_reason && <Notice tone="warn">On hold: {t.hold_reason}</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5 space-y-4">
            {t.description && <p className="text-sm text-slate-700 whitespace-pre-line">{t.description}</p>}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label="Raised">{fmtDateTime(t.created_at)}</Stat>
              <Stat label="By">{nameOf(everyone, t.reported_by, "System")}</Stat>
              <Stat label="Source">
                {MT_SOURCE_LABELS[t.source]}
                {t.guest_requests?.booking_id && (
                  <Link href={`/admin/bookings/${t.guest_requests.booking_id}`} className="block text-xs text-yellow-800">
                    View booking
                  </Link>
                )}
              </Stat>
              <Stat label="Target">{fmtDateTime(t.due_at)}</Stat>
              <Stat label="Engineer">{nameOf(everyone, t.assigned_to)}</Stat>
              {t.started_at && <Stat label="Started">{fmtDateTime(t.started_at)}</Stat>}
              {t.resolved_at && (
                <Stat label={t.status === "cancelled" ? "Closed" : "Resolved"}>
                  {fmtDateTime(t.resolved_at)} · {nameOf(everyone, t.resolved_by, "—")}
                </Stat>
              )}
              {t.assets && (
                <Stat label="Asset">
                  <Link href={`/admin/maintenance/assets/${t.assets.id}`} className="text-yellow-800">
                    {t.assets.code} · {t.assets.name}
                  </Link>
                </Stat>
              )}
            </dl>
            {gallery("report")}
          </Card>

          {t.resolution_note && (
            <Card className="p-5 space-y-3">
              <SectionTitle>{t.status === "cancelled" ? "Closed" : "What was done"}</SectionTitle>
              <p className="text-sm text-slate-700 whitespace-pre-line">{t.resolution_note}</p>
              {gallery("resolution")}
            </Card>
          )}

          {isOpen && canWork && (
            <Card className="p-5 space-y-4">
              <SectionTitle>Work</SectionTitle>
              {["open", "on_hold"].includes(t.status) && (
                <ActionForm action={startTicket} submitLabel={t.status === "on_hold" ? "Resume work" : "Start work"} className="">
                  <input type="hidden" name="id" value={t.id} />
                </ActionForm>
              )}
              {t.status === "in_progress" && (
                <details>
                  <summary className={`${secondaryButtonClass} list-none w-fit`}>Put on hold</summary>
                  <div className="mt-3 max-w-md">
                    <ActionForm action={holdTicket} submitLabel="Put on hold" submitClassName={secondaryButtonClass} className="space-y-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="hold_reason" required maxLength={300} placeholder="Waiting for a spare part" className={inputClass} />
                    </ActionForm>
                  </div>
                </details>
              )}
              <ActionForm action={resolveTicket} submitLabel="Mark resolved" pendingLabel="Saving…" className="space-y-3 border-t border-slate-100 pt-4">
                <input type="hidden" name="id" value={t.id} />
                <Field label="What was done">
                  <textarea name="resolution_note" required rows={2} maxLength={2000} className={inputClass} />
                </Field>
                <Field label="After photos (optional)">{PHOTO_INPUT}</Field>
                {activeBlock && (
                  <p className="text-xs text-slate-500">
                    Resolving puts room {t.rooms?.room_number} back into inventory, marked dirty for housekeeping.
                  </p>
                )}
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {t.room_id && (
            <Card className="p-5 space-y-3">
              <SectionTitle>Room {t.rooms?.room_number}</SectionTitle>
              {activeBlock ? (
                <p className="text-sm text-rose-800">Out of order since {fmtDate(activeBlock.start_date)} until this ticket is resolved.</p>
              ) : isOpen ? (
                <ActionForm action={blockRoomForTicket} submitLabel="Take room out of order" submitClassName={dangerButtonClass} className="space-y-2">
                  <input type="hidden" name="id" value={t.id} />
                  <p className="text-sm text-slate-600">The room is still for sale. Take it out if guests cannot use it.</p>
                </ActionForm>
              ) : (
                <p className="text-sm text-slate-600">In service.</p>
              )}
            </Card>
          )}

          {manage && isOpen && (
            <Card className="p-5 space-y-4">
              <SectionTitle>Supervisor</SectionTitle>
              <form action={assignTicket} className="space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <Field label="Engineer">
                  <select name="assigned_to" defaultValue={t.assigned_to ?? ""} className={inputClass}>
                    <option value="">Unassigned</option>
                    {engineers.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name || e.email}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className={secondaryButtonClass}>Assign</button>
              </form>
              <form action={setTicketPriority} className="space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <Field label="Priority" hint="Changing it resets the target from when the ticket was raised.">
                  <select name="priority" defaultValue={t.priority} className={inputClass}>
                    {MT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {MT_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className={secondaryButtonClass}>Change priority</button>
              </form>
              <details>
                <summary className="text-xs text-rose-700 cursor-pointer">Cancel ticket</summary>
                <div className="mt-2">
                  <ActionForm action={cancelTicket} submitLabel="Cancel ticket" submitClassName={dangerButtonClass} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input name="reason" required placeholder="Duplicate, not a fault…" className={inputClass} />
                  </ActionForm>
                </div>
              </details>
            </Card>
          )}

          {manage && !isOpen && (
            <Card className="p-5">
              <form action={reopenTicket}>
                <input type="hidden" name="id" value={t.id} />
                <button className={secondaryButtonClass}>Reopen ticket</button>
              </form>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle>Add photos</SectionTitle>
            <ActionForm action={addTicketPhotos} submitLabel="Upload" submitClassName={secondaryButtonClass} className="space-y-3">
              <input type="hidden" name="id" value={t.id} />
              {PHOTO_INPUT}
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
