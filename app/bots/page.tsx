import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { BotsPageClient } from "@/components/bots/BotsPageClient";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

// /bots — every public bot, the directory a group's "Explorar bots" opens as a
// dialog, as a page of its own: a link to hand around, and somewhere to browse
// with the whole screen. Read in the browser (see BotBrowser), like the add
// page beside it: what it lists is paged and searched as it is used.

// Through pageMetadata like every other public page, rather than the two
// hand-written lines this used to be. Those were missing the canonical, the
// social card and the robots directive the helper fills in, and they were
// hard-coded Portuguese on a site that renders in three languages.
export const metadata: Metadata = pageMetadata({
  path: "/bots",
  get title() { return translate("botsPage.title"); },
  get description() { return translate("botsPage.description"); },
});

export default function BotsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <BotsPageClient />
    </div>
  );
}
