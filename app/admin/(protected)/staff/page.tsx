import { Info } from "lucide-react";
import { createClient } from "../../../lib/supabase/server";
import Link from "next/link";
import { requirePermission } from "../../../lib/auth";
import type { Role, Staff } from "../../../lib/types";
import { PageHeader, Card, EmptyState, fmtDateTime } from "../../components/ui";
import { getProperties, getCurrentProperty } from "../../../lib/properties";
import StaffMemberForm from "./StaffMemberForm";
import AddStaffForm from "./AddStaffForm";
import StaffAccountActions from "./StaffAccountActions";

export default async function StaffPage() {
  const session = await requirePermission("staff.manage");
  const me = session.staff;
  const supabase = await createClient();

  const [{ data }, { data: roleRows }] = await Promise.all([
    supabase.from("staff").select("*").order("created_at", { ascending: true }),
    supabase.from("roles").select("*").order("sort_order"),
  ]);

  const members = (data ?? []) as Staff[];
  const roles = (roleRows ?? []) as Role[];

  // Only the hotels this administrator may work at, so assigning somebody to a
  // property is held to the same boundary as everything else (Module 14).
  const [properties, current] = await Promise.all([getProperties(), getCurrentProperty()]);
  const propertyOptions = properties.map((p) => ({ id: p.id, code: p.code, name: p.name }));
  const incomplete = members.filter((m) => !m.full_name.trim()).length;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Details, roles and access for everyone who can sign in."
        action={
          <Link href="/admin/staff/activity" className="text-sm text-yellow-800 hover:text-yellow-900">
            Activity &amp; sessions →
          </Link>
        }
      />

      <div className="flex items-start gap-2.5 text-xs bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-4 py-3 mb-6">
        <Info className="w-4 h-4 shrink-0 mt-px text-yellow-700" />
        <div className="font-light leading-relaxed space-y-1.5">
          <p>
            A <strong className="font-medium">role</strong> sets what someone can reach in
            this panel. Their actual job — Waiter, Head Chef, Night Manager — goes in{" "}
            <strong className="font-medium">job title</strong>, which is free text.
          </p>
          <p>
            What each role can do is set on the{" "}
            <Link href="/admin/roles" className="text-yellow-700 font-medium">
              Roles
            </Link>{" "}
            page. Roles marked 2FA require an authenticator app at sign-in.
          </p>
        </div>
      </div>

      <Card className="p-5 mb-6">
        <AddStaffForm roles={roles} properties={propertyOptions} currentProperty={current?.id ?? null} />
      </Card>

      {incomplete > 0 && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-2.5 mb-6">
          {incomplete} staff member{incomplete === 1 ? " has" : "s have"} no name recorded yet.
        </p>
      )}

      {members.length === 0 ? (
        <Card>
          <EmptyState message="No staff accounts yet." />
        </Card>
      ) : (
        <div className="space-y-5">
          {members.map((member) => (
            <Card key={member.id} className="p-5 space-y-4">
              <StaffMemberForm
                member={member}
                isSelf={member.id === me.id}
                roles={roles}
                properties={propertyOptions}
              />

              <div className="pt-4 border-t border-slate-100 space-y-3">
                {member.id !== me.id && <StaffAccountActions member={member} />}
                <p className="text-[11px] text-slate-400">
                  Account created {fmtDateTime(member.created_at)}
                  {member.last_seen_at ? ` · last active ${fmtDateTime(member.last_seen_at)}` : " · never signed in"}
                  {` · password set ${fmtDateTime(member.password_changed_at)}`}
                  {member.must_change_password ? " · must change password" : ""}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
