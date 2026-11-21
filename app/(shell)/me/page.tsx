import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MeScreen } from "./MeScreen";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("mobile.you"); },
  // One person's own account and settings: nothing here for anybody else,
  // a search engine included.
  robots: { index: false, follow: false },
};

export default function MePage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <MeScreen />
    </div>
  );
}
