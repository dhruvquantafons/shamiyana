import { Database } from "lucide-react";

/** Shown in place of the admin panel until Supabase credentials exist. */
export default function SetupNotice() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-lg border border-slate-200 p-7 shadow-sm">
        <div className="w-11 h-11 rounded-full bg-yellow-50 text-yellow-700 flex items-center justify-center mb-4">
          <Database className="w-5 h-5" />
        </div>

        <h1 className="text-lg font-semibold text-slate-900 mb-2">
          Reservations desk not configured
        </h1>
        <p className="text-sm text-slate-700 leading-relaxed mb-5">
          The admin panel needs a Supabase project before it can run. The public
          website is unaffected and continues to serve the published tariff.
        </p>

        <ol className="text-sm text-slate-700 space-y-2.5 list-decimal pl-5 mb-5">
          <li>
            Create a project at{" "}
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-yellow-700 underline"
            >
              supabase.com/dashboard
            </a>
            .
          </li>
          <li>
            Run <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px]">supabase/migrations/0001_init.sql</code>{" "}
            in the SQL editor.
          </li>
          <li>
            Set <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px]">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[13px]">SUPABASE_SERVICE_ROLE_KEY</code>.
          </li>
          <li>
            Add your first user under <strong className="font-medium">Authentication → Users</strong>. The
            first account becomes the administrator.
          </li>
        </ol>

        <p className="text-xs text-slate-500">
          Full instructions are in the project README.
        </p>
      </div>
    </main>
  );
}
