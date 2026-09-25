import Link from "next/link";
import { AlertTriangle, LogIn, LogOut } from "lucide-react";
import { createClient } from "../../lib/supabase/server";
import { requireSession } from "../../lib/auth";
import { can } from "../../lib/permissions";
import { getSettings } from "../../lib/settings";
import type { Booking, Room } from "../../lib/types";
import { OCCUPYING_STATUSES, roomBoardLabel } from "../../lib/types";
import { todayIn, minutesSince, addDays } from "../../lib/dates";
import { kpisFrom, reportByKind, resolveRange, type DailyRow } from "../../lib/reports";
import { runReport } from "../../lib/report-data";
import LiveRefresh from "../components/LiveRefresh";
import { PageHeader, Card, StatCard, StatusPill, fmtDate, fmtMoney } from "../components/ui";
import TapeChart, { TapeChartLegend } from "../components/TapeChart";

const BOARD_TONE: Record<string, string> = {
  "Vacant Clean": "bg-emerald-500",
  "Vacant Dirty": "bg-amber-500",
  Occupied: "bg-blue-500",
  "Out of Order": "bg-rose-500",
  "Out of Service": "bg-slate-400",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requireSession();
  const { denied } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const seesBookings = can(session, "bookings.view") || can(session, "frontdesk.view");
  const seesRevenue = can(session, "reports.financial");
  const canCreate = can(session, "bookings.create");

  const tapeStart = addDays(today, -1);
  const tapeDays = 14;
  const tapeEnd = addDays(tapeStart, tapeDays);

  const todayKpis = seesRevenue
    ? kpisFrom(
        ((await runReport(supabase, reportByKind("daily_revenue")!, resolveRange("today", today))).rows ??
          []) as unknown as DailyRow[],
        Number(settings.monthly_operating_cost),
      )
    : null;

  const [
    tentative,
    waitlisted,
    arrivals,
    departures,
    inHouse,
    occupied,
    rooms,
    unassigned,
    openRequests,
    hkOpen,
    mtOpen,
    leavePending,
    tapeRooms,
    tapeTypes,
    tapeBookings,
    tapeBlocks,
  ] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "tentative"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "waitlisted"),
    supabase
      .from("bookings")
      .select("*, guests(id, full_name), rooms(id, room_number)")
      .eq("check_in", today)
      .in("status", ["tentative", "confirmed"])
      .order("created_at"),
    supabase
      .from("bookings")
      .select("*, guests(id, full_name), rooms(id, room_number)")
      .eq("check_out", today)
      .eq("status", "checked_in")
      .order("created_at"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "checked_in"),
    supabase
      .from("bookings")
      .select("rooms_count")
      .lte("check_in", today)
      .gt("check_out", today)
      .in("status", OCCUPYING_STATUSES),
    supabase.from("rooms").select("id, status, housekeeping_status"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .is("room_id", null)
      .lte("check_in", today)
      .in("status", ["confirmed", "checked_in"]),
    supabase.from("guest_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("housekeeping_tasks")
      .select("status, started_at, target_minutes")
      .lte("task_date", today)
      .in("status", ["in_progress", "cleaned"]),
    supabase
      .from("maintenance_tickets")
      .select("priority, due_at, assigned_to")
      .in("status", ["open", "in_progress", "on_hold"]),
    supabase.from("leave_requests").select("staff_id").eq("status", "pending").neq("staff_id", session.staff.id),
    supabase.from("rooms").select("*").order("room_number"),
    supabase.from("room_types").select("*").order("sort_order"),
    supabase
      .from("bookings")
      .select("id, reference, contact_name, check_in, check_out, status, room_id, room_type_id, rooms_count, is_vip")
      .in("status", ["tentative", "confirmed", "checked_in", "checked_out"])
      .lt("check_in", tapeEnd)
      .gt("check_out", tapeStart),
    supabase.from("room_blocks").select("*").is("released_at", null).lt("start_date", tapeEnd),
  ]);

  const arrivalList = (arrivals.data ?? []) as Booking[];
  const departureList = (departures.data ?? []) as Booking[];
  const roomList = (rooms.data ?? []) as Pick<Room, "id" | "status" | "housekeeping_status">[];
  const sellable = roomList.filter((r) => r.status !== "out_of_service" && r.status !== "out_of_order").length;
  const committed = (occupied.data ?? []).reduce((s, b) => s + Number((b as { rooms_count: number }).rooms_count), 0);
  const occupancy = sellable > 0 ? Math.round((committed / sellable) * 100) : null;
  const statusCounts = roomList.reduce<Record<string, number>>((acc, r) => {
    const label = roomBoardLabel(r);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  const alerts: { text: string; href: string }[] = [];
  if (settings.business_date < today && can(session, "frontdesk.night_audit")) {
    alerts.push({ text: `Night audit has not closed ${fmtDate(settings.business_date)}.`, href: "/admin/night-audit" });
  }
  if ((unassigned.count ?? 0) > 0) {
    alerts.push({ text: `${unassigned.count} arriving or in-house booking(s) have no room assigned.`, href: "/admin/front-desk" });
  }
  if ((tentative.count ?? 0) > 0) {
    alerts.push({ text: `${tentative.count} tentative booking(s) waiting to be confirmed.`, href: "/admin/bookings?status=tentative" });
  }
  if ((waitlisted.count ?? 0) > 0) {
    alerts.push({ text: `${waitlisted.count} guest(s) on the waitlist.`, href: "/admin/bookings?status=waitlisted" });
  }
  const hkTasks = (hkOpen.data ?? []) as { status: string; started_at: string | null; target_minutes: number }[];
  const toInspect = hkTasks.filter((t) => t.status === "cleaned").length;
  const overdue = hkTasks.filter(
    (t) => t.status === "in_progress" && t.started_at && minutesSince(t.started_at) > t.target_minutes,
  ).length;
  if (overdue > 0 && can(session, "housekeeping.assign")) {
    alerts.push({ text: `${overdue} room clean(s) over the turnaround target.`, href: "/admin/housekeeping" });
  }
  if (toInspect > 0 && can(session, "housekeeping.inspect")) {
    alerts.push({ text: `${toInspect} room(s) waiting for inspection.`, href: "/admin/housekeeping" });
  }
  if ((openRequests.count ?? 0) > 0) {
    alerts.push({ text: `${openRequests.count} open guest request(s).`, href: "/admin/front-desk" });
  }
  if (can(session, "guests.view")) {
    const { data: inHouseGuests } = await supabase
      .from("bookings")
      .select("guests(date_of_birth, anniversary)")
      .eq("status", "checked_in")
      .not("guest_id", "is", null);
    const md = today.slice(5);
    const celebrating = (inHouseGuests ?? []).filter((b) => {
      const g = b.guests as unknown as { date_of_birth: string | null; anniversary: string | null } | null;
      return g?.date_of_birth?.slice(5) === md || g?.anniversary?.slice(5) === md;
    }).length;
    if (celebrating) {
      alerts.push({ text: `${celebrating} in-house guest(s) celebrating a birthday or anniversary today.`, href: "/admin/guests/occasions" });
    }
  }
  const tickets = (mtOpen.data ?? []) as { priority: string; due_at: string; assigned_to: string | null }[];
  if (can(session, "maintenance.manage") || can(session, "maintenance.work")) {
    const urgent = tickets.filter((t) => t.priority === "urgent").length;
    const late = tickets.filter((t) => minutesSince(t.due_at) > 0).length;
    const mine = tickets.filter((t) => t.assigned_to === session.staff.id).length;
    if (urgent) alerts.push({ text: `${urgent} urgent maintenance ticket(s) open.`, href: "/admin/maintenance?priority=urgent" });
    if (late) alerts.push({ text: `${late} maintenance ticket(s) past their resolution target.`, href: "/admin/maintenance" });
    if (mine && !can(session, "maintenance.manage")) {
      alerts.push({ text: `${mine} maintenance ticket(s) assigned to you.`, href: "/admin/maintenance/mine" });
    }
  }
  if (can(session, "hr.approve_leave") && leavePending.data?.length) {
    alerts.push({ text: `${leavePending.data.length} leave request(s) waiting for approval.`, href: "/admin/hr/leave" });
  }

  return (
    <>
      <LiveRefresh tables={["bookings", "rooms", "guest_requests", "maintenance_tickets"]} />
      <PageHeader
        title={`Good day, ${session.staff.full_name.split(" ")[0] || "there"}`}
        description={`${fmtDate(today)} · business date ${fmtDate(settings.business_date)}`}
      />

      {denied && (
        <div className="mb-6 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3.5 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Your role does not include that section.
        </div>
      )}

      {alerts.length > 0 && (
        <Card className="mb-6 divide-y divide-slate-100">
          {alerts.map((a) => (
            <Link key={a.text} href={a.href} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              {a.text}
            </Link>
          ))}
        </Card>
      )}

      {seesBookings && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Arriving today" value={arrivalList.length} href="/admin/front-desk" />
            <StatCard label="Departing today" value={departureList.length} href="/admin/front-desk" />
            <StatCard label="In house" value={inHouse.count ?? 0} href="/admin/front-desk" />
            <StatCard
              label="Occupancy tonight"
              value={occupancy === null ? "—" : `${occupancy}%`}
              hint={sellable ? `${committed} of ${sellable} rooms` : "Add rooms to inventory"}
              href="/admin/rooms"
            />
          </div>

          {todayKpis && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="ADR today"
                value={fmtMoney(todayKpis.adr)}
                hint="Room revenue ÷ rooms sold"
                href="/admin/reports"
              />
              <StatCard
                label="RevPAR today"
                value={fmtMoney(todayKpis.revpar)}
                hint="Room revenue ÷ rooms available"
                href="/admin/reports"
              />
              <StatCard
                label="Revenue today"
                value={fmtMoney(todayKpis.totalRevenue)}
                hint="Including tax"
                href="/admin/reports/financial"
              />
              <StatCard
                label="GOPPAR today"
                value={todayKpis.goppar === null ? "—" : fmtMoney(todayKpis.goppar)}
                hint={todayKpis.goppar === null ? "Set a monthly operating cost" : "After operating cost"}
                href="/admin/reports"
              />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <MovementList title="Arrivals" icon={<LogIn className="w-4 h-4 text-emerald-600" />} bookings={arrivalList} empty="No arrivals today." />
            <MovementList title="Departures" icon={<LogOut className="w-4 h-4 text-blue-600" />} bookings={departureList} empty="No departures today." />
          </div>

          {(tapeRooms.data?.length ?? 0) > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Tape chart</h2>
                <Link href="/admin/tape-chart" className="text-sm text-yellow-800 hover:text-yellow-900">
                  Full tape chart →
                </Link>
              </div>
              <TapeChartLegend />
              <Card className="overflow-x-auto">
                <TapeChart
                  rooms={tapeRooms.data ?? []}
                  roomTypes={tapeTypes.data ?? []}
                  bookings={(tapeBookings.data ?? []) as unknown as Booking[]}
                  blocks={tapeBlocks.data ?? []}
                  start={tapeStart}
                  days={tapeDays}
                  today={today}
                  canCreate={canCreate}
                />
              </Card>
            </div>
          )}
        </>
      )}

      {roomList.length > 0 && (
        <Card className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Room status</h2>
            <Link href="/admin/rooms" className="text-sm text-yellow-800 hover:text-yellow-900">
              Room board →
            </Link>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {Object.keys(BOARD_TONE).map((label) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${BOARD_TONE[label]}`} />
                <span className="text-sm text-slate-600">{label}</span>
                <span className="text-sm font-semibold text-slate-900">{statusCounts[label] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function MovementList({
  title,
  icon,
  bookings,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  bookings: Booking[];
  empty: string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        {icon}
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="ml-auto text-xs text-slate-500">{bookings.length}</span>
      </div>
      {bookings.length === 0 ? (
        <p className="px-4 py-8 text-sm text-slate-500 text-center">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link href={`/admin/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-900 truncate">
                    {b.guests?.full_name || b.contact_name || "Unnamed guest"}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {b.adults + b.children} guest(s) · {b.rooms_count} room(s)
                  </span>
                </span>
                <span className={`text-xs ${b.rooms?.room_number ? "text-slate-600" : "text-amber-700"}`}>
                  {b.rooms?.room_number ?? "No room"}
                </span>
                <StatusPill status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
