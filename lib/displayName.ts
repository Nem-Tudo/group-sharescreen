// Single source of truth for the "(guest)" suffix so it reads identically
// everywhere a participant's name is shown — ParticipantRow, VideoTile
// labels, ChatPanel messages, and the admin moderation views. `isGuest`
// comes from the server (see signaling.ts's peerSummary/chat "isGuest"
// field) — undefined (an older server, or a value nobody bothered to set)
// is treated the same as `false`, i.e. no suffix.
export function withGuestSuffix(name: string, isGuest?: boolean): string {
  return isGuest ? `${name} (guest)` : name;
}

// ─── Telling one person's several devices apart ───────────────────────────
//
// One account may be in a room from up to three places at once (see the
// server's MAX_DEVICES_PER_OWNER_IN_ROOM). They all carry the same display
// name, so without something else the participant list is the same word three
// times and the chat is three people who are one person.
//
// The server hands each connection a stable number within the room — 1, 2, 3
// — and this decides whether to *show* it. The rule is deliberately not "show
// device 2 and 3": that would leave the first one unlabelled and read as "the
// real one plus some duplicates". Once there is more than one, every one of
// them is numbered, which is the only version where "(1)" and "(2)" mean the
// same kind of thing.
//
// Which also means the label is a property of the room right now, not of the
// message or the row — the moment a second device joins, the first one gains
// its "(1)" with no message from the server, and loses it again when the
// second leaves.

/**
 * How many devices each identity currently has in the room.
 *
 * Built once per render and passed to the helpers below, rather than counted
 * per row: a chat with two hundred messages would otherwise walk the peer list
 * two hundred times to answer the same question.
 *
 * `entries` is the peer list *including this client's own entry* — leaving
 * yourself out is what would make your own second device look like it is alone
 * in the room, and it is the one entry that is never in `peers`.
 */
export function countDevicesByOwner(entries: { userId?: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.userId) continue;
    counts.set(entry.userId, (counts.get(entry.userId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The name as it should be shown, given who else of theirs is here.
 *
 * No suffix at all unless that identity genuinely has a second device in the
 * room right now — so the overwhelmingly common case (one person, one device)
 * is untouched, and an older server that sends no `device` at all behaves
 * exactly as it did before any of this existed.
 */
export function withDeviceSuffix(
  name: string,
  userId: string | undefined,
  device: number | undefined,
  deviceCounts: Map<string, number>
): string {
  if (!userId || !device) return name;
  if ((deviceCounts.get(userId) ?? 0) < 2) return name;
  return `${name} (${device})`;
}

/**
 * Both suffixes, in the one order they read correctly: "Maria (2) (guest)".
 *
 * The device number belongs to the name — it says *which* Maria — while
 * "(guest)" describes the account behind it, so it stays outermost. Composing
 * them here rather than at each call site is what stops the two orders from
 * both existing somewhere in the app.
 */
export function participantLabel(
  entry: { name: string; userId?: string; device?: number; isGuest?: boolean },
  deviceCounts: Map<string, number>
): string {
  return withGuestSuffix(
    withDeviceSuffix(entry.name, entry.userId, entry.device, deviceCounts),
    entry.isGuest
  );
}
