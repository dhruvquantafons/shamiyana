import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import type { Booking, BookingStatus } from "../../../lib/types";
import { BOOKING_STATUS_LABELS, BOOKING_SOURCE_LABELS } from "../../../lib/types";
import {
  PageHeader,
  Card,
  StatusPill,
  EmptyState,
  fmtDate,
  fmtMoney,
  inputClass,
  buttonClass,
  nightsBetween,
} from "../../components/ui";

/** Statuses where a room should already be assigned. */
const NEEDS_ROOM: BookingStatus[] = ["confirmed", "checked_in"];

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[]).map((s) => ({
    value: s,
    label: BOOKING_STATUS_LABELS[s],
  })),
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await requirePermission("bookings.view");
  const { status = "all", q = "" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select("*, guests(id, full_name, email, phone), room_types(id, name), rooms(id, room_number), rate_plans(id, code, name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status !== "all") query = query.eq("status", status);

  if (q) {
    // Commas and parentheses would break PostgREST's or() syntax.
    const term = `%${q.replace(/[%,()]/g, "")}%`;
    const clauses = [
      `reference.ilike.${term}`,
      `contact_name.ilike.${term}`,
      `contact_email.ilike.${term}`,
      `contact_phone.ilike.${term}`,
    ];

    // Room number lives on the joined rooms table, which .or() cannot reach,
    // so resolve matching rooms first and match on their ids. Lets the desk
    // search "203" to find who is in that room.
    const { data: matchedRooms } = await supabase
      .from("rooms")
      .select("id")
      .ilike("room_number", term);

    const roomIds = (matchedRooms ?? []).map((r) => r.id);
    if (roomIds.length > 0) clauses.push(`room_id.in.(${roomIds.join(",")})`);

    query = query.or(clauses.join(","));
  }

  const { data, error } = await query;
  const bookings = (data ?? []) as Booking[];

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every reservation request and confirmed stay."
        action={
          can(session, "bookings.create") ? (
            <Link href="/admin/bookings/new" className={buttonClass}>
              <span className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> New booking
              </span>
            </Link>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => {
          const params = new URLSearchParams();
          if (f.value !== "all") params.set("status", f.value);
          if (q) params.set("q", q);
          const href = `/admin/bookings${params.toString() ? `?${params}` : ""}`;
          const active = status === f.value;
          return (
            <Link
              key={f.value}
              href={href}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                active
                  ? "bg-yellow-400 text-slate-900 border-yellow-500 font-medium"
                  : "bg-white text-slate-700 border-slate-200 hover:border-yellow-500"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Search */}
      <form className="flex gap-2 mb-5" action="/admin/bookings">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Reference, name, email, phone or room number"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button type="submit" className={buttonClass}>
          Search
        </button>
      </form>

      <Card>
        {error ? (
          <EmptyState message={`Could not load bookings: ${error.message}`} />
        ) : bookings.length === 0 ? (
          <EmptyState message="No bookings match this view." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                  <th className="px-5 py-3 font-semibold">Guest</th>
                  <th className="px-5 py-3 font-semibold">Stay</th>
                  <th className="px-5 py-3 font-semibold">Room</th>
                  <th className="px-5 py-3 font-semibold">Room No.</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Total</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/admin/bookings/${b.id}`} className="block">
                        <span className="font-medium text-slate-900">
                          {b.guests?.full_name || b.contact_name || "Unnamed guest"}
                        </span>
                        <span className="block text-[11px] text-slate-500 font-mono">
                          {b.reference}
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-700">
                      {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                      <span className="block text-[11px] text-slate-500">
                        {nightsBetween(b.check_in, b.check_out)} night(s), {b.adults + b.children} guest(s)
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {b.rooms_count > 1 ? `${b.rooms_count} × ` : ""}
                      {b.room_types?.name ?? "—"}
                      {b.rate_plans && <span className="block text-[11px] text-slate-500">{b.rate_plans.code}</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {b.rooms?.room_number ? (
                        <span className="inline-block px-2.5 py-1 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-800 font-medium text-xs">
                          {b.rooms.room_number}
                        </span>
                      ) : NEEDS_ROOM.includes(b.status) ? (
                        <span className="text-xs text-amber-700">Unassigned</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {BOOKING_SOURCE_LABELS[b.source]}
                    </td>
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {fmtMoney(b.total_amount)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
