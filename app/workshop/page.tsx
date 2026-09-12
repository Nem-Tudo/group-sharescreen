import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkshopPanel } from "./WorkshopPanel";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

const TITLE = translate("workshop.discoverThemesGolive");
const DESCRIPTION =
  translate("workshop.roomThemesMadeByTheGolive");

export const metadata: Metadata = pageMetadata({
  path: "/workshop",
  title: TITLE,
  description: DESCRIPTION,
  keywords: ["temas golive", "descobrir temas", "tema de sala", "personalizar sala"],
  card: {
    get title() { return translate("workshop.themesForYourRoom"); },
    get subtitle() { return translate("workshop.madeByTheCommunityFreeTo"); },
    tone: "theme",
    get badge() { return translate("common.discover"); },
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
