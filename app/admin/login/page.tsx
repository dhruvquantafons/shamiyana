import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { hasSupabaseConfig } from "../../lib/supabase/config";
import SetupNotice from "../components/SetupNotice";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  await connection();
  if (!hasSupabaseConfig()) return <SetupNotice />;

  return (
    <main className="admin-theme min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="inline-flex w-10 h-10 rounded-lg bg-yellow-400 text-slate-900 text-sm font-semibold items-center justify-center">
            SR
          </span>
          <p className="text-lg font-semibold text-slate-900 mt-3">Shamiyana</p>
          <p className="text-sm text-slate-500">Sign in to property management</p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
          <Suspense
            fallback={<p className="text-sm text-slate-500 text-center py-8">Loading…</p>}
          >
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">
          Staff access only. Ask an administrator for an account.
        </p>
      </div>
    </main>
  );
}
