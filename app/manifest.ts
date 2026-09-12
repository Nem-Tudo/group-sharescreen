import type { MetadataRoute } from "next";
import { translate } from "@/lib/i18n";

// Served at /manifest.webmanifest (see get-metadata-route.js's naming for
// the "manifest" special case) — layout.tsx's `metadata.manifest` is what
// actually links it into <head>, since Next doesn't do that automatically
// just from this file existing.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: translate("common.goliveFreeOnlineGroupScreenSharing"),
    short_name: translate("common.golive"),
    description:
      translate("manifest.broadcastYourScreenToSeveralPeople"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/icon.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
