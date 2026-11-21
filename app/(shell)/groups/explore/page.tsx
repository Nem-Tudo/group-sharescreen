import type { Metadata } from "next";
import { translate } from "@/lib/i18n";

// /groups/explore — public groups to find and join (experiment groups-hub).
// Drawn by the group shell from the address (see components/groups/GroupsHub);
// this exists so the address resolves on a reload or a shared link, and so it
// is not read as a group called "explore".
export const metadata: Metadata = {
  get title() {
    return translate("groups.groupDialogs.exploreGroups");
  },
  robots: { index: false, follow: true },
};

export default function GroupsExplorePage() {
  return null;
}
