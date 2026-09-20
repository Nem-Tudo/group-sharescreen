import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { NotificationSettingsScreen } from "./NotificationSettingsScreen";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("common.notifications"); },
  // One person's own settings: nothing here for anybody else, a search engine
  // included — the same reasoning as /me itself.
  robots: { index: false, follow: false },
};

export default function NotificationSettingsPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <NotificationSettingsScreen />
    </div>
  );
}
