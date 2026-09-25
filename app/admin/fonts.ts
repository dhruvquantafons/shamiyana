import { Fraunces, Inter } from "next/font/google";

/**
 * Typefaces for the admin panel only.
 *
 * Loaded here rather than in the root layout so the guest site never
 * downloads them. Fraunces (variable, with optical sizing) carries page
 * titles, headings and headline figures; Inter carries body copy, tables,
 * labels and buttons. The `.admin-theme` rules in globals.css read the two
 * variables below.
 */
const display = Fraunces({
  variable: "--font-admin-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-admin-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Put on every `.admin-theme` root so both variables are in scope. */
export const adminFonts = `${display.variable} ${sans.variable}`;
