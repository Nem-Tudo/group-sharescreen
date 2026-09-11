"use client";

import { useMemo } from "react";
import useNtPopups from "ntpopups";
import { FaCrown } from "react-icons/fa";
import { MdPersonAdd, MdVolumeUp } from "react-icons/md";
import { DisplayUserName } from "@/components/DisplayUserName";
import { Tooltip } from "@/components/Tooltip";
import { UserAvatar } from "@/components/UserAvatar";
import { openGroupProfile } from "@/components/groups/groupProfile";
import { verifiedBadge } from "@/lib/entitlements";
import { useGroupMembers } from "@/lib/groupCache";
import { prefetchUserProfile } from "@/lib/userProfile";
import type { GroupDetail, GroupMember } from "@/lib/groupsApi";

// Who is in the group, as the right-hand column of its pages — the same card a
// room's participant list is, with the group's people in it: who is around
// right now, which voice room they are in, and who runs the place.
//
// The list comes from lib/groupCache, shared with the text room's @mention
// suggestions, so switching rooms shows it at once; it is re-read when the
// group's membership changes, and on a slow poll for the online dots, which
// nothing pushes.

const REFRESH_MS = 45_000;

export function GroupMembersPanel({ detail }: { detail: GroupDetail }) {
  const { openPopup } = useNtPopups();
  const groupId = detail.group.id;
  const isManager = detail.me.role === "owner" || detail.me.role === "admin";
  const members = useGroupMembers(
    groupId,
    `${detail.group.memberCount}:${detail.group.admins.join(",")}`,
    REFRESH_MS
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

  const online = (members ?? []).filter((m) => m.online || voiceRoomOf.has(m.id));
  const offline = (members ?? []).filter((m) => !m.online && !voiceRoomOf.has(m.id));

  function row(member: GroupMember, away: boolean) {
    const room = voiceRoomOf.get(member.id);
    return (
      <li key={member.id}>
        <button
          type="button"
          onClick={() =>
            openGroupProfile({ id: member.id, name: member.name, avatarUrl: member.avatarUrl, guest: member.guest })
          }
          onMouseEnter={() => !member.guest && prefetchUserProfile(member.id)}
          title="Ver perfil"
          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
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
                color={member.nameColor}
                className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200"
              />
              {member.role === "owner" && (
                <FaCrown className="h-3 w-3 shrink-0 text-amber-500" aria-label="Dono do grupo" />
              )}
              {member.role === "admin" && (
                <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  admin
                </span>
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
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Membros</h2>
          {isManager && (
            <Tooltip content="Convidar pessoas">
              <button
                type="button"
                onClick={() =>
                  void openPopup("group_invite", { data: { groupId, groupName: detail.group.name } })
                }
                aria-label="Convidar pessoas"
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border border-emerald-600/40 text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <MdPersonAdd className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </span>
        <span className="rounded-full bg-zinc-100 px-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {detail.group.memberCount}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {members === null ? (
          <p className="px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
        ) : (
          <>
            {online.length > 0 && (
              <section className="mb-3">
                <p className="px-2 pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Online — {online.length}
                </p>
                <ul className="flex flex-col">{online.map((m) => row(m, false))}</ul>
              </section>
            )}
            {offline.length > 0 && (
              <section>
                <p className="px-2 pb-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Offline — {offline.length}
                </p>
                <ul className="flex flex-col">{offline.map((m) => row(m, true))}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
