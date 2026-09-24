import Link from "next/link";
import { requirePermission } from "../../../lib/auth";
import { LANGUAGES } from "../../../lib/types";
import { getSettings, hhmm, taxSlabsOf } from "../../../lib/settings";
import { emailConfigured, smsConfigured } from "../../../lib/integrations";
import { saveSettings } from "../../actions";
import { PageHeader, Card, Field, Check, Notice, Tag, SectionTitle, inputClass, fmtDate } from "../../components/ui";
import ActionForm from "../../components/ActionForm";

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const s = await getSettings();
  const slabs = taxSlabsOf(s)
    .map((x) => `${x.up_to ?? "*"} ${x.rate}`)
    .join("\n");

  const feeSelect = (name: string, value: string) => (
    <select name={name} defaultValue={value} className={inputClass}>
      <option value="none">No charge</option>
      <option value="percent">Percent of nightly rate</option>
      <option value="flat">Flat amount (₹)</option>
    </select>
  );

  return (
    <>
      <PageHeader title="Settings" description="Property details, policies, tax and security. Business date is moved only by night audit." />
      <ActionForm action={saveSettings} submitLabel="Save settings" className="space-y-6">
        <Card className="p-5 space-y-4">
          <SectionTitle>Property</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Hotel name">
              <input name="name" defaultValue={s.name} required className={inputClass} />
            </Field>
            <Field label="Legal name">
              <input name="legal_name" defaultValue={s.legal_name} className={inputClass} />
            </Field>
            <Field label="GSTIN">
              <input name="gstin" defaultValue={s.gstin} maxLength={15} className={`${inputClass} uppercase`} />
            </Field>
          </div>
          <Field label="Address">
            <input name="address" defaultValue={s.address} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="City">
              <input name="city" defaultValue={s.city} className={inputClass} />
            </Field>
            <Field label="State">
              <input name="state" defaultValue={s.state} className={inputClass} />
            </Field>
            <Field label="Country">
              <input name="country" defaultValue={s.country} className={inputClass} />
            </Field>
            <Field label="PIN code">
              <input name="postcode" defaultValue={s.postcode} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Phone">
              <input name="phone" defaultValue={s.phone} className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" defaultValue={s.email} className={inputClass} />
            </Field>
            <Field label="Currency">
              <input name="currency" defaultValue={s.currency} maxLength={3} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Timezone">
              <input name="timezone" defaultValue={s.timezone} className={inputClass} />
            </Field>
          </div>
          <p className="text-xs text-slate-600">Business date: {fmtDate(s.business_date)}</p>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Front desk policy</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Field label="Check-in from">
              <input type="time" name="check_in_time" defaultValue={hhmm(s.check_in_time)} className={inputClass} />
            </Field>
            <Field label="Check-out by">
              <input type="time" name="check_out_time" defaultValue={hhmm(s.check_out_time)} className={inputClass} />
            </Field>
            <Field label="Tentative hold (hours)" hint="Night audit releases unconfirmed holds after this.">
              <input type="number" name="hold_hours" min={1} max={720} defaultValue={s.hold_hours} className={inputClass} />
            </Field>
            <Field label="Cleaning target (minutes)" hint="Default turnaround per room; room types can override.">
              <input type="number" name="hk_default_minutes" min={5} max={480} defaultValue={s.hk_default_minutes} className={inputClass} />
            </Field>
            <Field label="Deep clean every (days)">
              <input type="number" name="hk_deep_clean_days" min={1} max={365} defaultValue={s.hk_deep_clean_days} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Early check-in fee">{feeSelect("early_checkin_fee_type", s.early_checkin_fee_type)}</Field>
            <Field label="Value">
              <input type="number" name="early_checkin_fee_value" min={0} step="0.01" defaultValue={s.early_checkin_fee_value} className={inputClass} />
            </Field>
            <Field label="Late check-out fee">{feeSelect("late_checkout_fee_type", s.late_checkout_fee_type)}</Field>
            <Field label="Value">
              <input type="number" name="late_checkout_fee_value" min={0} step="0.01" defaultValue={s.late_checkout_fee_value} className={inputClass} />
            </Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Tax</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Tax name">
              <input name="tax_label" defaultValue={s.tax_label} className={inputClass} />
            </Field>
            <Field label="Room tax slabs" hint='One per line: "ceiling rate". Last line "* rate". Per room per night.'>
              <textarea name="tax_slabs" rows={3} defaultValue={slabs} className={`${inputClass} font-mono`} />
            </Field>
            <div className="pt-6">
              <Check name="tax_inclusive" defaultChecked={s.tax_inclusive} label="Published rates include tax" />
            </div>
          </div>
          <Notice tone="warn">
            Seeded with India&apos;s accommodation GST from 22 September 2025 (5% up to ₹7,500, 18% above). Confirm with
            the hotel&apos;s accountant.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Billing &amp; invoicing</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Invoice number prefix" hint="Numbers read PREFIX/2026-27/0001.">
              <input name="invoice_prefix" defaultValue={s.invoice_prefix} maxLength={10} className={`${inputClass} uppercase`} />
            </Field>
            <Field label="Refund approval above (₹)" hint="0 = every refund needs approval.">
              <input type="number" name="refund_approval_threshold" min={0} step="0.01" defaultValue={s.refund_approval_threshold} className={inputClass} />
            </Field>
            <div className="pt-6">
              <Check
                name="online_payments_enabled"
                defaultChecked={s.online_payments_enabled}
                label="Offer online payment links"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Outlet charges per stay (₹)" hint="Most a stay may carry unpaid from the outlets. 0 = no limit.">
              <input
                type="number"
                name="pos_room_charge_limit"
                min={0}
                step="0.01"
                defaultValue={s.pos_room_charge_limit}
                className={inputClass}
              />
            </Field>
            <Field label="Chase accounts overdue by (days)" hint="Used by the city ledger chase list.">
              <input
                type="number"
                name="ar_reminder_days"
                min={0}
                max={180}
                defaultValue={s.ar_reminder_days}
                className={inputClass}
              />
            </Field>
            <div className="pt-6 sm:col-span-2">
              <Check
                name="multi_currency_enabled"
                defaultChecked={s.multi_currency_enabled}
                label="Let the desk take payment in another currency"
                hint="Rates are maintained under Billing → Currencies. Amounts are always stored in the property's own currency."
              />
            </div>
          </div>
          <Field
            label="Monthly operating cost (₹)"
            hint="Used only to report GOPPAR, prorated over the days reported. 0 = GOPPAR is not reported."
          >
            <input
              type="number"
              name="monthly_operating_cost"
              min={0}
              step="0.01"
              defaultValue={s.monthly_operating_cost}
              className={inputClass}
            />
          </Field>
          <Field label="Invoice terms" hint="Printed at the foot of every invoice.">
            <textarea name="invoice_terms" rows={2} defaultValue={s.invoice_terms} className={inputClass} />
          </Field>
          <Notice tone="warn">
            Invoice numbers are sequential per financial year and are never reused. Changing the prefix starts a new
            series; it does not renumber invoices already issued.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Notifications</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Pre-arrival reminder (days before)" hint="0 = do not send it.">
              <input
                type="number"
                name="notify_pre_arrival_days"
                min={0}
                max={30}
                defaultValue={s.notify_pre_arrival_days}
                className={inputClass}
              />
            </Field>
            <Field label="Check-in instructions (days before)" hint="Times, ID needed, how to reach us. 0 = off.">
              <input
                type="number"
                name="notify_checkin_days"
                min={0}
                max={30}
                defaultValue={s.notify_checkin_days}
                className={inputClass}
              />
            </Field>
            <Field label="Thank-you & feedback (days after)" hint="Sent after departure with the feedback link. 0 = off.">
              <input
                type="number"
                name="notify_post_stay_days"
                min={0}
                max={30}
                defaultValue={s.notify_post_stay_days}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Check
              name="notify_staff_new_booking"
              defaultChecked={s.notify_staff_new_booking}
              label="Tell the team about new bookings"
            />
            <Check
              name="notify_staff_vip_arrival"
              defaultChecked={s.notify_staff_vip_arrival}
              label="Alert the desk when a VIP arrives today"
            />
            <Check
              name="notify_staff_ticket_assigned"
              defaultChecked={s.notify_staff_ticket_assigned}
              label="Tell staff when a maintenance ticket is assigned to them"
            />
          </div>
          <Notice>
            The three timed guest messages go out from the nightly job, which needs{" "}
            <span className="font-mono">CRON_SECRET</span> set. Wording for every message is edited under{" "}
            <Link href="/admin/settings/templates" className="text-yellow-700 underline">
              Templates
            </Link>
            , per language. Email needs <span className="font-mono">RESEND_API_KEY</span> and SMS needs the Twilio
            keys; without them each attempt is still recorded as &ldquo;not configured&rdquo; so nothing is lost
            silently.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Guest booking portal</SectionTitle>
          <Field
            label="Best-rate guarantee message"
            hint="Shown on the booking panel (SOW Module 17). Leave empty to show nothing."
          >
            <textarea
              name="best_rate_message"
              rows={2}
              defaultValue={s.best_rate_message}
              className={inputClass}
            />
          </Field>
          <Notice>
            Guests sign in to <span className="font-medium">/account</span> with a one-time code
            emailed to them — there is no password to reset. A guest who books by phone or at the
            desk sees that stay as soon as they sign in with the same email address.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Revenue &amp; dynamic pricing</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Field
              label="Approve changes over (%)"
              hint="A rule's rate change this size or smaller goes live on its own. 0 = every change is approved by hand."
            >
              <input
                type="number"
                name="revenue_auto_approve_percent"
                min={0}
                max={100}
                step="0.01"
                defaultValue={s.revenue_auto_approve_percent}
                className={inputClass}
              />
            </Field>
            <Field label="Forecast horizon (nights)" hint="How far ahead the forecast looks and the rules price.">
              <input
                type="number"
                name="revenue_forecast_days"
                min={7}
                max={365}
                defaultValue={s.revenue_forecast_days}
                className={inputClass}
              />
            </Field>
            <Field label="Never sell below (₹)" hint="Holds every pricing rule above this. 0 = no floor.">
              <input
                type="number"
                name="revenue_floor_rate"
                min={0}
                step="1"
                defaultValue={s.revenue_floor_rate}
                className={inputClass}
              />
            </Field>
            <Field label="Never sell above (₹)" hint="Holds every pricing rule below this. 0 = no ceiling.">
              <input
                type="number"
                name="revenue_ceiling_rate"
                min={0}
                step="1"
                defaultValue={s.revenue_ceiling_rate}
                className={inputClass}
              />
            </Field>
          </div>
          <Notice>
            The floor and ceiling are the last word on any rule&apos;s output, so a mistyped rule can embarrass the
            hotel by a little rather than by a lot. Each waiting change is judged against the threshold that was in
            force when the rules ran, so raising it here does not approve what is already in the queue.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Events &amp; banquets</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="Quotation approval above (₹)"
              hint="A quotation at or above this needs a second person's approval. 0 = every quotation does."
            >
              <input
                type="number"
                name="event_quote_approval_threshold"
                min={0}
                step="0.01"
                defaultValue={s.event_quote_approval_threshold}
                className={inputClass}
              />
            </Field>
            <Field label="Service charge (%)" hint="Added to every event and taxed at the hall's own rate. 0 = none.">
              <input
                type="number"
                name="event_service_charge_percent"
                min={0}
                max={100}
                step="0.01"
                defaultValue={s.event_service_charge_percent}
                className={inputClass}
              />
            </Field>
            <Field label="Deposit asked for (%)" hint="Shown on the quotation and the contract as what holds the date.">
              <input
                type="number"
                name="event_advance_percent"
                min={0}
                max={100}
                step="0.01"
                defaultValue={s.event_advance_percent}
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Function contract terms"
            hint="Printed on every function contract: cancellation terms, the head-count deadline, what damage is charged for."
          >
            <textarea name="event_terms" rows={4} defaultValue={s.event_terms} className={inputClass} />
          </Field>
          <Notice tone="info">
            The hall&apos;s own rates, its seating plans, the per-head catering packages and the equipment list are
            maintained under <strong>Events &amp; banquets → Hall &amp; packages</strong>, not here.
          </Notice>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle>Security &amp; data</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Sign out after idle (minutes)">
              <input type="number" name="session_timeout_minutes" min={5} max={720} defaultValue={s.session_timeout_minutes} className={inputClass} />
            </Field>
            <Field label="Minimum password length">
              <input type="number" name="password_min_length" min={8} max={128} defaultValue={s.password_min_length} className={inputClass} />
            </Field>
            <Field label="Password expiry (days)" hint="0 = never.">
              <input type="number" name="password_max_age_days" min={0} max={3650} defaultValue={s.password_max_age_days} className={inputClass} />
            </Field>
            <Field label="Lock after failed sign-ins">
              <input type="number" name="max_failed_logins" min={3} max={50} defaultValue={s.max_failed_logins} className={inputClass} />
            </Field>
            <Field label="Lockout (minutes)">
              <input type="number" name="lockout_minutes" min={1} max={1440} defaultValue={s.lockout_minutes} className={inputClass} />
            </Field>
            <Field label="Keep ID scans (days)" hint="Purged at night audit.">
              <input type="number" name="id_document_retention_days" min={30} max={3650} defaultValue={s.id_document_retention_days} className={inputClass} />
            </Field>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <SectionTitle
            action={
              <Link href="/admin/settings/templates" className="text-xs text-yellow-800 hover:text-yellow-900">
                Edit message templates →
              </Link>
            }
          >
            Languages
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Default language" hint="Used for guests whose language has no template.">
              <select name="default_language" defaultValue={s.default_language} className={inputClass}>
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <p className="text-xs font-medium text-slate-700 mb-2">Languages for guest messages</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(LANGUAGES).map(([code, name]) => (
                  <Check key={code} name="languages" value={code} label={name} defaultChecked={s.languages.includes(code)} />
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Each enabled language gets its own version of every message template. The staff panel itself is in English.
          </p>
        </Card>

        <Card className="p-5">
          <SectionTitle>Integrations</SectionTitle>
          <p className="text-sm text-slate-700 space-x-3">
            <span>Email {emailConfigured() ? <Tag tone="green">connected</Tag> : <Tag>not set</Tag>}</span>
            <span>SMS {smsConfigured() ? <Tag tone="green">connected</Tag> : <Tag>not set</Tag>}</span>
            <span>
              Door locks {process.env.DOOR_LOCK_WEBHOOK_URL ? <Tag tone="green">connected</Tag> : <Tag>not set</Tag>}
            </span>
          </p>
          <p className="text-[11px] text-slate-500 mt-2">Configured with environment variables; see README.</p>
        </Card>
      </ActionForm>
    </>
  );
}
