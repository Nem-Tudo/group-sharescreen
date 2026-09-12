import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemePageClient } from "./ThemePageClient";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

// One theme, at an address — which is what makes a theme shareable at all.
//
// Everything about a theme used to live inside a grid or a dialog, so "look at
// this one" meant "open the workshop and scroll", and a link pasted into a
// conversation could only point at the whole shop.
//
// The author's numbers are one level down, at /theme/[id]/panel. Same object,
// two audiences: this page is for anybody, that one is for the person who made
// it.

/** Where a theme's public details come from. Mirrors app/gift/[code]'s base. */
const API_BASE = (process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws")
  .replace(/^ws/, "http")
  .replace(/\/ws\/?$/, "");

type ThemeCard = { name: string; description: string; author: string | null; price: number };

/**
 * What is behind the id, for the card alone.
 *
 * Best-effort, like the gift page's: this runs while a crawler waits, and a
 * preview is never worth failing a page over. The route it asks is the public
 * one, so an unpublished theme answers 404 here and the link previews as the
 * generic card — which is correct, since it will not open for that reader
 * either.
 */
async function loadTheme(id: string): Promise<ThemeCard | null> {
  try {
    const res = await fetch(`${API_BASE}/themes/${encodeURIComponent(id)}`, {
      // A theme's name and author change rarely; its numbers are not on the
      // card. Five minutes keeps a busy link from asking on every forward.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      theme?: {
        name?: string;
        description?: string;
        price?: number;
        author?: { displayName?: string } | null;
      };
    };
    if (!data.theme) return null;
    return {
      name: data.theme.name ?? translate("common.theme"),
      description: data.theme.description ?? "",
      author: data.theme.author?.displayName ?? null,
      price: data.theme.price ?? 0,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(props: PageProps<"/theme/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const theme = await loadTheme(id);

  const title = theme ? translate("theme.nameAThemeForGolive", { name: theme.name }) : translate("theme.goliveTheme");
  const subtitle = theme
    ? theme.description ||
      `${theme.author ? translate("theme.aThemeByAuthor", { author: theme.author }) : ""}${
        theme.price > 0 ? translate("theme.valuePoints", { value: theme.price.toLocaleString(formatLocale()) }) : translate("theme.freeToUse")
      }`
    : translate("theme.roomThemesMadeByTheGolive");

  return pageMetadata({
    path: `/theme/${id}`,
    title,
    description: subtitle,
    card: {
      title: theme?.name ?? translate("theme.goliveTheme"),
      subtitle,
      tone: "theme",
      badge: theme?.author ? translate("theme.themeByAuthor", { author: theme.author }) : translate("common.theme"),
    },
  });
}

export default async function ThemePage(props: PageProps<"/theme/[id]">) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <ThemePageClient id={id} />
    </div>
  );
}
