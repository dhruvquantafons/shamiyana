import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { addDays, isIsoDate, todayIn } from "../../../lib/dates";
import type { Booking, BookingStatus, Room, RoomBlock, RoomType } from "../../../lib/types";
import { BOOKING_STATUS_LABELS } from "../../../lib/types";
import { PageHeader, Card, secondaryButtonClass } from "../../components/ui";
import LiveRefresh from "../../components/LiveRefresh";
import TapeChart from "../../components/TapeChart";

const SPANS = [7, 14, 30] as const;

const BAR: Record<BookingStatus, string> = {
  tentative: "bg-amber-100 border-amber-300 text-amber-900",
  confirmed: "bg-emerald-100 border-emerald-300 text-emerald-900",
  checked_in: "bg-blue-100 border-blue-300 text-blue-900",
  checked_out: "bg-slate-100 border-slate-300 text-slate-600",
  cancelled: "bg-rose-50 border-rose-200 text-rose-700",
  no_show: "bg-orange-50 border-orange-200 text-orange-800",
  waitlisted: "bg-violet-50 border-violet-200 text-violet-800",
};

export default async function TapeChartPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; days?: string }>;
}) {
  const session = await requireAnyPermission(["bookings.view", "frontdesk.view"]);
  const params = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const days = SPANS.find((s) => String(s) === params.days) ?? 14;
  const start = params.start && isIsoDate(params.start) ? params.start : addDays(today, -1);
  const end = addDays(start, days);
  const canCreate = can(session, "bookings.create");

  const [{ data: rooms }, { data: types }, { data: bookings }, { data: blocks }] = await Promise.all([
    supabase.from("rooms").select("*").order("room_number"),
    supabase.from("room_types").select("*").order("sort_order"),
    supabase
      .from("bookings")
      .select("id, reference, contact_name, check_in, check_out, status, room_id, room_type_id, rooms_count, is_vip")
      .in("status", ["tentative", "confirmed", "checked_in", "checked_out"])
      .lt("check_in", end)
      .gt("check_out", start),
    supabase.from("room_blocks").select("*").is("released_at", null).lt("start_date", end),
  ]);

  const roomList = (rooms ?? []) as Room[];
  const typeList = (types ?? []) as RoomType[];
  const stays = (bookings ?? []) as Booking[];
  const blockList = ((blocks ?? []) as RoomBlock[]).filter((b) => b.end_date === null || b.end_date >= start);

  const link = (s: string, d: number = days) => `/admin/tape-chart?start=${s}&days=${d}`;

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Tape chart"
        description="Every room and every stay. Click a stay to open it, or an empty day to book from that date."
        action={
          <div className="flex items-center gap-2">
            <Link href={link(addDays(start, -days))} className={`${secondaryButtonClass} !px-2`} aria-label="Earlier">
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <Link href={link(addDays(today, -1))} className={secondaryButtonClass}>
              Today
            </Link>
            <Link href={link(addDays(start, days))} className={`${secondaryButtonClass} !px-2`} aria-label="Later">
              <ChevronRight className="w-4 h-4" />
            </Link>
            {SPANS.map((s) => (
              <Link
                key={s}
                href={link(start, s)}
                className={`text-xs px-2.5 py-1.5 rounded-full border ${
                  s === days ? "bg-yellow-400 text-slate-900 border-yellow-500" : "bg-white border-slate-200 text-slate-700"
                }`}
              >
                {s}d
              </Link>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4 text-[11px]">
        {(["tentative", "confirmed", "checked_in", "checked_out"] as BookingStatus[]).map((s) => (
          <span key={s} className={`px-2 py-0.5 rounded border ${BAR[s]}`}>
            {BOOKING_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="px-2 py-0.5 rounded border bg-[repeating-linear-gradient(45deg,#e7e5e4,#e7e5e4_4px,#f5f5f4_4px,#f5f5f4_8px)] border-stone-300 text-stone-700">
          Blocked
        </span>
      </div>

      <Card className="overflow-x-auto">
        <TapeChart
          rooms={roomList}
          roomTypes={typeList}
          bookings={stays}
          blocks={blockList}
          start={start}
          days={days}
          today={today}
          canCreate={canCreate}
        />
      </Card>
    </>
  );
}
