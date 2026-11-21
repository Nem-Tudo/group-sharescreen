"use client";

import { groupEntryPath } from "@/components/groups/lastChannel";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import useNtPopups from "ntpopups";
import { MdAdd, MdExplore, MdLink } from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import { SkeletonRows } from "@/components/HomeSkeletons";
import { readHomePanels, writeHomePanels } from "@/lib/homePanelsCache";
import { Popover, Tooltip } from "@/components/Tooltip";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { OFFICIAL_GROUP_ID, fetchPublicGroupPreview, groupPath, type PublicGroupPreview } from "@/lib/groupLinks";
import { joinPublicGroup } from "@/lib/groupsApi";
import { useGuestToken } from "@/lib/guestToken";
import { refreshGroup, refreshGroups, syncGroupsIdentity, useMyGroups } from "@/lib/useGroups";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectName } from "@/lib/signalingSelectors";
import { useT } from "@/lib/useI18n";
import { useGroupContextMenu } from "@/components/groups/groupMenus";
import { requestExploreGroups } from "@/components/groups/groupSearch";
import { translate, translateCount } from "@/lib/i18n";
import { GROUPS_EXPLORE_PATH } from "@/lib/groupLinks";
import type { GroupSummary } from "@/lib/groupsApi";
import {
  FOLDER_SWATCH,
  folderColor,
  layoutOf,
  moveEntry,
  moveInFolder,
  railEntries,
  type RailEntry,
} from "@/lib/groupRailLayout";
import { GROUP_ORGANIZE_EVENTS, trackGroupOrganize, useGroupOrganize } from "@/lib/groupOrganize";
import { useGroupsHub } from "@/lib/groupsHub";
import { useDragSort } from "@/lib/useDragSort";
import { saveLayout, useGroupRailLayout } from "@/lib/useGroups";

// The groups list beside the home page's room form — the counterpart of the
// friends list on the other side of it (see HomeFriendsPanel), drawn the same
// way so the two read as one family: bordered rows, a face, a name, and on the
// right the one number worth being told about (mentions).
//
// Shown to an account always (with a way in when there is nothing yet), and to
// a guest only once they are in a group — a guest can belong to a couple, and
// the home page is where they come back to. Nothing at all, and no request, for
// somebody with no identity yet: the form next to this is still asking for one.

const ROLE_LABEL = { get owner() { return translate("common.owner"); }, get admin() { return translate("common.admin"); }, get member() { return translate("common.member"); } } as const;

/** "4 membros · 1 online" — the line a group's card carries. Empty from an API that does not say. */
function describeCounts(memberCount: number | undefined, onlineCount: number | undefined): string {
  if (memberCount === undefined) return "";
  const members = translateCount("common.memberCount", memberCount);
  return onlineCount ? `${members} · ${onlineCount} online` : members;
}

// The card's own button, drawn on the row. The groups you are in open, the one
// you are not in joins (see OfficialGroupCard) — same size, different colour.
const CARD_ACTION = "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition";

const ICON_BUTTON =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900";

const PANEL_CLASS =
  "flex w-full max-w-md flex-col rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:w-88 dark:border-white/10 dark:bg-zinc-950";

const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900";

// The official group's public face, read once per page load and shared by
// every opening of the "+" menu — it is the same group for everybody, and the
// menu should not flash a skeleton each time it opens.
let officialPreview: Promise<PublicGroupPreview | null> | null = null;

/**
 * GoLive's own group, as a card in the "+" menu — drawn like the group rows
 * below it (its face, its name with the badge), with its own way in: one
 * click joins it and opens it. Only offered to somebody not in it yet (see
 * offerOfficial); a guest who has no name yet is sent to the group's page
 * instead, whose join card is where a name is asked for.
 */
function OfficialGroupCard({ onDone }: { onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const { account } = useAuth();
  const registeredName = useSignalingSelector(selectName);
  const [preview, setPreview] = useState<PublicGroupPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    officialPreview ??= fetchPublicGroupPreview(OFFICIAL_GROUP_ID).then((result) => {
      // A failed read is not kept, so the next opening tries again.
      if (!result) officialPreview = null;
      return result;
    });
    void officialPreview.then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (preview === null) return null;
  const path = groupPath(OFFICIAL_GROUP_ID);

  async function join() {
    if (!account && !registeredName) {
      onDone();
      router.push(path);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await joinPublicGroup(OFFICIAL_GROUP_ID, account ? null : registeredName);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    await Promise.all([refreshGroups(), refreshGroup(OFFICIAL_GROUP_ID)]);
    onDone();
    router.push(path);
  }

  return (
    <div className="mt-1 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
      <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{t("groups.homeGroupsPanel.officialGroup")}</p>
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        {preview === undefined ? (
          <>
            <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            <span className="h-3 flex-1 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          </>
        ) : (
          <>
            <GroupIcon
              name={preview.group.name}
              iconUrl={preview.group.iconUrl}
              seed={preview.group.id}
              size={32}
              className="rounded-lg"
            />
            <span className="min-w-0 flex-1">
              <GroupName
                name={preview.group.name}
                flags={preview.group.flags}
                className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100"
              />
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {describeCounts(preview.group.memberCount, preview.group.onlineCount)}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void join()}
              className={`${CARD_ACTION} cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busy ? t("common.joining2") : t("common.signIn")}
            </button>
          </>
        )}
      </div>
      {error && <p className="px-2 pt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export function HomeGroupsPanel({ className = "" }: { className?: string }) {
  const { account, loading } = useAuth();
  const guestToken = useGuestToken();
  // Same reason as the friends panel: appearing a beat after the page settled
  // would shove the form sideways under somebody's cursor. `loading` only
  // ever means "there is an account token on disk", so an account — and
  // with it this panel — is all but certain: its outline is drawn now.
  if (loading) return <GroupsPanelSkeleton className={className} />;
  const identity = account?.id ?? guestToken;
  if (!identity) return null;
  return <GroupsPanelBody className={className} identity={identity} isAccount={Boolean(account)} />;
}

function GroupsHeading({ count }: { count?: number }) {
  const t = useT();
  return (
    <h2 className="flex items-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
      {/* The site's own beta tag (see BetaMark), at the size it has in a
          room's account card. */}
      <span className="mr-2 text-[10px] font-bold">
        <BetaMark />
      </span>
      {t("common.groups")}
      {count !== undefined && count > 0 && <span className="ml-1.5 font-normal text-zinc-400">{count}</span>}
    </h2>
  );
}

/** The panel while the account resolves: the real heading, placeholder rows. */
function GroupsPanelSkeleton({ className }: { className: string }) {
  const t = useT();
  return (
    <aside className={`${PANEL_CLASS} ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <GroupsHeading />
        <span className="flex shrink-0 items-center gap-2">
          <span className="skeleton-block h-7 w-7 rounded-lg" aria-hidden="true" />
          <Link
            href="/groups"
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("common.seeAll")}
          </Link>
        </span>
      </div>
      <SkeletonRows count={3} face="square" trailing="button" />
    </aside>
  );
}

function GroupsPanelBody({
  className,
  identity,
  isAccount,
}: {
  className: string;
  identity: string;
  isAccount: boolean;
}) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const router = useRouter();
  const groupMenu = useGroupContextMenu(router.push);
  const [addOpen, setAddOpen] = useState(false);
  // Folders, the shelf and rearranging from here (experiment group-organize).
  const organize = useGroupOrganize({ track: true });
  // Explorar has a page of its own (experiment groups-hub).
  const hub = useGroupsHub({ track: false });
  // Somebody logging in on this page must not keep the guest's list on screen.
  useEffect(() => {
    syncGroupsIdentity(identity);
  }, [identity]);
  const { groups: fresh } = useMyGroups();
  // Last visit's list while this one loads, accounts only (see
  // lib/homePanelsCache). A guest's identity is a token, not an account, and
  // their list is short-lived enough not to be worth remembering.
  const cached = useMemo(() => (isAccount ? readHomePanels(identity)?.groups ?? null : null), [isAccount, identity]);
  const groups = fresh ?? cached;
  useEffect(() => {
    if (isAccount && fresh) writeHomePanels(identity, { groups: fresh });
  }, [isAccount, identity, fresh]);

  // A guest with no groups sees the page they always saw — see the header.
  if (!isAccount && (!groups || groups.length === 0)) return null;
  // Only once the list has answered, so it never flashes up for somebody who
  // turns out to be in it already.
  const offerOfficial = fresh !== null && !fresh.some((g) => g.id === OFFICIAL_GROUP_ID);

  return (
    <aside
      // flex-col so the list below can take whatever height is left once this
      // panel is stretched to match the two beside it on the home page (see
      // app/page.tsx's items-stretch). Without it the panel would simply grow
      // and leave the extra space blank under a short list.
      className={`${PANEL_CLASS} ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <GroupsHeading count={organize ? groups?.filter((g) => !g.archived).length : groups?.length} />
        <span className="flex shrink-0 items-center gap-2">
          {/* One "+" for both ways of getting another group — joining one
              somebody invited you to, or making your own — rather than two
              look-alike icons whose difference you have to hover to learn. */}
          <Popover
            open={addOpen}
            onClose={() => setAddOpen(false)}
            placement="bottom-end"
            tooltip={t("groups.homeGroupsPanel.addGroup")}
            content={
              <div className="flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                {/* Every public group, on /groups — the way in for somebody
                    with no invite and nothing to make yet, the same answer the
                    dock's "+" offers (see AddGroupDialog). */}
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    requestExploreGroups();
                    router.push(hub ? GROUPS_EXPLORE_PATH : "/groups");
                  }}
                  className={MENU_ITEM}
                >
                  <MdExplore className="h-4 w-4 shrink-0 text-indigo-600" />
                  <span className="min-w-0">
                    <span className="block font-medium">{t("groups.groupDialogs.exploreGroups")}</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t("groups.groupDialogs.exploreGroupsHint")}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!isAccount}
                  onClick={() => {
                    setAddOpen(false);
                    void openPopup("create_group", { data: {} });
                  }}
                  className={MENU_ITEM}
                >
                  <MdAdd className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    <span className="block font-medium">{t("common.createAGroup")}</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {isAccount ? t("groups.homeGroupsPanel.withVoiceAndTextRooms") : t("groups.homeGroupsPanel.needsAnAccount")}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    void openPopup("join_group", { data: {} });
                  }}
                  className={MENU_ITEM}
                >
                  <MdLink className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0">
                    <span className="block font-medium">{t("common.joinAGroup")}</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t("groups.homeGroupsPanel.withTheInviteLink")}
                    </span>
                  </span>
                </button>
                {offerOfficial && <OfficialGroupCard onDone={() => setAddOpen(false)} />}
              </div>
            }
          >
            <button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              aria-label={t("groups.homeGroupsPanel.addGroup")}
              aria-expanded={addOpen}
              className={ICON_BUTTON}
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Popover>
          <Link
            href="/groups"
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {t("common.seeAll")}
          </Link>
        </span>
      </div>

      {/* Mentions anywhere, said once up top — the per-group numbers below say
          where, this says that there is something to go and read. */}
      {/* {mentions > 0 && (
        <p className="mt-3 rounded-lg border border-red-600/25 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-400">
          {mentions === 1 ? "Você foi mencionado 1 vez" : `Você foi mencionado ${mentions} vezes`}
        </p>
      )} */}

      {groups === null ? (
        <SkeletonRows count={3} face="square" trailing="button" />
      ) : groups.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {t("common.youAreNotInAnyGroup")}{" "}
          <button
            type="button"
            onClick={() => void openPopup("create_group", { data: {} })}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("common.createAGroup")}
          </button>{" "}
          {t("common.or")}{" "}
          <button
            type="button"
            onClick={() => void openPopup("join_group", { data: {} })}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            entrar com um convite
          </button>
          .
        </p>
      ) : (
        // Capped and scrolled, like the friends list, so a long list does not
        // decide how tall the page is.
        // Each group as a card — the same one the official group has in the
        // "+" menu: its face, its name, who and how many, and a button. The
        // whole card is the link; "Abrir" is drawn on it, not a second target.
        <HomeGroupList groups={groups} groupMenu={groupMenu} organize={organize} />
      )}
    </aside>
  );
}

type GroupMenuHandler = (event: ReactMouseEvent, group: GroupSummary) => void;

/**
 * The panel's list. Outside the experiment group-organize, every group as a
 * card, as it always was. In it: the shelf left out, folders as a heading of
 * their colour over their groups, and the order rearranged by dragging a card
 * — the top level among itself, a folder's groups inside it (see
 * lib/useDragSort) — saved as the rail's own (see lib/useGroups' saveLayout).
 */
function HomeGroupList({
  groups,
  groupMenu,
  organize,
}: {
  groups: GroupSummary[];
  groupMenu: GroupMenuHandler;
  organize: boolean;
}) {
  const t = useT();
  const layout = useGroupRailLayout();
  const entries: RailEntry[] = useMemo(
    () => (organize ? railEntries(groups, layout) : groups.map((g) => ({ kind: "group", id: g.id, group: g }))),
    [organize, groups, layout]
  );
  const drawn = useMemo(() => layoutOf(entries), [entries]);
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const listRef = useRef<HTMLUListElement | null>(null);
  const drag = useDragSort({
    ids,
    listRef,
    scrollRef: listRef,
    disabled: !organize,
    onMove: (from, to) => {
      saveLayout(moveEntry(drawn, from, to));
      trackGroupOrganize(GROUP_ORGANIZE_EVENTS.homeReorder);
    },
  });

  if (entries.length === 0) {
    return <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("groups.organize.allArchived")}</p>;
  }

  return (
    // Capped and scrolled, like the friends list, so a long list does not
    // decide how tall the page is.
    <ul
      ref={listRef}
      className="content-in mt-3 flex max-h-[26rem] min-h-0 flex-col gap-1.5 overflow-y-auto lg:max-h-none lg:flex-1"
    >
      {entries.map((entry) => (
        <li key={`${entry.kind}:${entry.id}`} {...drag.itemProps(entry.id)}>
          {entry.kind === "group" ? (
            <HomeGroupRow group={entry.group} groupMenu={groupMenu} dragging={drag.drag?.id === entry.id} />
          ) : (
            <HomeFolder
              folderId={entry.id}
              name={entry.folder.name || t("groups.organize.folder")}
              color={entry.folder.color}
              groups={entry.groups}
              groupMenu={groupMenu}
              dragging={drag.drag?.id === entry.id}
              onMove={(from, to) => {
                saveLayout(moveInFolder(drawn, entry.id, from, to));
                trackGroupOrganize(GROUP_ORGANIZE_EVENTS.homeReorder);
              }}
              scrollRef={listRef}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function HomeFolder({
  folderId,
  name,
  color,
  groups,
  groupMenu,
  dragging,
  onMove,
  scrollRef,
}: {
  folderId: string;
  name: string;
  color: string;
  groups: GroupSummary[];
  groupMenu: GroupMenuHandler;
  dragging: boolean;
  onMove: (from: number, to: number) => void;
  scrollRef: RefObject<HTMLUListElement | null>;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => groups.map((g) => g.id), [groups]);
  const drag = useDragSort({ ids, listRef, scrollRef, onMove });
  return (
    <div
      data-folder={folderId}
      className={`flex flex-col gap-1.5 rounded-xl ${dragging ? "bg-white shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-700" : ""}`}
    >
      <p className="flex cursor-grab items-center gap-1.5 px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 select-none dark:text-zinc-400">
        <span className={`h-2 w-2 shrink-0 rounded-full ${FOLDER_SWATCH[folderColor(color)]}`} />
        <span className="truncate">{name}</span>
      </p>
      <ul ref={listRef} className="flex flex-col gap-1.5 border-l-2 border-zinc-200 pl-2 dark:border-zinc-800">
        {groups.map((group) => (
          <li key={group.id} {...drag.itemProps(group.id)}>
            <HomeGroupRow group={group} groupMenu={groupMenu} dragging={drag.drag?.id === group.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One group as a card: its face, its name, who and how many, and "Abrir". The whole card is the link. */
function HomeGroupRow({
  group,
  groupMenu,
  dragging,
}: {
  group: GroupSummary;
  groupMenu: GroupMenuHandler;
  dragging: boolean;
}) {
  const t = useT();
  return (
    <Link
      href={groupEntryPath(group.id)}
      draggable={false}
      onContextMenu={(e) => groupMenu(e, group)}
      className={`group/card flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 ${
        group.suspended ? "opacity-60" : ""
      } ${dragging ? "cursor-grabbing shadow-lg ring-1 ring-zinc-300 dark:ring-zinc-700" : ""}`}
    >
      <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={32} className="rounded-lg" />
      <span className="min-w-0 flex-1">
        <GroupName
          name={group.name}
          flags={group.flags}
          className={`flex w-full text-sm ${
            group.unread ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-900 dark:text-zinc-100"
          }`}
        />
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          {group.suspended ? (
            <span className="font-medium text-amber-600 dark:text-amber-400">{t("common.suspended")}</span>
          ) : (
            [
              ROLE_LABEL[group.role],
              describeCounts(group.memberCount, group.onlineCount),
              group.unread ? t("common.newMessages").toLowerCase() : "",
            ]
              .filter(Boolean)
              .join(" · ")
          )}
        </span>
      </span>
      {group.suspended ? null : group.mentions > 0 ? (
        <Tooltip
          content={
            group.mentions === 1
              ? t("groups.homeGroupsPanel.n1Mention")
              : t("groups.homeGroupsPanel.mentionsMentions", { mentions: group.mentions })
          }
        >
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">
            {group.mentions > 99 ? "99+" : group.mentions}
          </span>
        </Tooltip>
      ) : group.unread ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-950 dark:bg-zinc-50" aria-label={t("common.newMessages")} />
      ) : null}
      <span
        aria-hidden
        className={`${CARD_ACTION} bg-zinc-950 text-white group-hover/card:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:group-hover/card:bg-zinc-200`}
      >
        {t("groups.homeGroupsPanel.open")}
      </span>
    </Link>
  );
}
