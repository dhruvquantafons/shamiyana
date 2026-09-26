import { Building2 } from "lucide-react";
import { requireAnyPermission } from "../../../lib/auth";
import { can } from "../../../lib/permissions";
import { getSettings } from "../../../lib/settings";
import { addDays, todayIn } from "../../../lib/dates";
import {
  getProperties,
  getCurrentProperty,
  getGroupSettings,
  loadGroupPerformance,
} from "../../../lib/properties";
import { CENTRAL_CONFIG_ITEMS, LANGUAGES, type CentralConfigItem } from "../../../lib/types";
import {
  createProperty,
  saveProperty,
  setDefaultProperty,
  saveGroupSettings,
  pushCentralConfig,
} from "../../property-actions";
import {
  Card,
  Check,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SectionTitle,
  Tag,
  fmtMoney,
  inputClass,
  secondaryButtonClass,
  tableHeadClass,
} from "../../components/ui";
import ActionForm from "../../components/ActionForm";

/**
 * Module 14 — the group in one screen.
 *
 * Three things live here, in the order somebody running a group needs them:
 * how the hotels are performing against each other, the hotels themselves, and
 * the standards head office pushes down to them.
 */
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireAnyPermission(["properties.view", "properties.manage"]);
  const params = await searchParams;
  const settings = await getSettings();
  const manage = can(session, "properties.manage");

  const today = todayIn(settings.timezone);
  const days = Math.min(400, Math.max(1, Number(params.days) || 30));
  const from = addDays(today, -days);

  const [properties, current, group, performance] = await Promise.all([
    getProperties(),
    getCurrentProperty(),
    manage ? getGroupSettings() : Promise.resolve(null),
    loadGroupPerformance(from, today),
  ]);

  const totals = performance.reduce(
    (acc, r) => ({
      sold: acc.sold + Number(r.rooms_sold),
      available: acc.available + Number(r.rooms_available),
      revenue: acc.revenue + Number(r.total_revenue),
    }),
    { sold: 0, available: 0, revenue: 0 },
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Properties"
        description={
          properties.length > 1
            ? `${properties.length} hotels. You are working in ${current?.name ?? "—"}.`
            : "One hotel. Add another to run them as a group."
        }
      />

      {/* ── Side by side ──────────────────────────────────────────────── */}

      <Card className="overflow-hidden">
        <div className="px-5 sm:px-6 pt-5">
        <SectionTitle
          action={
            <form className="flex items-center gap-2 text-xs">
              <label htmlFor="days" className="text-slate-500">
                Last
              </label>
              <select id="days" name="days" defaultValue={String(days)} className={`${inputClass} w-28! py-1.5! text-xs!`}>
                {[7, 30, 90, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              <button type="submit" className={`${secondaryButtonClass} py-1.5! px-3! text-xs!`}>
                Show
              </button>
            </form>
          }
        >
          Performance side by side
        </SectionTitle>
        </div>

        {performance.length === 0 ? (
          <EmptyState message="Nothing to compare yet." />
        ) : (
          <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={tableHeadClass}>
                  <th className="text-left py-3 pl-5 sm:pl-6 pr-3 font-medium">Property</th>
                  <th className="text-right py-3 px-3 font-medium">Occupancy</th>
                  <th className="text-right py-3 px-3 font-medium">Rooms sold</th>
                  <th className="text-right py-3 px-3 font-medium">ADR</th>
                  <th className="text-right py-3 px-3 font-medium">RevPAR</th>
                  <th className="text-right py-3 pl-3 pr-5 sm:pr-6 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((r) => (
                  <tr key={r.property_id} className="border-b border-slate-100 hover:bg-emerald-50/70 transition-colors">
                    <td className="py-3.5 pl-5 sm:pl-6 pr-3">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{r.name}</span>
                        <Tag>{r.code}</Tag>
                        {r.brand && <Tag tone="violet">{r.brand}</Tag>}
                      </span>
                    </td>
                    <td className="text-right py-3.5 px-3 tabular-nums">{Number(r.occupancy).toFixed(1)}%</td>
                    <td className="text-right py-3.5 px-3 tabular-nums">
                      {r.rooms_sold} <span className="text-slate-400">/ {r.rooms_available}</span>
                    </td>
                    <td className="text-right py-3.5 px-3 tabular-nums">{fmtMoney(Number(r.adr))}</td>
                    <td className="text-right py-3.5 px-3 tabular-nums">{fmtMoney(Number(r.revpar))}</td>
                    <td className="text-right py-3.5 pl-3 pr-5 sm:pr-6 tabular-nums font-medium text-slate-900">{fmtMoney(Number(r.total_revenue))}</td>
                  </tr>
                ))}
                {performance.length > 1 && (
                  <tr className="font-medium text-slate-900 bg-emerald-50 border-b border-slate-100">
                    <td className="py-3.5 pl-5 sm:pl-6 pr-3">Group</td>
                    <td className="text-right py-3.5 px-3 tabular-nums">
                      {totals.available > 0
                        ? ((totals.sold / totals.available) * 100).toFixed(1)
                        : "0.0"}
                      %
                    </td>
                    <td className="text-right py-3.5 px-3 tabular-nums">
                      {totals.sold} <span className="text-slate-400">/ {totals.available}</span>
                    </td>
                    <td className="text-right py-3.5 px-3 text-slate-400">—</td>
                    <td className="text-right py-3.5 px-3 text-slate-400">—</td>
                    <td className="text-right py-3.5 pl-3 pr-5 sm:pr-6 tabular-nums">{fmtMoney(totals.revenue)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            <p className="text-xs text-slate-500 leading-relaxed px-5 sm:px-6 py-4 max-w-4xl">
              ADR is room revenue over the rooms actually sold. RevPAR spreads the same revenue over
              every room the hotel could have sold, which is what lets two hotels of different sizes
              be compared at all. A group ADR is deliberately not shown: averaging averages across
              hotels of different sizes gives a number that means nothing.
            </p>
          </div>
        )}
      </Card>

      {/* ── The hotels ────────────────────────────────────────────────── */}

      <Card className="p-5 sm:p-6">
        <SectionTitle>The hotels</SectionTitle>
        <div className="space-y-4">
          {properties.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-lg bg-emerald-200 text-emerald-900 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Building2 className="w-4 h-4" strokeWidth={1.75} />
                </span>
                <span className="admin-display text-[15px] text-slate-900 mr-1">{p.name}</span>
                <Tag>{p.code}</Tag>
                {p.is_default && <Tag tone="gold">Website</Tag>}
                {!p.is_active && <Tag tone="red">Closed</Tag>}
                {p.id === current?.id && <Tag tone="green">You are here</Tag>}
              </div>

              {manage ? (
                <div className="space-y-3">
                  <ActionForm action={saveProperty} submitLabel="Save" className="space-y-4">
                    <input type="hidden" name="property_id" value={p.id} />
                    <div className="grid sm:grid-cols-3 gap-4">
                      <Field label="Name">
                        <input name="name" defaultValue={p.name} className={inputClass} required />
                      </Field>
                      <Field label="Brand" hint="For a group with more than one brand.">
                        <input name="brand" defaultValue={p.brand} className={inputClass} />
                      </Field>
                      <Field label="Order">
                        <input
                          name="sort_order"
                          type="number"
                          min={0}
                          max={999}
                          defaultValue={p.sort_order}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Check
                      name="is_active"
                      label="Open for business"
                      defaultChecked={p.is_active}
                      hint="A closed property keeps its records but takes no new bookings."
                    />
                  </ActionForm>

                  {!p.is_default && p.is_active && (
                    <ActionForm
                      action={setDefaultProperty}
                      submitLabel="Sell this one on the website"
                      submitClassName={secondaryButtonClass}
                      confirmMessage={`The public website will start selling ${p.name}. Continue?`}
                      className="pt-4 border-t border-slate-200"
                    >
                      <input type="hidden" name="property_id" value={p.id} />
                    </ActionForm>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  {p.city}
                  {p.brand ? ` · ${p.brand}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>

        {manage && (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <SectionTitle>Add a hotel</SectionTitle>
            <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 sm:p-5">
            <ActionForm action={createProperty} submitLabel="Add property" pendingLabel="Setting up…">
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Short code" hint="Letters and digits, e.g. DL.">
                  <input name="code" className={inputClass} maxLength={10} required />
                </Field>
                <Field label="Name">
                  <input name="name" className={inputClass} required />
                </Field>
                <Field label="Brand">
                  <input name="brand" className={inputClass} />
                </Field>
              </div>
              <Notice>
                The new hotel starts on the group&rsquo;s standards, message templates, shift
                patterns, departments and cleaning checklists. Its rooms, rates and staff are its
                own — those are what make it a different hotel, so nothing is copied.
              </Notice>
            </ActionForm>
            </div>
          </div>
        )}
      </Card>

      {/* ── Head office ───────────────────────────────────────────────── */}

      {manage && group && (
        <Card className="p-5 sm:p-6">
          <SectionTitle>Group standards</SectionTitle>
          <p className="text-sm text-slate-500 -mt-2 mb-5">
            Head office&rsquo;s copy. Editing it changes nothing at the hotels until you push it.
          </p>

          <ActionForm action={saveGroupSettings} submitLabel="Save standards">
            <Field label="Group name">
              <input name="group_name" defaultValue={group.group_name} className={inputClass} />
            </Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Default language">
                <select name="default_language" defaultValue={group.default_language} className={inputClass}>
                  {Object.entries(LANGUAGES).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Loyalty programme name">
                <input
                  name="loyalty_program_name"
                  defaultValue={group.loyalty_program_name}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Best-rate message" hint="Shown on the booking portal.">
              <textarea
                name="best_rate_message"
                defaultValue={group.best_rate_message}
                rows={2}
                className={inputClass}
              />
            </Field>

            <Field label="Invoice terms">
              <textarea name="invoice_terms" defaultValue={group.invoice_terms} rows={2} className={inputClass} />
            </Field>

            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Tax label">
                <input name="tax_label" defaultValue={group.tax_label} className={inputClass} />
              </Field>
              <Field label="Points expire after (months)">
                <input
                  name="loyalty_expiry_months"
                  type="number"
                  min={0}
                  max={120}
                  defaultValue={group.loyalty_expiry_months}
                  className={inputClass}
                />
              </Field>
              <Field label="Smallest redemption">
                <input
                  name="loyalty_min_redeem_points"
                  type="number"
                  min={0}
                  defaultValue={group.loyalty_min_redeem_points}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
              <Check name="tax_inclusive" label="Published rates include tax" defaultChecked={group.tax_inclusive} />
              <Check name="loyalty_enabled" label="Loyalty programme running" defaultChecked={group.loyalty_enabled} />
            </div>
          </ActionForm>

          <div className="mt-6 pt-6 border-t border-slate-200">
            <SectionTitle>Push to the hotels</SectionTitle>
            <ActionForm
              action={pushCentralConfig}
              submitLabel="Push"
              pendingLabel="Pushing…"
              confirmMessage="This overwrites the chosen settings at the chosen properties. Continue?"
            >
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 rounded-xl bg-slate-50 border border-slate-200 p-4">
                {(Object.keys(CENTRAL_CONFIG_ITEMS) as CentralConfigItem[]).map((key) => (
                  <Check key={key} name="items" value={key} label={CENTRAL_CONFIG_ITEMS[key]} />
                ))}
              </div>

              <Field label="To which hotels" hint="Leave all unticked to push to every open hotel.">
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 rounded-xl bg-slate-50 border border-slate-200 p-4">
                  {properties
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <Check key={p.id} name="properties" value={p.id} label={`${p.code} · ${p.name}`} />
                    ))}
                </div>
              </Field>

              <Notice tone="warn">
                A hotel can still adjust these locally afterwards — that is what makes them
                standards rather than locks. Pushing again overwrites whatever it changed.
              </Notice>
            </ActionForm>
          </div>
        </Card>
      )}
    </div>
  );
}
