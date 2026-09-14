import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { AddBotClient } from "@/components/bots/AddBotClient";

// /bots/:id/add — the link a bot's owner hands out (see the developer
// dashboard's "Instalação" page), and what the "Adicionar a um grupo" button
// on a bot's profile opens. Somebody who manages a group picks one and the
// bot is in: a bot never walks into a group by itself (see the API's
// groupRoutes, POST /groups/:id/bots).
//
// Everything is read in the browser, because what the page offers depends
// entirely on who is looking — which groups they manage — and nothing about
// it is worth a link preview beyond the title.

export const metadata: Metadata = {
  title: "Adicionar bot a um grupo — GoLive",
  robots: { index: false, follow: false },
};

export default async function AddBotPage(props: PageProps<"/bots/[id]/add">) {
  const { id } = await props.params;
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <AddBotClient botId={id} />
    </div>
  );
}
