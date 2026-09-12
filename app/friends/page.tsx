import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FriendsPanel } from "./FriendsPanel";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("common.friends"); },
  get description() { return translate("friends.yourFriendsOnGoliveFriendRequests"); },
  // Nothing here is public: the page renders one person's own graph and is
  // useless — and empty — to anybody else, including a crawler.
  robots: { index: false, follow: false },
};

export default function FriendsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <FriendsPanel />
    </div>
  );
}
