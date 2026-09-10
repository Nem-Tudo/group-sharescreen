import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkshopPanel } from "./WorkshopPanel";
import { pageMetadata } from "@/lib/seo";

const TITLE = "Descobrir temas — GoLive";
const DESCRIPTION =
  "Temas de sala feitos pela comunidade do GoLive. Use qualquer um de graça, ou crie o seu.";

export const metadata: Metadata = pageMetadata({
  path: "/workshop",
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["temas golive", "descobrir temas", "tema de sala", "personalizar sala"],
  card: {
    title: "Temas para a sua sala",
    subtitle: "Feitos pela comunidade. Usar é grátis para qualquer conta.",
    tone: "theme",
    badge: "Descobrir",
  },
});

export default function WorkshopPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <WorkshopPanel />
    </div>
  );
}
