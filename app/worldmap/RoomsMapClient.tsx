"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchPublicRooms, type PublicRoom } from "@/lib/roomsApi";
import { WorldMap, type WorldMapMarker } from "@/components/WorldMap";
import { GlobeIcon } from "@/components/icons";
import { ThemeMenuButton } from "@/components/ThemeToggle";
import { roomCategory } from "@/lib/roomCategories";

// Same cadence as the plain /rooms list — a room appearing or emptying out is
// worth seeing without a reload, and neither page is expensive to serve.
const POLL_INTERVAL_MS = 8000;

export function RoomsMapClient() {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const data = await fetchPublicRooms(controller.signal);
        if (cancelled) return;
        setRooms(data);
        setError(null);
      } catch {
        if (!cancelled) setError("Não foi possível carregar as salas públicas.");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  // Only rooms whose owner actually placed them. A room with no pin isn't
  // hidden from anyone — it's on /rooms like always; it simply has no answer
  // to the question this page asks.
  const markers = useMemo<WorldMapMarker[]>(
    () =>
      (rooms ?? [])
        .filter((room): room is PublicRoom & { location: { lat: number; lng: number } } =>
          Boolean(room.location)
        )
        .map((room) => ({
          id: room.handle,
          lat: room.location.lat,
          lng: room.location.lng,
          label: room.handle,
          // Rides along on the pin itself and again in its popup, so it has
          // to stay short enough not to stretch a pin across a country.
          badge: `· ${room.peopleCount} ${room.peopleCount === 1 ? "pessoa" : "pessoas"}`,
          tag: roomCategory(room.category)?.label,
          description: room.description,
          href: `/watch/${room.handle}`,
        })),
    [rooms]
  );

  const placedCount = markers.length;
  const totalCount = rooms?.length ?? 0;

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
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* No SiteHeader on this page either, and the map's own colours
              follow the theme (see WorldMapImpl) — so this is exactly where
              someone would want to change it. */}
          <ThemeMenuButton />
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
