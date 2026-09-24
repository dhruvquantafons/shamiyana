import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient } from "../../lib/supabase/server";
import { getGuestSession, guestPasswordLoginEnabled } from "../../lib/guest-auth";
import { loadGuestBookings, endGuestSession } from "../../lib/guest-portal";
import { getPortalSettings } from "../../lib/rates";
import { stringsFor, isRtl, type DisplayCurrency } from "../../lib/portal-i18n";
import PageHeader from "../../components/PageHeader";
import GuestSignIn from "./GuestSignIn";
import BookingCard from "./BookingCard";
import GuestProfileForm from "./GuestProfileForm";

export const metadata: Metadata = {
  title: "My Bookings",
  description: "Sign in to view and manage your bookings at Hotel Shamiyana.",
  alternates: { canonical: "/account" },
  robots: { index: false, follow: false },
};

/**
 * The guest's account (SOW Module 17: "Guest account creation to view/manage
 * their own bookings").
 *
 * Reads the session cookie, so it is rendered per request rather than served
 * from the static cache the rest of the public site uses.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; cur?: string }>;
}) {
  const params = await searchParams;
  // portal_settings(), not getSettings(): property_settings is staff-only, so
  // a guest reading it would silently get built-in defaults.
  const [session, settings] = await Promise.all([getGuestSession(), getPortalSettings()]);

  // The guest's saved language wins over the query string, so a returning
  // guest sees the portal the way they left it.
  const language = session?.guest.language || params.lang || settings.defaultLanguage;
  const t = stringsFor(language, settings.languages);

  const supabase = createPublicClient();
  const { data: currencyRows } = await supabase
    .from("currencies")
    .select("code, symbol, rate_to_base, decimals")
    .eq("is_active", true);
  const currencies = (currencyRows ?? []) as DisplayCurrency[];
  const wanted = params.cur?.toUpperCase() ?? "";
  const chosen =
    settings.multiCurrency && wanted
      ? (currencies.find((c) => c.code === wanted) ?? null)
      : null;
  const currency = chosen && chosen.code !== settings.currency ? chosen : null;

  const bookings = session ? await loadGuestBookings() : [];
  const upcoming = bookings.filter((b) =>
    ["tentative", "confirmed", "waitlisted", "checked_in"].includes(b.status),
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div dir={isRtl(language) ? "rtl" : undefined}>
      <PageHeader
        eyebrow="Your account"
        title={session ? t.myBookings : t.signIn}
        lead={
          session
            ? "Your upcoming stays and everything you have booked with us before."
            : "Sign in with your email address to see your bookings, pay a deposit, or cancel a stay."
        }
        image="/gallery/11.jpg"
      />

      <section className="bg-[#0b131b] py-14 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {!session ? (
            <div className="max-w-md mx-auto bg-white/[0.04] border border-white/10 rounded-lg p-6 sm:p-8">
              <GuestSignIn
                labels={{ emailCode: t.emailCode, enterCode: t.enterCode }}
                passwordLogin={guestPasswordLoginEnabled()}
              />
            </div>
          ) : (
            <div className="space-y-10">
              <header className="flex flex-wrap items-center gap-3 pb-6 border-b border-white/10">
                <div>
                  <p className="text-white text-sm">
                    Signed in as <span className="text-[#d4af37]">{session.email}</span>
                  </p>
                  {session.guest.loyalty_member_no && (
                    <p className="text-xs text-slate-400 mt-1">
                      Membership {session.guest.loyalty_member_no}
                      {session.guest.loyalty_tier ? ` · ${session.guest.loyalty_tier}` : ""}
                    </p>
                  )}
                </div>
                <form action={endGuestSession} className="ml-auto">
                  <button
                    type="submit"
                    className="text-xs text-slate-400 hover:text-[#d4af37] transition-colors"
                  >
                    {t.signOut}
                  </button>
                </form>
              </header>

              {settings.multiCurrency && currencies.length > 1 && (
                <form className="flex flex-wrap items-center gap-2 text-xs">
                  <label htmlFor="cur" className="text-slate-400">
                    Show prices in
                  </label>
                  <select
                    id="cur"
                    name="cur"
                    defaultValue={currency?.code ?? settings.currency}
                    className="bg-white/5 border border-white/15 rounded-md px-2.5 py-1.5 text-white focus:border-[#d4af37] focus:outline-none"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code} className="bg-[#0b131b]">
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="border border-white/15 rounded-md px-2.5 py-1.5 text-slate-300 hover:border-[#d4af37] hover:text-[#d4af37] transition-colors"
                  >
                    Show
                  </button>
                  {currency && (
                    <span className="text-slate-500">
                      Approximate. Your bill is settled in {settings.currency}.
                    </span>
                  )}
                </form>
              )}

              <div>
                <h2 className="font-serif text-xl text-white mb-4">Upcoming stays</h2>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Nothing booked at the moment.{" "}
                    <Link href="/rooms" className="text-[#d4af37] hover:underline">
                      Have a look at our rooms
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="space-y-4">
                    {upcoming.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        currency={currency}
                        labels={{ payNow: t.payNow, cancelBooking: t.cancelBooking, free: t.free }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {past.length > 0 && (
                <div>
                  <h2 className="font-serif text-xl text-white mb-4">Previous stays</h2>
                  <div className="space-y-4">
                    {past.map((b) => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        currency={currency}
                        labels={{ payNow: t.payNow, cancelBooking: t.cancelBooking, free: t.free }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className="font-serif text-xl text-white mb-4">Your details</h2>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  We use these for your bookings. Telling us your dietary needs and preferences means
                  the desk does not have to ask again each time.
                </p>
                <GuestProfileForm
                  guest={session.guest}
                  languages={settings.languages}
                  labels={{ yourName: t.yourName, yourPhone: t.yourPhone }}
                />
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed border-t border-white/10 pt-6">
                Under our{" "}
                <Link href="/privacy" className="text-slate-400 hover:text-[#d4af37]">
                  privacy policy
                </Link>{" "}
                you may ask for a copy of your data or have it erased. Email{" "}
                <a href={`mailto:${settings.email}`} className="text-slate-400 hover:text-[#d4af37]">
                  {settings.email}
                </a>{" "}
                and we will see to it.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
