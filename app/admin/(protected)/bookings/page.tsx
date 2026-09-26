import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
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
  buttonClass,
  nightsBetween,
  tableHeadClass,
  tableRowClass,
  Avatar,
  SearchInput,
  FilterChips,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
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
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const session = await requirePermission("bookings.view");
  const { status = "all", q = "", page: pageRaw } = await searchParams;
  const page = pageParam(pageRaw);
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select("*, guests(id, full_name, email, phone), room_types(id, name), rooms(id, room_number), rate_plans(id, code, name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));

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

  const { data, error, count } = await query;
  const listParams = { status: status !== "all" ? status : null, q };
  if (outOfRange(error)) redirect(pageHref("/admin/bookings", listParams, 1));
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <FilterChips path="/admin/bookings" param="status" options={FILTERS} current={status} params={{ q }} label="Status" />
          <SearchInput
            action="/admin/bookings"
            defaultValue={q}
            placeholder="Reference, name, email, phone or room number"
            keep={{ status: status !== "all" ? status : null }}
            className="w-full sm:w-96"
          />
        </div>
        {error ? (
          <EmptyState message={`Could not load bookings: ${error.message}`} />
        ) : bookings.length === 0 ? (
          <EmptyState message="No bookings match this view." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-5 py-3 font-medium">Guest</th>
                  <th className="px-5 py-3 font-medium">Stay</th>
                  <th className="px-5 py-3 font-medium">Room</th>
                  <th className="px-5 py-3 font-medium">Room No.</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((b) => (
                  <tr key={b.id} className={tableRowClass}>
                    <td className="px-5 py-3.5">
                      <Link href={`/admin/bookings/${b.id}`} className="flex items-center gap-3">
                        <Avatar name={b.guests?.full_name || b.contact_name} />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">
                            {b.guests?.full_name || b.contact_name || "Unnamed guest"}
                          </span>
                          <span className="block text-[11px] text-slate-500 font-mono">
                            {b.reference}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-slate-700">
                      {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                      <span className="block text-[11px] text-slate-500">
                        {nightsBetween(b.check_in, b.check_out)} night(s), {b.adults + b.children} guest(s)
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-700">
                      {b.rooms_count > 1 ? `${b.rooms_count} × ` : ""}
                      {b.room_types?.name ?? "—"}
                      {b.rate_plans && <span className="block text-[11px] text-slate-500">{b.rate_plans.code}</span>}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {b.rooms?.room_number ? (
                        <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium text-xs tabular-nums">
                          {b.rooms.room_number}
                        </span>
                      ) : NEEDS_ROOM.includes(b.status) ? (
                        <span className="text-xs text-amber-700">Unassigned</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 whitespace-nowrap">
                      {BOOKING_SOURCE_LABELS[b.source]}
                    </td>
                    <td className="px-5 py-3.5 text-slate-900 font-medium whitespace-nowrap tabular-nums">
                      {fmtMoney(b.total_amount)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={count ?? 0} path="/admin/bookings" params={listParams} />
      </Card>
    </>
  );
}
