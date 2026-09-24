import Link from "next/link";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import type { GuestFeedback } from "../../../../lib/types";
import { Card, EmptyState, StatCard, fmtDateTime } from "../../../components/ui";

type Row = GuestFeedback & { guests: { id: string; full_name: string } | null; bookings: { reference: string } | null };

const ASPECTS = ["room", "service", "cleanliness", "food"] as const;

export default async function FeedbackListPage() {
  await requirePermission("guests.view");
  const supabase = await createClient();
  const [{ data }, { count: waiting }] = await Promise.all([
    supabase
      .from("guest_feedback")
      .select("*, guests(id, full_name), bookings(reference)")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(200),
    supabase.from("guest_feedback").select("id", { count: "exact", head: true }).is("submitted_at", null).not("requested_at", "is", null),
  ]);
  const rows = (data ?? []) as Row[];
  const avg = (k: "overall" | (typeof ASPECTS)[number]) => {
    const vals = rows.map((r) => r[k]).filter((v): v is number => !!v);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="Overall" value={avg("overall")} hint={`${rows.length} response(s)`} />
        <StatCard label="Room" value={avg("room")} />
        <StatCard label="Service" value={avg("service")} />
        <StatCard label="Cleanliness" value={avg("cleanliness")} />
        <StatCard label="Food" value={avg("food")} />
        <StatCard label="Awaiting reply" value={waiting ?? 0} hint="Links emailed, not answered" />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No feedback yet. Guests get a link with their final bill at express check-out." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((f) => (
              <li key={f.id} className="px-4 py-3 text-sm">
                <p>
                  <span className="text-yellow-600">{"★".repeat(f.overall ?? 0)}</span>
                  <span className="text-slate-300">{"★".repeat(5 - (f.overall ?? 0))}</span>{" "}
                  {f.guests ? (
                    <Link href={`/admin/guests/${f.guests.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                      {f.guests.full_name}
                    </Link>
                  ) : (
                    "Guest"
                  )}
                  <span className="text-xs text-slate-500">
                    {f.bookings && ` · ${f.bookings.reference}`} · {f.source === "guest" ? "online" : "via the desk"} ·{" "}
                    {fmtDateTime(f.submitted_at!)}
                  </span>
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {ASPECTS.filter((k) => f[k])
                    .map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${f[k]}/5`)
                    .join(" · ")}
                </p>
                {f.comment && <p className="text-slate-700 mt-1">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
