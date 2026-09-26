import { Inter } from "next/font/google";

/**
 * The admin panel's typeface.
 *
 * Loaded here rather than in the root layout so the guest site never
 * downloads it. Inter carries everything — body, tables, labels, and at a
 * heavier weight with tighter tracking, the headings and headline figures.
 * `.admin-theme` in globals.css points `--font-admin-display` at this same
 * variable, so the heading rules keep working without a second font.
 */
const sans = Inter({
  variable: "--font-admin-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Put on every `.admin-theme` root so the variable is in scope. */
export const adminFonts = sans.variable;
