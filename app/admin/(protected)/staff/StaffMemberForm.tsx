"use client";

import { keepFormOnSubmit } from "../../components/useKeepForm";

import { useActionState } from "react";
import type { Property, Role, Staff } from "../../../lib/types";
import { updateStaffMember } from "../../actions";
import type { ActionState } from "../../form-utils";
import { Field, inputClass, buttonClass, Banner, Check } from "../../components/ui";

export default function StaffMemberForm({
  member,
  isSelf,
  roles,
  properties = [],
}: {
  member: Staff;
  isSelf: boolean;
  roles: Role[];
  /** The hotels this person can be assigned to (SOW Module 14). */
  properties?: Pick<Property, "id" | "code" | "name">[];
}) {
  const role = roles.find((r) => r.key === member.role);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateStaffMember,
    {},
  );

  return (
    <form action={formAction} onSubmit={keepFormOnSubmit(formAction)} className="space-y-4">
      <input type="hidden" name="id" value={member.id} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {member.full_name || "Unnamed staff member"}
            {isSelf && (
              <span className="ml-2 text-[11px] text-yellow-700 font-sans font-normal">
                (you)
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-500">{member.email}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full border border-yellow-200 bg-yellow-50 text-yellow-800">
            {role?.name ?? member.role}
          </span>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border ${
              member.is_active
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-rose-50 text-rose-800 border-rose-200"
            }`}
          >
            {member.is_active ? "Active" : "Suspended"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Full name">
          <input name="full_name" defaultValue={member.full_name} required className={inputClass} />
        </Field>
        <Field label="Job title">
          <input
            name="job_title"
            defaultValue={member.job_title}
            placeholder="Front Office Manager"
            className={inputClass}
          />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" defaultValue={member.phone} className={inputClass} />
        </Field>
      </div>

      {isSelf ? (
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          You can edit your own details, but not your own role or access — that
          prevents an administrator locking the whole team out by accident.
          Another administrator can change them for you.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Role" hint={role?.description}>
            <select name="role" defaultValue={member.role} className={inputClass}>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                  {r.requires_2fa ? " (2FA)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Access" hint="Suspending takes effect on their next request.">
            <select
              name="is_active"
              defaultValue={String(member.is_active)}
              className={inputClass}
            >
              <option value="true">Active</option>
              <option value="false">Suspended</option>
            </select>
          </Field>

          {properties.length > 1 && (
            <>
              <Field label="Works at" hint="Everything they see and report on is this hotel.">
                <select
                  name="property_id"
                  defaultValue={member.property_id ?? ""}
                  className={inputClass}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="self-end pb-2">
                <Check
                  name="all_properties"
                  value="true"
                  label="Head office"
                  defaultChecked={member.all_properties ?? false}
                  hint="Sees and switches between every hotel in the group."
                />
              </div>
            </>
          )}
        </div>
      )}

      <Banner error={state.error} success={state.success} />

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
