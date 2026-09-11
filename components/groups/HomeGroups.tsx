"use client";

import Link from "next/link";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { groupPath } from "@/lib/groupLinks";
import { useMyGroups } from "@/lib/useGroups";

// "Seus grupos" on the home page: a row of the groups this person is in, so the
// way back into one is on the first screen they see. Renders nothing for
// somebody in no group — a first visit should not grow the form for nothing,
// the same rule RecentRooms follows.

const SHOWN = 6;

export function HomeGroups() {
  const { groups } = useMyGroups();
  if (!groups || groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Seus grupos</span>
        <Link href="/groups" className="text-xs font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400">
          Ver todos
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.slice(0, SHOWN).map((group) => (
          <Link
            key={group.id}
            href={groupPath(group.id)}
            title={group.name}
            className="relative block transition hover:opacity-80"
          >
            <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={44} className="rounded-xl" />
            {(group.unread || group.mentions > 0) && (
              <span
                className={`absolute -right-1 -top-1 flex items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white dark:border-zinc-950 ${
                  group.mentions > 0 ? "h-5 min-w-5 bg-red-600 px-1" : "h-3 w-3 bg-zinc-950 dark:bg-zinc-50"
                }`}
              >
                {group.mentions > 0 ? group.mentions : ""}
              </span>
            )}
          </Link>
        ))}
        {groups.length > SHOWN && (
          <Link
            href="/groups"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
          >
            +{groups.length - SHOWN}
          </Link>
        )}
      </div>
    </div>
  );
}
