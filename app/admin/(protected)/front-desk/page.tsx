import Link from "next/link";
import { LogIn, LogOut, BedDouble, Search, UserPlus, Bell, Star } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings, hhmm } from "../../../lib/settings";
import { todayIn } from "../../../lib/dates";
import { folioTotals } from "../../../lib/policies";
import type { Booking, FolioEntry, GuestRequest } from "../../../lib/types";
import { REQUEST_KIND_LABELS } from "../../../lib/types";
import { createGuestRequest, updateGuestRequest } from "../../frontdesk-actions";
import {
  PageHeader,
  Card,
  StatusPill,
  Tag,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  inputClass,
  buttonClass,
  secondaryButtonClass,
  Field,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import LiveRefresh from "../../components/LiveRefresh";

type DeskBooking = Booking & { rooms: { id: string; room_number: string } | null };

const SELECT = "*, guests(id, full_name, email, phone), room_types(id, name), rooms(id, room_number)";

export default async function FrontDeskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requirePermission("frontdesk.view");
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const [arrivalsRes, inHouseRes, requestsRes, searchRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(SELECT)
      .in("status", ["tentative", "confirmed"])
      .lte("check_in", today)
      .gt("check_out", today)
      .order("check_in")
      .order("eta", { nullsFirst: false }),
    supabase.from("bookings").select(SELECT).eq("status", "checked_in").order("check_out"),
    supabase
      .from("guest_requests")
      .select("*, rooms(room_number), bookings(contact_name, reference)")
      .eq("status", "open")
      .order("due_at", { nullsFirst: false })
      .order("created_at"),
    q.trim()
      ? (() => {
          // Quick check-in search: confirmation number, name or phone.
          const term = `%${q.trim().replace(/[%,()]/g, "")}%`;
          return supabase
            .from("bookings")
            .select(SELECT)
            .or(`reference.ilike.${term},contact_name.ilike.${term},contact_phone.ilike.${term},contact_email.ilike.${term}`)
            .in("status", ["tentative", "confirmed", "checked_in", "waitlisted"])
            .order("check_in")
            .limit(20);
        })()
      : Promise.resolve({ data: null }),
  ]);

  const arrivals = (arrivalsRes.data ?? []) as DeskBooking[];
  const inHouse = (inHouseRes.data ?? []) as DeskBooking[];
  const departures = inHouse.filter((b) => b.check_out <= today);
  const stayovers = inHouse.filter((b) => b.check_out > today);
  const requests = (requestsRes.data ?? []) as (GuestRequest & {
    rooms: { room_number: string } | null;
    bookings: { contact_name: string; reference: string } | null;
  })[];
  const results = (searchRes.data ?? null) as DeskBooking[] | null;

  const { data: folio } = inHouse.length
    ? await supabase
        .from("folio_entries")
        .select("booking_id, kind, amount, tax_amount, voided_at, is_deposit")
        .in("booking_id", inHouse.map((b) => b.id))
    : { data: [] };
  const balanceOf = (id: string) =>
    folioTotals(((folio ?? []) as FolioEntry[]).filter((e) => e.booking_id === id)).balance;

  const canCheckIn = can(session, "frontdesk.checkin");
  const canCheckOut = can(session, "frontdesk.checkout");

  return (
    <>
      <LiveRefresh tables={["bookings", "rooms", "guest_requests"]} />
      <PageHeader
        title="Front desk"
        description={`Today, ${fmtDate(today)}. Check-in from ${hhmm(settings.check_in_time)}, check-out by ${hhmm(settings.check_out_time)}.`}
        action={
          can(session, "bookings.create") ? (
            <Link href="/admin/bookings/new?walkin=1" className={buttonClass}>
              <span className="flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" /> Walk-in
              </span>
            </Link>
          ) : null
        }
      />

      <form className="flex gap-2 mb-6" action="/admin/front-desk">
        <div className="relative flex-1 max-w-lg">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="Find a guest: confirmation number, name or phone"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button type="submit" className={buttonClass}>
          Find
        </button>
      </form>

      {results && (
        <Card className="mb-6">
          <p className="px-5 py-3 text-xs text-slate-600 border-b border-slate-100">
            {results.length} match(es) for “{q}”
          </p>
          <BookingRows bookings={results} today={today} canCheckIn={canCheckIn} canCheckOut={canCheckOut} />
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Counter icon={<LogIn className="w-4 h-4 text-emerald-600" />} label="To arrive" value={arrivals.length} />
        <Counter icon={<LogOut className="w-4 h-4 text-blue-600" />} label="To depart" value={departures.length} />
        <Counter icon={<BedDouble className="w-4 h-4 text-yellow-700" />} label="In house" value={inHouse.length} />
      </div>

      <div className="space-y-6">
        <Card>
          <Heading icon={<LogIn className="w-4 h-4 text-emerald-600" />} title="Arrivals" count={arrivals.length} />
          {arrivals.length === 0 ? (
            <Empty>No one else is due today.</Empty>
          ) : (
            <BookingRows bookings={arrivals} today={today} canCheckIn={canCheckIn} canCheckOut={canCheckOut} />
          )}
        </Card>

        <Card>
          <Heading icon={<LogOut className="w-4 h-4 text-blue-600" />} title="Departures" count={departures.length} />
          {departures.length === 0 ? (
            <Empty>No departures left today.</Empty>
          ) : (
            <BookingRows
              bookings={departures}
              today={today}
              canCheckIn={canCheckIn}
              canCheckOut={canCheckOut}
              balanceOf={balanceOf}
            />
          )}
        </Card>

        <Card>
          <Heading icon={<BedDouble className="w-4 h-4 text-yellow-700" />} title="Staying on" count={stayovers.length} />
          {stayovers.length === 0 ? (
            <Empty>No stay-over guests.</Empty>
          ) : (
            <BookingRows
              bookings={stayovers}
              today={today}
              canCheckIn={canCheckIn}
              canCheckOut={canCheckOut}
              balanceOf={balanceOf}
            />
          )}
        </Card>

        {can(session, "frontdesk.requests") && (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-4 h-4 text-yellow-700" />
              <h2 className="text-base font-semibold text-slate-900">Guest requests</h2>
              <span className="ml-auto text-xs text-slate-500">{requests.length} open</span>
            </div>

            {requests.length > 0 && (
              <ul className="divide-y divide-slate-100 mb-5 border border-slate-100 rounded-lg">
                {requests.map((r) => {
                  const overdue = r.due_at && new Date(r.due_at) < new Date();
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Tag tone={r.kind === "complaint" ? "red" : r.kind === "wake_up_call" ? "violet" : "gold"}>
                        {REQUEST_KIND_LABELS[r.kind]}
                      </Tag>
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-sm text-slate-900">{r.description}</p>
                        <p className="text-[11px] text-slate-500">
                          {r.rooms?.room_number ? `Room ${r.rooms.room_number} · ` : ""}
                          {r.bookings?.contact_name ?? ""}
                          {r.due_at && (
                            <span className={overdue ? "text-rose-700 font-medium" : ""}>
                              {" "}
                              · due {fmtDateTime(r.due_at)}
                            </span>
                          )}
                        </p>
                      </div>
                      <form action={updateGuestRequest}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value="done" />
                        <button type="submit" className={`${secondaryButtonClass} !py-1.5`}>
                          Done
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}

            <ActionForm action={createGuestRequest} submitLabel="Log request" className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label="For">
                  <select name="booking_id" className={inputClass} defaultValue="">
                    <option value="">No guest (general)</option>
                    {inHouse.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.rooms?.room_number ? `${b.rooms.room_number} · ` : ""}
                        {b.contact_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select name="kind" className={inputClass} defaultValue="request">
                    {Object.entries(REQUEST_KIND_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due date">
                  <input type="date" name="due_date" defaultValue={today} className={inputClass} />
                </Field>
                <Field label="Due time">
                  <input type="time" name="due_time" className={inputClass} />
                </Field>
              </div>
              <Field label="Details">
                <input name="description" required placeholder="Wake-up call, extra towels, message from…" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

function Counter({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon} {label}
      </p>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function Heading({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
      {icon}
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <span className="ml-auto text-xs text-slate-500">{count}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-sm text-slate-500 text-center">{children}</p>;
}

function BookingRows({
  bookings,
  today,
  canCheckIn,
  canCheckOut,
  balanceOf,
}: {
  bookings: DeskBooking[];
  today: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
  balanceOf?: (id: string) => number;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {bookings.map((b) => {
        const balance = balanceOf?.(b.id);
        const arriving = ["tentative", "confirmed"].includes(b.status);
        return (
          <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Link href={`/admin/bookings/${b.id}`} className="flex-1 min-w-[200px] group">
              <p className="text-sm font-medium text-slate-900 group-hover:text-yellow-700 flex items-center gap-1.5">
                {b.is_vip && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" aria-label="VIP" />}
                {b.guests?.full_name || b.contact_name || "Unnamed guest"}
              </p>
              <p className="text-[11px] text-slate-500">
                <span className="font-mono">{b.reference}</span> · {b.room_types?.name ?? "Room"} · {fmtDate(b.check_in)} →{" "}
                {fmtDate(b.check_out)}
                {b.eta ? ` · ETA ${b.eta.slice(0, 5)}` : ""}
                {arriving && b.check_in < today ? " · late arrival" : ""}
              </p>
            </Link>

            <span className={`text-xs whitespace-nowrap ${b.rooms?.room_number ? "text-slate-700" : "text-amber-700"}`}>
              {b.rooms?.room_number ? `Room ${b.rooms.room_number}` : "No room"}
            </span>

            {balance !== undefined && (
              <span className={`text-xs whitespace-nowrap ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {balance > 0 ? `Owes ${fmtMoney(balance)}` : "Settled"}
              </span>
            )}

            <StatusPill status={b.status} />

            {arriving && canCheckIn && b.check_in <= today && (
              <Link href={`/admin/bookings/${b.id}/check-in`} className={`${buttonClass} !py-1.5`}>
                Check in
              </Link>
            )}
            {b.status === "checked_in" && canCheckOut && (
              <Link href={`/admin/bookings/${b.id}/check-out`} className={`${secondaryButtonClass} !py-1.5`}>
                Check out
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
