import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeReportClient } from "./ThemeReportClient";

export const metadata: Metadata = {
  title: "Painel do tema",
  // Never indexed and never shared: the page is about one person's own work,
  // the API refuses it to anybody else, and a card for it would be a link that
  // says nothing to whoever it reached.
  robots: { index: false, follow: false },
};

export default async function ThemeReportPage(props: PageProps<"/tema/[id]">) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <ThemeReportClient id={id} />
    </div>
  );
}
