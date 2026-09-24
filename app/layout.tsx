import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SITE } from "./lib/site";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const body = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const TITLE = `${SITE.name} | ${SITE.tagline}`;
const DESCRIPTION =
  "Experience warm hospitality, refined deluxe rooms, authentic Kashmiri dining, and peaceful valley charm at Hotel Shamiyana, Srinagar.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: TITLE,
    template: `%s | ${SITE.name}`,
  },
  description: DESCRIPTION,
  applicationName: SITE.name,
  keywords: [
    "Hotel Shamiyana",
    "hotels in Srinagar",
    "Srinagar hotel near Dal Lake",
    "Kashmir hotel booking",
    "Jhelum river hotel",
    "conference hotel Srinagar",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: SITE.url,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#141312",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased scroll-smooth`}
    >
      <head>
        {/* Scroll reveals start transparent. Without JavaScript nothing would
            ever reveal them, so force every one visible in that case. */}
        <noscript>
          <style>{`.reveal { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
      </head>
      <body className="min-h-full flex flex-col bg-[#f9f8f5] text-[#1c1b1a] font-sans selection:bg-[#d9c3a3] selection:text-black">
        {children}
      </body>
    </html>
  );
}

