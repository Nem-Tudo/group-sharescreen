"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { MdChevronRight, MdClose, MdLock } from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { trackEvent } from "@/lib/analytics";
import {
  forgetRecentRoom,
  getRecentRooms,
  getRecentRoomsServer,
  recentRoomPresentation,
  subscribeRecentRooms,
} from "@/lib/recentRooms";

export function RecentRooms() {
  // useSyncExternalStore after all. The note that used to be here said this
  // hook "demands Object.is equality, which a localStorage parse cannot
  // honestly guarantee" — true of a naive reader, and not true of this one:
  // getRecentRooms caches the raw string it parsed and returns the very same
  // array while that string is unchanged, which is exactly the guarantee the
  // hook wants. What the state-plus-effect version cost was a second render
  // on every mount (the server has no localStorage, so the effect always had
  // something to correct) and a lint error for setting state in an effect.
  const rooms = useSyncExternalStore(subscribeRecentRooms, getRecentRooms, getRecentRoomsServer);
  const [opening, setOpening] = useState<string | null>(null);
  if (rooms.length === 0) return null;

  // The one the phone shows. Below sm there is room for a single button, and
  // it has to be the room you were in last — which is *not* rooms[0]: the list
  // is ordered by when each room was first added and deliberately kept stable
  // (see rememberRecentRoom), so position 0 is the most recently discovered
  // room, not the most recently visited one. Re-entering a room already on
  // the list left the phone pointing somewhere else forever, which is the bug.
  //
  // Picked by timestamp instead. The desktop list keeps its stable order, so
  // the two do not have to agree on anything except which entry is newest.
  // Which one was clicked, so it can say so. Entering a room from here is a
  // full route change followed by a socket and a join; until the next page
  // paints, the only thing that had happened on screen was nothing.
  //
  // Never cleared: the navigation ends by replacing this page. A room that
  // somehow fails to open leaves a spinner behind, which is still a truer
  // account than a button that looks untouched.
  const latestHandle = rooms.reduce((newest, room) =>
    room.visitedAt > newest.visitedAt ? room : newest
  ).handle;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Salas recentes
        </span>
        {/* <span className="text-xs text-zinc-500 dark:text-zinc-400 sm:hidden">
          última em que você entrou
        </span>
        <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
          {MAX_RECENT_ROOMS} últimas em que você entrou
        </span> */}
      </div>
      <ul className="flex flex-col gap-2 pt-1.5 pl-1.5">
        {rooms.map((room, index) => {
          const { name, isPrivate, code } = recentRoomPresentation(room.handle);
          const visibility = isPrivate ? "privada" : "pública";
          return (
            <li
              key={room.handle}
              className={
                room.handle === latestHandle ? "relative" : "relative hidden sm:block"
              }
            >
              <Link
                href={`/watch/${room.handle}`}
                onClick={() => {
                  setOpening(room.handle);
                  trackEvent("recent_room_click", {
                    visibility: isPrivate ? "private" : "public",
                    index,
                  });
                }}
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
                {/* In the chevron's place rather than beside it: the arrow
                    means "this goes somewhere", and once it is going, saying
                    so is the more useful of the two. Same box either way, so
                    the row does not resize under the cursor. */}
                {opening === room.handle ? (
                  <ButtonSpinner className="text-zinc-400 dark:text-zinc-500" />
                ) : (
                  <MdChevronRight
                    className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500"
                    aria-hidden="true"
                  />
                )}
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
