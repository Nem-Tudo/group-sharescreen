import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ChamadoPageClient } from "./ChamadoPageClient";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

// One chamado, at an address (experiment "chamados", see lib/chamados): the
// link somebody pastes in WhatsApp or Discord to call people in. Its preview
// card says who is calling and for what; the page shows the chamado with its
// "Entrar", or that it is over.

/** Where a chamado's public details come from. Same base as the theme page's. */
const API_BASE = (process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws")
  .replace(/^ws/, "http")
  .replace(/\/ws\/?$/, "");

type ChamadoCardData = { kind: string; what: string; note: string; author: string | null; open: boolean };

/** Best-effort, for the card alone: a preview is never worth failing a page over. */
async function loadChamado(id: string): Promise<ChamadoCardData | null> {
  try {
    const res = await fetch(`${API_BASE}/chamados/${encodeURIComponent(id)}`, {
      // Short: a chamado lives for hours, and "encerrado" should reach the card soon.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chamado?: { kind?: string; what?: string; note?: string; status?: string; author?: { displayName?: string } | null };
    };
    if (!data.chamado?.what) return null;
    return {
      kind: data.chamado.kind ?? "talk",
      what: data.chamado.what,
      note: data.chamado.note ?? "",
      author: data.chamado.author?.displayName ?? null,
      open: data.chamado.status === "open",
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const chamado = await loadChamado(id);
  const kindLine = chamado ? translate(`chamados.calls.${chamado.kind}`) : "";
  const title = chamado
    ? chamado.author
      ? translate("chamados.cardTitle", { name: chamado.author, what: chamado.what })
      : chamado.what
    : translate("chamados.title");
  const description = chamado
    ? chamado.open
      ? chamado.note || translate("chamados.cardOpen")
      : translate("chamados.ended")
    : translate("chamados.cardGeneric");
  return pageMetadata({
    path: `/chamado/${id}`,
    title,
    description,
    card: {
      title: chamado?.what ?? translate("chamados.title"),
      subtitle: description,
      tone: "room",
      badge: chamado?.author ? `${chamado.author} ${kindLine}` : translate("chamados.title"),
    },
  });
}

export default async function ChamadoPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <ChamadoPageClient id={id} />
    </div>
  );
}
