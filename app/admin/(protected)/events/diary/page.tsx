import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requireAnyPermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import {
  dayOfWeek,
  daysInMonth,
  monthEndOf,
  monthStartOf,
  shiftMonth,
  todayIn,
  addDays,
} from "../../../../lib/dates";
import { billablePax, clientName, hhmm, holdsTheSpace } from "../../../../lib/events";
import type { EventBooking, EventSpace, EventStatus } from "../../../../lib/types";
import { EVENT_STATUS_LABELS } from "../../../../lib/types";
import { Card, EmptyState, SectionTitle, StatCard, Tag, fmtMoney } from "../../../components/ui";

/**
 * The availability calendar (SOW Module 10).
 *
 * Only a confirmed function holds the hall, so the diary has to show two
 * different things at once: what is actually happening, and what is still
 * being chased for the same date. A day with three enquiries and no booking
 * is the most valuable day on this page, and it would look empty if only
 * confirmed business were drawn.
 */

const STATUS_STYLE: Record<EventStatus, string> = {
  enquiry: "bg-slate-100 text-slate-700 border-slate-200",
  quoted: "bg-amber-50 text-amber-800 border-amber-200",
  confirmed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  completed: "bg-blue-50 text-blue-800 border-blue-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200 line-through",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function EventsDiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; space?: string }>;
}) {
  await requireAnyPermission(["events.view", "events.book"]);
  const { month: monthParam, space: spaceParam } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const month = /^\d{4}-\d{2}/.test(monthParam ?? "") ? monthStartOf(`${monthParam}-01`) : monthStartOf(today);
  const monthEnd = monthEndOf(month);

  const { data: spaceRows } = await supabase
    .from("event_spaces")
    .select("*")
    .order("sort_order");
  const spaces = (spaceRows ?? []) as EventSpace[];
  const spaceId = spaces.some((s) => s.id === spaceParam) ? spaceParam! : (spaces[0]?.id ?? "");

  const query = supabase
    .from("event_bookings")
    .select("*, event_layouts(name, capacity), companies(name), guests(full_name)")
    .gte("event_date", month)
    .lte("event_date", monthEnd)
    .order("event_date")
    .order("setup_from");
  const { data: eventRows } = spaceId ? await query.eq("space_id", spaceId) : await query;
  const events = (eventRows ?? []) as EventBooking[];

  const byDay = new Map<string, EventBooking[]>();
  for (const e of events) {
    const list = byDay.get(e.event_date);
    if (list) list.push(e);
    else byDay.set(e.event_date, [e]);
  }

  // A Monday-first grid, padded so the first of the month lands on its weekday.
  const days = daysInMonth(month);
  const lead = (dayOfWeek(month) + 6) % 7;
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => addDays(month, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const held = events.filter(holdsTheSpace);
  const heldDays = new Set(held.map((e) => e.event_date));
  const chasing = events.filter((e) => e.status === "enquiry" || e.status === "quoted");
  const monthValue = held.reduce((s, e) => s + Number(e.grand_total), 0);
  const monthName = new Date(`${month}T00:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const href = (m: string) => `/admin/events/diary?month=${m.slice(0, 7)}${spaceId ? `&space=${spaceId}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Days let" value={heldDays.size} hint={`of ${days} in ${monthName}`} />
        <StatCard label="Functions held" value={held.length} hint="Confirmed and completed" />
        <StatCard label="Still being chased" value={chasing.length} hint="Enquiries and quotations" />
        <StatCard label="Confirmed value" value={fmtMoney(monthValue)} hint="Including tax" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href={href(shiftMonth(month, -1))}
              aria-label="Previous month"
              className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <p className="text-sm font-medium text-slate-900 min-w-[9rem] text-center">{monthName}</p>
            <Link
              href={href(shiftMonth(month, 1))}
              aria-label="Next month"
              className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link href={href(todayIn(settings.timezone))} className="ml-1 text-[11px] text-yellow-700 hover:underline">
              This month
            </Link>
          </div>

          {spaces.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {spaces.map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/events/diary?month=${month.slice(0, 7)}&space=${s.id}`}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    s.id === spaceId
                      ? "border-yellow-500 bg-yellow-50 text-yellow-800"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {s.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </Card>

      {spaces.length === 0 ? (
        <EmptyState message="No event space has been set up yet." />
      ) : (
        <Card className="p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {WEEKDAYS.map((d) => (
              <p key={d} className="text-[11px] font-medium text-slate-400 text-center pb-1">
                {d}
              </p>
            ))}

            {cells.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="min-h-[5rem]" />;
              const dayEvents = byDay.get(day) ?? [];
              const isToday = day === today;
              const isHeld = heldDays.has(day);
              return (
                <div
                  key={day}
                  className={`min-h-[5rem] rounded-lg border p-1.5 ${
                    isToday
                      ? "border-yellow-400 bg-yellow-50/40"
                      : isHeld
                        ? "border-emerald-200 bg-emerald-50/30"
                        : "border-slate-200"
                  }`}
                >
                  <p className={`text-[11px] mb-1 ${isToday ? "font-semibold text-yellow-800" : "text-slate-500"}`}>
                    {Number(day.slice(8, 10))}
                  </p>
                  <div className="space-y-1">
                    {dayEvents.map((e) => (
                      <Link
                        key={e.id}
                        href={`/admin/events/${e.id}`}
                        title={`${e.number} · ${e.title} · ${clientName(e)} · ${hhmm(e.start_time)}–${hhmm(e.end_time)} · ${billablePax(e)} covers`}
                        className={`block rounded border px-1.5 py-1 text-[10px] leading-tight hover:brightness-95 ${STATUS_STYLE[e.status]}`}
                      >
                        <span className="block truncate font-medium">{e.title}</span>
                        <span className="block truncate">
                          {hhmm(e.start_time)} · {billablePax(e)} pax
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            {(Object.keys(STATUS_STYLE) as EventStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded border ${STATUS_STYLE[s]}`} />
                {EVENT_STATUS_LABELS[s]}
              </span>
            ))}
          </div>
        </Card>
      )}

      {chasing.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Days with business still to win</SectionTitle>
          <p className="text-[11px] text-slate-500 -mt-2 mb-3">
            The hall is not held until a function is confirmed, so more than one enquiry can sit on the same date.
            These are the ones worth a telephone call.
          </p>
          <ul className="space-y-2">
            {chasing.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Tag tone={e.status === "quoted" ? "amber" : "neutral"}>{EVENT_STATUS_LABELS[e.status]}</Tag>
                <Link href={`/admin/events/${e.id}`} className="font-mono text-yellow-700 hover:underline">
                  {e.number}
                </Link>
                <span className="text-slate-700">{e.title}</span>
                <span className="text-slate-500">
                  {e.event_date} · {hhmm(e.start_time)}–{hhmm(e.end_time)} · {clientName(e)}
                </span>
                <span className="ml-auto font-medium text-slate-700">{fmtMoney(e.grand_total)}</span>
                {heldDays.has(e.event_date) && (
                  <span className="text-[11px] text-rose-700">The hall is already held that day</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
