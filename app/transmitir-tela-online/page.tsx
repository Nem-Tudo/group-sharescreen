import type { Metadata } from "next";
import { SITE_URL, ogImage } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { ScreenGuideContent } from "./ScreenGuideContent";

const PATH = "/transmitir-tela-online";
const TITLE = translate("screenGuide.metaTitle");
const DESCRIPTION = translate("screenGuide.metaDescription");

const OG_IMAGE = ogImage({
  get title() { return translate("screenGuide.h1"); },
  get subtitle() { return translate("screenGuide.ogSubtitle"); },
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Overrides the root's hreflang block: that one points every language at "/",
  // which on this page would tell Google the translation of the guide is the home.
  alternates: { canonical: PATH },
  openGraph: {
    type: "article",
    locale: "pt_BR",
    url: `${SITE_URL}${PATH}`,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return <ScreenGuideContent />;
}
