import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { BotsPageClient } from "@/components/bots/BotsPageClient";

// /bots — every public bot, the directory a group's "Explorar bots" opens as a
// dialog, as a page of its own: a link to hand around, and somewhere to browse
// with the whole screen. Read in the browser (see BotBrowser), like the add
// page beside it: what it lists is paged and searched as it is used.

export const metadata: Metadata = {
  title: "Bots — GoLive",
  description: "Bots feitos pela comunidade para os seus grupos no GoLive.",
};

export default function BotsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <BotsPageClient />
    </div>
  );
}
