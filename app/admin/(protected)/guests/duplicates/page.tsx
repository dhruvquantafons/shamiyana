import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import type { Guest } from "../../../../lib/types";
import { mergeGuests } from "../../../guest-actions";
import { Card, EmptyState, secondaryButtonClass, fmtDateTime } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { phoneKey } from "../shared";

type Row = Pick<Guest, "id" | "full_name" | "email" | "phone" | "created_at">;

/**
 * Profiles that share an email, a phone number (ignoring spaces and the
 * country code) or an identical name. Each group can be merged into one.
 */
export default async function DuplicatesPage() {
  await requirePermission("guests.privacy");
  const supabase = await createClient();
  const { data } = await supabase
    .from("guests")
    .select("id, full_name, email, phone, created_at")
    .is("erased_at", null)
    .order("created_at")
    .limit(10000);
  const guests = (data ?? []) as Row[];

  // Union-find over the three keys, so a chain of matches forms one group.
  const parent = new Map(guests.map((g) => [g.id, g.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  const join = (a: string, b: string) => parent.set(find(b), find(a));
  const seen = new Map<string, string>();
  for (const g of guests) {
    const keys = [
      g.email && `e:${g.email.toLowerCase()}`,
      phoneKey(g.phone).length >= 7 && `p:${phoneKey(g.phone)}`,
      `n:${g.full_name.trim().toLowerCase().replace(/\s+/g, " ")}`,
    ].filter(Boolean) as string[];
    for (const k of keys) {
      const other = seen.get(k);
      if (other) join(other, g.id);
      else seen.set(k, g.id);
    }
  }
  const byRoot = new Map<string, Row[]>();
  for (const g of guests) byRoot.set(find(g.id), [...(byRoot.get(find(g.id)) ?? []), g]);
  const groups = [...byRoot.values()].filter((g) => g.length > 1);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-3xl">
        Profiles sharing an email, phone number or exact name. Merging keeps the chosen profile, moves the other&rsquo;s stays,
        ID and feedback onto it, fills its blank fields, and deletes the duplicate. Check they really are the same person
        first — two guests can share a name.
      </p>
      {groups.length === 0 ? (
        <Card>
          <EmptyState message="No likely duplicates." />
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group[0].id} className="p-4">
            <ul className="divide-y divide-slate-100 mb-3">
              {group.map((g) => (
                <li key={g.id} className="py-2 text-sm flex flex-wrap gap-x-4">
                  <Link href={`/admin/guests/${g.id}`} className="font-medium text-slate-900 hover:text-yellow-800 min-w-[180px]">
                    {g.full_name}
                  </Link>
                  <span className="text-slate-600">{g.email ?? "—"}</span>
                  <span className="text-slate-600">{g.phone ?? "—"}</span>
                  <span className="text-xs text-slate-400">created {fmtDateTime(g.created_at)}</span>
                </li>
              ))}
            </ul>
            {group.length === 2 ? (
              <ActionForm
                action={mergeGuests}
                submitLabel={`Keep ${group[0].full_name}, merge the other into it`}
                submitClassName={secondaryButtonClass}
                confirmMessage="Merge these profiles? The duplicate is deleted after its stays move across."
                className=""
              >
                <input type="hidden" name="keep_id" value={group[0].id} />
                <input type="hidden" name="drop_id" value={group[1].id} />
              </ActionForm>
            ) : (
              <p className="text-xs text-slate-500">Open the profile to keep and merge the others into it one at a time.</p>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
