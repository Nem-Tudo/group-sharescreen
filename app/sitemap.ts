import type { MetadataRoute } from "next";

const SITE_URL = "https://golive.nemtudo.me";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/rooms`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/worldmap`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/app`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/discord-bot`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/badges`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Pages that exist, are indexable and were simply missing from this list.
    // A page Google has never been told about gets crawled only if something
    // links to it, and /pro, /workshop and /bots were reachable mostly from
    // menus inside the app.
    {
      url: `${SITE_URL}/pro`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/workshop`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/bots`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
