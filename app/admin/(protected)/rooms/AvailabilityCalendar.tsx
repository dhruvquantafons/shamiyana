"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Room, RoomType, Booking, RoomBlock } from "../../../lib/types";
import {
  monthStartOf,
  shiftMonth,
  daysInMonth,
} from "../../../lib/dates";
import { Card, secondaryButtonClass } from "../../components/ui";

type DayCell = { iso: string; day: number } | null;

/**
 * Month calendar of committed occupancy.
 *
 * The displayed month is local state, not a URL parameter: paging is instant
 * and needs no server round-trip. The page loads a wide window of bookings up
 * front so any month in range can be rendered without refetching.
 *
 * A booking occupies a night when check_in <= night < check_out, so the
 * departure date itself is free.
 */
export default function AvailabilityCalendar({
  roomTypes,
  rooms,
  bookings,
  blocks,
  today,
  rangeStart,
  rangeEnd,
}: {
  roomTypes: RoomType[];
  rooms: Room[];
  bookings: Booking[];
  /** Active blocks; a blocked room is not sellable on the nights it covers. */
  blocks: Pick<RoomBlock, "room_id" | "start_date" | "end_date">[];
  /** Today at the hotel, so the highlight does not depend on the viewer's clock. */
  today: string;
  /** Bounds of the loaded booking window, as yyyy-mm-dd. */
  rangeStart: string;
  rangeEnd: string;
}) {
  const thisMonth = monthStartOf(today);
  const [month, setMonth] = useState(thisMonth);

  const minMonth = monthStartOf(rangeStart);
  const maxMonth = monthStartOf(rangeEnd);
  const canGoBack = month > minMonth;
  const canGoForward = month < maxMonth;

  const [year, monthNumber] = month.split("-").map(Number);
  const total = daysInMonth(month);

  const iso = (day: number) =>
    `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Pad so the 1st lands under the right weekday (weeks start Monday).
  const leading = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const cells: DayCell[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => ({ iso: iso(i + 1), day: i + 1 })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const blockedOn = (day: string, roomId: string) =>
    blocks.some((b) => b.room_id === roomId && b.start_date <= day && (b.end_date === null || b.end_date >= day));
  const capacityOn = (day: string, typeId?: string) =>
    rooms.filter((r) => (typeId ? r.room_type_id === typeId : true) && !blockedOn(day, r.id)).length;
  const capacity = rooms.length;

  const bookedOn = (day: string, typeId?: string) =>
    bookings
      .filter(
        (b) =>
          b.check_in <= day &&
          b.check_out > day &&
          (typeId ? b.room_type_id === typeId : true),
      )
      .reduce((sum, b) => sum + b.rooms_count, 0);

  const monthLabel = new Date(year, monthNumber - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Availability</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Sellable rooms free per night: tentative, confirmed and in-house stays count; blocked rooms are excluded.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {month !== thisMonth && (
            <button
              type="button"
              onClick={() => setMonth(thisMonth)}
              className={`${secondaryButtonClass} !py-1.5`}
            >
              Today
            </button>
          )}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={!canGoBack}
              aria-label="Previous month"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-yellow-500 hover:text-yellow-700 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span
              aria-live="polite"
              className="text-sm font-semibold text-slate-900 min-w-[150px] text-center"
            >
              {monthLabel}
            </span>

            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={!canGoForward}
              aria-label="Next month"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-yellow-500 hover:text-yellow-700 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {capacity === 0 ? (
        <p className="px-5 py-10 text-sm text-slate-500 text-center">
          Add rooms to your inventory to see availability.
        </p>
      ) : (
        <>
          <div className="p-3 sm:p-5">
            <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1 sm:mb-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div
                  key={d}
                  className="text-center text-xs text-slate-500 font-semibold py-1"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {cells.map((cell, i) => {
                if (!cell) return <div key={`pad-${i}`} />;

                const booked = bookedOn(cell.iso);
                const dayCapacity = capacityOn(cell.iso);
                const free = dayCapacity - booked;
                const isToday = cell.iso === today;
                const isPast = cell.iso < today;

                const tone =
                  free <= 0
                    ? "bg-rose-50 border-rose-200"
                    : free <= Math.max(1, Math.floor(dayCapacity * 0.2))
                      ? "bg-amber-50 border-amber-200"
                      : "bg-white border-slate-100";

                return (
                  <div
                    key={cell.iso}
                    title={`${cell.iso} — ${Math.max(0, free)} of ${dayCapacity} sellable free${dayCapacity < capacity ? ` (${capacity - dayCapacity} blocked)` : ""}`}
                    className={`rounded-lg border p-1.5 sm:p-2 min-h-[64px] sm:min-h-[80px] flex flex-col transition-colors ${tone} ${
                      isPast ? "opacity-45" : ""
                    } ${isToday ? "ring-2 ring-yellow-500 ring-offset-1" : ""}`}
                  >
                    <span
                      className={`text-[11px] font-medium ${
                        isToday ? "text-yellow-700" : "text-slate-700"
                      }`}
                    >
                      {cell.day}
                    </span>

                    <span className="mt-auto">
                      {free <= 0 ? (
                        <span className="block text-[10px] sm:text-[11px] font-semibold text-rose-700">
                          Full
                        </span>
                      ) : (
                        <span className="block text-sm sm:text-base font-medium text-slate-900 leading-none">
                          {free}
                          <span className="text-[10px] text-slate-500 font-sans ml-0.5">free</span>
                        </span>
                      )}
                      {booked > 0 && (
                        <span className="block text-[9px] text-slate-500 mt-0.5">
                          {booked} booked
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {roomTypes.length > 1 && (
            <div className="px-5 pb-5">
              <p className="text-xs font-medium text-slate-500 mb-2">
                By room type, today
              </p>
              <div className="flex flex-wrap gap-2">
                {roomTypes.map((rt) => {
                  const typeCapacity = capacityOn(today, rt.id);
                  const free = typeCapacity - bookedOn(today, rt.id);
                  return (
                    <span
                      key={rt.id}
                      className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700"
                    >
                      {rt.name}:{" "}
                      <strong className="font-medium text-slate-900">
                        {typeCapacity === 0
                          ? "no rooms"
                          : `${Math.max(0, free)} of ${typeCapacity}`}
                      </strong>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
