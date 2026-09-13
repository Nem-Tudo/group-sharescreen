"use client";

import { memo, useEffect, useMemo } from "react";
import useNtPopups from "ntpopups";
import { FaCrown } from "react-icons/fa";
import { MdPeople, MdPersonAdd, MdVolumeUp } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { verifiedBadge } from "@/lib/entitlements";
import { useMemberCounts, useOfflineGroupMembers, useOnlineGroupMembers } from "@/lib/groupCache";
import {
  canManage,
  hoistedRoleOf,
  memberCanInChannel,
  membersRevalidateKey,
  roleColorOf,
  rolesInOrder,
} from "@/lib/groupPermissions";
import { prefetchUserProfile } from "@/lib/userProfile";
import { useWindowedList } from "@/lib/useWindowedList";
import type { GroupChannel, GroupDetail, GroupMember, GroupRoleInfo } from "@/lib/groupsApi";
import { useT, useTCount } from "@/lib/useI18n";

// Who is in the group, as the right-hand column of its pages — the same card a
// room's participant list is, with the group's people in it: who is around
// right now, which voice room they are in, and who runs the place.
//
// Discord's sections: whoever is around is listed under their highest role
// that is shown apart ("Exibir separadamente"), in the roles' order, and
// everybody else around under "Online"; whoever is away, under "Offline"
// whatever their roles. Names are drawn in their highest coloured role's colour.
//
// The list comes from lib/groupCache, shared with the text room's @mention
// suggestions, so switching rooms shows it at once; it is re-read when the
// group's membership changes, and on a slow poll for the online dots, which
// nothing pushes.
//
// Beside a text room it is that room's people: only the members who can see it
// (see lib/groupPermissions — the owner and administrators always can), the way a
// Discord channel's member list is. Anywhere else, the whole group.

const REFRESH_MS = 45_000;

// Row heights, in px, stated rather than measured — and then *enforced* on
// the elements themselves below, so the windowing arithmetic and the layout
// cannot drift apart. A guessed height here would show up as a scrollbar that
// lies and a list that jumps under the cursor.
const MEMBER_H = 38;
// Somebody standing in a voice room gets a second line naming it.
const MEMBER_VOICE_H = 54;
// The section heading, with the gap that used to be the section's own margin
// folded in — the list is flat now, so the spacing has to live somewhere.
const HEADER_H = 32;

// How close to the end of the loaded rows the window may get before the next
// page of offline members is asked for — about a screen's worth.
const LOAD_AHEAD_ROWS = 20;

// One stable empty list while the online members have not arrived.
const NO_ONE: GroupMember[] = [];

/** One flattened list entry: the headings and the people, in display order. */
type Row =
  | { kind: "header"; key: string; title: string; count: number }
  | { kind: "member"; key: string; member: GroupMember; away: boolean; room?: string };

function rowHeight(row: Row): number {
  if (row.kind === "header") return HEADER_H;
  return row.room === undefined ? MEMBER_H : MEMBER_VOICE_H;
}

/**
 * One person in the column.
 *
 * Memoized, and given only values rather than the whole group detail, so that
 * a group of ten thousand does not rebuild ten thousand subtrees because
 * somebody's microphone icon changed. `color` is resolved by the parent for
 * the same reason: passing `detail` down would make every row re-render
 * whenever anything about the group did.
 */
const MemberRow = memo(function MemberRow({
  member,
  away,
  room,
  color,
}: {
  member: GroupMember;
  away: boolean;
  room?: string;
  color: string | null;
}) {
  const t = useT();
  return (
    <li style={{ height: room === undefined ? MEMBER_H : MEMBER_VOICE_H }}>
      <button
        type="button"
        onClick={() =>
          openGroupProfile({ id: member.id, name: member.name, avatarUrl: member.avatarUrl, guest: member.guest })
        }
        onMouseEnter={() => !member.guest && prefetchUserProfile(member.id)}
        title={t("common.viewProfile")}
        className={`flex h-full w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
          away ? "opacity-55" : ""
        }`}
      >
        <UserAvatar
          src={member.avatarUrl}
          name={member.name}
          size={26}
          userId={member.guest ? null : member.id}
          isGuest={member.guest}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <DisplayUserName
              name={member.name}
              isGuest={member.guest}
              verified={verifiedBadge(member.flags)}
              bot={member.bot}
              color={color ?? member.nameColor}
              className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200"
            />
            {member.role === "owner" && (
              <FaCrown className="h-3 w-3 shrink-0 text-amber-500" aria-label={t("groups.groupMembersPanel.groupOwner")} />
            )}
          </span>
          {room !== undefined && (
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-500">
              <MdVolumeUp className="h-3 w-3 shrink-0" />
              <span className="truncate">{room}</span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

export function GroupMembersPanel({
  detail,
  channel = null,
}: {
  detail: GroupDetail;
  /** The text room on screen, if any — the list is then only who can see it. */
  channel?: GroupChannel | null;
}) {
  const t = useT();
  const tc = useTCount();
  const { openPopup } = useNtPopups();
  const groupId = detail.group.id;
  const canInvite = canManage(detail, "createInvites");
  const revalidateKey = membersRevalidateKey(detail);
  const textChannel = channel?.kind === "text" ? channel : null;

  // Who is connected, whole — bounded by how many are online, not by how many
  // belong — and everybody else a page at a time, as the list scrolls down to
  // them. This used to be the entire membership in one request, re-read on a
  // poll, which at ten thousand members was a couple of megabytes each time.
  const onlineEntry = useOnlineGroupMembers(groupId, revalidateKey, REFRESH_MS);
  const offlinePaged = useOfflineGroupMembers(groupId, revalidateKey, textChannel?.id ?? null);
  // Only beside a text room: group-wide, the online list already carries the counts.
  const roomCounts = useMemberCounts(textChannel ? groupId : null, textChannel?.id ?? null, revalidateKey);

  // The online list is group-wide and shared with the text room, so beside a
  // room it is narrowed here; it is small enough for that to be free. The
  // offline pages arrive already narrowed — see the API's memberSlice.
  const onlineHere = useMemo(
    () =>
      onlineEntry && textChannel
        ? onlineEntry.list.filter((m) =>
            memberCanInChannel(detail, textChannel, { id: m.id, roleIds: m.roleIds }, "viewChannel")
          )
        : onlineEntry?.list ?? null,
    [onlineEntry, textChannel, detail]
  );

  // Which voice room each person is standing in, by name.
  const voiceRoomOf = useMemo(() => {
    const names = new Map(detail.channels.map((c) => [c.id, c.name]));
    const out = new Map<string, string>();
    for (const [channelId, people] of Object.entries(detail.voice)) {
      for (const person of people) out.set(person.userId, names.get(channelId) ?? "");
    }
    return out;
  }, [detail.channels, detail.voice]);

  // Memoized rather than recomputed in the render body. These walk the whole
  // membership — twice for the split, then once more for the sections, each
  // with a permission lookup per member — and none of it changes when the
  // panel re-renders for something else.
  const online = onlineHere ?? NO_ONE;
  // An offline page can be older than the online list: somebody who connected
  // since it was fetched would otherwise be listed in both sections. Anybody
  // standing in a voice room is connected by definition, so they never belong
  // down here either.
  const offline = useMemo(() => {
    const here = new Set(online.map((m) => m.id));
    return offlinePaged.list.filter((m) => !here.has(m.id) && !voiceRoomOf.has(m.id));
  }, [offlinePaged.list, online, voiceRoomOf]);
  // How many are offline in all, not merely how many pages have arrived — so
  // the heading says the real number before the list has been scrolled to.
  // The counts for what the column lists, from whichever answer has them
  // first. Group-wide, the online list carries them. Beside a text room they
  // must be that room's, which the online list cannot give (it is shared
  // group-wide), and the first offline page arrives only once the list has
  // scrolled near its end — so the room's counts are asked for on their own.
  const counts = offlinePaged.counts ?? (textChannel ? roomCounts : onlineEntry?.counts ?? null);
  const offlineTotal = counts ? Math.max(0, counts.total - counts.online) : offline.length;

  // The header's two numbers. Online is the list's own length so the header
  // never disagrees with the sections below it; null until the online list has
  // arrived, when there is nothing honest to say. The total never reads lower
  // than the online count, for the moment before the counts have answered.
  const onlineCount = onlineEntry ? online.length : null;
  const totalCount = Math.max(
    onlineCount ?? 0,
    counts?.total ?? (textChannel ? 0 : detail.group.memberCount)
  );
  const countsLabel =
    onlineCount === null
      ? tc("common.memberCount", totalCount)
      : `${t("groups.groupRail.onlineCount", { count: onlineCount })} · ${tc("common.memberCount", totalCount)}`;

  // Whoever is around, by their highest role shown apart — in the roles'
  // order — and everybody else around after them.
  const sections = useMemo(() => {
    const byRole = new Map<string, GroupMember[]>();
    const rest: GroupMember[] = [];
    for (const member of online) {
      const role = hoistedRoleOf(detail, { id: member.id, roleIds: member.roleIds });
      if (!role) {
        rest.push(member);
        continue;
      }
      const list = byRole.get(role.id);
      if (list) list.push(member);
      else byRole.set(role.id, [member]);
    }
    const out: { key: string; title: string; role: GroupRoleInfo | null; people: GroupMember[] }[] = [];
    for (const role of rolesInOrder(detail)) {
      const people = byRole.get(role.id);
      if (people) out.push({ key: role.id, title: role.name, role, people });
    }
    if (rest.length > 0) out.push({ key: "online", title: t("common.online"), role: null, people: rest });
    return out;
  }, [online, detail, t]);

  // One flat list instead of nested <section> elements: the window has to
  // slice a single sequence, and a heading is just a row with its own height.
  // The spacing that used to be each section's margin is folded into
  // HEADER_H, so this looks exactly as it did.
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const section of sections) {
      out.push({
        kind: "header",
        key: `h:${section.key}`,
        title: section.title,
        count: section.people.length,
      });
      for (const member of section.people) {
        out.push({
          kind: "member",
          key: member.id,
          member,
          away: false,
          room: voiceRoomOf.get(member.id),
        });
      }
    }
    if (offline.length > 0 || offlineTotal > 0) {
      out.push({ kind: "header", key: "h:offline", title: t("common.offline"), count: offlineTotal });
      for (const member of offline) {
        out.push({ kind: "member", key: member.id, member, away: true });
      }
    }
    return out;
  }, [sections, offline, offlineTotal, voiceRoomOf, t]);

  // Prefix sum of row tops, which is what lets the window binary-search a
  // scroll position across rows of three different heights.
  const offsets = useMemo(() => {
    const out = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i += 1) out[i + 1] = out[i] + rowHeight(rows[i]);
    return out;
  }, [rows]);

  // Name colours resolved here rather than inside each row: roleColorOf needs
  // the whole group detail, and handing that to every row would defeat the
  // memo on it.
  const colors = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const row of rows) {
      if (row.kind !== "member") continue;
      out.set(
        row.member.id,
        roleColorOf(detail, { id: row.member.id, roleIds: row.member.roleIds })
      );
    }
    return out;
  }, [rows, detail]);

  const { scrollRef, start, end, topPad, bottomPad } = useWindowedList({
    count: rows.length,
    rowHeight: offsets,
  });

  // The next page is asked for once the rendered window comes within a screen
  // or so of the end of what has arrived. With a small group the window is the
  // whole list, so this reads the pages back to back until they run out — a
  // handful of requests. With a large one it waits for the scroll.
  const { hasMore, loading: loadingMore, loadMore } = offlinePaged;
  const nearEnd = end >= rows.length - LOAD_AHEAD_ROWS;
  useEffect(() => {
    if (onlineEntry && hasMore && !loadingMore && nearEnd) loadMore();
  }, [onlineEntry, hasMore, loadingMore, nearEnd, loadMore]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("common.members")}</h2>
          {canInvite && (
            <Tooltip content={t("common.invitePeople")}>
              <button
                type="button"
                onClick={() =>
                  void openPopup("group_invite", { data: { groupId, groupName: detail.group.name } })
                }
                aria-label={t("common.invitePeople")}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-emerald-600/40 text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <MdPersonAdd className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </span>
        <Tooltip content={countsLabel}>
          <span className="flex shrink-0 items-center gap-2.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">
            <span className="sr-only">{countsLabel}</span>
            {onlineCount !== null && (
              <span aria-hidden className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {onlineCount}
              </span>
            )}
            <span aria-hidden className="inline-flex items-center gap-1">
              <MdPeople className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
              {totalCount}
            </span>
          </span>
        </Tooltip>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {onlineEntry === null ? (
          <p className="px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
        ) : (
          // The spacers stand in for the rows that are not rendered, so the
          // scrollbar is the size it would be with all of them present.
          <ul style={{ paddingTop: topPad, paddingBottom: bottomPad }} className="flex flex-col">
            {rows.slice(start, end).map((row) =>
              row.kind === "header" ? (
                <li
                  key={row.key}
                  style={{ height: HEADER_H }}
                  className="flex min-w-0 items-end gap-1.5 px-2 pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400"
                >
                  <span className="truncate">{row.title}</span>
                  <span className="shrink-0">— {row.count}</span>
                </li>
              ) : (
                <MemberRow
                  key={row.key}
                  member={row.member}
                  away={row.away}
                  room={row.room}
                  color={colors.get(row.member.id) ?? null}
                />
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
