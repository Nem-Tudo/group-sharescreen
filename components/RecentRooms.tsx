"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MdChevronRight, MdClose, MdLock } from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { trackEvent } from "@/lib/analytics";
import {
  forgetRecentRoom,
  getRecentRooms,
  MAX_RECENT_ROOMS,
  recentRoomPresentation,
  subscribeRecentRooms,
  type RecentRoom,
} from "@/lib/recentRooms";

export function RecentRooms() {
  // Read once on mount rather than via useSyncExternalStore: that hook
  // calls getSnapshot twice per render and demands Object.is equality,
  // which a localStorage parse cannot honestly guarantee.
  const [rooms, setRooms] = useState<RecentRoom[]>(() => getRecentRooms());
  useEffect(() => {
    setRooms(getRecentRooms());
    return subscribeRecentRooms(() => setRooms(getRecentRooms()));
  }, []);
  if (rooms.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Salas recentes
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {MAX_RECENT_ROOMS} últimas em que você entrou
        </span>
      </div>
      <ul className="flex flex-col gap-2 pt-1.5 pl-1.5">
        {rooms.map((room, index) => {
          const { name, isPrivate, code } = recentRoomPresentation(room.handle);
          const visibility = isPrivate ? "privada" : "pública";
          return (
            <li key={room.handle} className="relative">
              <Link
                href={`/watch/${room.handle}`}
                onClick={() =>
                  trackEvent("recent_room_click", {
                    visibility: isPrivate ? "private" : "public",
                    index,
                  })
                }
                aria-label={`Entrar na sala ${visibility} ${name}`}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
              >
                {isPrivate ? (
                  <MdLock className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <GlobeIcon className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">{name}</span>
                {code && (
                  <span className="shrink-0 font-normal tabular-nums text-zinc-400 dark:text-zinc-500">
                    {code}
                  </span>
                )}
                <MdChevronRight
                  className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500"
                  aria-hidden="true"
                />
              </Link>
              <button
                type="button"
                onClick={() => {
                  trackEvent("recent_room_forget", {
                    visibility: isPrivate ? "private" : "public",
                  });
                  forgetRecentRoom(room.handle);
                }}
                aria-label={`Remover ${name} das salas recentes`}
                className="absolute -top-1.5 -left-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <MdClose className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
