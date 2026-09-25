import type { Metadata } from "next";
import { connection } from "next/server";
import { requireSession, accessForClient } from "../../lib/auth";
import { getSettings } from "../../lib/settings";
import { getProperties, getCurrentProperty } from "../../lib/properties";
import { hasSupabaseConfig } from "../../lib/supabase/config";
import Sidebar from "../components/Sidebar";
import SetupNotice from "../components/SetupNotice";
import IdleTimer from "../components/IdleTimer";
import { adminFonts } from "../fonts";

export const metadata: Metadata = {
  title: "Property Management",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // An authenticated shell must never be prerendered and cached.
  await connection();

  if (!hasSupabaseConfig()) return <SetupNotice />;

  // proxy.ts already blocks signed-out traffic; this is the authoritative
  // check, and it also enforces 2FA and password expiry.
  const session = await requireSession();
  const [settings, properties, currentProperty] = await Promise.all([
    getSettings(),
    getProperties(),
    getCurrentProperty(),
  ]);

  return (
    <div className={`admin-theme ${adminFonts} min-h-screen bg-slate-50 print:bg-white`}>
      <Sidebar
        staff={session.staff}
        roleName={session.role.name}
        access={accessForClient(session)}
        properties={properties.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        currentProperty={currentProperty?.id ?? null}
      />
      <IdleTimer minutes={settings.session_timeout_minutes} />
      <div className="lg:pl-64 print:pl-0">
        <main className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-10 print:p-0 print:max-w-none">{children}</main>
      </div>
    </div>
  );
}
