"use client";

import Link from "next/link";
import { WorldMap } from "@/components/WorldMap";
import { GlobeIcon } from "@/components/icons";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { UpdateAppButton } from "@/components/UpdateAppButton";
import { usePublicRoomMarkers } from "@/lib/usePublicRoomMarkers";

export function RoomsMapClient() {
  // The same pins the location picker inside a room shows (see
  // ManageRoomModal) — one definition of what a room looks like on a map.
  const { rooms, markers, error } = usePublicRoomMarkers();

  const placedCount = markers.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Mapa de salas
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {rooms === null
              ? "Carregando..."
              : placedCount === 0
                ? "Nenhuma sala pública definiu seu local no mundo ainda."
                : `Encontre salas no seu país, cidade ou bairro`}
          </p>
          {/* Says what a pin is before anybody has to guess. A map of dots
              over cities reads as "these are people's locations" unless it is
              told otherwise, and what it actually shows is where each room's
              owner chose to put a marker. Nothing here detects anyone: the
              app never calls the geolocation API, and no participant's
              position is known to it in the first place. */}
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Cada alfinete é onde o dono da sala escolheu marcá-la, no mapa, na mão. Ninguém tem a
            localização detectada — nem quem cria a sala, nem quem entra nela.
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

      {error && (
        <p className="bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {/* The map fills whatever is left of the page — min-h-0 is what lets it
          actually shrink inside the flex column instead of overflowing it. */}
      <div className="min-h-0 flex-1">
        <WorldMap markers={markers} searchable className="h-full w-full" />
      </div>
    </div>
  );
}
