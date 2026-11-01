import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { EffectPageClient } from "./EffectPageClient";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

// One camera effect, at an address, as with the themes (app/theme/[id]). The
// author's numbers are one level down, at /effect/[id]/panel.

const API_BASE = (process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws")
  .replace(/^ws/, "http")
  .replace(/\/ws\/?$/, "");

/** For the link's card alone: best-effort, a preview is never worth failing a page over. */
async function loadEffect(id: string): Promise<{ name: string; description: string; author: string | null } | null> {
  try {
    const res = await fetch(`${API_BASE}/camera-effects/${encodeURIComponent(id)}/info`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      effect?: { name?: string; description?: string; author?: { displayName?: string } | null };
    };
    if (!data.effect) return null;
    return {
      name: data.effect.name ?? "",
      description: data.effect.description ?? "",
      author: data.effect.author?.displayName ?? null,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(props: PageProps<"/effect/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const effect = await loadEffect(id);
  const name = effect?.name || translate("cameraWorkshop.title");
  const subtitle =
    effect?.description ||
    (effect?.author ? translate("cameraWorkshop.byAuthor", { author: effect.author }) : translate("cameraWorkshop.subtitle"));
  return pageMetadata({
    path: `/effect/${id}`,
    title: name,
    description: subtitle,
    card: { title: name, subtitle, tone: "theme", badge: translate("cameraWorkshop.title") },
  });
}

export default async function EffectPage(props: PageProps<"/effect/[id]">) {
  const { id } = await props.params;
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <EffectPageClient id={id} />
    </div>
  );
}
