import type { NextConfig } from "next";

// Room photography is served from the Supabase Storage bucket, so next/image
// needs that host on its allow-list. Scoped to the public object path of this
// one project rather than the whole hostname.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

// The Windows desktop demo (desktop/) runs this app as a standalone server
// against a local Supabase-compatible stack at 127.0.0.1. Room photos then come
// from that local address, which Next blocks from image optimization unless
// allowed. Vercel builds are unaffected.
const desktopDemo = process.env.DEMO_BUILD === "1";

const nextConfig: NextConfig = {
  ...(desktopDemo ? { output: "standalone" as const } : {}),
  experimental: {
    serverActions: {
      // Room photos (5 MB) and check-in ID scans (up to three of 5 MB each,
      // plus the signature) are uploaded through server actions, which are
      // capped at 1 MB by default.
      bodySizeLimit: "16mb",
    },
  },
  images: desktopDemo
    ? {
        dangerouslyAllowLocalIP: true,
        remotePatterns: [
          {
            protocol: "http",
            hostname: "127.0.0.1",
            port: "54321",
            pathname: "/storage/v1/object/public/**",
            search: "",
          },
        ],
      }
    : {
        remotePatterns: supabaseHost
          ? [
              {
                protocol: "https",
                hostname: supabaseHost,
                port: "",
                pathname: "/storage/v1/object/public/**",
                search: "",
              },
            ]
          : [],
      },
};

export default nextConfig;
