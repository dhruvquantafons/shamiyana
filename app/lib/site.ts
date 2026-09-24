/**
 * Single source of truth for site-wide constants that appear in metadata,
 * structured data, the sitemap, and the legal pages.
 */
/** The address this deployment answers on, and the one it puts in links. */
export const PRODUCTION_URL = "https://www.hotelshamiyana.com";

/**
 * Where this deployment thinks it lives.
 *
 * Defaults to the live domain, so production needs no configuration. A
 * staging deployment sets NEXT_PUBLIC_SITE_URL to its own address — otherwise
 * the links this system emails out, a guest's feedback link and the "open the
 * booking" link in a staff alert, would point at a site that is not there yet.
 *
 * Trailing slashes are trimmed because every use appends a path.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || PRODUCTION_URL).replace(/\/+$/, "");

/** True when this is the real site rather than a staging deployment. */
export const IS_PRODUCTION_SITE = SITE_URL === PRODUCTION_URL;

export const SITE = {
  name: "Hotel Shamiyana",
  shortName: "Shamiyana",
  tagline: "Luxury Hotel & Dining • Srinagar",
  url: SITE_URL,
  description:
    "Hotel Shamiyana is situated at a prime location in Srinagar, on the bank of the Jhelum River and just 1.5 km from Dal Lake and Lal Chowk — with 33 Deluxe Rooms, 03 Royal Suites, 02 Presidential Suites, and versatile conference space.",
  email: "info@hotelshamiyana.com",
  phones: ["0194-3500113", "+91 90700 90713", "0194-3517164"],
  addressLocality: "Srinagar",
  addressRegion: "Jammu & Kashmir",
  addressCountry: "India",
} as const;

/** Last review date shown on the legal pages. */
export const LEGAL_LAST_UPDATED = "16 September 2026";
