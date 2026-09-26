import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import type { BookingGroup } from "../../../lib/types";
import {
  PageHeader,
  Card,
  EmptyState,
  fmtDate,
  buttonClass,
  tableHeadClass,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
} from "../../components/ui";

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePermission("bookings.groups");
  const page = pageParam((await searchParams).page);
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("booking_groups")
    .select("*, companies(name), bookings(id, status, contact_name)", { count: "exact" })
    .order("check_in", { ascending: false })
    .range(...pageRange(page));
  if (outOfRange(error)) redirect(pageHref("/admin/groups", {}, 1));

  type Row = BookingGroup & {
    companies: { name: string } | null;
    bookings: { id: string; status: string; contact_name: string }[];
  };
  const groups = (data ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Groups"
        description="Blocks of rooms under one master booking — weddings, tours, conferences. Guest names are added to the rooming list later."
        action={
          <Link href="/admin/groups/new" className={buttonClass}>
            <span className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New group
            </span>
          </Link>
        }
      />
      <Card>
        {groups.length === 0 ? (
          <EmptyState message="No group bookings yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="px-5 py-3 font-semibold">Group</th>
                <th className="px-5 py-3 font-semibold">Dates</th>
                <th className="px-5 py-3 font-semibold">Rooms</th>
                <th className="px-5 py-3 font-semibold">Rooming list</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => {
                const live = g.bookings.filter((b) => !["cancelled", "no_show"].includes(b.status));
                const named = live.filter((b) => !b.contact_name.startsWith(`${g.name} — room`)).length;
                return (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/admin/groups/${g.id}`} className="font-medium text-slate-900 hover:text-yellow-700">
                        {g.name}
                      </Link>
                      <span className="block text-[11px] text-slate-500">
                        <span className="font-mono">{g.reference}</span>
                        {g.companies ? ` · ${g.companies.name}` : ""}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">
                      {fmtDate(g.check_in)} → {fmtDate(g.check_out)}
                    </td>
                    <td className="px-5 py-3 text-slate-700">{live.length}</td>
                    <td className="px-5 py-3 text-slate-700">
                      {named} of {live.length} named
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} total={count ?? 0} path="/admin/groups" />
      </Card>
    </>
  );
}
