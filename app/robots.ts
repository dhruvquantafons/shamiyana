import type { MetadataRoute } from "next";
import { SITE, IS_PRODUCTION_SITE } from "./lib/site";

/**
 * Only the real site invites crawlers.
 *
 * A staging deployment shares the same pages, so letting it be indexed would
 * compete with the hotel's own listing for its own words — and a half-priced
 * test rate showing up in a search result is worse than that.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_PRODUCTION_SITE) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
