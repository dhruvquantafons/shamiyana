import Link from "next/link";
import { createClient } from "../../../lib/supabase/server";
import { requireAnyPermission } from "../../../lib/auth";
import { TEMPLATE_LABELS } from "../../../lib/message-templates";
import type { Notification, Staff } from "../../../lib/types";
import { PageHeader, Card, StatCard, Notice, inputClass } from "../../components/ui";
import NotificationList, { templateName } from "../../components/NotificationList";

/**
 * The notification log (SOW Module 16: "notification history log per guest
 * and per staff member").
 *
 * A guest's own history also appears on their profile, and a booking's on its
 * activity tab; this is the whole log, filterable, for answering "was that
 * reminder actually sent?" and "is the SMS provider failing?".
 */

const STAFF_TEMPLATES = [
  "staff_new_booking",
  "staff_vip_arrival",
  "staff_ticket_assigned",
  "mt_urgent",
  "mt_escalated",
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; template?: string; staff?: string }>;
}) {
  await requireAnyPermission(["guests.view", "settings.manage", "audit.view"]);
  const supabase = await createClient();
  const params = await searchParams;

  let query = supabase
    .from("notifications")
    .select("*, bookings(id, reference), staff:staff_id(id, full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.kind === "guest" || params.kind === "staff") query = query.eq("kind", params.kind);
  if (params.status && ["sent", "skipped", "failed"].includes(params.status)) {
    query = query.eq("status", params.status);
  }
  if (params.template) query = query.eq("template", params.template);
  if (params.staff && /^[0-9a-f-]{36}$/i.test(params.staff)) query = query.eq("staff_id", params.staff);

  const [{ data: rows }, { data: people }] = await Promise.all([
    query,
    supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const items = (rows ?? []) as unknown as Notification[];
  const staffList = (people ?? []) as Pick<Staff, "id" | "full_name">[];

  const counted = (status: string) => items.filter((n) => n.status === status).length;

  return (
    <>
      <PageHeader
        title="Notification log"
        description="Every guest message and staff alert this system has attempted, successful or not. The most recent 200 are shown."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Shown" value={items.length} />
        <StatCard label="Sent" value={counted("sent")} />
        <StatCard
          label="Not configured"
          value={counted("skipped")}
          hint={counted("skipped") > 0 ? "No email or SMS provider set" : undefined}
        />
        <StatCard label="Failed" value={counted("failed")} />
      </div>

      {counted("skipped") > 0 && (
        <div className="mb-6">
          <Notice tone="warn">
            Some attempts were not sent because no provider is configured. Set{" "}
            <span className="font-mono">RESEND_API_KEY</span> for email and the Twilio keys for SMS. Until then the
            hotel is recording what it would have sent, but guests are not receiving it.
          </Notice>
        </div>
      )}

      <Card className="p-5 mb-6">
        <form className="flex flex-wrap items-end gap-3 text-xs">
          <label className="text-slate-600">
            Audience
            <select name="kind" defaultValue={params.kind ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Everyone</option>
              <option value="guest">Guests</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <label className="text-slate-600">
            Outcome
            <select name="status" defaultValue={params.status ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Any</option>
              <option value="sent">Sent</option>
              <option value="skipped">Not configured</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="text-slate-600">
            Message
            <select name="template" defaultValue={params.template ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Any</option>
              {Object.entries(TEMPLATE_LABELS).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.name}
                </option>
              ))}
              {STAFF_TEMPLATES.map((key) => (
                <option key={key} value={key}>
                  {templateName(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-slate-600">
            Staff member
            <select name="staff" defaultValue={params.staff ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Anyone</option>
              {staffList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="px-4 py-2 rounded-md border border-slate-300 hover:border-yellow-500 transition-colors"
          >
            Filter
          </button>
          <Link href="/admin/notifications" className="text-slate-500 hover:text-yellow-700 px-2 py-2">
            Clear
          </Link>
        </form>
      </Card>

      <Card className="p-5">
        <NotificationList
          items={items}
          showRecipientName
          empty="Nothing matches those filters."
        />
      </Card>

      <p className="text-xs text-slate-500 mt-4">
        A guest&apos;s own history is on their profile, and a booking&apos;s on its activity tab. Wording is edited
        under{" "}
        <Link href="/admin/settings/templates" className="text-yellow-700 underline">
          Settings → Templates
        </Link>
        .
      </p>
    </>
  );
}
