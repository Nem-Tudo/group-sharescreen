import type { Metadata } from "next";
import { fetchPublicGroupPreview } from "@/lib/groupLinks";
import { groupLinkMetadata } from "@/lib/groupMetadata";

// /groups/:id/:room — a text room, or a voice room. Drawn by the group shell
// from the address, like every page under /groups: moving between rooms is a
// pushState that never asks the server for this page (see
// components/groups/GroupAppShell and lib/groupNavigation). It exists so the
// address resolves on a reload or a shared link.
//
// A room's address pasted into a chat previews as its group, the same card as
// /groups/:id (see lib/groupMetadata) — the room itself is not on the group's
// public card, so it is not in the preview either.

export async function generateMetadata(props: PageProps<"/groups/[groupId]/[roomId]">): Promise<Metadata> {
  const { groupId, roomId } = await props.params;
  const preview = await fetchPublicGroupPreview(groupId);
  return groupLinkMetadata({ path: `/groups/${groupId}/${roomId}`, kind: "group", group: preview?.group ?? null });
}

export default function GroupRoomPage() {
  return null;
}
