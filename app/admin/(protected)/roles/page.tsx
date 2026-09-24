import { createClient } from "../../../lib/supabase/server";
import { requirePermission } from "../../../lib/auth";
import { PERMISSION_GROUPS } from "../../../lib/permissions";
import type { Role } from "../../../lib/types";
import { saveRole, deleteRole } from "../../actions";
import { PageHeader, Card, Field, Check, Tag, Notice, inputClass, dangerButtonClass } from "../../components/ui";
import ActionForm from "../../components/ActionForm";

function RoleFields({ role, granted }: { role?: Role; granted: Set<string> }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Name">
          <input name="name" required defaultValue={role?.name} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <input name="description" defaultValue={role?.description} className={inputClass} />
          </Field>
        </div>
      </div>
      <Check
        name="requires_2fa"
        defaultChecked={role?.requires_2fa}
        label="Require two-factor authentication"
        hint="People with this role must set up an authenticator app before they can use the panel."
      />
      {role?.is_superuser ? (
        <Notice>This role holds every permission, including ones added in future releases.</Notice>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.module} className="space-y-1.5">
              <legend className="text-xs font-medium text-yellow-700 mb-1">{g.module}</legend>
              {g.permissions.map((p) => (
                <Check key={p.key} name="permissions" value={p.key} defaultChecked={granted.has(p.key)} label={p.label} />
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </>
  );
}

export default async function RolesPage() {
  await requirePermission("roles.manage");
  const supabase = await createClient();
  const [{ data: roles }, { data: perms }, { data: staff }] = await Promise.all([
    supabase.from("roles").select("*").order("sort_order").order("name"),
    supabase.from("role_permissions").select("*"),
    supabase.from("staff").select("role"),
  ]);
  const byRole = (key: string) =>
    new Set((perms ?? []).filter((p) => p.role_key === key).map((p) => p.permission as string));
  const headcount = (key: string) => (staff ?? []).filter((s) => s.role === key).length;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role may see and do, module by module and action by action. Changes apply on each person's next page load."
      />
      <div className="space-y-6">
        <Card className="p-5">
          <details>
            <summary className="text-sm font-medium text-yellow-700 cursor-pointer">Create a custom role</summary>
            <div className="mt-5">
              <ActionForm action={saveRole} submitLabel="Create role">
                <RoleFields granted={new Set()} />
              </ActionForm>
            </div>
          </details>
        </Card>

        {((roles ?? []) as Role[]).map((role) => (
          <Card key={role.key} className="p-5">
            <details>
              <summary className="list-none cursor-pointer flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{role.name}</span>
                {role.is_system ? <Tag>Built-in</Tag> : <Tag tone="gold">Custom</Tag>}
                {role.requires_2fa && <Tag tone="violet">2FA</Tag>}
                <span className="text-xs text-slate-600">
                  {headcount(role.key)} person(s) · {role.is_superuser ? "all permissions" : `${byRole(role.key).size} permission(s)`}
                </span>
                <span className="ml-auto text-[11px] text-yellow-700">Edit</span>
              </summary>
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                <ActionForm action={saveRole} submitLabel="Save role">
                  <input type="hidden" name="key" value={role.key} />
                  <RoleFields role={role} granted={byRole(role.key)} />
                </ActionForm>
                {!role.is_system && (
                  <ActionForm
                    action={deleteRole}
                    submitLabel="Delete role"
                    submitClassName={dangerButtonClass}
                    confirmMessage={`Delete ${role.name}?`}
                    className=""
                  >
                    <input type="hidden" name="key" value={role.key} />
                  </ActionForm>
                )}
              </div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
