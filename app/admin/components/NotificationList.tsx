import { TEMPLATE_LABELS } from "../../lib/message-templates";
import type { MessageTemplateKey, Notification } from "../../lib/types";
import { Tag, fmtDateTime } from "./ui";

/**
 * The notification history (SOW Module 16: "notification history log per
 * guest and per staff member").
 *
 * Shows skipped attempts as plainly as successful ones. That matters more
 * than it sounds: when no email provider is configured the log fills with
 * "not configured" rather than staying empty, so nobody is left believing a
 * guest was told something they never were.
 */

/** Staff alerts are not guest templates, so they are named here. */
const STAFF_TEMPLATE_LABELS: Record<string, string> = {
  staff_new_booking: "New booking alert",
  staff_vip_arrival: "VIP arrival alert",
  staff_ticket_assigned: "Ticket assigned",
  mt_urgent: "Urgent ticket alert",
  mt_escalated: "Ticket overdue alert",
};

export function templateName(template: string): string {
  return (
    STAFF_TEMPLATE_LABELS[template] ??
    TEMPLATE_LABELS[template as MessageTemplateKey]?.name ??
    template.replace(/_/g, " ")
  );
}

const tone = (status: string) =>
  status === "sent" ? "green" : status === "failed" ? "red" : "neutral";

const statusWords = (status: string) =>
  status === "skipped" ? "not configured" : status;

export default function NotificationList({
  items,
  empty = "Nothing sent yet.",
  showRecipientName = false,
}: {
  items: Notification[];
  empty?: string;
  /** Show who received it — for a log that spans several people. */
  showRecipientName?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-500">{empty}</p>;
  }

  return (
    <ul className="space-y-2.5 text-xs">
      {items.map((n) => (
        <li key={n.id} className="pb-2.5 border-b border-slate-100 last:border-0 last:pb-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-900 font-medium">{templateName(n.template)}</span>
            <span className="text-slate-500">{n.channel === "email" ? "Email" : "SMS"}</span>
            <Tag tone={tone(n.status)}>{statusWords(n.status)}</Tag>
            {n.kind === "staff" && <Tag tone="blue">Staff</Tag>}
          </span>
          <span className="block text-slate-500 mt-0.5">
            {fmtDateTime(n.created_at)} &rarr;{" "}
            {showRecipientName && n.staff?.full_name ? `${n.staff.full_name} (${n.recipient})` : n.recipient}
            {n.bookings?.reference ? ` · ${n.bookings.reference}` : ""}
          </span>
          {n.subject && <span className="block text-slate-400 mt-0.5 truncate">{n.subject}</span>}
          {n.error && <span className="block text-red-600 mt-0.5">{n.error}</span>}
        </li>
      ))}
    </ul>
  );
}
