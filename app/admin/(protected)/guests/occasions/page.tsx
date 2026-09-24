import Link from "next/link";
import { Cake, Heart } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { getSettings } from "../../../../lib/settings";
import { addDays, daysBetween, todayIn } from "../../../../lib/dates";
import { Card, EmptyState, Tag, fmtDate } from "../../../components/ui";

type Row = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  anniversary: string | null;
  marketing_opt_in: boolean;
  email: string | null;
  tags: string[];
};

/** The next time a month-day comes round, on or after today. */
function nextOccurrence(date: string, today: string): string {
  const md = date.slice(5);
  const year = Number(today.slice(0, 4));
  // 29 February falls on 28 February in other years.
  const fix = (y: number) => (md === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : `${y}-${md}`);
  const thisYear = fix(year);
  return thisYear >= today ? thisYear : fix(year + 1);
}

/** Birthdays and anniversaries coming up (SOW Module 8: special-occasion reminders). */
export default async function OccasionsPage() {
  await requirePermission("guests.view");
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const until = addDays(today, 30);

  const [{ data }, { data: stays }] = await Promise.all([
    supabase
      .from("guests")
      .select("id, full_name, date_of_birth, anniversary, marketing_opt_in, email, tags")
      .is("erased_at", null)
      .or("date_of_birth.not.is.null,anniversary.not.is.null")
      .limit(5000),
    supabase
      .from("bookings")
      .select("guest_id, reference, check_in, check_out, status, rooms(room_number)")
      .in("status", ["confirmed", "checked_in"])
      .lte("check_in", until)
      .gte("check_out", today)
      .not("guest_id", "is", null),
  ]);

  const events = ((data ?? []) as Row[])
    .flatMap((g) =>
      (
        [
          ["Birthday", g.date_of_birth],
          ["Anniversary", g.anniversary],
        ] as const
      )
        .filter(([, d]) => d)
        .map(([kind, d]) => ({ guest: g, kind, on: nextOccurrence(d!, today) })),
    )
    .filter((e) => e.on <= until)
    .sort((a, b) => a.on.localeCompare(b.on));

  // The desk can act on occasions that fall during a stay.
  const stayFor = (guestId: string, on: string) =>
    (stays ?? []).find((s) => s.guest_id === guestId && s.check_in <= on && s.check_out >= on);

  return (
    <Card>
      {events.length === 0 ? (
        <EmptyState message="No birthdays or anniversaries in the next 30 days. Add them on guest profiles." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => {
            const stay = stayFor(e.guest.id, e.on);
            const days = daysBetween(today, e.on);
            return (
              <li key={`${e.guest.id}-${e.kind}`} className="px-4 py-3 flex flex-wrap items-center gap-3">
                {e.kind === "Birthday" ? <Cake className="w-4 h-4 text-yellow-700" /> : <Heart className="w-4 h-4 text-rose-600" />}
                <div className="flex-1 min-w-[220px]">
                  <Link href={`/admin/guests/${e.guest.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                    {e.guest.full_name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {e.kind} · {fmtDate(e.on)} · {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
                  </p>
                </div>
                {stay && (
                  <Tag tone="green">
                    {stay.status === "checked_in" ? "In house" : "Staying"} · {stay.reference}
                    {(stay.rooms as unknown as { room_number: string } | null)?.room_number
                      ? ` · room ${(stay.rooms as unknown as { room_number: string }).room_number}`
                      : ""}
                  </Tag>
                )}
                {e.guest.tags.includes("VIP") && <Tag tone="gold">VIP</Tag>}
                {e.guest.marketing_opt_in && e.guest.email ? <Tag tone="blue">Offers OK</Tag> : <Tag>No offers consent</Tag>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
