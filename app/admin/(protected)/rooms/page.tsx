import Link from "next/link";
import { Accessibility, CigaretteOff, Cigarette } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import type { Room, RoomType, Booking, RoomBlock, HousekeepingStatus } from "../../../lib/types";
import { OCCUPYING_STATUSES, HOUSEKEEPING_STATUS_LABELS, roomBoardLabel } from "../../../lib/types";
import { updateHousekeepingStatus, createBlock, releaseBlock } from "../../rooms-actions";
import {
  PageHeader,
  Card,
  EmptyState,
  Field,
  SectionTitle,
  Tag,
  inputClass,
  secondaryButtonClass,
  fmtDate,
  fmtDateTime,
  tableHeadClass,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import LiveRefresh from "../../components/LiveRefresh";
import { todayIn, monthStartOf, shiftMonth, monthEndOf } from "../../../lib/dates";
import AddRoomForm from "./AddRoomForm";
import RoomEditForm from "./RoomEditForm";
import AvailabilityCalendar from "./AvailabilityCalendar";

const MONTHS_BACK = 3;
const MONTHS_FORWARD = 12;

const TILE: Record<string, string> = {
  "Vacant Clean": "border-emerald-300 bg-emerald-50",
  "Vacant Dirty": "border-amber-300 bg-amber-50",
  Occupied: "border-blue-300 bg-blue-50",
  "Out of Order": "border-rose-300 bg-rose-50",
  "Out of Service": "border-stone-300 bg-stone-100",
};

const HK_FLOW: HousekeepingStatus[] = ["dirty", "cleaning", "clean", "inspected"];

export default async function RoomsPage() {
  const session = await requirePermission("rooms.view");
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const thisMonth = monthStartOf(today);
  const windowStart = shiftMonth(thisMonth, -MONTHS_BACK);
  const windowEnd = monthEndOf(shiftMonth(thisMonth, MONTHS_FORWARD));
  const seesBookings = can(session, "bookings.view") || can(session, "frontdesk.view");

  const [{ data: rooms }, { data: roomTypes }, { data: booked }, { data: inHouse }, { data: blocks }] =
    await Promise.all([
      supabase.from("rooms").select("*, room_types(name, slug)").order("room_number"),
      supabase.from("room_types").select("*").order("sort_order"),
      supabase
        .from("bookings")
        .select("id, room_type_id, check_in, check_out, rooms_count, status")
        .in("status", OCCUPYING_STATUSES)
        .lte("check_in", windowEnd)
        .gt("check_out", windowStart),
      supabase
        .from("bookings")
        .select("id, contact_name, room_id, check_out, is_vip")
        .eq("status", "checked_in")
        .not("room_id", "is", null),
      supabase
        .from("room_blocks")
        .select("*, rooms(room_number), maintenance_tickets(id, reference, status)")
        .is("released_at", null)
        .order("start_date"),
    ]);

  const roomList = (rooms ?? []) as Room[];
  const types = (roomTypes ?? []) as RoomType[];
  const blockList = ((blocks ?? []) as RoomBlock[]).filter((b) => b.end_date === null || b.end_date >= today);
  const occupantByRoom = new Map(
    ((inHouse ?? []) as Pick<Booking, "id" | "contact_name" | "room_id" | "check_out" | "is_vip">[]).map((b) => [
      b.room_id as string,
      b,
    ]),
  );
  const blockToday = (roomId: string) =>
    blockList.find((b) => b.room_id === roomId && b.start_date <= today && (b.end_date === null || b.end_date >= today));

  const floors = [...new Set(roomList.map((r) => r.floor))].sort((a, b) => (a ?? -1) - (b ?? -1));
  const counts = roomList.reduce<Record<string, number>>((acc, r) => {
    const label = roomBoardLabel(r);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  const canStatus = can(session, "rooms.status");
  const canInspect = can(session, "housekeeping.inspect");

  return (
    <>
      <LiveRefresh />
      <PageHeader title="Rooms" description="Room status board, blocks, inventory and availability." />

      <div className="space-y-6">
        {/* ── Status board ── */}
        <Card className="p-5">
          <SectionTitle
            action={
              <div className="flex flex-wrap gap-2 text-[11px]">
                {Object.keys(TILE).map((label) => (
                  <span key={label} className={`px-2 py-0.5 rounded border ${TILE[label]}`}>
                    {label} {counts[label] ?? 0}
                  </span>
                ))}
              </div>
            }
          >
            Room status
          </SectionTitle>

          {roomList.length === 0 ? (
            <EmptyState message="No rooms added yet." />
          ) : (
            <div className="space-y-4">
              {floors.map((floor) => (
                <div key={String(floor)}>
                  <p className="text-xs font-medium text-slate-500 mb-2">
                    {floor === null ? "No floor set" : `Floor ${floor}`}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {roomList
                      .filter((r) => r.floor === floor)
                      .map((room) => {
                        const label = roomBoardLabel(room);
                        const occupant = occupantByRoom.get(room.id);
                        const block = blockToday(room.id);
                        return (
                          <div key={room.id} className={`rounded-lg border p-2.5 ${TILE[label]}`}>
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-base font-semibold leading-none text-slate-900">{room.room_number}</p>
                              <span className="flex gap-0.5 text-slate-600">
                                {room.is_accessible && <Accessibility className="w-3.5 h-3.5" aria-label="Accessible" />}
                                {room.is_smoking ? (
                                  <Cigarette className="w-3.5 h-3.5" aria-label="Smoking" />
                                ) : (
                                  <CigaretteOff className="w-3.5 h-3.5 opacity-40" aria-label="Non-smoking" />
                                )}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-700 mt-1 truncate">{room.room_types?.name}</p>
                            <p className="text-[11px] font-medium mt-1">{label}</p>
                            {occupant && seesBookings && (
                              <Link href={`/admin/bookings/${occupant.id}`} className="block text-[10px] text-blue-800 truncate hover:underline">
                                {occupant.is_vip ? "★ " : ""}
                                {occupant.contact_name} · out {fmtDate(occupant.check_out).slice(0, 6)}
                              </Link>
                            )}
                            {block && <p className="text-[10px] text-rose-800 truncate" title={block.reason}>{block.reason}</p>}
                            {room.dnd && <p className="text-[10px] font-medium text-violet-700">Do Not Disturb</p>}
                            {canStatus && !block ? (
                              <form action={updateHousekeepingStatus} className="mt-1.5">
                                <input type="hidden" name="id" value={room.id} />
                                <div className="flex flex-wrap gap-1">
                                  {HK_FLOW.filter((hk) => hk !== "inspected" || canInspect).map((hk) => (
                                    <button
                                      key={hk}
                                      type="submit"
                                      name="housekeeping_status"
                                      value={hk}
                                      title={`Mark ${HOUSEKEEPING_STATUS_LABELS[hk].toLowerCase()}`}
                                      className={`text-[9px] px-1.5 py-0.5 rounded border cursor-pointer ${
                                        room.housekeeping_status === hk
                                          ? "bg-slate-900 text-white border-slate-900"
                                          : "bg-white/70 border-slate-200 text-slate-700 hover:border-yellow-500"
                                      }`}
                                    >
                                      {HOUSEKEEPING_STATUS_LABELS[hk]}
                                    </button>
                                  ))}
                                </div>
                              </form>
                            ) : (
                              <p className="text-[10px] text-slate-600 mt-1">{HOUSEKEEPING_STATUS_LABELS[room.housekeeping_status]}</p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-slate-500">
                Occupied follows check-in and check-out automatically; check-out marks the room dirty and creates a cleaning
                task. Only rooms a supervisor has <strong className="font-medium">inspected</strong> can be given to an
                arriving guest.
              </p>
            </div>
          )}
        </Card>

        {/* ── Blocks ── */}
        <Card className="p-5">
          <SectionTitle
            action={
              can(session, "maintenance.report") && (
                <Link href="/admin/maintenance?report=1" className="text-xs text-yellow-800 hover:text-yellow-900">
                  Report a problem
                </Link>
              )
            }
          >
            Out of order &amp; out of service
          </SectionTitle>
          {blockList.length === 0 ? (
            <p className="text-sm text-slate-500 mb-4">No rooms are blocked.</p>
          ) : (
            <div className="overflow-x-auto mb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className={tableHeadClass}>
                    <th className="py-2 pr-3 font-semibold">Room</th>
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Dates</th>
                    <th className="py-2 pr-3 font-semibold">Reason</th>
                    <th className="py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {blockList.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 font-medium">{b.rooms?.room_number}</td>
                      <td className="py-2 pr-3">
                        <Tag tone={b.kind === "out_of_order" ? "red" : "neutral"}>
                          {b.kind === "out_of_order" ? "Out of order" : "Out of service"}
                        </Tag>
                      </td>
                      <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">
                        {fmtDate(b.start_date)} → {b.end_date ? fmtDate(b.end_date) : "until released"}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">
                        {b.reason}
                        <span className="block text-[10px] text-slate-500">
                          since {fmtDateTime(b.created_at)}
                          {b.maintenance_tickets && (
                            <>
                              {" · "}
                              <Link href={`/admin/maintenance/${b.maintenance_tickets.id}`} className="text-yellow-800 hover:text-yellow-900">
                                {b.maintenance_tickets.reference}
                              </Link>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {can(session, "rooms.block") && (
                          <ActionForm action={releaseBlock} submitLabel="Release" submitClassName={`${secondaryButtonClass} !py-1`} className="">
                            <input type="hidden" name="id" value={b.id} />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {can(session, "rooms.block") && roomList.length > 0 && (
            <details>
              <summary className="text-sm text-yellow-700 cursor-pointer">Block a room</summary>
              <ActionForm action={createBlock} submitLabel="Block room" className="space-y-3 mt-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <Field label="Room">
                    <select name="room_id" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {roomList.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.room_number} · {r.room_types?.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type" hint="Out of order: repairs. Out of service: minor, short.">
                    <select name="kind" defaultValue="out_of_order" className={inputClass}>
                      <option value="out_of_order">Out of order</option>
                      <option value="out_of_service">Out of service</option>
                    </select>
                  </Field>
                  <Field label="From">
                    <input type="date" name="start_date" defaultValue={today} required className={inputClass} />
                  </Field>
                  <Field label="Until (inclusive)" hint="Blank: until released.">
                    <input type="date" name="end_date" className={inputClass} />
                  </Field>
                </div>
                <Field label="Reason" hint="Raises a maintenance ticket automatically.">
                  <input name="reason" required placeholder="AC not cooling; carpet replacement…" className={inputClass} />
                </Field>
              </ActionForm>
            </details>
          )}
        </Card>

        {seesBookings && <AvailabilityCalendar
          roomTypes={types}
          rooms={roomList}
          bookings={(booked ?? []) as Booking[]}
          blocks={blockList}
          today={today}
          rangeStart={windowStart}
          rangeEnd={windowEnd}
        />}

        {/* ── Inventory ── */}
        <Card>
          <h2 className="text-base font-semibold text-slate-900 px-5 py-4 border-b border-slate-100">
            Inventory ({roomList.length})
          </h2>
          {roomList.length === 0 ? (
            <EmptyState message="No rooms yet." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {roomList.map((room) => (
                <li key={room.id} className="px-5 py-3">
                  <details>
                    <summary className="flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer list-none text-sm">
                      <span className="font-medium text-slate-900 w-14">{room.room_number}</span>
                      <span className="text-slate-700 w-40">{room.room_types?.name}</span>
                      <span className="text-slate-600 text-xs">
                        {[
                          room.floor !== null && `Floor ${room.floor}`,
                          room.view,
                          room.bed_configuration,
                          room.max_adults && `sleeps ${room.max_adults}`,
                          room.is_accessible && "accessible",
                          room.is_smoking ? "smoking" : "non-smoking",
                          room.connecting_room_id &&
                            `connects to ${roomList.find((r) => r.id === room.connecting_room_id)?.room_number ?? "?"}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {can(session, "rooms.manage") && <span className="ml-auto text-[11px] text-yellow-700">Edit</span>}
                    </summary>
                    {can(session, "rooms.manage") && (
                      <div className="mt-4">
                        <RoomEditForm room={room} roomTypes={types} rooms={roomList} />
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {can(session, "rooms.manage") && (
          <Card className="p-5">
            <SectionTitle>Add a room</SectionTitle>
            <AddRoomForm roomTypes={types} rooms={roomList} />
          </Card>
        )}
      </div>
    </>
  );
}
