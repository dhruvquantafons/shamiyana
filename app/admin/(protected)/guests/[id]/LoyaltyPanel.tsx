import type { Guest, LoyaltyTier, LoyaltyTierChange, LoyaltyTransaction } from "../../../../lib/types";
import { LOYALTY_TX_LABELS } from "../../../../lib/types";
import { balanceOf, lifetime, nextExpiry, redemptionValue, tierByKey, tierProgress } from "../../../../lib/loyalty";
import { enrollInLoyalty, leaveLoyalty, reevaluateTier, adjustPoints } from "../../../loyalty-actions";
import {
  Card,
  Check,
  Field,
  Notice,
  SectionTitle,
  Stat,
  Tag,
  fmtDate,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
} from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";
import { TierTag } from "../loyalty/shared";

/**
 * A guest's loyalty membership (SOW Module 8): their tier and what it earns
 * them, the points they can spend and when those points die, and the history
 * behind the balance.
 *
 * Points are shown with what they are actually worth, because "4,200 points"
 * means nothing to a guest at the desk and "₹1,050 off the bill" means
 * everything. Redemption itself happens on the booking's Folio tab, where
 * there is a bill to take it off.
 */
export default function LoyaltyPanel({
  guest,
  tiers,
  transactions,
  history,
  nights,
  spend,
  programName,
  enabled,
  minRedeem,
  expiryMonths,
  today,
  canEdit,
  canManage,
}: {
  guest: Guest;
  tiers: LoyaltyTier[];
  transactions: LoyaltyTransaction[];
  history: LoyaltyTierChange[];
  nights: number;
  spend: number;
  programName: string;
  enabled: boolean;
  minRedeem: number;
  expiryMonths: number;
  today: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const tier = tierByKey(tiers, guest.loyalty_tier);
  const balance = balanceOf(transactions, today);
  const totals = lifetime(transactions);
  const expiring = nextExpiry(transactions, today);
  const progress = tierProgress(tiers, nights, spend);
  const worth = tier ? redemptionValue(balance, tier) : 0;

  // ── Not a member ──
  if (!guest.loyalty_opt_in) {
    return (
      <Card className="p-5">
        <SectionTitle>{programName}</SectionTitle>
        {balance > 0 && (
          <Notice tone="info">
            This guest has left the programme but still holds {balance.toLocaleString("en-IN")} points. Enrolling them
            again restores the balance.
          </Notice>
        )}
        {!enabled ? (
          <p className="text-xs text-slate-500">
            {programName} is switched off, so nobody can be enrolled. Turn it on under <strong>Guests → Loyalty</strong>.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">
              Not a member. Enrolling gives them a membership number and sets their tier from the stays they have
              already had — a long-standing guest does not start again at the bottom.
            </p>
            {canEdit && (
              <ActionForm action={enrollInLoyalty} submitLabel={`Enrol in ${programName}`} submitClassName={secondaryButtonClass}>
                <input type="hidden" name="guest_id" value={guest.id} />
              </ActionForm>
            )}
          </>
        )}
      </Card>
    );
  }

  // ── A member ──
  return (
    <Card className="p-5">
      <SectionTitle
        action={
          canManage ? (
            <ActionForm action={reevaluateTier} submitLabel="Review tier" submitClassName={secondaryButtonClass}>
              <input type="hidden" name="guest_id" value={guest.id} />
            </ActionForm>
          ) : undefined
        }
      >
        {programName}
      </SectionTitle>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-1">
        <Stat label="Tier">
          <TierTag tier={tier} />
        </Stat>
        <Stat label="Member number">
          <span className="font-mono">{guest.loyalty_member_no ?? "—"}</span>
        </Stat>
        <Stat label="Points">
          {balance.toLocaleString("en-IN")}
          {worth > 0 && <span className="block text-[11px] text-slate-500">worth {fmtMoney(worth)}</span>}
        </Stat>
        <Stat label="Member since">{guest.loyalty_joined_on ? fmtDate(guest.loyalty_joined_on) : "—"}</Stat>
      </dl>

      {expiring.on && expiring.points > 0 && (
        <p className="mt-4 text-[11px] text-amber-700">
          {expiring.points.toLocaleString("en-IN")} points expire on {fmtDate(expiring.on)}
          {tier ? ` — ${fmtMoney(redemptionValue(expiring.points, tier))} of value` : ""}. Offer them against the next
          bill.
        </p>
      )}
      {expiryMonths === 0 && <p className="mt-4 text-[11px] text-slate-500">Points do not expire.</p>}

      {/* ── Tier progress ── */}
      {progress && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-[11px] text-slate-500">
            Last twelve months: <strong className="text-slate-700">{nights}</strong>{" "}
            {nights === 1 ? "night" : "nights"} and <strong className="text-slate-700">{fmtMoney(spend)}</strong> spent.
          </p>
          {progress.next ? (
            <>
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden" aria-hidden>
                <div className="h-full bg-yellow-500" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {progress.nightsToNext === 0 && progress.spendToNext === 0
                  ? `Qualifies for ${progress.next.name} — review the tier to move them up.`
                  : `${progress.next.name} needs ` +
                    [
                      progress.nightsToNext > 0 ? `${progress.nightsToNext} more ${progress.nightsToNext === 1 ? "night" : "nights"}` : null,
                      progress.spendToNext > 0 ? `${fmtMoney(progress.spendToNext)} more spend` : null,
                    ]
                      .filter(Boolean)
                      .join(" and ") +
                    "."}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] text-emerald-700">Top tier — nothing further to earn.</p>
          )}
        </div>
      )}

      {tier?.perks && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">{tier.name} perks — honour these</p>
          <p className="text-xs text-slate-700 mt-1 whitespace-pre-line">{tier.perks}</p>
        </div>
      )}

      {/* ── Lifetime ── */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
        <Stat label="Earned ever">{totals.earned.toLocaleString("en-IN")}</Stat>
        <Stat label="Redeemed">{totals.redeemed.toLocaleString("en-IN")}</Stat>
        <Stat label="Expired">{totals.expired.toLocaleString("en-IN")}</Stat>
        <Stat label="Corrections">
          {totals.adjusted > 0 ? "+" : ""}
          {totals.adjusted.toLocaleString("en-IN")}
        </Stat>
      </dl>

      <p className="mt-4 text-[11px] text-slate-500">
        Points are redeemed against a bill on the booking&apos;s <strong>Folio</strong> tab, where the smallest
        redemption is {minRedeem.toLocaleString("en-IN")} points.
      </p>

      {/* ── History ── */}
      {transactions.length > 0 && (
        <details className="mt-4 pt-4 border-t border-slate-100">
          <summary className="text-xs font-medium text-yellow-700 cursor-pointer">
            Points history ({transactions.length})
          </summary>
          <ul className="space-y-1.5 text-xs mt-3">
            {transactions.slice(0, 40).map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <Tag
                    tone={t.kind === "earn" ? "green" : t.kind === "redeem" ? "blue" : t.kind === "expire" ? "neutral" : "amber"}
                  >
                    {LOYALTY_TX_LABELS[t.kind]}
                  </Tag>{" "}
                  <span className="text-slate-700">{t.description}</span>
                  {t.bookings?.reference && <span className="text-slate-500"> · {t.bookings.reference}</span>}
                </span>
                <span className={t.points > 0 ? "text-emerald-700" : "text-slate-600"}>
                  {t.points > 0 ? "+" : ""}
                  {t.points.toLocaleString("en-IN")}
                  {t.remaining > 0 && t.points > 0 && (
                    <span className="text-slate-500"> · {t.remaining.toLocaleString("en-IN")} left</span>
                  )}
                  {t.expires_on && t.remaining > 0 && (
                    <span className="text-slate-500"> · expires {fmtDate(t.expires_on)}</span>
                  )}
                  <span className="text-slate-500"> · {fmtDate(t.created_at.slice(0, 10))}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {history.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Tier history ({history.length})</summary>
          <ul className="space-y-1 text-xs mt-2 text-slate-600">
            {history.map((h) => (
              <li key={h.id}>
                {fmtDate(h.changed_at.slice(0, 10))} — {h.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── Manager tools ── */}
      {canManage && (
        <details className="mt-4 pt-4 border-t border-slate-100">
          <summary className="text-xs font-medium text-yellow-700 cursor-pointer">Correct the balance</summary>
          <ActionForm action={adjustPoints} submitLabel="Apply correction" submitClassName={secondaryButtonClass} className="space-y-3 mt-3">
            <input type="hidden" name="guest_id" value={guest.id} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Points">
                <input type="number" name="points" min={1} step={1} required className={inputClass} />
              </Field>
              <div className="flex items-end">
                <Check name="take_away" label="Take these points away instead of adding them" />
              </div>
            </div>
            <Field label="Reason" hint="Kept on the guest's history and in the audit log.">
              <input
                name="reason"
                required
                maxLength={300}
                placeholder="Goodwill after the lift outage, points awarded in error…"
                className={inputClass}
              />
            </Field>
            <p className="text-[11px] text-slate-500">
              Points taken away come off the batch expiring soonest, the same order a redemption uses.
            </p>
          </ActionForm>
        </details>
      )}

      {canEdit && (
        <details className="mt-3">
          <summary className="text-[11px] text-slate-500 hover:text-rose-700 cursor-pointer">Leave the programme</summary>
          <div className="mt-2">
            <ActionForm action={leaveLoyalty} submitLabel="Pause membership" submitClassName={secondaryButtonClass}>
              <input type="hidden" name="guest_id" value={guest.id} />
              <p className="text-[11px] text-slate-500 mb-2">
                The points balance is kept in case they rejoin. Erasing the guest&apos;s data removes it for good.
              </p>
            </ActionForm>
          </div>
        </details>
      )}
    </Card>
  );
}
