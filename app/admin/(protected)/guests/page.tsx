import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import type { Guest, GuestStats, GuestTag } from "../../../lib/types";
import { GUEST_TAGS, guestTags } from "../../../lib/types";
import {
  Card,
  EmptyState,
  inputClass,
  buttonClass,
  tableHeadClass,
  fmtDate,
  fmtMoney,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
} from "../../components/ui";
import { GuestTags } from "./shared";

export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; page?: string }> }) {
  const session = await requirePermission("guests.view");
  const seesSpend = can(session, "folio.view");
  const { q = "", tag, page: pageRaw } = await searchParams;
  const page = pageParam(pageRaw);
  const activeTag = (GUEST_TAGS as readonly string[]).includes(tag ?? "") ? (tag as GuestTag) : null;
  const supabase = await createClient();

  let query = supabase
    .from("guests")
    .select("id, full_name, email, phone, tags, company_id, erased_at, nationality, updated_at", { count: "exact" })
    .is("erased_at", null)
    .order("updated_at", { ascending: false })
    .range(...pageRange(page));
  const term = q.replace(/[%,()]/g, "").trim();
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  if (activeTag === "VIP" || activeTag === "Blacklisted") query = query.contains("tags", [activeTag]);
  if (activeTag === "Corporate") query = query.not("company_id", "is", null);
  if (activeTag === "Repeat Guest") {
    const { data: repeat } = await supabase.from("guest_stats").select("guest_id").gte("stays", 2).limit(1000);
    query = query.in("id", (repeat ?? []).map((r) => r.guest_id));
  }

  const { data, error, count } = await query;
  const listParams = { q: term, tag: activeTag };
  if (outOfRange(error)) redirect(pageHref("/admin/guests", listParams, 1));
  const guests = (data ?? []) as Pick<Guest, "id" | "full_name" | "email" | "phone" | "tags" | "company_id" | "nationality">[];
  const { data: statRows } = guests.length
    ? await supabase.from("guest_stats").select("*").in("guest_id", guests.map((g) => g.id))
    : { data: [] };
  const stats = new Map(((statRows ?? []) as GuestStats[]).map((s) => [s.guest_id, s]));
  const href = (t: string | null) => {
    const p = new URLSearchParams();
    if (term) p.set("q", term);
    if (t) p.set("tag", t);
    return `/admin/guests${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form className="flex gap-2" action="/admin/guests">
          <input name="q" defaultValue={term} placeholder="Name, email or phone" className={`${inputClass} w-64`} />
          {activeTag && <input type="hidden" name="tag" value={activeTag} />}
          <button className={buttonClass}>Search</button>
        </form>
        <div className="flex flex-wrap gap-1">
          {[null, ...GUEST_TAGS].map((t) => (
            <Link
              key={t ?? "all"}
              href={href(t)}
              className={`text-xs px-2.5 py-1 rounded-md border ${t === activeTag ? "bg-yellow-50 border-yellow-300 text-yellow-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {t ?? "All"}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        {guests.length === 0 ? (
          <EmptyState message={term || activeTag ? "No guests match." : "Guests appear here once they book."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2.5 font-medium">Guest</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Stays</th>
                  <th className="px-4 py-2.5 font-medium">Last stay</th>
                  <th className="px-4 py-2.5 font-medium">Next arrival</th>
                  {seesSpend && <th className="px-4 py-2.5 font-medium">Spend</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guests.map((g) => {
                  const s = stats.get(g.id);
                  return (
                    <tr key={g.id}>
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/guests/${g.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                          {g.full_name}
                        </Link>
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          <GuestTags tags={guestTags(g, s)} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {g.email}
                        {g.phone && <span className="block">{g.phone}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {s?.stays ?? 0}
                        {s && s.nights > 0 && <span className="text-xs text-slate-500"> · {s.nights} nights</span>}
                      </td>
                      <td className="px-4 py-2.5">{s?.last_stay ? fmtDate(s.last_stay) : "—"}</td>
                      <td className="px-4 py-2.5">{s?.next_arrival ? fmtDate(s.next_arrival) : "—"}</td>
                      {seesSpend && <td className="px-4 py-2.5">{s?.total_spend ? fmtMoney(s.total_spend) : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={count ?? 0} path="/admin/guests" params={listParams} />
      </Card>
    </div>
  );
}
