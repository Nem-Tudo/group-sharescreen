import type { Metadata } from "next";
import { translate } from "@/lib/i18n";

// What a shared link looks like, per page.
//
// Every page used to inherit the root's card (see app/layout.tsx), so a room
// invite, a present and the download page all arrived in a chat as the same
// picture with the same sentence. This is the one place that decides
// otherwise.
//
// `images` is set *explicitly* on every page built through here, and that is
// the point rather than a detail: Next merges a segment's openGraph into its
// parent's, so a page that only overrides the title keeps advertising the
// root's picture. Naming it every time is what makes "different per page" true
// of the whole card instead of only its text.

/** The site's own address. Kept in step with app/layout.tsx's SITE_URL. */
export const SITE_URL = "https://golive.nemtudo.me";

/**
 * Which accent a card is drawn in — see app/api/og/route.tsx.
 *
 * Colour is the only thing that changes between them: a link is recognised in
 * a chat by its shape, and a card that rearranged itself per page would stop
 * reading as "this is GoLive" at a glance.
 */
export type OgTone = "default" | "room" | "gift" | "pro" | "max" | "theme";

export interface OgImageOptions {
  title: string;
  subtitle?: string;
  tone?: OgTone;
  /** The small line above the title. Defaults to the tone's own name. */
  badge?: string;
}

/** The URL of a generated card. Relative — metadataBase makes it absolute. */
export function ogImage({ title, subtitle, tone, badge }: OgImageOptions): string {
  const params = new URLSearchParams({ title });
  if (subtitle) params.set("subtitle", subtitle);
  if (tone) params.set("tone", tone);
  if (badge) params.set("badge", badge);
  return `/api/og?${params.toString()}`;
}

export interface PageMetadataOptions {
  /** Site-relative, with the leading slash. Becomes the canonical and og:url. */
  path: string;
  title: string;
  description: string;
  keywords?: string[];
  /**
   * What the card should say, when it should not simply repeat the page's
   * own title and description. A room's card says "Sala tal" where the page
   * title has to carry the site's name as well.
   */
  card?: OgImageOptions;
  /**
   * A picture of the thing itself, shown as the small square beside the text
   * instead of the generated wide card — a group's icon, the way a chat app
   * previews a group invite. Absolute. Takes the place of `card`.
   */
  thumbnail?: string;
  /**
   * Left out of search results. Not the same thing as "not shareable" — a
   * room, a profile and a present are all noindex and all meant to be pasted
   * into a chat, which is exactly why they still get a card.
   */
  noindex?: boolean;
}

export function pageMetadata({
  path,
  title,
  description,
  keywords,
  card,
  thumbnail,
  noindex,
}: PageMetadataOptions): Metadata {
  const image = thumbnail ?? ogImage(card ?? { title, subtitle: description });
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    ...(keywords ? { keywords } : {}),
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url,
      siteName: translate("common.golive"),
      title,
      description,
      // A thumbnail's size is whatever it was uploaded at; the generated card
      // is always 1200×630.
      images: [thumbnail ? { url: image, alt: title } : { url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      // "summary" is the small square beside the text — what a thumbnail is.
      card: thumbnail ? "summary" : "summary_large_image",
      title,
      description,
      images: [image],
    },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}
