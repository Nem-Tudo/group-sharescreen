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

export function rememberedChannel(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY_PREFIX + groupId);
  } catch {
    return null;
  }
}
