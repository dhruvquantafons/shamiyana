import type { NextConfig } from "next";

// Room photography is served from the Supabase Storage bucket, so next/image
// needs that host on its allow-list. Scoped to the public object path of this
// one project rather than the whole hostname.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Room photos (5 MB) and check-in ID scans (up to three of 5 MB each,
      // plus the signature) are uploaded through server actions, which are
      // capped at 1 MB by default.
      bodySizeLimit: "16mb",
    },
  },
  images: {
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
