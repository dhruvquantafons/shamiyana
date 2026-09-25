"use client";

import Link from "next/link";
import type { Booking, BookingStatus, Room, RoomBlock, RoomType } from "../../lib/types";
import { BOOKING_STATUS_LABELS, roomBoardLabel } from "../../lib/types";
import { addDays, dayOfWeek, daysBetween } from "../../lib/dates";

const BAR: Record<BookingStatus, string> = {
  tentative: "bg-amber-100 border-amber-300 text-amber-900",
  confirmed: "bg-emerald-100 border-emerald-300 text-emerald-900",
  checked_in: "bg-blue-100 border-blue-300 text-blue-900",
  checked_out: "bg-slate-100 border-slate-300 text-slate-600",
  cancelled: "bg-rose-50 border-rose-200 text-rose-700",
  no_show: "bg-orange-50 border-orange-200 text-orange-800",
  waitlisted: "bg-violet-50 border-violet-200 text-violet-800",
};

/** Hatching used for out-of-order / out-of-service blocks and their legend swatch. */
const BLOCKED = "bg-[repeating-linear-gradient(45deg,#eaeaea,#eaeaea_4px,#f7f7f7_4px,#f7f7f7_8px)]";

/** Status key shown above the chart, identical wherever the chart appears. */
export function TapeChartLegend() {
  return (
    <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
      {(["tentative", "confirmed", "checked_in", "checked_out"] as BookingStatus[]).map((s) => (
        <span key={s} className={`px-2 py-0.5 rounded border ${BAR[s]}`}>
          {BOOKING_STATUS_LABELS[s]}
        </span>
      ))}
      <span className={`px-2 py-0.5 rounded border ${BLOCKED} border-stone-300 text-stone-700`}>Blocked</span>
    </div>
  );
}

type Bar = { from: number; to: number; clipStart: boolean; clipEnd: boolean };

function span(checkIn: string, checkOut: string, start: string, days: number): Bar | null {
  const from = daysBetween(start, checkIn);
  const to = daysBetween(start, checkOut);
  if (to <= 0 || from >= days) return null;
  return { from: Math.max(0, from), to: Math.min(days, to), clipStart: from < 0, clipEnd: to > days };
}

function lanes(bookings: Booking[]): Booking[][] {
  const result: Booking[][] = [];
  for (const b of [...bookings].sort((a, z) => a.check_in.localeCompare(z.check_in))) {
    const lane = result.find((l) => l.every((o) => o.check_out <= b.check_in || o.check_in >= b.check_out));
    if (lane) lane.push(b);
    else result.push([b]);
  }
  return result;
}

export default function TapeChart({
  rooms,
  roomTypes,
  bookings,
  blocks,
  start,
  days,
  today,
  canCreate,
}: {
  rooms: Room[];
  roomTypes: RoomType[];
  bookings: Booking[];
  blocks: RoomBlock[];
  start: string;
  days: number;
  today: string;
  canCreate: boolean;
}) {
  const end = addDays(start, days);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const grid = { gridTemplateColumns: `repeat(${days}, minmax(${days > 14 ? 28 : 44}px, 1fr))` };
  const blockList = blocks.filter((b) => b.end_date === null || b.end_date >= start);

  const roomList = roomTypes
    .map((type) => {
      const typeRooms = rooms.filter((r) => r.room_type_id === type.id);
      const unassigned = bookings.filter(
        (b) => b.room_type_id === type.id && !b.room_id && b.status !== "checked_out",
      );
      return { type, rooms: typeRooms, unassigned };
    })
    .filter((group) => group.rooms.length > 0 || group.unassigned.length > 0);

  return (
    <div className="min-w-max">
      <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="w-36 shrink-0 px-4 flex items-center text-xs text-slate-500 font-medium sticky left-0 z-10 bg-white border-r border-slate-200">
          Room
        </div>
        <div className="grid flex-1" style={grid}>
          {dates.map((d, i) => {
            const date = new Date(d + "T00:00:00");
            return (
              <div
                key={d}
                className={`text-center py-2 border-slate-100 ${i < days - 1 ? "border-r" : ""} ${
                  d === today ? "bg-yellow-50 shadow-[inset_0_-2px_0_var(--color-yellow-400)]" : ""
                }`}
              >
                <p className={`text-[10px] uppercase tracking-wide leading-none ${d === today ? "text-yellow-700 font-medium" : "text-slate-500"}`}>
                  {date.toLocaleDateString("en-IN", { weekday: "short" })}
                </p>
                <p className="text-[13px] font-medium text-slate-900 tabular-nums leading-none mt-1.5">{date.getDate()}</p>
              </div>
            );
          })}
        </div>
      </div>

      {roomList.map(({ type, rooms: typeRooms, unassigned }) => (
        <div key={type.id}>
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[11px] font-medium text-slate-500 uppercase tracking-wider sticky left-0">
            {type.name} · {typeRooms.length} room(s)
          </div>

          {typeRooms.map((room) => {
            const roomStays = bookings.filter((b) => b.room_id === room.id);
            const roomBlocks = blockList.filter((b) => b.room_id === room.id);
            return (
              <div key={room.id} className="flex border-b border-slate-100">
                <div className="w-36 shrink-0 px-4 py-2 flex flex-col justify-center sticky left-0 bg-white z-10 border-r border-slate-200">
                  <p className="text-sm font-medium text-slate-900 leading-tight tabular-nums">{room.room_number}</p>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{roomBoardLabel(room)}</p>
                </div>
                <div className="grid flex-1" style={grid}>
                  {dates.map((d, i) => {
                    const weekend = [5, 6].includes(dayOfWeek(d));
                    const cls = `min-h-9 border-slate-100 ${i < days - 1 ? "border-r" : ""} ${d === today ? "bg-yellow-50/60" : weekend ? "bg-slate-50" : ""}`;
                    return canCreate && d >= today ? (
                      <Link
                        key={d}
                        href={`/admin/bookings/new?check_in=${d}&room_type=${type.id}`}
                        title={`New booking from ${d}`}
                        className={`${cls} hover:bg-yellow-50`}
                        style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }}
                      />
                    ) : (
                      <div key={d} className={cls} style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }} />
                    );
                  })}
                  {roomBlocks.map((bl) => {
                    const s = span(bl.start_date, addDays(bl.end_date ?? addDays(end, 1), 1), start, days);
                    return s ? (
                      <div
                        key={bl.id}
                        title={`${bl.kind === "out_of_order" ? "Out of order" : "Out of service"}: ${bl.reason}`}
                        className={`relative z-10 m-1 rounded-md border border-stone-300 ${BLOCKED} text-[10px] text-stone-700 px-1.5 flex items-center truncate`}
                        style={{ gridColumn: `${s.from + 1} / ${s.to + 1}`, gridRow: 1 }}
                      >
                        {bl.reason}
                      </div>
                    ) : null;
                  })}
                  {roomStays.map((b) => {
                    const s = span(b.check_in, b.check_out, start, days);
                    if (!s) return null;
                    return (
                      <Link
                        key={b.id}
                        href={`/admin/bookings/${b.id}`}
                        title={`${b.contact_name} · ${b.reference} · ${BOOKING_STATUS_LABELS[b.status]} · ${b.check_in} → ${b.check_out}`}
                        className={`relative z-10 m-1 flex items-center truncate border px-1.5 text-[11px] font-medium ${BAR[b.status]} ${
                          s.clipStart ? "rounded-l-none border-l-0" : "rounded-l-md"
                        } ${s.clipEnd ? "rounded-r-none border-r-0" : "rounded-r-md"}`}
                        style={{ gridColumn: `${s.from + 1} / ${s.to + 1}`, gridRow: 1 }}
                      >
                        {b.is_vip ? "★ " : ""}
                        {b.contact_name || b.reference}
                        {b.rooms_count > 1 ? ` ×${b.rooms_count}` : ""}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {lanes(unassigned).map((lane, i) => (
            <div key={`u-${i}`} className="flex border-b border-slate-100 bg-amber-50/40">
              <div className="w-36 shrink-0 px-4 py-2 flex items-center sticky left-0 bg-amber-50 z-10 border-r border-slate-200">
                <p className="text-xs text-amber-800">Unassigned</p>
              </div>
              <div className="grid flex-1" style={grid}>
                {dates.map((d, i) => {
                  const weekend = [5, 6].includes(dayOfWeek(d));
                  const cls = `min-h-9 border-slate-100 ${i < days - 1 ? "border-r" : ""} ${d === today ? "bg-yellow-50/60" : weekend ? "bg-slate-50" : ""}`;
                  return canCreate && d >= today ? (
                    <Link
                      key={d}
                      href={`/admin/bookings/new?check_in=${d}&room_type=${type.id}`}
                      title={`New booking from ${d}`}
                      className={`${cls} hover:bg-yellow-50`}
                      style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }}
                    />
                  ) : (
                    <div key={d} className={cls} style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: 1 }} />
                  );
                })}
                {lane.map((b) => {
                  const s = span(b.check_in, b.check_out, start, days);
                  if (!s) return null;
                  return (
                    <Link
                      key={b.id}
                      href={`/admin/bookings/${b.id}`}
                      title={`${b.contact_name} · ${b.reference} · ${BOOKING_STATUS_LABELS[b.status]} · ${b.check_in} → ${b.check_out}`}
                      className={`relative z-10 m-1 flex items-center truncate border px-1.5 text-[11px] font-medium ${BAR[b.status]} ${
                        s.clipStart ? "rounded-l-none border-l-0" : "rounded-l-md"
                      } ${s.clipEnd ? "rounded-r-none border-r-0" : "rounded-r-md"}`}
                      style={{ gridColumn: `${s.from + 1} / ${s.to + 1}`, gridRow: 1 }}
                    >
                      {b.is_vip ? "★ " : ""}
                      {b.contact_name || b.reference}
                      {b.rooms_count > 1 ? ` ×${b.rooms_count}` : ""}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
