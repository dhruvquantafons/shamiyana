import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { pointsFor, redemptionValue } from "../../../../lib/loyalty";
import type { Guest, LoyaltyTier, LoyaltyTransaction } from "../../../../lib/types";
import { LOYALTY_TX_LABELS } from "../../../../lib/types";
import {
  saveLoyaltyProgram,
  saveLoyaltyTier,
  reevaluateAllTiers,
} from "../../../loyalty-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  SectionTitle,
  StatCard,
  Tag,
  fmtDate,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
  Pagination,
  pageParam,
  pageRange,
  pageHref,
  outOfRange,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { TierTag } from "./shared";

/**
 * The loyalty programme (SOW Module 8): its rules, its tiers, and who is in it.
 *
 * Points are earned automatically when an invoice is issued, at the earning
 * rate of the tier the guest held at the time. They are spent from the guest's
 * profile or against a bill on the Folio tab. Tiers are re-checked nightly
 * against a rolling twelve months, so this page is for setting the rules
 * rather than for daily work.
 */
export default async function LoyaltyPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requirePermission("guests.view");
  const page = pageParam((await searchParams).page);
  const supabase = await createClient();
  const settings = await getSettings();
  const manage = can(session, "loyalty.manage");

  // The members table pages; the member and per-tier counts cover everyone.
  const [{ data: tierRows }, { data: memberRows, error, count: memberCount }, { data: txRows }] = await Promise.all([
    supabase.from("loyalty_tiers").select("*").order("sort_order"),
    supabase
      .from("guests")
      .select("id, full_name, loyalty_member_no, loyalty_tier, loyalty_joined_on, loyalty_opt_in", { count: "exact" })
      .eq("loyalty_opt_in", true)
      .is("erased_at", null)
      .order("loyalty_joined_on", { ascending: false })
      .range(...pageRange(page)),
    supabase
      .from("loyalty_transactions")
      .select("*, guests(full_name, loyalty_member_no), bookings(reference)")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const tiers = (tierRows ?? []) as LoyaltyTier[];
  const members = (memberRows ?? []) as Pick<
    Guest,
    "id" | "full_name" | "loyalty_member_no" | "loyalty_tier" | "loyalty_joined_on" | "loyalty_opt_in"
  >[];
  const recent = (txRows ?? []) as LoyaltyTransaction[];
  if (outOfRange(error)) redirect(pageHref("/admin/guests/loyalty", {}, 1));

  // One exact count per tier, so the breakdown is right however many members there are.
  const tierCounts = await Promise.all(
    tiers.map((t) =>
      supabase
        .from("guests")
        .select("id", { count: "exact", head: true })
        .eq("loyalty_opt_in", true)
        .is("erased_at", null)
        .eq("loyalty_tier", t.key),
    ),
  );
  const byTier = new Map<string, number>(tiers.map((t, i) => [t.key, tierCounts[i].count ?? 0]));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Programme"
          value={settings.loyalty_enabled ? "On" : "Off"}
          hint={settings.loyalty_program_name}
        />
        <StatCard label="Members" value={memberCount ?? 0} hint="Currently enrolled" />
        <StatCard label="Tiers" value={tiers.filter((t) => t.is_active).length} hint={`${tiers.length} set up`} />
        <StatCard
          label="Points expire after"
          value={settings.loyalty_expiry_months === 0 ? "Never" : `${settings.loyalty_expiry_months} months`}
          hint={`Minimum redemption ${settings.loyalty_min_redeem_points.toLocaleString("en-IN")} points`}
        />
      </div>

      {!settings.loyalty_enabled && (
        <Notice tone="info">
          {settings.loyalty_program_name} is switched off. Guests cannot be enrolled and no points are earned. Existing
          balances are kept and will still be there when it is switched back on.
        </Notice>
      )}

      {/* ── Programme rules ── */}
      {manage && (
        <Card className="p-5">
          <SectionTitle>Programme rules</SectionTitle>
          <ActionForm
            action={saveLoyaltyProgram}
            submitLabel="Save programme"
            submitClassName={secondaryButtonClass}
            className="space-y-4"
          >
            <Check
              name="loyalty_enabled"
              defaultChecked={settings.loyalty_enabled}
              label="Run the loyalty programme"
              hint="Off means no enrolment and no points earned. Nothing already earned is lost."
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Programme name" hint="Shown to guests in messages.">
                <input
                  name="loyalty_program_name"
                  maxLength={60}
                  defaultValue={settings.loyalty_program_name}
                  className={inputClass}
                />
              </Field>
              <Field label="Points expire after (months)" hint="0 means they never expire.">
                <input
                  type="number"
                  name="loyalty_expiry_months"
                  min={0}
                  max={120}
                  defaultValue={settings.loyalty_expiry_months}
                  className={inputClass}
                />
              </Field>
              <Field label="Smallest redemption (points)">
                <input
                  type="number"
                  name="loyalty_min_redeem_points"
                  min={0}
                  defaultValue={settings.loyalty_min_redeem_points}
                  className={inputClass}
                />
              </Field>
            </div>
            <p className="text-[11px] text-slate-500">
              Points are earned on the taxable value of an invoice, not on the tax — tax collected for the government is
              not the guest&apos;s spend with the hotel.
            </p>
          </ActionForm>
        </Card>
      )}

      {/* ── Tiers ── */}
      <Card className="p-5">
        <SectionTitle
          action={
            manage ? (
              <ActionForm action={reevaluateAllTiers} submitLabel="Review every member" submitClassName={secondaryButtonClass}>
                <input type="hidden" name="all" value="true" />
              </ActionForm>
            ) : undefined
          }
        >
          Tiers
        </SectionTitle>
        <p className="text-[11px] text-slate-500 -mt-2 mb-4">
          A guest holds the highest tier whose nights <em>and</em> spend they meet over a rolling twelve months. The
          lowest tier is the entry tier, and must sit at zero so every member has one. Night audit re-checks everybody.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className={tableHeadClass}>
                <th className="py-2 px-3 font-semibold">Tier</th>
                <th className="py-2 pr-3 font-semibold text-right">Nights</th>
                <th className="py-2 pr-3 font-semibold text-right">Spend</th>
                <th className="py-2 pr-3 font-semibold text-right">Earn rate</th>
                <th className="py-2 pr-3 font-semibold text-right">Point worth</th>
                <th className="py-2 pr-3 font-semibold text-right">Members</th>
                <th className="py-2 pr-3 font-semibold">Perks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {tiers.map((t) => (
                <tr key={t.key} className={t.is_active ? "" : "text-slate-400"}>
                  <td className="py-2 px-3">
                    <TierTag tier={t} />
                    {!t.is_active && (
                      <>
                        {" "}
                        <Tag tone="neutral">Retired</Tag>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{t.min_nights}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(Number(t.min_spend))}</td>
                  <td className="py-2 pr-3 text-right">
                    {Number(t.earn_rate)}
                    <span className="block text-[10px] text-slate-500">
                      {pointsFor(10000, t).toLocaleString("en-IN")} pts per {fmtMoney(10000)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {fmtMoney(Number(t.redeem_rate))}
                    <span className="block text-[10px] text-slate-500">
                      1,000 pts = {fmtMoney(redemptionValue(1000, t))}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{byTier.get(t.key) ?? 0}</td>
                  <td className="py-2 pr-3 text-slate-500">{t.perks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {manage && (
          <details className="mt-4 pt-4 border-t border-slate-100">
            <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Add or edit a tier</summary>
            <ActionForm
              action={saveLoyaltyTier}
              submitLabel="Save tier"
              submitClassName={secondaryButtonClass}
              className="space-y-3 mt-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Key" hint="Lower case, no spaces. Editing an existing key updates it.">
                  <input name="key" required maxLength={20} placeholder="gold" className={inputClass} />
                </Field>
                <Field label="Name">
                  <input name="name" required maxLength={40} placeholder="Gold" className={inputClass} />
                </Field>
                <Field label="Order" hint="Lowest is the entry tier.">
                  <input type="number" name="sort_order" min={0} max={100} defaultValue={tiers.length + 1} className={inputClass} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label="Nights needed">
                  <input type="number" name="min_nights" min={0} defaultValue={0} className={inputClass} />
                </Field>
                <Field label={`Spend needed (${settings.currency})`}>
                  <input type="number" name="min_spend" min={0} step="0.01" defaultValue={0} className={inputClass} />
                </Field>
                <Field label="Earn rate" hint={`Points per ${settings.currency} spent.`}>
                  <input type="number" name="earn_rate" min={0} step="0.0001" defaultValue={0.05} className={inputClass} />
                </Field>
                <Field label="Point worth" hint={`${settings.currency} per point redeemed.`}>
                  <input type="number" name="redeem_rate" min={0} step="0.0001" defaultValue={0.25} className={inputClass} />
                </Field>
              </div>
              <Field label="Perks" hint="Shown on the guest's profile so the desk can honour them.">
                <textarea name="perks" rows={2} maxLength={1000} className={inputClass} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Colour" hint="slate, amber, violet, blue, green or red.">
                  <input name="colour" maxLength={20} defaultValue="slate" className={inputClass} />
                </Field>
                <div className="flex items-end">
                  <Check name="is_active" defaultChecked label="In use" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Changing a threshold does not move anybody on its own — use <strong>Review every member</strong> above,
                or wait for tonight&apos;s audit.
              </p>
            </ActionForm>
          </details>
        )}
      </Card>

      {/* ── Members ── */}
      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Members</SectionTitle>
        </div>
        {members.length === 0 ? (
          <EmptyState message="Nobody is enrolled yet. Enrol a guest from their profile, under Guests." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="py-2 px-4 font-semibold">Member</th>
                  <th className="py-2 pr-3 font-semibold">Number</th>
                  <th className="py-2 pr-3 font-semibold">Tier</th>
                  <th className="py-2 pr-4 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/60">
                    <td className="py-2 px-4">
                      <Link href={`/admin/guests/${m.id}`} className="text-slate-900 hover:text-yellow-700">
                        {m.full_name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-500">{m.loyalty_member_no ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <TierTag tier={tiers.find((t) => t.key === m.loyalty_tier) ?? null} />
                    </td>
                    <td className="py-2 pr-4 text-slate-500">
                      {m.loyalty_joined_on ? fmtDate(m.loyalty_joined_on) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={memberCount ?? 0} path="/admin/guests/loyalty" />
      </Card>

      {/* ── Latest movements ── */}
      {recent.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Latest points activity</SectionTitle>
          <ul className="space-y-1.5 text-xs">
            {recent.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <Tag tone={t.kind === "earn" ? "green" : t.kind === "redeem" ? "blue" : t.kind === "expire" ? "neutral" : "amber"}>
                    {LOYALTY_TX_LABELS[t.kind]}
                  </Tag>{" "}
                  <Link href={`/admin/guests/${t.guest_id}`} className="text-slate-900 hover:text-yellow-700">
                    {t.guests?.full_name ?? "Guest"}
                  </Link>
                  <span className="text-slate-500">
                    {" "}
                    · {t.description}
                    {t.bookings?.reference ? ` · ${t.bookings.reference}` : ""}
                  </span>
                </span>
                <span className={t.points > 0 ? "text-emerald-700" : "text-slate-600"}>
                  {t.points > 0 ? "+" : ""}
                  {t.points.toLocaleString("en-IN")} pts
                  <span className="text-slate-500"> · {fmtDate(t.created_at.slice(0, 10))}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
