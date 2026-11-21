import type { Metadata } from "next";
import { translate } from "@/lib/i18n";

// /groups/rooms — every public room open right now, beside your groups and
// conversations. Drawn by the group shell from the address (see
// components/groups/GroupsRoomsView); this exists so the address resolves on a
// reload or a shared link, and so it is not read as a group called "rooms".
export const metadata: Metadata = {
  get title() {
    return translate("groups.roomsTab.title");
  },
  robots: { index: false, follow: true },
};

export default function GroupsRoomsPage() {
  return null;
}
