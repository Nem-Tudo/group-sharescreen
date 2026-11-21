import type { GroupFolder, GroupRailLayout, GroupSummary } from "./groupsApi";

// Folders and the shelf in somebody's own list of groups (experiment
// group-organize) — the client's half of the API's groupLayoutStore. Pure, so
// the rail, the home page's panel and the phone's list all arrange the same
// way, and every change is "work out the next layout, then save it" (see
// lib/useGroups' saveLayout).
//
// A layout's top level is a list of group ids and folder refs ("folder:<id>");
// a group is in at most one place; archived groups are in none.

const FOLDER_PREFIX = "folder:";

export function folderRef(folderId: string): string {
  return `${FOLDER_PREFIX}${folderId}`;
}

export function folderIdOf(entry: string): string | null {
  return entry.startsWith(FOLDER_PREFIX) ? entry.slice(FOLDER_PREFIX.length) : null;
}

/** The colours a folder can wear — the API keeps the names, this file owns the look. */
export const FOLDER_COLORS = ["zinc", "red", "orange", "amber", "green", "teal", "sky", "blue", "violet", "pink"] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

/** Background for the folder's tile, and the dot in the colour picker. */
export const FOLDER_SWATCH: Record<FolderColor, string> = {
  zinc: "bg-zinc-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

/** The folder's tile while closed: a tint of its colour behind the little faces. */
export const FOLDER_TINT: Record<FolderColor, string> = {
  zinc: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
  red: "bg-red-500/15 text-red-600 dark:text-red-300",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  pink: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
};

export function folderColor(color: string): FolderColor {
  return (FOLDER_COLORS as readonly string[]).includes(color) ? (color as FolderColor) : "zinc";
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newFolderId(): string {
  let id = "";
  for (let i = 0; i < 8; i += 1) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return id;
}

/** One line of the list: a group on its own, or a folder and what is in it. */
export type RailEntry =
  | { kind: "group"; id: string; group: GroupSummary }
  | { kind: "folder"; id: string; folder: GroupFolder; groups: GroupSummary[] };

/**
 * The layout as it stands, made from the groups alone — for somebody with no
 * folders yet, or an API too old to send one. Archived groups are left out,
 * as in a saved layout.
 */
export function layoutFromGroups(groups: readonly GroupSummary[]): GroupRailLayout {
  return { order: groups.filter((g) => !g.archived).map((g) => g.id), folders: [] };
}

/**
 * What the list draws, from the groups and the layout. Anything the layout
 * does not account for (a group joined a moment ago, before the server's
 * answer) goes on top, like the server would put it; anything the layout names
 * that is no longer among the groups is skipped.
 */
export function railEntries(groups: readonly GroupSummary[], layout: GroupRailLayout | null): RailEntry[] {
  const live = groups.filter((g) => !g.archived);
  const byId = new Map(live.map((g) => [g.id, g]));
  const source = layout ?? layoutFromGroups(live);
  const placed = new Set<string>();
  const folders = new Map<string, { folder: GroupFolder; groups: GroupSummary[] }>();
  for (const folder of source.folders) {
    const inside = folder.groupIds.map((id) => byId.get(id)).filter((g): g is GroupSummary => Boolean(g) && !placed.has(g!.id));
    for (const g of inside) placed.add(g.id);
    if (inside.length > 0) folders.set(folder.id, { folder: { ...folder, groupIds: inside.map((g) => g.id) }, groups: inside });
  }
  const entries: RailEntry[] = [];
  const usedFolders = new Set<string>();
  for (const entry of source.order) {
    const folderId = folderIdOf(entry);
    if (folderId) {
      const found = folders.get(folderId);
      if (found && !usedFolders.has(folderId)) {
        usedFolders.add(folderId);
        entries.push({ kind: "folder", id: folderId, folder: found.folder, groups: found.groups });
      }
      continue;
    }
    const group = byId.get(entry);
    if (group && !placed.has(entry)) {
      placed.add(entry);
      entries.push({ kind: "group", id: entry, group });
    }
  }
  for (const [id, found] of folders) {
    if (!usedFolders.has(id)) entries.push({ kind: "folder", id, folder: found.folder, groups: found.groups });
  }
  const fresh = live.filter((g) => !placed.has(g.id)).map((g): RailEntry => ({ kind: "group", id: g.id, group: g }));
  return [...fresh, ...entries];
}

/** The layout the entries describe — what gets saved after any change to them. */
export function layoutOf(entries: readonly RailEntry[]): GroupRailLayout {
  return {
    order: entries.map((e) => (e.kind === "folder" ? folderRef(e.id) : e.id)),
    folders: entries
      .filter((e): e is Extract<RailEntry, { kind: "folder" }> => e.kind === "folder")
      .map((e) => ({ ...e.folder, groupIds: e.groups.map((g) => g.id) })),
  };
}

/** Every group in list order: the top level with each folder opened in place. */
export function flatIds(layout: GroupRailLayout): string[] {
  const byFolder = new Map(layout.folders.map((f) => [f.id, f.groupIds]));
  return layout.order.flatMap((entry) => {
    const folderId = folderIdOf(entry);
    return folderId ? byFolder.get(folderId) ?? [] : [entry];
  });
}

/** The archived groups, newest put away first (the order the API lists them in). */
export function archivedGroups(groups: readonly GroupSummary[]): GroupSummary[] {
  return groups.filter((g) => g.archived);
}

/** The folder a group is in, if any. */
export function folderOfGroup(layout: GroupRailLayout | null, groupId: string): GroupFolder | null {
  return layout?.folders.find((f) => f.groupIds.includes(groupId)) ?? null;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** One top-level line moved from one place to another. */
export function moveEntry(layout: GroupRailLayout, from: number, to: number): GroupRailLayout {
  if (from === to || from < 0 || from >= layout.order.length) return layout;
  return { ...layout, order: moved(layout.order, from, Math.max(0, Math.min(layout.order.length - 1, to))) };
}

/** One group moved inside its folder. */
export function moveInFolder(layout: GroupRailLayout, folderId: string, from: number, to: number): GroupRailLayout {
  return {
    ...layout,
    folders: layout.folders.map((f) =>
      f.id === folderId && from !== to && from >= 0 && from < f.groupIds.length
        ? { ...f, groupIds: moved(f.groupIds, from, Math.max(0, Math.min(f.groupIds.length - 1, to))) }
        : f
    ),
  };
}

/** Takes a group out of wherever it is in the layout (a folder or the top level). */
function without(layout: GroupRailLayout, groupId: string): GroupRailLayout {
  return {
    order: layout.order.filter((entry) => entry !== groupId),
    folders: layout.folders
      .map((f) => ({ ...f, groupIds: f.groupIds.filter((id) => id !== groupId) }))
      .filter((f) => f.groupIds.length > 0 || false),
  };
}

/** Drops folders left empty, and their refs. */
function pruned(layout: GroupRailLayout): GroupRailLayout {
  const kept = new Set(layout.folders.filter((f) => f.groupIds.length > 0).map((f) => f.id));
  return {
    order: layout.order.filter((entry) => {
      const folderId = folderIdOf(entry);
      return !folderId || kept.has(folderId);
    }),
    folders: layout.folders.filter((f) => kept.has(f.id)),
  };
}

/**
 * A new folder holding `groupIds`, where the first of them was. Named after
 * nothing — an empty name is drawn as "Pasta" — and in the first colour.
 */
export function createFolder(
  layout: GroupRailLayout,
  groupIds: string[],
  options: { id?: string; name?: string; color?: FolderColor } = {}
): { layout: GroupRailLayout; folderId: string } {
  const id = options.id ?? newFolderId();
  const anchor = groupIds[0];
  // Where the folder goes: the place of the first group, at the top level or
  // where its folder sits.
  const anchorFolder = layout.folders.find((f) => f.groupIds.includes(anchor));
  const anchorEntry = anchorFolder ? folderRef(anchorFolder.id) : anchor;
  let next = layout;
  for (const gid of groupIds) next = without(next, gid);
  const index = layout.order.indexOf(anchorEntry);
  const order = [...next.order];
  const at = index < 0 ? 0 : Math.min(order.length, layout.order.slice(0, index).filter((e) => order.includes(e)).length);
  order.splice(at, 0, folderRef(id));
  return {
    layout: pruned({
      order,
      folders: [...next.folders, { id, name: options.name ?? "", color: options.color ?? "blue", groupIds: [...groupIds] }],
    }),
    folderId: id,
  };
}

/** A group put into a folder, at its end. */
export function addToFolder(layout: GroupRailLayout, groupId: string, folderId: string): GroupRailLayout {
  if (!layout.folders.some((f) => f.id === folderId)) return layout;
  const next = without(layout, groupId);
  return pruned({
    order: next.order,
    folders: next.folders.map((f) => (f.id === folderId ? { ...f, groupIds: [...f.groupIds, groupId] } : f)),
  });
}

/** A group taken out of its folder, to sit right after it. */
export function removeFromFolder(layout: GroupRailLayout, groupId: string): GroupRailLayout {
  const folder = layout.folders.find((f) => f.groupIds.includes(groupId));
  if (!folder) return layout;
  const at = layout.order.indexOf(folderRef(folder.id));
  const next = without(layout, groupId);
  const order = [...next.order];
  const stillThere = order.indexOf(folderRef(folder.id));
  order.splice(stillThere >= 0 ? stillThere + 1 : Math.max(0, at), 0, groupId);
  return pruned({ order, folders: next.folders });
}

/** A folder undone: its groups take its place, in its order. */
export function dissolveFolder(layout: GroupRailLayout, folderId: string): GroupRailLayout {
  const folder = layout.folders.find((f) => f.id === folderId);
  if (!folder) return layout;
  return {
    order: layout.order.flatMap((entry) => (entry === folderRef(folderId) ? folder.groupIds : [entry])),
    folders: layout.folders.filter((f) => f.id !== folderId),
  };
}

export function updateFolder(
  layout: GroupRailLayout,
  folderId: string,
  patch: { name?: string; color?: FolderColor }
): GroupRailLayout {
  return {
    ...layout,
    folders: layout.folders.map((f) =>
      f.id === folderId
        ? { ...f, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 32) } : {}), ...(patch.color ? { color: patch.color } : {}) }
        : f
    ),
  };
}

/** A group out of the layout altogether — it is going onto the shelf. */
export function withoutGroup(layout: GroupRailLayout, groupId: string): GroupRailLayout {
  return pruned(without(layout, groupId));
}

/** What a folder's line says about its groups put together: any unread, and how many mentions. */
export function folderNews(groups: readonly GroupSummary[]): { unread: boolean; mentions: number } {
  let unread = false;
  let mentions = 0;
  for (const g of groups) {
    if (g.suspended) continue;
    unread ||= g.unread;
    mentions += g.mentions;
  }
  return { unread, mentions };
}

/**
 * The groups whose marks count toward the totals — the tab bar's badge, the
 * rail's "@". An archived group's do not: its count is drawn on the shelf
 * itself and nowhere else. Outside the experiment (`organizing` false) there
 * is no shelf to draw, so every group counts, as before.
 */
export function countedGroups(groups: readonly GroupSummary[], organizing: boolean): GroupSummary[] {
  return organizing ? groups.filter((g) => !g.archived) : [...groups];
}
