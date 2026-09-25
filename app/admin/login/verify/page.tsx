import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "../../../lib/auth";
import { verifyTotp } from "../../security-actions";
import { isDemoTwoFactor, demoCode } from "../../../lib/two-factor";
import { signOut } from "../../actions";
import { Field, inputClass } from "../../components/ui";
import ActionForm from "../../components/ActionForm";
import { adminFonts } from "../../fonts";

export const metadata: Metadata = { title: "Verify sign-in", robots: { index: false, follow: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (session.aal.current === "aal2" || session.aal.next !== "aal2") redirect("/admin");
  const { next = "/admin" } = await searchParams;

  return (
    <main className={`admin-theme ${adminFonts} min-h-screen bg-slate-50 flex items-center justify-center p-4`}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-7 space-y-4">
        <div>
          <p className="admin-display text-xl text-slate-900">Two-step verification</p>
          <p className="text-sm text-slate-600 mt-1">Enter the 6-digit code from your authenticator app.</p>
        </div>
        {isDemoTwoFactor() && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
            Demo mode — the code is <strong className="font-mono tracking-widest">{demoCode()}</strong>.
          </p>
        )}
        <ActionForm action={verifyTotp} submitLabel="Verify" pendingLabel="Checking…">
          <input type="hidden" name="next" value={next} />
          <Field label="Code">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              autoFocus
              required
              className={`${inputClass} text-center text-lg tracking-[0.4em]`}
            />
          </Field>
        </ActionForm>
        <form action={signOut}>
          <button className="text-xs text-slate-600 hover:text-yellow-700 cursor-pointer">Use a different account</button>
        </form>
      </div>
    </main>
  );
}
