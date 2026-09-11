import type { GroupCategory, GroupChannel } from "./groupsApi";

// How a group's rooms list is arranged, and how a drag rearranges it — the
// client's half of the API's setGroupLayout. Pure, so the sidebar and the
// settings' "Salas" tab rearrange the same way.
//
// The list is sections: the rooms without a category first, then each
// category in order. Each section lists its voice rooms and then its text
// rooms — the order of the two kinds is fixed, only the order within each kind
// (and which section a room is in) moves. A drop that lands a room among the
// other kind is read as "in this section": the room goes to its own kind's
// part of it, at whichever end is nearest.

export interface LayoutSection {
  /** null for the rooms without a category. */
  category: GroupCategory | null;
  voice: GroupChannel[];
  text: GroupChannel[];
}

/** What the layout route takes — see the API's setGroupLayout. */
export interface LayoutPayload {
  categories: string[];
  containers: { categoryId: string | null; channels: string[] }[];
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** The list as it is drawn: the uncategorised rooms, then every category, in order. */
export function buildSections(channels: GroupChannel[], categories: GroupCategory[] = []): LayoutSection[] {
  const ordered = [...categories].sort(byPosition);
  const known = new Set(ordered.map((c) => c.id));
  const sectionOf = (c: GroupChannel) => (c.categoryId && known.has(c.categoryId) ? c.categoryId : null);
  const make = (category: GroupCategory | null): LayoutSection => {
    const id = category?.id ?? null;
    const inside = channels.filter((c) => sectionOf(c) === id).sort(byPosition);
    return { category, voice: inside.filter((c) => c.kind === "voice"), text: inside.filter((c) => c.kind === "text") };
  };
  return [make(null), ...ordered.map(make)];
}

export function toPayload(sections: LayoutSection[]): LayoutPayload {
  return {
    categories: sections.filter((s) => s.category).map((s) => s.category!.id),
    containers: sections.map((s) => ({
      categoryId: s.category?.id ?? null,
      channels: [...s.voice, ...s.text].map((c) => c.id),
    })),
  };
}

/** The channels and categories a layout amounts to — positions and categories rewritten. */
export function applySections(sections: LayoutSection[]): { channels: GroupChannel[]; categories: GroupCategory[] } {
  const channels: GroupChannel[] = [];
  const categories: GroupCategory[] = [];
  for (const section of sections) {
    const categoryId = section.category?.id ?? null;
    if (section.category) categories.push({ ...section.category, position: categories.length });
    section.voice.forEach((c, position) => channels.push({ ...c, categoryId, position }));
    section.text.forEach((c, position) => channels.push({ ...c, categoryId, position }));
  }
  return { channels, categories };
}

/**
 * Moves a room into the section for `categoryId`, just before `beforeId` —
 * a room of the same kind there — or to the end of its kind there when
 * `beforeId` is null (or names a room it cannot be placed beside).
 */
export function moveChannel(
  sections: LayoutSection[],
  channelId: string,
  categoryId: string | null,
  beforeId: string | null
): LayoutSection[] {
  const moving = sections.flatMap((s) => [...s.voice, ...s.text]).find((c) => c.id === channelId);
  if (!moving) return sections;
  const kind = moving.kind;
  const next = sections.map((s) => ({
    ...s,
    voice: s.voice.filter((c) => c.id !== channelId),
    text: s.text.filter((c) => c.id !== channelId),
  }));
  const target = next.find((s) => (s.category?.id ?? null) === categoryId) ?? next[0];
  const list = target[kind];
  const index = beforeId ? list.findIndex((c) => c.id === beforeId) : -1;
  if (index >= 0) list.splice(index, 0, moving);
  else list.push(moving);
  return next;
}

/** Moves a category to just before `beforeId`, or to the end when null. */
export function moveCategory(sections: LayoutSection[], categoryId: string, beforeId: string | null): LayoutSection[] {
  const [root, ...rest] = sections;
  const moving = rest.find((s) => s.category?.id === categoryId);
  if (!moving || categoryId === beforeId) return sections;
  const others = rest.filter((s) => s !== moving);
  const index = beforeId ? others.findIndex((s) => s.category?.id === beforeId) : -1;
  if (index >= 0) others.splice(index, 0, moving);
  else others.push(moving);
  return [root, ...others];
}

/**
 * Where a room dropped on another room goes: that room's section, and — when
 * the two are the same kind — just before it, or just after it when the drop
 * was on its lower half. A room of the other kind means "this section": the
 * voice rooms come first, so a text room lands at the top of the text rooms
 * and a voice room at the end of the voice rooms, whichever is nearest.
 */
export function dropOnChannel(
  sections: LayoutSection[],
  dragged: GroupChannel,
  target: GroupChannel,
  after: boolean
): { categoryId: string | null; beforeId: string | null } {
  const section = sections.find((s) => [...s.voice, ...s.text].some((c) => c.id === target.id));
  const categoryId = section?.category?.id ?? null;
  if (!section) return { categoryId, beforeId: null };
  if (dragged.kind !== target.kind) {
    const own = section[dragged.kind].filter((c) => c.id !== dragged.id);
    return { categoryId, beforeId: dragged.kind === "text" ? own[0]?.id ?? null : null };
  }
  const list = section[target.kind].filter((c) => c.id !== dragged.id);
  const index = list.findIndex((c) => c.id === target.id);
  const beforeId = after ? list[index + 1]?.id ?? null : target.id;
  return { categoryId, beforeId };
}
