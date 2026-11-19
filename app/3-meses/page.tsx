import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { AnniversaryContent } from "./AnniversaryContent";

// GoLive's third birthday-in-months (first commit: 17/08/2026): the story,
// the numbers, a mascot and a chiptune. Everything moves; see
// AnniversaryContent for how the scenes are put together.

// The 8-bit labels only. Loaded on this route alone.
const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anniv-pixel",
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
    <div className={`${pixel.variable} flex flex-1 flex-col`}>
      <AnniversaryContent />
    </div>
  );
}
