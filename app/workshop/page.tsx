import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkshopPanel } from "./WorkshopPanel";

const TITLE = "Descobrir temas — GoLive";
const DESCRIPTION =
  "Temas de sala feitos pela comunidade do GoLive. Use qualquer um de graça, ou crie o seu.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["temas golive", "descobrir temas", "tema de sala", "personalizar sala"],
  alternates: { canonical: "/workshop" },
};

export default function WorkshopPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <WorkshopPanel />
    </div>
  );
}
