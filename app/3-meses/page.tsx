import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { AnniversaryContent } from "./AnniversaryContent";

// Go Live's three months (first commit: 17/08/2026): the story, the numbers,
// a mascot and a chiptune. See AnniversaryContent for how the scenes are put
// together, and anniversary.css for the look.

// Loaded on this route alone. Archivo's width axis gives the condensed
// broadcast-graphics headlines; Plex Mono carries timecodes and labels.
const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-anniv-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-anniv-mono",
  display: "swap",
});

export const metadata: Metadata = pageMetadata({
  path: "/3-meses",
  title: translate("anniversary.meta.title"),
  description: translate("anniversary.meta.description"),
  keywords: ["golive 3 meses", "história do golive", "números do golive", "golive aniversário"],
  card: {
    get title() {
      return translate("anniversary.meta.cardTitle");
    },
    get subtitle() {
      return translate("anniversary.meta.cardSubtitle");
    },
    tone: "theme",
    get badge() {
      return translate("anniversary.meta.cardBadge");
    },
  },
});

export default function AnniversaryPage() {
  return (
    <div className={`${display.variable} ${mono.variable} flex flex-1 flex-col`}>
      <AnniversaryContent />
    </div>
  );
}
