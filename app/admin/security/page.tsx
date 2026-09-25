import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "../../lib/auth";
import { getSettings } from "../../lib/settings";
import { passwordExpired } from "../../lib/password-policy";
import { changeOwnPassword } from "../security-actions";
import { signOut } from "../actions";
import { Card, Field, Notice, inputClass } from "../components/ui";
import ActionForm from "../components/ActionForm";
import TwoFactorPanel from "./TwoFactorPanel";
import { isDemoTwoFactor, demoCode } from "../../lib/two-factor";
import { adminFonts } from "../fonts";

export const metadata: Metadata = { title: "Password & 2FA", robots: { index: false, follow: false } };

/**
 * Lives outside the (protected) layout on purpose: the layout redirects here
 * when 2FA or a password change is required, so this page must not apply
 * those same checks or it would loop.
 */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  await connection();
  const session = await getSession();
  if (!session) redirect("/admin/login");
  // A second factor already enrolled must be used before changing anything.
  if (session.aal.next === "aal2" && session.aal.current !== "aal2") redirect("/admin/login/verify?next=/admin/security");

  const { required } = await searchParams;
  const settings = await getSettings();
  const mustChange =
    session.staff.must_change_password || passwordExpired(session.staff.password_changed_at, settings.password_max_age_days);
  const needs2fa = session.role.requires_2fa && !session.hasTotp;
  const blocked = mustChange || needs2fa;

  return (
    <main className={`admin-theme ${adminFonts} min-h-screen bg-slate-50 p-4 sm:p-8`}>
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="admin-display text-2xl text-slate-900">Password &amp; two-factor</p>
            <p className="text-sm text-slate-600">
              {session.staff.full_name || session.staff.email} · {session.role.name}
            </p>
          </div>
          {blocked ? (
            <form action={signOut}>
              <button className="text-xs text-slate-600 hover:text-yellow-700 cursor-pointer">Sign out</button>
            </form>
          ) : (
            <Link href="/admin" className="text-xs text-yellow-700">
              Back to the panel →
            </Link>
          )}
        </div>

        {required && blocked && (
          <Notice tone="warn">
            {mustChange && <p>Please choose a new password before continuing.</p>}
            {needs2fa && <p>Your role requires two-factor authentication. Set it up below to continue.</p>}
          </Notice>
        )}

        <Card className="p-5">
          <p className="text-base font-semibold mb-4">Change password</p>
          <ActionForm action={changeOwnPassword} submitLabel="Change password">
            <Field label="Current password">
              <input type="password" name="current_password" required autoComplete="current-password" className={inputClass} />
            </Field>
            <Field
              label="New password"
              hint={`At least ${settings.password_min_length} characters with upper and lower case, a number and a symbol.`}
            >
              <input type="password" name="password" required autoComplete="new-password" className={inputClass} />
            </Field>
            <Field label="Repeat new password">
              <input type="password" name="confirm" required autoComplete="new-password" className={inputClass} />
            </Field>
          </ActionForm>
        </Card>

        <Card className="p-5">
          <p className="text-base font-semibold mb-1">Two-factor authentication</p>
          <p className="text-sm text-slate-600 mb-4">
            {session.hasTotp
              ? session.role.requires_2fa && isDemoTwoFactor()
                ? "On — required by your role. You enter a code at each sign-in."
                : "On. You enter a code at each sign-in."
              : isDemoTwoFactor()
                ? "Off."
                : "Off. Use Google Authenticator, Microsoft Authenticator, 1Password or similar."}
          </p>
          <TwoFactorPanel
            enabled={session.hasTotp}
            required={session.role.requires_2fa}
            demoCode={isDemoTwoFactor() ? demoCode() : null}
          />
        </Card>
      </div>
    </main>
  );
}
