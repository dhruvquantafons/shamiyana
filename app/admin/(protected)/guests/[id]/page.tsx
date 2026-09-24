import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cake, Heart } from "lucide-react";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { todayIn } from "../../../../lib/dates";
import type {
  Booking,
  Company,
  Guest,
  GuestFeedback,
  GuestStats,
  LoyaltyTier,
  LoyaltyTierChange,
  LoyaltyTransaction,
  Notification as GuestMessage,
  RoomType,
} from "../../../../lib/types";
import { ID_TYPE_LABELS, LANGUAGES, guestTags } from "../../../../lib/types";
import { eraseGuest, mergeGuests, recordFeedback, updateGuestProfile } from "../../../guest-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  Stat,
  StatusPill,
  inputClass,
  secondaryButtonClass,
  dangerButtonClass,
  tableHeadClass,
  fmtDate,
  fmtDateTime,
  fmtMoney,
} from "../../../components/ui";
import NotificationList from "../../../components/NotificationList";
import ActionForm from "../../../components/ActionForm";
import { GuestTags, phoneKey } from "../shared";
import LoyaltyPanel from "./LoyaltyPanel";

type Stay = Pick<Booking, "id" | "reference" | "check_in" | "check_out" | "status" | "total_amount" | "special_requests" | "rooms_count"> & {
  room_types: { name: string } | null;
  rooms: { room_number: string } | null;
};

const SCORE_LABELS = { overall: "Overall", room: "Room", service: "Service", cleanliness: "Cleanliness", food: "Food" } as const;

function StarSelect({ name, required = false }: { name: string; required?: boolean }) {
  return (
    <select name={name} required={required} defaultValue="" className={inputClass}>
      <option value="">{required ? "Choose…" : "—"}</option>
      {[5, 4, 3, 2, 1].map((n) => (
        <option key={n} value={n}>
          {"★".repeat(n)}
        </option>
      ))}
    </select>
  );
}

export default async function GuestProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ merged?: string }>;
}) {
  const session = await requirePermission("guests.view");
  const { id } = await params;
  const { merged } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("guests").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const guest = data as Guest;

  const settings = await getSettings();
  const today = todayIn(settings.timezone);

  const [
    { data: statRow },
    { data: stayRows },
    { data: fb },
    { data: identity },
    { data: types },
    { data: companies },
    { data: tierRows },
    { data: loyaltyRows },
    { data: tierHistory },
    { data: activity },
    { data: messages },
  ] = await Promise.all([
    supabase.from("guest_stats").select("*").eq("guest_id", id).maybeSingle(),
    supabase
      .from("bookings")
      .select("id, reference, check_in, check_out, status, total_amount, special_requests, rooms_count, room_types(name), rooms(room_number)")
      .eq("guest_id", id)
      .order("check_in", { ascending: false }),
    supabase.from("guest_feedback").select("*").eq("guest_id", id).order("created_at", { ascending: false }),
    supabase.rpc("guest_identity_masked", { p_guest: id }),
    supabase.from("room_types").select("id, name").order("sort_order"),
    supabase.from("companies").select("id, name").eq("is_active", true).order("name"),
    supabase.from("loyalty_tiers").select("*").order("sort_order"),
    supabase
      .from("loyalty_transactions")
      .select("*, bookings(reference)")
      .eq("guest_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("loyalty_tier_history")
      .select("*")
      .eq("guest_id", id)
      .order("changed_at", { ascending: false })
      .limit(20),
    supabase.rpc("loyalty_rolling_activity", { p_guest: id, p_date: today }),
    // SOW Module 16: "notification history log per guest". Read by guest
    // rather than by booking, so it follows them across stays.
    supabase
      .from("notifications")
      .select("*, bookings(id, reference)")
      .eq("guest_id", id)
      .eq("kind", "guest")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const stats = statRow as GuestStats | null;
  const stays = (stayRows ?? []) as unknown as Stay[];
  const feedback = (fb ?? []) as GuestFeedback[];
  const idOnFile = (identity as { id_type: string; id_last4: string }[] | null)?.[0];
  const tags = guestTags(guest, stats);
  const edit = can(session, "guests.edit") && !guest.erased_at;
  const privacy = can(session, "guests.privacy") && !guest.erased_at;
  const submitted = feedback.filter((f) => f.submitted_at);
  const avg = submitted.length ? (submitted.reduce((s, f) => s + (f.overall ?? 0), 0) / submitted.length).toFixed(1) : null;
  const unratedStays = stays.filter((s) => s.status === "checked_out" && !feedback.some((f) => f.booking_id === s.id && f.submitted_at));

  const tiers = (tierRows ?? []) as LoyaltyTier[];
  const loyalty = (loyaltyRows ?? []) as LoyaltyTransaction[];
  const tierChanges = (tierHistory ?? []) as LoyaltyTierChange[];
  // loyalty_rolling_activity returns a single row of nights and spend.
  const rolling = ((activity as { nights: number; spend: number }[] | null) ?? [])[0] ?? { nights: 0, spend: 0 };

  // Likely duplicates to merge into this profile.
  let duplicates: Pick<Guest, "id" | "full_name" | "email" | "phone">[] = [];
  if (privacy) {
    const safe = (v: string) => `"${v.replace(/["%,()\\]/g, "")}"`;
    const ors = [`full_name.ilike.${safe(guest.full_name)}`];
    if (guest.email) ors.push(`email.ilike.${safe(guest.email)}`);
    const digits = phoneKey(guest.phone);
    if (digits.length >= 7) ors.push(`phone.ilike.%${digits}`);
    const { data: dupes } = await supabase
      .from("guests")
      .select("id, full_name, email, phone")
      .or(ors.join(","))
      .neq("id", id)
      .is("erased_at", null)
      .limit(10);
    duplicates = dupes ?? [];
  }

  const profile = (
    <fieldset disabled={!edit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Full name">
          <input name="full_name" required defaultValue={guest.full_name} className={inputClass} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={guest.email ?? ""} className={inputClass} />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" defaultValue={guest.phone ?? ""} className={inputClass} />
        </Field>
        <Field label="Address">
          <input name="address" defaultValue={guest.address} className={inputClass} />
        </Field>
        <Field label="City">
          <input name="city" defaultValue={guest.city} className={inputClass} />
        </Field>
        <Field label="Country">
          <input name="country" defaultValue={guest.country} className={inputClass} />
        </Field>
        <Field label="Nationality">
          <input name="nationality" defaultValue={guest.nationality} className={inputClass} />
        </Field>
        <Field label="Company">
          <select name="company_id" defaultValue={guest.company_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {((companies ?? []) as Pick<Company, "id" | "name">[]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language" hint="Messages are sent in it when a template exists.">
          <select name="language" defaultValue={guest.language} className={inputClass}>
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Field label="Birthday">
          <input type="date" name="date_of_birth" defaultValue={guest.date_of_birth ?? ""} className={inputClass} />
        </Field>
        <Field label="Anniversary">
          <input type="date" name="anniversary" defaultValue={guest.anniversary ?? ""} className={inputClass} />
        </Field>
        <Field label="Preferred room type">
          <select name="preferred_room_type_id" defaultValue={guest.preferred_room_type_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {((types ?? []) as Pick<RoomType, "id" | "name">[]).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Preferred floor">
          <input type="number" name="preferred_floor" defaultValue={guest.preferred_floor ?? ""} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Dietary needs">
          <input name="dietary" defaultValue={guest.dietary} placeholder="Vegetarian, no nuts…" className={inputClass} />
        </Field>
        <Field label="Preferences">
          <input name="preferences" defaultValue={guest.preferences} placeholder="Quiet room, extra pillows, river view…" className={inputClass} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea name="notes" rows={2} defaultValue={guest.notes} className={inputClass} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
        <Check name="vip" label="VIP" defaultChecked={guest.tags.includes("VIP")} />
        <Check
          name="marketing_opt_in"
          label="Agreed to receive offers"
          defaultChecked={guest.marketing_opt_in}
          hint="Needed before sending birthday or anniversary offers."
        />
        <Check name="blacklisted" label="Blacklisted" defaultChecked={guest.tags.includes("Blacklisted")} />
      </div>
      <Field label="Blacklist reason" hint="Shown to the desk at booking and check-in.">
        <input name="blacklist_reason" defaultValue={guest.blacklist_reason} className={inputClass} />
      </Field>
    </fieldset>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/admin/guests" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700">
        <ArrowLeft className="w-3.5 h-3.5" /> Guests
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900 mr-1">{guest.full_name}</h2>
        <GuestTags tags={tags} />
      </div>

      {merged && <Notice tone="ok">Profiles merged. Stays, ID and feedback from the duplicate are now here.</Notice>}
      {guest.erased_at && (
        <Notice tone="warn">Personal data erased on {fmtDateTime(guest.erased_at)}. Stays and amounts are kept for tax records.</Notice>
      )}
      {guest.tags.includes("Blacklisted") && (
        <Notice tone="error">Blacklisted{guest.blacklist_reason ? `: ${guest.blacklist_reason}` : ""}.</Notice>
      )}

      <Card className="p-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <Stat label="Stays">{stats?.stays ?? 0}</Stat>
          <Stat label="Nights">{stats?.nights ?? 0}</Stat>
          {can(session, "folio.view") && <Stat label="Total spend">{fmtMoney(stats?.total_spend ?? 0)}</Stat>}
          <Stat label="Last stay">{stats?.last_stay ? fmtDate(stats.last_stay) : "—"}</Stat>
          <Stat label="Next arrival">{stats?.next_arrival ? fmtDate(stats.next_arrival) : "—"}</Stat>
          <Stat label="Rating">{avg ? `${avg} ★ (${submitted.length})` : "—"}</Stat>
          <Stat label="ID">{idOnFile ? `${ID_TYPE_LABELS[idOnFile.id_type] ?? idOnFile.id_type} …${idOnFile.id_last4}` : "—"}</Stat>
          <Stat label="Cancelled / no-show">
            {stats?.cancellations ?? 0} / {stats?.no_shows ?? 0}
          </Stat>
          {guest.date_of_birth && (
            <Stat label="Birthday">
              <span className="inline-flex items-center gap-1">
                <Cake className="w-3.5 h-3.5 text-yellow-700" /> {fmtDate(guest.date_of_birth)}
              </span>
            </Stat>
          )}
          {guest.anniversary && (
            <Stat label="Anniversary">
              <span className="inline-flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 text-rose-600" /> {fmtDate(guest.anniversary)}
              </span>
            </Stat>
          )}
        </dl>
      </Card>

      <LoyaltyPanel
        guest={guest}
        tiers={tiers}
        transactions={loyalty}
        history={tierChanges}
        nights={Number(rolling.nights ?? 0)}
        spend={Number(rolling.spend ?? 0)}
        programName={settings.loyalty_program_name}
        enabled={settings.loyalty_enabled}
        minRedeem={settings.loyalty_min_redeem_points}
        expiryMonths={settings.loyalty_expiry_months}
        today={today}
        canEdit={edit}
        canManage={can(session, "loyalty.manage") && !guest.erased_at}
      />

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Stay history</SectionTitle>
        </div>
        {stays.length === 0 ? (
          <EmptyState message="No bookings yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="px-4 py-2.5 font-medium">Booking</th>
                  <th className="px-4 py-2.5 font-medium">Dates</th>
                  <th className="px-4 py-2.5 font-medium">Room</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Total</th>
                  <th className="px-4 py-2.5 font-medium">Special requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stays.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/bookings/${b.id}`} className="font-medium text-slate-900 hover:text-yellow-800">
                        {b.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                    </td>
                    <td className="px-4 py-2.5">
                      {b.room_types?.name ?? "—"}
                      {b.rooms?.room_number && <span className="text-xs text-slate-500"> · {b.rooms.room_number}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={b.status} />
                    </td>
                    <td className="px-4 py-2.5">{fmtMoney(b.total_amount)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{b.special_requests || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Profile</SectionTitle>
        {edit ? (
          <ActionForm action={updateGuestProfile} submitLabel="Save profile" className="space-y-4">
            <input type="hidden" name="id" value={guest.id} />
            {profile}
          </ActionForm>
        ) : (
          profile
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <SectionTitle>Messages sent</SectionTitle>
        <NotificationList
          items={(messages ?? []) as unknown as GuestMessage[]}
          empty="No messages have been sent to this guest yet."
        />
      </Card>

      <Card className="p-5 space-y-4">
        <SectionTitle>Feedback</SectionTitle>
        {feedback.length === 0 ? (
          <p className="text-sm text-slate-500">No feedback yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {feedback.map((f) => (
              <li key={f.id} className="py-3 text-sm">
                {f.submitted_at ? (
                  <>
                    <p>
                      <span className="text-yellow-600">{"★".repeat(f.overall ?? 0)}</span>
                      <span className="text-slate-300">{"★".repeat(5 - (f.overall ?? 0))}</span>{" "}
                      <span className="text-xs text-slate-500">
                        {f.source === "guest" ? "From the guest" : "Recorded by the desk"} · {fmtDateTime(f.submitted_at)}
                        {f.booking_id && ` · ${stays.find((s) => s.id === f.booking_id)?.reference ?? ""}`}
                      </span>
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {(["room", "service", "cleanliness", "food"] as const)
                        .filter((k) => f[k])
                        .map((k) => `${SCORE_LABELS[k]} ${f[k]}/5`)
                        .join(" · ")}
                    </p>
                    {f.comment && <p className="text-slate-700 mt-1">{f.comment}</p>}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Feedback link {f.requested_at ? `emailed ${fmtDateTime(f.requested_at)}` : "created"} for{" "}
                    {stays.find((s) => s.id === f.booking_id)?.reference ?? "a stay"} — not answered yet.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {(can(session, "guests.edit") || can(session, "frontdesk.checkout")) && !guest.erased_at && (
          <details>
            <summary className={`${secondaryButtonClass} list-none w-fit`}>Record feedback</summary>
            <div className="mt-3">
              <ActionForm action={recordFeedback} submitLabel="Save feedback" className="space-y-3">
                <input type="hidden" name="guest_id" value={guest.id} />
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <Field label="Stay">
                    <select name="booking_id" defaultValue={unratedStays[0]?.id ?? ""} className={inputClass}>
                      <option value="">Not about a stay</option>
                      {unratedStays.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.reference}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Overall">
                    <StarSelect name="overall" required />
                  </Field>
                  {(["room", "service", "cleanliness", "food"] as const).map((k) => (
                    <Field key={k} label={SCORE_LABELS[k]}>
                      <StarSelect name={k} />
                    </Field>
                  ))}
                </div>
                <Field label="Comment">
                  <input name="comment" maxLength={2000} className={inputClass} />
                </Field>
              </ActionForm>
            </div>
          </details>
        )}
      </Card>

      {privacy && (
        <Card className="p-5 space-y-5">
          <SectionTitle>Data &amp; privacy</SectionTitle>
          <div>
            <a href={`/admin/guests/${guest.id}/export`} className={secondaryButtonClass}>
              Download this guest&rsquo;s data
            </a>
            <p className="text-xs text-slate-500 mt-1.5">For a guest asking what the hotel holds about them. The download is recorded in the audit log.</p>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-900 mb-2">Merge a duplicate into this profile</p>
            {duplicates.length === 0 ? (
              <p className="text-xs text-slate-500">No other profiles share this name, email or phone. The Duplicates tab lists every likely match.</p>
            ) : (
              <ActionForm
                action={mergeGuests}
                submitLabel="Merge"
                submitClassName={secondaryButtonClass}
                confirmMessage="Merge the chosen profile into this one? Its stays, ID and feedback move here and it is deleted."
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="keep_id" value={guest.id} />
                <select name="drop_id" required defaultValue="" className={`${inputClass} max-w-md`}>
                  <option value="" disabled>
                    Choose the duplicate…
                  </option>
                  {duplicates.map((d) => (
                    <option key={d.id} value={d.id}>
                      {[d.full_name, d.email, d.phone].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </ActionForm>
            )}
          </div>

          <details className="border-t border-slate-100 pt-4">
            <summary className="text-sm text-rose-700 cursor-pointer">Erase personal data</summary>
            <div className="mt-3 max-w-lg space-y-2">
              <p className="text-xs text-slate-600">
                Removes the name, contact details, ID details and scans, signature, birthday, preferences and notes — for a guest
                using their right to be forgotten. Bookings and amounts stay, without the name, because tax law requires them.
                This cannot be undone.
              </p>
              <ActionForm action={eraseGuest} submitLabel="Erase" submitClassName={dangerButtonClass} className="flex items-end gap-2">
                <input type="hidden" name="id" value={guest.id} />
                <input name="confirm" required placeholder="Type ERASE" className={`${inputClass} max-w-[160px]`} />
              </ActionForm>
            </div>
          </details>
        </Card>
      )}
    </div>
  );
}
