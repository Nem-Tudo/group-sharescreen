import type { Metadata } from "next";
import { fetchPublicGroupPreview } from "@/lib/groupLinks";
import { groupLinkMetadata } from "@/lib/groupMetadata";

// /groups/:id — lands on a room (the one this group was last left on lives in
// localStorage, so that is decided in the browser). Drawn by the group shell
// from the address, like every page under /groups — see
// components/groups/GroupAppShell and lib/groupNavigation. It exists so the
// address resolves on a reload or a shared link.
//
// Its metadata is the one thing it does itself: a group's address pasted into
// a chat previews as that group — for a public group, whose card anybody may
// see; a private one previews as "a group on GoLive" (see lib/groupMetadata).

export async function generateMetadata(props: PageProps<"/groups/[groupId]">): Promise<Metadata> {
  const { groupId } = await props.params;
  const preview = await fetchPublicGroupPreview(groupId);
  return groupLinkMetadata({ path: `/groups/${groupId}`, kind: "group", group: preview?.group ?? null });
}

export default function GroupIndexPage() {
  return null;
}
