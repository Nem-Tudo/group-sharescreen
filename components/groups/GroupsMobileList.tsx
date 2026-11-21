"use client";

import { groupEntryPath } from "@/components/groups/lastChannel";
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdArchive,
  MdArrowDownward,
  MdArrowUpward,
  MdChevronRight,
  MdClose,
  MdCreateNewFolder,
  MdDoneAll,
  MdDriveFileMove,
  MdFolder,
  MdFolderOff,
  MdKeyboardArrowDown,
  MdLink,
  MdMoreHoriz,
  MdOutlineFolderOpen,
  MdScreenShare,
  MdSearch,
  MdUnarchive,
  MdVerticalAlignBottom,
  MdVerticalAlignTop,
  MdVideocam,
  MdVolumeUp,
} from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { MobileSheet } from "@/components/MobileSheet";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupLink } from "@/components/groups/GroupLink";
import { GroupName } from "@/components/groups/GroupName";
import { LiveRoomsRow } from "@/components/groups/GroupsHome";
import { nameMatches, searchWords, setGroupsHomeQuery } from "@/components/groups/groupSearch";
import { copyText } from "@/lib/clipboard";
import { GROUPS_EXPLORE_PATH, groupPath } from "@/lib/groupLinks";
import type { GroupFolder, GroupSummary } from "@/lib/groupsApi";
import { useGroupNavigation } from "@/lib/groupNavigation";
import {
  FOLDER_COLORS,
  FOLDER_SWATCH,
  FOLDER_TINT,
  addToFolder,
  archivedGroups,
  createFolder,
  dissolveFolder,
  folderColor,
  folderNews,
  layoutOf,
  moveEntry,
  moveInFolder,
  railEntries,
  removeFromFolder,
  updateFolder,
  type RailEntry,
} from "@/lib/groupRailLayout";
import { GROUP_ORGANIZE_EVENTS, trackGroupOrganize, useGroupOrganize } from "@/lib/groupOrganize";
import { haptic } from "@/lib/nativeApp";
import { setFolderOpen, useOpenFolders } from "@/lib/openFolders";
import {
  archiveGroup,
  markGroupRead,
  prefetchGroup,
  reorderGroups,
  saveLayout,
  useGroupRailLayout,
  useMyGroups,
} from "@/lib/useGroups";
import { useAuth } from "@/lib/AuthContext";
import { useT, useTCount } from "@/lib/useI18n";

// /groups on a phone (experiments groups-hub and group-organize): the list of
// the groups somebody is in, the way a chat app lists its chats — one row per
// group, edge to edge, the newest at the top; a search over them; the
// archived ones behind a row of their own at the very top (WhatsApp's place
// for it); folders that open in place. Public groups are Explorar's, a button
// away in the bar (see GroupMobileBar).
//
// Rearranging is an action sheet rather than a drag: a list a thumb scrolls
// all day is the wrong place for a gesture that also starts on a long press,
// and iOS spends the long press on a link's preview anyway. "Organizar" puts a
// ⋯ on every row; on Android a long press opens the same sheet.

type Sheet = { kind: "group"; id: string } | { kind: "folder"; id: string } | null;

export function GroupsMobileList() {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const navigation = useGroupNavigation();
  const organize = useGroupOrganize({ track: true });
  const { groups } = useMyGroups();
  const layout = useGroupRailLayout();
  const openFolders = useOpenFolders();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const list = useMemo(() => groups ?? [], [groups]);
  const entries: RailEntry[] = useMemo(
    () => (organize ? railEntries(list, layout) : list.map((g) => ({ kind: "group", id: g.id, group: g }))),
    [organize, list, layout]
  );
  const drawn = useMemo(() => layoutOf(entries), [entries]);
  const shelf = useMemo(() => (organize ? archivedGroups(list) : []), [organize, list]);
  const entryIds = entries.map((e) => e.id);
  const words = searchWords(query);
  const searching = words.length > 0;
  const matches = searching ? list.filter((g) => nameMatches(g.name, words)) : [];

  const folderOf = (groupId: string) => drawn.folders.find((f) => f.groupIds.includes(groupId)) ?? null;

  function moveLine(kind: "group" | "folder", id: string, to: number) {
    const folder = kind === "group" ? folderOf(id) : null;
    const siblings = folder ? folder.groupIds : entryIds;
    const from = siblings.indexOf(id);
    const target = Math.max(0, Math.min(siblings.length - 1, to));
    if (from < 0 || from === target) return;
    haptic("tap");
    if (folder) saveLayout(moveInFolder(drawn, folder.id, from, target));
    else if (organize) saveLayout(moveEntry(drawn, from, target));
    else {
      const next = [...entryIds];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      reorderGroups(next);
    }
  }

  function openSheet(e: ReactMouseEvent | null, next: Sheet) {
    e?.preventDefault();
    e?.stopPropagation();
    haptic("tap");
    setSheet(next);
  }

  const sheetGroup = sheet?.kind === "group" ? list.find((g) => g.id === sheet.id) ?? null : null;
  const sheetFolder =
    sheet?.kind === "folder"
      ? ((entries.find((e) => e.kind === "folder" && e.id === sheet.id) as Extract<RailEntry, { kind: "folder" }> | undefined) ??
        null)
      : null;

  const groupRow = (group: GroupSummary, extra?: { nested?: boolean; shelved?: boolean }) => (
    <GroupRow
      key={group.id}
      group={group}
      nested={Boolean(extra?.nested)}
      shelved={Boolean(extra?.shelved)}
      editing={editing && organize}
      onOptions={(e) => openSheet(e, { kind: "group", id: group.id })}
      onLongPress={organize ? (e) => openSheet(e, { kind: "group", id: group.id }) : undefined}
    />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white dark:bg-zinc-950">
      {/* The search, and "Organizar" beside it when there is anything to organize. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-3 pb-2 pt-3 backdrop-blur dark:bg-zinc-950/95">
        <div className="relative min-w-0 flex-1">
          <MdSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("groups.groupRail.searchPlaceholder")}
            aria-label={t("groups.groupRail.searchPlaceholder")}
            maxLength={100}
            enterKeyHint="search"
            className="h-10 w-full rounded-full bg-zinc-100 pl-10 pr-9 text-[15px] text-zinc-950 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-400/40 dark:bg-zinc-900 dark:text-zinc-50 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={t("groups.groupsHome.clearSearch")}
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500"
            >
              <MdClose className="h-4 w-4" />
            </button>
          )}
        </div>
        {organize && list.length > 1 && !searching && (
          <button
            type="button"
            onClick={() => {
              haptic("tap");
              setEditing(!editing);
            }}
            aria-pressed={editing}
            className={`h-10 shrink-0 rounded-full px-3.5 text-sm font-semibold transition active:scale-95 ${
              editing
                ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            }`}
          >
            {editing ? t("groups.organize.done") : t("groups.organize.organize")}
          </button>
        )}
      </div>

      {searching ? (
        <div className="pb-4">
          <ul>{matches.map((g) => groupRow(g, { shelved: Boolean(organize && g.archived) }))}</ul>
          {matches.length === 0 && (
            <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupRail.noMatches")}</p>
          )}
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setGroupsHomeQuery(query.trim());
                navigation.push(GROUPS_EXPLORE_PATH);
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-3 py-3 text-left text-sm font-medium text-zinc-700 active:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:active:bg-zinc-900"
            >
              <GlobeIcon className="h-5 w-5 shrink-0" />
              {t("groups.groupRail.searchPublicGroups")}
            </button>
          </div>
        </div>
      ) : groups === null ? (
        <div className="flex flex-col gap-1 px-3 py-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="flex items-center gap-3 py-2">
              <span className="h-12 w-12 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
              <span className="h-3 flex-1 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </span>
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyGroups canCreate={Boolean(account)} onExplore={() => navigation.push(GROUPS_EXPLORE_PATH)} />
      ) : (
        <div className="pb-4">
          <div className="px-3">
            <LiveRoomsRow />
          </div>

          {shelf.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!shelfOpen) trackGroupOrganize(GROUP_ORGANIZE_EVENTS.archiveOpen);
                  setShelfOpen(!shelfOpen);
                }}
                aria-expanded={shelfOpen}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-100 dark:active:bg-zinc-900"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-zinc-500">
                  <MdArchive className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                    {t("groups.organize.archived")}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{t("groups.organize.archiveHint")}</span>
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{shelf.length}</span>
                <MdKeyboardArrowDown className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${shelfOpen ? "rotate-180" : ""}`} />
              </button>
              {shelfOpen && <ul className="bg-zinc-50 dark:bg-zinc-900/40">{shelf.map((g) => groupRow(g, { shelved: true }))}</ul>}
            </>
          )}

          <ul>
            {entries.map((entry) =>
              entry.kind === "group" ? (
                groupRow(entry.group)
              ) : (
                <FolderSection
                  key={`folder:${entry.id}`}
                  folder={entry.folder}
                  groups={entry.groups}
                  open={openFolders.has(entry.id)}
                  editing={editing}
                  onToggle={() => {
                    haptic("tap");
                    setFolderOpen(entry.id, !openFolders.has(entry.id));
                  }}
                  onOptions={(e) => openSheet(e, { kind: "folder", id: entry.id })}
                  renderGroup={(g) => groupRow(g, { nested: true })}
                />
              )
            )}
          </ul>

          <div className="flex gap-2 px-3 pt-4">
            <button
              type="button"
              onClick={() => navigation.push(GROUPS_EXPLORE_PATH)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-semibold text-zinc-800 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200"
            >
              <GlobeIcon className="h-5 w-5" />
              {t("groups.groupDialogs.exploreGroups")}
            </button>
            <button
              type="button"
              onClick={() => void openPopup("add_group", { data: {} })}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-3 py-2.5 text-sm font-semibold text-white active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950"
            >
              <MdAdd className="h-5 w-5" />
              {t("groups.homeGroupsPanel.addGroup")}
            </button>
          </div>
        </div>
      )}

      {/* The actions on one group or one folder. */}
      <MobileSheet open={Boolean(sheetGroup || sheetFolder)} onClose={() => setSheet(null)} title={sheetGroup?.name ?? (sheetFolder ? sheetFolder.folder.name || t("groups.organize.folder") : "")}>
        {sheetGroup ? (
          <GroupSheet
            group={sheetGroup}
            organize={organize}
            siblings={folderOf(sheetGroup.id)?.groupIds ?? entryIds}
            folders={drawn.folders}
            currentFolder={folderOf(sheetGroup.id)}
            onMove={(to) => moveLine("group", sheetGroup.id, to)}
            onNewFolder={() => {
              const { layout: next, folderId } = createFolder(drawn, [sheetGroup.id]);
              saveLayout(next);
              setFolderOpen(folderId, true);
              trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderCreate);
              // Straight into naming it.
              setSheet({ kind: "folder", id: folderId });
            }}
            onAddTo={(folderId) => {
              saveLayout(addToFolder(drawn, sheetGroup.id, folderId));
              setFolderOpen(folderId, true);
              trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderAdd);
              setSheet(null);
            }}
            onRemoveFromFolder={() => {
              saveLayout(removeFromFolder(drawn, sheetGroup.id));
              setSheet(null);
            }}
            onArchive={(archived) => {
              archiveGroup(sheetGroup.id, archived);
              trackGroupOrganize(archived ? GROUP_ORGANIZE_EVENTS.archive : GROUP_ORGANIZE_EVENTS.unarchive);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        ) : sheetFolder ? (
          <FolderSheet
            key={sheetFolder.id}
            folder={sheetFolder.folder}
            groups={sheetFolder.groups}
            index={entryIds.indexOf(sheetFolder.id)}
            total={entryIds.length}
            onMove={(to) => moveLine("folder", sheetFolder.id, to)}
            onRename={(name) => saveLayout(updateFolder(drawn, sheetFolder.id, { name }))}
            onColor={(color) => saveLayout(updateFolder(drawn, sheetFolder.id, { color }))}
            onUngroup={() => {
              saveLayout(dissolveFolder(drawn, sheetFolder.id));
              trackGroupOrganize(GROUP_ORGANIZE_EVENTS.folderUngroup);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        ) : null}
      </MobileSheet>
    </div>
  );
}

/** Nobody's groups yet: the two ways to get one, big, and the way to find one. */
function EmptyGroups({ canCreate, onExplore }: { canCreate: boolean; onExplore: () => void }) {
  const t = useT();
  const { openPopup } = useNtPopups();
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupsHome.severalVoiceAndTextRoomsIn")}</p>
      <button
        type="button"
        onClick={onExplore}
        className="flex items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-3.5 text-left active:bg-zinc-50 dark:border-zinc-800 dark:active:bg-zinc-900"
      >
        <GlobeIcon className="h-6 w-6 shrink-0 text-zinc-600 dark:text-zinc-300" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-zinc-950 dark:text-zinc-50">{t("groups.groupDialogs.exploreGroups")}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.exploreGroupsHint")}</span>
        </span>
        <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void openPopup("join_group", { data: {} })}
          className="flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-3 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
        >
          <MdLink className="h-5 w-5" />
          {t("common.joinAGroup")}
        </button>
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => void openPopup("create_group", { data: {} })}
          className="flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
        >
          <MdAdd className="h-5 w-5" />
          {t("common.createAGroup")}
        </button>
      </div>
    </div>
  );
}

function GroupRow({
  group,
  nested,
  shelved,
  editing,
  onOptions,
  onLongPress,
}: {
  group: GroupSummary;
  nested: boolean;
  shelved: boolean;
  editing: boolean;
  onOptions: (e: ReactMouseEvent) => void;
  onLongPress?: (e: ReactMouseEvent) => void;
}) {
  const t = useT();
  const mentions = group.suspended ? 0 : group.mentions;
  const unread = !group.suspended && group.unread;
  const activity = group.suspended || shelved ? undefined : group.voiceActivity;
  const ActivityIcon = activity === "screen" ? MdScreenShare : activity === "camera" ? MdVideocam : MdVolumeUp;
  const status = group.suspended ? (
    <span className="font-medium text-amber-600 dark:text-amber-400">{t("common.suspended")}</span>
  ) : activity ? (
    <span className={`inline-flex items-center gap-1 ${activity === "voice" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      <ActivityIcon className="h-3.5 w-3.5 shrink-0" />
      {activity === "screen"
        ? t("groups.groupRail.callScreen")
        : activity === "camera"
          ? t("groups.groupRail.callCamera")
          : t("groups.groupRail.callVoice")}
    </span>
  ) : unread ? (
    t("common.newMessages")
  ) : group.onlineCount ? (
    t("groups.groupRail.onlineCount", { count: group.onlineCount })
  ) : null;

  return (
    <li className="relative">
      <GroupLink
        href={groupEntryPath(group.id)}
        onFocus={() => prefetchGroup(group.id)}
        onContextMenu={onLongPress}
        draggable={false}
        className={`flex items-center gap-3 py-2.5 pr-3 select-none [-webkit-touch-callout:none] active:bg-zinc-100 dark:active:bg-zinc-900 ${
          nested ? "pl-8" : "pl-4"
        } ${shelved ? "opacity-75" : ""} ${editing ? "pr-14" : ""}`}
      >
        <span className="relative shrink-0">
          <GroupIcon
            name={group.name}
            iconUrl={group.iconUrl}
            seed={group.id}
            size={nested ? 40 : 48}
            className={`rounded-2xl ${group.suspended ? "opacity-50 grayscale" : ""}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <GroupName
            name={group.name}
            flags={group.flags}
            className={`flex w-full text-[15px] ${unread ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-900 dark:text-zinc-100"}`}
          />
          {status && <span className="block truncate text-[13px] text-zinc-500 dark:text-zinc-400">{status}</span>}
        </span>
        {!editing &&
          (mentions > 0 ? (
            <span
              className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ${
                shelved ? "bg-zinc-500" : "bg-red-600"
              }`}
            >
              {mentions > 99 ? "99+" : mentions}
            </span>
          ) : unread ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-label={t("common.newMessages")} />
          ) : null)}
      </GroupLink>
      {editing && (
        <button
          type="button"
          onClick={onOptions}
          aria-label={t("groups.organize.options")}
          className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-zinc-600 active:bg-zinc-200 dark:text-zinc-300 dark:active:bg-zinc-800"
        >
          <MdMoreHoriz className="h-6 w-6" />
        </button>
      )}
    </li>
  );
}

function FolderSection({
  folder,
  groups,
  open,
  editing,
  onToggle,
  onOptions,
  renderGroup,
}: {
  folder: GroupFolder;
  groups: GroupSummary[];
  open: boolean;
  editing: boolean;
  onToggle: () => void;
  onOptions: (e: ReactMouseEvent) => void;
  renderGroup: (group: GroupSummary) => ReactNode;
}) {
  const t = useT();
  const tc = useTCount();
  const color = folderColor(folder.color);
  const news = folderNews(groups);
  return (
    <li>
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          onContextMenu={(e) => onOptions(e)}
          aria-expanded={open}
          className={`flex w-full items-center gap-3 py-2.5 pl-4 text-left select-none active:bg-zinc-100 dark:active:bg-zinc-900 ${editing ? "pr-14" : "pr-3"}`}
        >
          {open ? (
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${FOLDER_TINT[color]}`}>
              <MdOutlineFolderOpen className="h-6 w-6" />
            </span>
          ) : (
            <span className={`grid h-12 w-12 shrink-0 grid-cols-2 gap-0.5 rounded-2xl p-1.5 ${FOLDER_TINT[color]}`}>
              {groups.slice(0, 4).map((g) => (
                <GroupIcon key={g.id} name={g.name} iconUrl={g.iconUrl} seed={g.id} size={17} className="rounded-md" />
              ))}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${FOLDER_SWATCH[color]}`} />
              <span className={`truncate text-[15px] ${news.unread && !open ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-900 dark:text-zinc-100"}`}>
                {folder.name || t("groups.organize.folder")}
              </span>
            </span>
            <span className="block truncate text-[13px] text-zinc-500 dark:text-zinc-400">
              {tc("groups.organize.folderCount", groups.length)}
            </span>
          </span>
          {!open && !editing &&
            (news.mentions > 0 ? (
              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
                {news.mentions > 99 ? "99+" : news.mentions}
              </span>
            ) : news.unread ? (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            ) : null)}
          {!editing && (
            <MdKeyboardArrowDown className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
          )}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onOptions}
            aria-label={t("groups.organize.options")}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-zinc-600 active:bg-zinc-200 dark:text-zinc-300 dark:active:bg-zinc-800"
          >
            <MdMoreHoriz className="h-6 w-6" />
          </button>
        )}
      </div>
      {open && (
        <ul className="relative">
          <span aria-hidden className={`absolute bottom-2 left-[1.6rem] top-0 w-0.5 rounded-full ${FOLDER_SWATCH[color]} opacity-60`} />
          {groups.map((g) => renderGroup(g))}
        </ul>
      )}
    </li>
  );
}

// ─── The sheets ─────────────────────────────────────────────────────────

const sheetRow =
  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium text-zinc-800 transition active:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:active:bg-zinc-900";

function MoveRows({ index, total, onMove }: { index: number; total: number; onMove: (to: number) => void }) {
  const t = useT();
  return (
    <>
      <button type="button" disabled={index <= 0} onClick={() => onMove(0)} className={sheetRow}>
        <MdVerticalAlignTop className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.moveToTop")}
      </button>
      <button type="button" disabled={index <= 0} onClick={() => onMove(index - 1)} className={sheetRow}>
        <MdArrowUpward className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.moveUp")}
      </button>
      <button type="button" disabled={index >= total - 1} onClick={() => onMove(index + 1)} className={sheetRow}>
        <MdArrowDownward className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.moveDown")}
      </button>
      <button type="button" disabled={index >= total - 1} onClick={() => onMove(total - 1)} className={sheetRow}>
        <MdVerticalAlignBottom className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.moveToBottom")}
      </button>
    </>
  );
}

function GroupSheet({
  group,
  organize,
  siblings,
  folders,
  currentFolder,
  onMove,
  onNewFolder,
  onAddTo,
  onRemoveFromFolder,
  onArchive,
  onClose,
}: {
  group: GroupSummary;
  organize: boolean;
  siblings: readonly string[];
  folders: GroupFolder[];
  currentFolder: GroupFolder | null;
  onMove: (to: number) => void;
  onNewFolder: () => void;
  onAddTo: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onArchive: (archived: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const shelved = organize && Boolean(group.archived);
  const hasNews = !group.suspended && (group.unread || group.mentions > 0);
  const others = folders.filter((f) => f.id !== currentFolder?.id);
  const index = siblings.indexOf(group.id);

  if (picking) {
    return (
      <div className="flex flex-col pb-1">
        {others.map((folder) => (
          <button key={folder.id} type="button" onClick={() => onAddTo(folder.id)} className={sheetRow}>
            <span className={`h-3 w-3 shrink-0 rounded-full ${FOLDER_SWATCH[folderColor(folder.color)]}`} />
            <span className="truncate">{folder.name || t("groups.organize.folder")}</span>
          </button>
        ))}
        <button type="button" onClick={onNewFolder} className={sheetRow}>
          <MdCreateNewFolder className="h-5 w-5 shrink-0 opacity-75" />
          {t("groups.organize.newFolder")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-1">
      <button
        type="button"
        disabled={!hasNews}
        onClick={() => {
          void markGroupRead(group.id);
          onClose();
        }}
        className={sheetRow}
      >
        <MdDoneAll className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.markAsRead")}
      </button>
      <button
        type="button"
        onClick={() => {
          void copyText(`${window.location.origin}${groupPath(group.id)}`);
          onClose();
        }}
        className={sheetRow}
      >
        <MdLink className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.groupRail.copyLink")}
      </button>
      {organize && !shelved && (
        <>
          {others.length > 0 ? (
            <button type="button" onClick={() => setPicking(true)} className={sheetRow}>
              <MdDriveFileMove className="h-5 w-5 shrink-0 opacity-75" />
              {t("groups.organize.moveToFolder")}
            </button>
          ) : (
            <button type="button" onClick={onNewFolder} className={sheetRow}>
              <MdCreateNewFolder className="h-5 w-5 shrink-0 opacity-75" />
              {t("groups.organize.newFolder")}
            </button>
          )}
          {currentFolder && (
            <button type="button" onClick={onRemoveFromFolder} className={sheetRow}>
              <MdFolderOff className="h-5 w-5 shrink-0 opacity-75" />
              {t("groups.organize.removeFromFolder")}
            </button>
          )}
        </>
      )}
      {!shelved && <MoveRows index={index} total={siblings.length} onMove={onMove} />}
      {organize && (
        <button type="button" onClick={() => onArchive(!shelved)} className={sheetRow}>
          {shelved ? <MdUnarchive className="h-5 w-5 shrink-0 opacity-75" /> : <MdArchive className="h-5 w-5 shrink-0 opacity-75" />}
          <span className="min-w-0">
            <span className="block">{shelved ? t("groups.organize.unarchive") : t("groups.organize.archive")}</span>
            {!shelved && <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{t("groups.organize.archiveHint")}</span>}
          </span>
        </button>
      )}
    </div>
  );
}

function FolderSheet({
  folder,
  groups,
  index,
  total,
  onMove,
  onRename,
  onColor,
  onUngroup,
  onClose,
}: {
  folder: GroupFolder;
  groups: GroupSummary[];
  index: number;
  total: number;
  onMove: (to: number) => void;
  onRename: (name: string) => void;
  onColor: (color: (typeof FOLDER_COLORS)[number]) => void;
  onUngroup: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(folder.name);
  const current = folderColor(folder.color);
  const commit = () => {
    if (name.trim() !== folder.name) onRename(name);
  };
  const hasNews = groups.some((g) => !g.suspended && (g.unread || g.mentions > 0));
  return (
    <div className="flex flex-col gap-1 pb-1">
      <label className="px-3 pt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400" htmlFor={`m-folder-${folder.id}`}>
        {t("groups.organize.folderName")}
      </label>
      <input
        id={`m-folder-${folder.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            onClose();
          }
        }}
        maxLength={32}
        enterKeyHint="done"
        placeholder={t("groups.organize.folder")}
        className="mx-3 h-11 rounded-xl border border-zinc-300 bg-white px-3 text-[15px] text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <div role="radiogroup" aria-label={t("groups.organize.folderColor")} className="flex flex-wrap gap-2.5 px-3 py-2">
        {FOLDER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === current}
            aria-label={color}
            onClick={() => onColor(color)}
            className={`h-8 w-8 rounded-full ${FOLDER_SWATCH[color]} ${
              color === current ? "ring-2 ring-zinc-950 ring-offset-2 ring-offset-white dark:ring-zinc-50 dark:ring-offset-zinc-950" : ""
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={!hasNews}
        onClick={() => {
          for (const g of groups) if (g.unread || g.mentions > 0) void markGroupRead(g.id);
          onClose();
        }}
        className={sheetRow}
      >
        <MdDoneAll className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.organize.markFolderRead")}
      </button>
      <MoveRows index={index} total={total} onMove={onMove} />
      <button type="button" onClick={onUngroup} className={sheetRow}>
        <MdFolder className="h-5 w-5 shrink-0 opacity-75" />
        {t("groups.organize.ungroup")}
      </button>
    </div>
  );
}
