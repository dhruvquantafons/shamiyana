import Link from "next/link";
import { redirect } from "next/navigation";
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
  tableRowClass,
  SearchInput,
  FilterChips,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import LiveRefresh from "../../components/LiveRefresh";
import { todayIn, monthStartOf, shiftMonth, monthEndOf } from "../../../lib/dates";
import AddRoomForm from "./AddRoomForm";
import RoomEditForm from "./RoomEditForm";
import AvailabilityCalendar from "./AvailabilityCalendar";

const MONTHS_BACK = 3;
const MONTHS_FORWARD = 12;

/**
 * Board states: the URL value, the label roomBoardLabel() gives, the tile's
 * tint with a coloured leading edge, and the legend swatch in the same hue.
 */
const BOARD = [
  { value: "vacant_clean", label: "Vacant Clean", tile: "bg-white border-slate-200 shadow-[inset_3px_0_0_var(--color-emerald-300)]", swatch: "bg-emerald-300" },
  { value: "vacant_dirty", label: "Vacant Dirty", tile: "bg-amber-50 border-amber-200 shadow-[inset_3px_0_0_var(--color-amber-500)]", swatch: "bg-amber-500" },
  { value: "occupied", label: "Occupied", tile: "bg-emerald-50 border-emerald-200 shadow-[inset_3px_0_0_var(--color-emerald-600)]", swatch: "bg-emerald-600" },
  { value: "out_of_order", label: "Out of Order", tile: "bg-rose-50 border-rose-200 shadow-[inset_3px_0_0_var(--color-rose-500)]", swatch: "bg-rose-500" },
  { value: "out_of_service", label: "Out of Service", tile: "bg-slate-50 border-slate-200 shadow-[inset_3px_0_0_var(--color-slate-400)]", swatch: "bg-slate-400" },
] as const;
type BoardValue = (typeof BOARD)[number]["value"];
const TILE: Record<string, string> = Object.fromEntries(BOARD.map((b) => [b.label, b.tile]));

/** Rooms per page: four full rows of the six-across board. */
const ROOMS_PAGE = 24;

const HK_FLOW: HousekeepingStatus[] = ["dirty", "cleaning", "clean", "inspected"];

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string }>;
}) {
  const session = await requirePermission("rooms.view");
  const params = await searchParams;
  const page = pageParam(params.page);
  const status: BoardValue | "all" = BOARD.some((b) => b.value === params.status) ? (params.status as BoardValue) : "all";
  const typeId = params.type && /^[0-9a-f-]{36}$/i.test(params.type) ? params.type : null;
  const term = (params.q ?? "").replace(/[%,()]/g, "").trim();
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const thisMonth = monthStartOf(today);
  const windowStart = shiftMonth(thisMonth, -MONTHS_BACK);
  const windowEnd = monthEndOf(shiftMonth(thisMonth, MONTHS_FORWARD));
  const seesBookings = can(session, "bookings.view") || can(session, "frontdesk.view");

  // The board and the inventory list show one filtered page of rooms. The
  // full list below still feeds the counts, the calendar and every form.
  // Room type names live on the joined table, which .or() cannot reach, so
  // matching types are resolved to ids first (as Bookings does for rooms).
  let listQuery = supabase
    .from("rooms")
    .select("*, room_types(name, slug)", { count: "exact" })
    .order("room_number")
    .range(...pageRange(page, ROOMS_PAGE));
  if (status === "occupied" || status === "out_of_order" || status === "out_of_service") listQuery = listQuery.eq("status", status);
  if (status === "vacant_clean") listQuery = listQuery.eq("status", "available").in("housekeeping_status", ["clean", "inspected"]);
  if (status === "vacant_dirty") listQuery = listQuery.eq("status", "available").in("housekeeping_status", ["dirty", "cleaning"]);
  if (typeId) listQuery = listQuery.eq("room_type_id", typeId);
  if (term) {
    const { data: matchedTypes } = await supabase.from("room_types").select("id").ilike("name", `%${term}%`);
    const clauses = [`room_number.ilike.%${term}%`];
    const typeIds = (matchedTypes ?? []).map((t) => t.id);
    if (typeIds.length > 0) clauses.push(`room_type_id.in.(${typeIds.join(",")})`);
    listQuery = listQuery.or(clauses.join(","));
  }

  const [
    { data: rooms },
    { data: roomTypes },
    { data: booked },
    { data: inHouse },
    { data: blocks },
    { data: pageRows, error: listError, count: listCount },
  ] = await Promise.all([
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
      listQuery,
    ]);

  const listParams = { q: term, status: status === "all" ? null : status, type: typeId };
  if (outOfRange(listError)) redirect(pageHref("/admin/rooms", listParams, 1));
  const pageRooms = (pageRows ?? []) as Room[];
  const filtered = Boolean(term || typeId || status !== "all");

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

  const floors = [...new Set(pageRooms.map((r) => r.floor))].sort((a, b) => (a ?? -1) - (b ?? -1));
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
        {/* ── Find rooms: filters the status board and the inventory list below ── */}
        {roomList.length > 0 && (
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FilterChips
                path="/admin/rooms"
                param="status"
                label="Room status"
                current={status}
                params={{ q: term, type: typeId }}
                options={[
                  { value: "all", label: "All rooms", count: roomList.length },
                  ...BOARD.map((b) => ({ value: b.value, label: b.label, count: counts[b.label] ?? 0, swatch: b.swatch })),
                ]}
              />
              <SearchInput
                action="/admin/rooms"
                defaultValue={term}
                placeholder="Room number or room type"
                keep={{ status: status === "all" ? null : status, type: typeId }}
                className="w-full sm:w-80"
              />
            </div>
            {types.length > 1 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="admin-eyebrow">Room type</span>
                <FilterChips
                  path="/admin/rooms"
                  param="type"
                  label="Room type"
                  current={typeId ?? "all"}
                  params={{ q: term, status: status === "all" ? null : status }}
                  options={[
                    { value: "all", label: "All types" },
                    ...types.map((t) => ({
                      value: t.id,
                      label: t.name,
                      count: roomList.filter((r) => r.room_type_id === t.id).length,
                    })),
                  ]}
                />
              </div>
            )}
          </Card>
        )}

        {/* ── Status board ── */}
        <Card className="p-5">
          <SectionTitle
            action={
              filtered ? (
                <span className="text-xs text-slate-500 tabular-nums">
                  {listCount ?? 0} of {roomList.length} rooms match
                </span>
              ) : null
            }
          >
            Room status
          </SectionTitle>

          {roomList.length === 0 ? (
            <EmptyState message="No rooms added yet." />
          ) : pageRooms.length === 0 ? (
            <EmptyState message="No rooms match this view." />
          ) : (
            <div className="space-y-4">
              {floors.map((floor) => (
                <div key={String(floor)}>
                  <p className="admin-eyebrow mb-2">
                    {floor === null ? "No floor set" : `Floor ${floor}`}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {pageRooms
                      .filter((r) => r.floor === floor)
                      .map((room) => {
                        const label = roomBoardLabel(room);
                        const occupant = occupantByRoom.get(room.id);
                        const block = blockToday(room.id);
                        return (
                          <div key={room.id} className={`rounded-xl border p-3 transition-shadow duration-200 hover:shadow-[0_6px_18px_-10px_rgb(17_20_18/0.2)] ${TILE[label]}`}>
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
                            <p className="text-[10.5px] text-slate-500 mt-1 truncate">{room.room_types?.name}</p>
                            <p className="text-[11px] font-medium text-slate-800 mt-1">{label}</p>
                            {occupant && seesBookings && (
                              <Link href={`/admin/bookings/${occupant.id}`} className="block text-[10px] text-emerald-800 truncate hover:underline">
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
                                      className={`text-[9px] px-1.5 py-0.5 rounded-md border cursor-pointer transition-colors duration-150 ${
                                        room.housekeeping_status === hk
                                          ? "bg-emerald-900 text-white border-emerald-900"
                                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900"
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
              <Pagination
                page={page}
                total={listCount ?? 0}
                pageSize={ROOMS_PAGE}
                path="/admin/rooms"
                params={listParams}
                className="pt-3 border-t border-slate-100"
              />
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
                    <tr key={b.id} className={tableRowClass}>
                      <td className="py-2.5 pr-3 font-medium">{b.rooms?.room_number}</td>
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
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-900">Inventory ({roomList.length})</h2>
            {filtered && <span className="text-xs text-slate-500">Showing rooms that match the filters above</span>}
          </div>
          {roomList.length === 0 ? (
            <EmptyState message="No rooms yet." />
          ) : pageRooms.length === 0 ? (
            <EmptyState message="No rooms match this view." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {pageRooms.map((room) => (
                <li key={room.id} className="px-5 py-3 hover:bg-slate-50 transition-colors duration-150">
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
          <Pagination page={page} total={listCount ?? 0} pageSize={ROOMS_PAGE} path="/admin/rooms" params={listParams} />
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
