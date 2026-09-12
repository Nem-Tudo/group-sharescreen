import type { Metadata } from "next";
import { ogImage } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { DesktopAppContent, DESCRIPTION, SITE_URL } from "./DesktopAppContent";

const RELEASES_API =
  "https://api.github.com/repos/Nem-Tudo/group-sharescreen/releases/latest";

// Cached for ten minutes and shared by everyone who opens the page: the
// latest tag is the same answer for all of them, and GitHub rate-limits.
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "group-sharescreen-app-page",
      },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: string };
    return release.tag_name ?? null;
  } catch {
    return null;
  }
}

const TITLE = translate("app.downloadTheGoliveDesktopAppWindows");

const OG_IMAGE = ogImage({
  get title() { return translate("app.goliveOnYourPc"); },
  get subtitle() { return translate("app.lightNoOverlayAndYouChoose"); },
  get badge() { return translate("common.desktopApp"); },
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "baixar golive",
    "app de transmitir tela",
    "programa leve para compartilhar tela",
    "transmitir tela com som do sistema",
    "escolher quais sons transmitir",
    "compartilhar tela sem vazar spotify",
    "compartilhar tela sem eco",
    "golive para pc",
    "golive windows",
  ],
  alternates: { canonical: "/app" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: `${SITE_URL}/app`,
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

export default async function Page() {
  const version = await fetchLatestVersion();
  return <DesktopAppContent version={version} />;
}
