"use client";

// Which text room each group was last left on, per browser — so clicking a
// group on the rail goes back to the conversation that was open rather than
// to the first room every time. localStorage and best-effort: a missing or
// stale value just means landing on the first room, which is always valid.

const KEY_PREFIX = "golive:group:lastChannel:";

export function rememberChannel(groupId: string, channelId: string): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + groupId, channelId);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

/**
 * Where a link to a group should go: the text room it was last left on, when
 * this browser remembers one, or the group itself. On a phone /groups/:id is
 * the group's list of rooms, so a link straight to the room is what "open the
 * group where I left it" takes; on a desktop it skips GroupIndex's redirect.
 * A room gone since is no harm: GroupRoom sends a missing room to the group.
 * Read at render — only ever in lists drawn in the browser.
 */
export function groupEntryPath(groupId: string): string {
  const channelId = rememberedChannel(groupId);
  return channelId ? `/groups/${groupId}/${channelId}` : `/groups/${groupId}`;
}

export function rememberedChannel(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY_PREFIX + groupId);
  } catch {
    return null;
  }
}
