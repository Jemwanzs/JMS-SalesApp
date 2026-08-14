import type { MetadataRoute } from "next";

/**
 * Next.js's native manifest file convention — auto-served at
 * /manifest.webmanifest, auto-linked from <head>. See
 * docs/07-ui-ux-screen-map.md and spec S117 (installable PWA, no native
 * app development required for first release).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JMS Sales App",
    short_name: "JMS Sales",
    description:
      "Mobile-first, multi-tenant sales records & analytics platform.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF3E6",
    theme_color: "#10786A",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
