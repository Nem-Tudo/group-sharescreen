import type { Metadata } from "next";
import { GroupAppShell } from "@/components/groups/GroupAppShell";
import { translate } from "@/lib/i18n";

// Every page under /groups shares one shell — the rail, the rooms, and the
// voice call that has to survive moving between them (see GroupAppShell).
// A layout, not a wrapper in each page, precisely because a layout is not
// re-mounted when the page under it changes.

export const metadata: Metadata = {
  get title() { return translate("common.groups"); },
  get description() { return translate("groups.layout.yourGroupsOnGolivePermanentVoice"); },
  // A group is private to its members; there is nothing here for a search
  // engine to index.
  robots: { index: false, follow: false },
};

export default function GroupLayout({ children }: LayoutProps<"/groups">) {
  return <GroupAppShell>{children}</GroupAppShell>;
}
