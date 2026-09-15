// Rich embeds on a message — the cards webhooks and bots send (Discord's
// embeds). The server validates them (sharescreen-api/server/embeds.ts) and
// this is the shape it sends; components/MessageEmbeds.tsx draws them.

export interface MessageEmbed {
  title?: string;
  description?: string;
  /** Where the title links to. */
  url?: string;
  /** The bar down the card's left edge, as 0xRRGGBB. */
  color?: number;
  author?: { name: string; url?: string; iconUrl?: string };
  footer?: { text: string; iconUrl?: string };
  /** ISO 8601 — drawn next to the footer. */
  timestamp?: string;
  fields?: { name: string; value: string; inline: boolean }[];
  /** A picture under the card's text. */
  image?: string;
  /** A small picture in the card's top-right corner. */
  thumbnail?: string;
}

/** The embeds of a message as it came off the wire — anything that is not a list of objects is none. */
export function readEmbeds(raw: unknown): MessageEmbed[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const embeds = raw.filter((entry): entry is MessageEmbed => Boolean(entry) && typeof entry === "object");
  return embeds.length > 0 ? embeds : undefined;
}

/** A link from an embed, only if it is http(s) — never a javascript: one, whatever the server let through. */
export function safeHref(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/** A picture from an embed, https only. */
export function safeImage(url: string | undefined): string | undefined {
  return url && /^https:\/\//i.test(url) ? url : undefined;
}
