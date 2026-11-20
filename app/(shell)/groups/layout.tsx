import type { Metadata } from "next";
import { translate } from "@/lib/i18n";

// Every page under /groups shares one shell — the rail, the rooms, and the
// voice call that has to survive moving between them (see GroupAppShell). It
// is drawn one level up, by app/(shell)/layout.tsx, which the room pages share
// too; this layout only carries the group pages' own metadata.

export const metadata: Metadata = {
  get title() { return translate("common.groups"); },
  get description() { return translate("groups.layout.yourGroupsOnGolivePermanentVoice"); },
  // A group is private to its members; there is nothing here for a search
  // engine to index.
  robots: { index: false, follow: false },
};

export default function GroupLayout({ children }: LayoutProps<"/groups">) {
  return children;
}
