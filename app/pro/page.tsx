import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ProPanel } from "./ProPanel";

const TITLE = "GoLive Pro — seja Verificado, transmita em 4K 240 fps";
const DESCRIPTION =
  "Assinatura mensal do GoLive: transmita a sua tela em 2K e 4K, com até 240 quadros por segundo.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "golive pro",
    "transmitir tela em 4k",
    "compartilhar tela 240fps",
    "assinatura golive",
    "golive premium",
  ],
  alternates: { canonical: "/pro" },
};

// Deliberately no price in the metadata or anywhere else in this file. The
// number lives in one place — the plan document the API reads (see its
// premiumPlan.ts) — and a copy of it baked into a page's description is a
// copy nobody remembers to update the day the price changes.
export default function ProPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <ProPanel />
    </div>
  );
}
