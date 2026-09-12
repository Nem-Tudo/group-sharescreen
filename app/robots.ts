import type { MetadataRoute } from "next";

const SITE_URL = "https://golive.nemtudo.me";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "/ad" holds the link-only ad reports: the token in the URL is
      // the whole credential, so a crawler must never walk one (the pages
      // also carry robots: noindex — this just keeps the fetch from
      // happening at all).
      disallow: ["/admin", "/api/", "/ad"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
