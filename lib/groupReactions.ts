import type { GroupReaction } from "./groupsApi";

// A message's reactions, changed on this screen ahead of the server — the
// chip lights up on the click, the way Discord's does — and then replaced by
// what the server answers. The same rule the server keeps (see the API's
// setGroupReaction): an emoji keeps its place in the row while anybody is on
// it, a new one goes at the end, and one nobody is left on disappears.

/** Puts `userId` on `emoji` (`on`) or takes them off it. */
export function toggleReaction(
  reactions: GroupReaction[],
  emoji: string,
  userId: string,
  on: boolean
): GroupReaction[] {
  const index = reactions.findIndex((r) => r.emoji === emoji);
  if (on) {
    if (index < 0) return [...reactions, { emoji, users: [userId] }];
    const current = reactions[index];
    if (current.users.includes(userId)) return reactions;
    return reactions.map((r, i) => (i === index ? { ...r, users: [...r.users, userId] } : r));
  }
  if (index < 0) return reactions;
  const users = reactions[index].users.filter((u) => u !== userId);
  return users.length === 0
    ? reactions.filter((_, i) => i !== index)
    : reactions.map((r, i) => (i === index ? { ...r, users } : r));
}

/**
 * Who reacted, for the chip's tooltip: "Você, Bia e Caio reagiram com 👍",
 * naming five at most.
 */
export function describeReaction(reaction: GroupReaction, nameOf: (userId: string) => string): string {
  const names = reaction.users.map(nameOf);
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} e mais ${rest}`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`
        : shown[0] ?? "";
  return `${list} ${names.length === 1 ? "reagiu" : "reagiram"} com ${reaction.emoji}`;
}
