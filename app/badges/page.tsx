import type { Metadata } from "next";
import { ogImage } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { BadgesPanel } from "./BadgesPanel";
import { translate } from "@/lib/i18n";

const TITLE = translate("badges.goliveBadgesWhatEachOneMeans");
const DESCRIPTION =
  translate("badges.everyGoliveBadgeAndHowEach");

// Its own card rather than the root's, so this link is not the home page's
// picture with a different sentence under it. See lib/seo.ts.
const OG_IMAGE = ogImage({
  get title() { return translate("badges.goliveBadges"); },
  get subtitle() { return translate("badges.whatEachOneMeansAndHow"); },
  get badge() { return translate("common.badges"); },
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["badges golive", "selos golive", "bug hunter", "beta tester", "apoiador inicial"],
  alternates: { canonical: "/badges" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/badges",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Deliberately no badge list in this file. The catalogue is a database
// collection (see the API's /badges), and a copy here would be a second
// source of truth that goes stale the day somebody adds one — the panel
// reads the live one.
export default function BadgesPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <BadgesPanel />
    </div>
  );
}
