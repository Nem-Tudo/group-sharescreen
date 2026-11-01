import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { DeleteAccountPanel } from "./DeleteAccountPanel";
import { translate } from "@/lib/i18n";

export const metadata: Metadata = {
  get title() { return translate("accountDelete.metaTitle"); },
  // One person's own account: nothing here for anybody else — see /me.
  robots: { index: false, follow: false },
};

export default function DeleteAccountPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <SiteHeader />
      <DeleteAccountPanel />
    </div>
  );
}
