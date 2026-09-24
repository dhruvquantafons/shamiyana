import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import type { Booking, BookingGroup, RoomType } from "../../../../lib/types";
import { saveRoomingList, addRoomsToGroup, confirmGroup, cancelGroup } from "../../../group-actions";
import {
  Card,
  Field,
  SectionTitle,
  StatusPill,
  fmtDate,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  dangerButtonClass,
  tableHeadClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("bookings.groups");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: group }, { data: bookings }, { data: types }] = await Promise.all([
    supabase.from("booking_groups").select("*, companies(name), rate_plans(name)").eq("id", id).maybeSingle(),
    supabase
      .from("bookings")
      .select("*, room_types(id, name), rooms(id, room_number)")
      .eq("group_id", id)
      .order("created_at"),
    supabase.from("room_types").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  if (!group) notFound();

  const g = group as BookingGroup & { companies: { name: string } | null; rate_plans: { name: string } | null };
  const rooms = (bookings ?? []) as Booking[];
  const live = rooms.filter((b) => !["cancelled", "no_show"].includes(b.status));
  const total = live.reduce((s, b) => s + Number(b.total_amount ?? 0), 0);
  const editable = rooms.filter((b) => ["tentative", "confirmed", "waitlisted"].includes(b.status));

  return (
    <>
      <Link href="/admin/groups" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Groups
      </Link>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{g.name}</h1>
      <p className="text-xs text-slate-500 mt-1 mb-6">
        <span className="font-mono">{g.reference}</span> · {fmtDate(g.check_in)} → {fmtDate(g.check_out)} ·{" "}
        {g.rate_plans?.name ?? "No plan"}
        {g.companies ? ` · ${g.companies.name}` : ""} · {live.length} room(s) · {fmtMoney(total)}
        {g.organiser_name && ` · organiser ${g.organiser_name} ${g.organiser_phone}`}
      </p>

      <div className="space-y-6">
        <Card className="p-4 flex flex-wrap gap-3 items-start">
          <ActionForm action={confirmGroup} submitLabel="Confirm all tentative rooms" submitClassName={secondaryButtonClass} className="">
            <input type="hidden" name="group_id" value={id} />
          </ActionForm>
          {can(session, "bookings.cancel") && (
            <details className="relative">
              <summary className={`${dangerButtonClass} list-none`}>Cancel group</summary>
              <div className="absolute z-10 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-md p-4">
                <ActionForm
                  action={cancelGroup}
                  submitLabel="Release every room"
                  submitClassName={dangerButtonClass}
                  confirmMessage="Release every room in this group?"
                  className="space-y-3"
                >
                  <input type="hidden" name="group_id" value={id} />
                  <Field label="Reason">
                    <input name="reason" required className={inputClass} />
                  </Field>
                  <p className="text-[11px] text-slate-600">
                    Group penalties follow the contract; post any agreed charge on a room&apos;s folio.
                  </p>
                </ActionForm>
              </div>
            </details>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle>Rooming list</SectionTitle>
          {editable.length === 0 ? (
            <p className="text-sm text-slate-500">No open rooms to name.</p>
          ) : (
            <ActionForm action={saveRoomingList} submitLabel="Save rooming list">
              <input type="hidden" name="group_id" value={id} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={tableHeadClass}>
                      <th className="py-2 pr-2 font-semibold">#</th>
                      <th className="py-2 pr-2 font-semibold">Room type</th>
                      <th className="py-2 pr-2 font-semibold">Guest name</th>
                      <th className="py-2 pr-2 font-semibold">Phone</th>
                      <th className="py-2 pr-2 font-semibold">Email</th>
                      <th className="py-2 pr-2 font-semibold w-20">Adults</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editable.map((b, i) => (
                      <tr key={b.id}>
                        <td className="py-1.5 pr-2 text-slate-500">
                          <input type="hidden" name="booking_id" value={b.id} />
                          {i + 1}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-700 whitespace-nowrap">{b.room_types?.name}</td>
                        <td className="py-1.5 pr-2">
                          <input
                            name={`name_${b.id}`}
                            defaultValue={b.contact_name.startsWith(`${g.name} — room`) ? "" : b.contact_name}
                            placeholder={b.contact_name}
                            className={inputClass}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input name={`phone_${b.id}`} defaultValue={b.contact_phone} className={inputClass} />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input name={`email_${b.id}`} defaultValue={b.contact_email} className={inputClass} />
                        </td>
                        <td className="py-1.5 pr-2">
                          <input type="number" name={`adults_${b.id}`} min={1} max={10} defaultValue={b.adults} className={inputClass} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ActionForm>
          )}
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold">Rooms</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {rooms.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                  <span className="font-mono text-[11px] text-slate-500 w-20">{b.reference}</span>
                  <span className="flex-1 text-sm">{b.contact_name}</span>
                  <span className="text-xs text-slate-700">{b.room_types?.name}</span>
                  <span className="text-xs text-slate-700 w-16">{b.rooms?.room_number ?? "—"}</span>
                  <StatusPill status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <SectionTitle>Add rooms</SectionTitle>
          <ActionForm action={addRoomsToGroup} submitLabel="Add" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="group_id" value={id} />
            <Field label="Room type">
              <select name="room_type_id" className={inputClass}>
                {((types ?? []) as Pick<RoomType, "id" | "name">[]).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How many">
              <input type="number" name="count" min={1} max={50} defaultValue={1} className={`${inputClass} w-24`} />
            </Field>
            <Field label="Status">
              <select name="status" defaultValue="confirmed" className={inputClass}>
                <option value="confirmed">Confirmed</option>
                <option value="tentative">Tentative</option>
              </select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
