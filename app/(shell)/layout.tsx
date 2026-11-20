import { GroupAppShell } from "@/components/groups/GroupAppShell";

// One shell for the group pages and the room pages (/groups/* and /watch/*).
//
// A route group rather than a layout in each: a layout is not re-mounted while
// the page under it changes, so walking from a group to a room and back keeps
// the same rail of groups, the same top bar and the same conversations strip —
// scrolled where they were, with nothing drawn twice.
//
// On a room's page the shell draws its frame only for the people in the
// experiment "room-shell" (see lib/roomShell); for everybody else it renders
// the room exactly as it always was, untouched, and the frame stays the group
// pages' own. Either way the page itself sits at the same place in the tree,
// so switching between the two never re-mounts the room's page.

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <GroupAppShell>{children}</GroupAppShell>;
}
