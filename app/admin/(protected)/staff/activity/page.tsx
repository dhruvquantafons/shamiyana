import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient, createServiceClient } from "../../../../lib/supabase/server";
import { requirePermission } from "../../../../lib/auth";
import { can } from "../../../../lib/permissions";
import { getSettings } from "../../../../lib/settings";
import { addDays, minutesSince, todayIn, zonedTime } from "../../../../lib/dates";
import type { Role, Staff } from "../../../../lib/types";
import { endStaffSessions } from "../../../actions";
import { Card, EmptyState, PageHeader, SectionTitle, StatCard, Tag, dangerButtonClass, tableHeadClass, fmtDateTime } from "../../../components/ui";
import ActionForm from "../../../components/ActionForm";

type Attempt = { email: string; succeeded: boolean; ip: string; attempted_at: string };

/** Who is signed in, recent sign-ins and failures, and ending sessions (Module 15). */
export default async function StaffActivityPage() {
  const session = await requirePermission("staff.manage");
  const supabase = await createClient();
  const settings = await getSettings();
  const today = todayIn(settings.timezone);
  const dayStart = zonedTime(today, "00:00", settings.timezone).toISOString();
  const since = zonedTime(addDays(today, -7), "00:00", settings.timezone).toISOString();

  const [{ data: staffRows }, { data: roleRows }, { data: actions }] = await Promise.all([
    supabase.from("staff").select("*").order("full_name"),
    supabase.from("roles").select("key, name"),
    can(session, "audit.view")
      ? supabase.from("audit_log").select("actor_id").gte("occurred_at", dayStart).limit(10000)
      : Promise.resolve({ data: null }),
  ]);
  // Sign-in attempts are readable only with the service key.
  let attempts: Attempt[] = [];
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createServiceClient()
      .from("login_attempts")
      .select("email, succeeded, ip, attempted_at")
      .gte("attempted_at", since)
      .order("attempted_at", { ascending: false })
      .limit(500);
    attempts = (data ?? []) as Attempt[];
  }

  const staff = (staffRows ?? []) as Staff[];
  const roleName = new Map(((roleRows ?? []) as Pick<Role, "key" | "name">[]).map((r) => [r.key, r.name]));
  const online = staff.filter((s) => s.is_active && s.last_seen_at && minutesSince(s.last_seen_at) <= settings.session_timeout_minutes);
  const lastSignIn = (email: string) => attempts.find((a) => a.succeeded && a.email.toLowerCase() === email.toLowerCase());
  const failures = (email: string) =>
    attempts.filter((a) => !a.succeeded && a.email.toLowerCase() === email.toLowerCase() && minutesSince(a.attempted_at) <= 24 * 60).length;
  const actionsToday = (id: string) => (actions ?? []).filter((a) => a.actor_id === id).length;
  const unknownFailures = attempts.filter((a) => !a.succeeded && !staff.some((s) => s.email.toLowerCase() === a.email.toLowerCase()));

  return (
    <>
      <Link href="/admin/staff" className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-yellow-700 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Staff
      </Link>
      <PageHeader title="Activity & sessions" description="Who is signed in, sign-in history, and ending someone's sessions." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active now" value={online.length} hint={`seen in the last ${settings.session_timeout_minutes} min`} />
        <StatCard label="Sign-ins (7 days)" value={attempts.filter((a) => a.succeeded).length} />
        <StatCard label="Failed sign-ins (7 days)" value={attempts.filter((a) => !a.succeeded).length} />
        <StatCard label="Unknown emails tried" value={new Set(unknownFailures.map((a) => a.email.toLowerCase())).size} />
      </div>

      <Card className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={tableHeadClass}>
                <th className="px-4 py-2.5 font-medium">Staff</th>
                <th className="px-4 py-2.5 font-medium">Last active</th>
                <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                <th className="px-4 py-2.5 font-medium">Failed (24 h)</th>
                {actions && <th className="px-4 py-2.5 font-medium">Changes today</th>}
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((s) => {
                const isOnline = online.includes(s);
                const last = lastSignIn(s.email);
                const failed = failures(s.email);
                return (
                  <tr key={s.id} className={s.is_active ? "" : "opacity-60"}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-900">{s.full_name || s.email}</span>
                      <span className="block text-xs text-slate-500">
                        {roleName.get(s.role) ?? s.role}
                        {!s.is_active && " · suspended"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {isOnline ? <Tag tone="green">Active now</Tag> : s.last_seen_at ? fmtDateTime(s.last_seen_at) : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {last ? (
                        <>
                          {fmtDateTime(last.attempted_at)}
                          {last.ip && <span className="block text-slate-400">{last.ip}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5">{failed ? <Tag tone={failed >= settings.max_failed_logins ? "red" : "amber"}>{failed}</Tag> : "—"}</td>
                    {actions && <td className="px-4 py-2.5">{actionsToday(s.id) || "—"}</td>}
                    <td className="px-4 py-2.5 text-right">
                      {s.id !== session.staff.id && s.is_active && (
                        <ActionForm
                          action={endStaffSessions}
                          submitLabel="End sessions"
                          submitClassName={`${dangerButtonClass} !py-1 !text-xs`}
                          confirmMessage={`Sign ${s.full_name || s.email} out on every device?`}
                          className=""
                        >
                          <input type="hidden" name="id" value={s.id} />
                        </ActionForm>
                      )}
                      {s.sessions_revoked_at && (
                        <span className="block text-[11px] text-slate-400 mt-1">ended {fmtDateTime(s.sessions_revoked_at)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="px-4 pt-4">
          <SectionTitle>Sign-in attempts · last 7 days</SectionTitle>
        </div>
        {attempts.length === 0 ? (
          <EmptyState message={process.env.SUPABASE_SERVICE_ROLE_KEY ? "No sign-in attempts." : "Needs the service role key."} />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {attempts.slice(0, 100).map((a, i) => (
              <li key={`${a.attempted_at}-${i}`} className="px-4 py-2 flex flex-wrap gap-x-4 items-center">
                <span className="w-36 text-xs text-slate-500">{fmtDateTime(a.attempted_at)}</span>
                <span className="flex-1 min-w-[180px]">{a.email}</span>
                <span className="text-xs text-slate-400 w-32">{a.ip || "—"}</span>
                {a.succeeded ? <Tag tone="green">Signed in</Tag> : <Tag tone="red">Failed</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
