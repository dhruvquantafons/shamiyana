import { getPublicRates, getPortalSettings } from "../lib/rates";

/**
 * Safety net for the public pages.
 *
 * Edits made through the admin panel call revalidatePath and appear at once.
 * A change made straight in the Supabase dashboard runs none of our code, so
 * without this the statically rendered pages would serve stale rates and
 * photographs indefinitely. Five minutes keeps them honest.
 */
export const revalidate = 300;
import SiteShell from "../components/SiteShell";

/**
 * Chrome shared by every public page.
 *
 * Rates are loaded once here rather than per page, so the header, footer and
 * reservation panel all agree, and the panel keeps its state while the visitor
 * moves between pages.
 */
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ rooms }, settings] = await Promise.all([getPublicRates(), getPortalSettings()]);

  return (
    <SiteShell
      rooms={rooms}
      bestRateMessage={settings.bestRateMessage}
      languages={settings.languages}
      defaultLanguage={settings.defaultLanguage}
    >
      {children}
    </SiteShell>
  );
}
