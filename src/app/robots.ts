import type { MetadataRoute } from "next";

// Personal, single-user tool — no bot should crawl or index it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
