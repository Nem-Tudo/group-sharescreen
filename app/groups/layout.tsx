import type { Metadata } from "next";
import { GroupAppShell } from "@/components/groups/GroupAppShell";

// Every page under /groups shares one shell — the rail, the rooms, and the
// voice call that has to survive moving between them (see GroupAppShell).
// A layout, not a wrapper in each page, precisely because a layout is not
// re-mounted when the page under it changes.

export const metadata: Metadata = {
  title: "Grupos",
  description: "Seus grupos no GoLive: salas de voz e de texto permanentes com seus amigos.",
  // A group is private to its members; there is nothing here for a search
  // engine to index.
  robots: { index: false, follow: false },
};

export default function GroupLayout({ children }: LayoutProps<"/groups">) {
  return <GroupAppShell>{children}</GroupAppShell>;
}
