"use client";

import Link from "next/link";
import useNtPopups from "ntpopups";
import { MdAdd, MdHome, MdLink } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { useAuth } from "@/lib/AuthContext";
import { groupPath } from "@/lib/groupLinks";
import { useMyGroups } from "@/lib/useGroups";

// The strip down the left edge with every group this person is in — the
// "which server am I in" column of the Discord layout. Each icon goes to the
// group's own address, which then lands on the room that group was last left
// on (see lastChannel and app/groups/[groupId]/page.tsx), so hopping between
// two groups comes back exactly where each conversation was.

export function GroupRail({
  activeGroupId,
  onNavigate,
}: {
  activeGroupId: string | null;
  /** Called after any navigation — the phone drawer closes itself with it. */
  onNavigate?: () => void;
}) {
  const { groups } = useMyGroups();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();

  return (
    <nav
      aria-label="Seus grupos"
      className="flex h-full w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-black/5 bg-zinc-100 py-3 dark:border-white/5 dark:bg-zinc-950"
    >
      <Tooltip content="Início do GoLive" placement="right">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Início do GoLive"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-zinc-700 transition-all hover:rounded-xl hover:bg-zinc-950 hover:text-white dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-50 dark:hover:text-zinc-950"
        >
          <MdHome className="h-6 w-6" />
        </Link>
      </Tooltip>
      <Tooltip content="Todos os seus grupos" placement="right">
        <Link
          href="/groups"
          onClick={onNavigate}
          aria-label="Todos os seus grupos"
          className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
            activeGroupId === null
              ? "rounded-xl bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
              : "bg-white text-zinc-700 hover:bg-zinc-950 hover:text-white dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-50 dark:hover:text-zinc-950"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-6 w-6" />
        </Link>
      </Tooltip>

      <span className="h-0.5 w-8 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-800" />

      {groups === null &&
        [0, 1, 2].map((i) => (
          <span key={i} className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
        ))}

      {groups?.map((group) => {
        const active = group.id === activeGroupId;
        return (
          <div key={group.id} className="relative flex w-full shrink-0 justify-center">
            {/* The pill on the left edge: tall for the group on screen, a dot
                for one with something unread, nothing otherwise — the same
                three states Discord's rail has, because people already read
                them without being told. */}
            <span
              aria-hidden
              className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-zinc-950 transition-all dark:bg-zinc-50 ${
                active ? "h-9" : group.unread ? "h-2" : "h-0"
              }`}
            />
            <Tooltip content={group.name} placement="right">
              <Link
                href={groupPath(group.id)}
                onClick={onNavigate}
                aria-label={group.name + (group.unread ? " (mensagens novas)" : "")}
                aria-current={active ? "page" : undefined}
                className="relative block"
              >
                <GroupIcon
                  name={group.name}
                  iconUrl={group.iconUrl}
                  seed={group.id}
                  size={48}
                  className={`transition-all ${active ? "rounded-xl" : "rounded-2xl hover:rounded-xl"}`}
                />
                {group.mentions > 0 && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-zinc-100 bg-red-600 px-1 text-[11px] font-bold text-white dark:border-zinc-950">
                    {group.mentions > 99 ? "99+" : group.mentions}
                  </span>
                )}
              </Link>
            </Tooltip>
          </div>
        );
      })}

      <Tooltip
        content={account ? "Criar um grupo" : "Crie uma conta para criar grupos"}
        placement="right"
      >
        <button
          type="button"
          onClick={() => {
            if (!account) return;
            onNavigate?.();
            void openPopup("create_group", { data: {} });
          }}
          aria-label="Criar um grupo"
          aria-disabled={!account}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 transition-all dark:bg-zinc-900 dark:text-emerald-500 ${
            account
              ? "cursor-pointer hover:rounded-xl hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white"
              : "cursor-not-allowed opacity-50"
          }`}
        >
          <MdAdd className="h-7 w-7" />
        </button>
      </Tooltip>
      <Tooltip content="Entrar com um convite" placement="right">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void openPopup("join_group", { data: {} });
          }}
          aria-label="Entrar com um convite"
          className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-white text-zinc-600 transition-all hover:rounded-xl hover:bg-zinc-950 hover:text-white dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-50 dark:hover:text-zinc-950"
        >
          <MdLink className="h-6 w-6" />
        </button>
      </Tooltip>
    </nav>
  );
}
