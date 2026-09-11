"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WorldMap } from "@/components/WorldMap";
import { GlobeIcon } from "@/components/icons";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { usePublicRoomMarkers } from "@/lib/usePublicRoomMarkers";
import { useGroupMapMarkers } from "@/lib/useGroupMapMarkers";

// What the map shows: everything, or one of its two kinds of pin. Live rooms
// (green) come and go with the people in them; groups (blue) stay where their
// owners put them.
type MapFilter = "all" | "rooms" | "groups";

export function RoomsMapClient() {
  // The same pins the location picker inside a room shows (see
  // ManageRoomModal) — one definition of what a room looks like on a map.
  const { rooms, markers: roomMarkers, error } = usePublicRoomMarkers();
  // And the groups placed on the map (see the group settings' map tab).
  const { groups, markers: groupMarkers, error: groupError } = useGroupMapMarkers();
  const [filter, setFilter] = useState<MapFilter>("all");

  const shown = useMemo(
    () =>
      filter === "rooms"
        ? roomMarkers
        : filter === "groups"
          ? groupMarkers
          : // Groups first, so a live room on the same spot draws on top.
            [...groupMarkers, ...roomMarkers],
    [filter, roomMarkers, groupMarkers]
  );

  const loading = rooms === null && groups === null;

  const filterButton = (id: MapFilter, label: string, count: number | null, dot?: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
        filter === id
          ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />}
      {label}
      {count !== null && <span className="text-xs font-normal text-zinc-400">{count}</span>}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Mapa de salas e grupos
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {loading
              ? "Carregando..."
              : roomMarkers.length + groupMarkers.length === 0
                ? "Nenhuma sala ou grupo definiu seu local no mundo ainda."
                : "Encontre salas e grupos no seu país, cidade ou bairro"}
          </p>
          {/* Says what a pin is before anybody has to guess. A map of dots
              over cities reads as "these are people's locations" unless it is
              told otherwise, and what it actually shows is where each room's
              or group's owner chose to put a marker. Nothing here detects
              anyone: the app never calls the geolocation API, and no
              participant's position is known to it in the first place. */}
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Cada alfinete é onde o dono da sala ou do grupo escolheu marcá-lo, na mão. Ninguém tem a
            localização detectada. Salas ativas (verde) somem quando esvaziam; grupos (azul) ficam até o
            dono tirar do mapa.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* No SiteHeader on this page either, and the map's own colours
              follow the theme (see WorldMapImpl) — so this is exactly where
              someone would want to change it. */}
          <ThemeMenuButton />
          <UpdateAppButton />
          <Link
            href="/rooms"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <GlobeIcon className="h-4 w-4" />
            Ver em lista
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Início
          </Link>
        </div>
      </header>

      {/* The filter, with the colours it filters by — which doubles as the
          map's legend. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <div
          role="group"
          aria-label="O que mostrar no mapa"
          className="inline-flex gap-0.5 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-900"
        >
          {filterButton("all", "Tudo", null)}
          {filterButton("rooms", "Salas ativas", rooms === null ? null : roomMarkers.length, "#059669")}
          {filterButton("groups", "Grupos", groups === null ? null : groupMarkers.length, "#2563eb")}
        </div>
      </div>

      {(error || groupError) && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error ?? groupError}
        </p>
      )}

      {/* The map fills whatever is left of the page — min-h-0 is what lets it
          actually shrink inside the flex column instead of overflowing it. */}
      <div className="min-h-0 flex-1">
        <WorldMap markers={shown} searchable className="h-full w-full" />
      </div>
    </div>
  );
}
