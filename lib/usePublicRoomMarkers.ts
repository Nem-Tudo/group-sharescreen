"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchPublicRooms, type PublicRoom } from "@/lib/roomsApi";
import type { WorldMapMarker } from "@/components/WorldMap";
import { roomCategory } from "@/lib/roomCategories";

// Same cadence as the plain /rooms list — a room appearing or emptying out is
// worth seeing without a reload, and neither page is expensive to serve.
const POLL_INTERVAL_MS = 8000;

// Every public room that has actually been placed, as pins. Shared by the
// /worldmap page and by the location picker inside the room (see
// ManageRoomModal): someone deciding where to put their own room wants to see
// where the others already are — an empty globe makes the whole feature look
// like it does nothing, and a neighbourhood with three rooms in it is the
// argument for joining them.
//
// A room with no pin isn't hidden from anybody by this — it's on /rooms like
// always; it simply has no answer to the question a map asks.
export function usePublicRoomMarkers(options?: {
  // Left off the returned pins. The room you are placing right now is already
  // drawn as the picker's own `pick` marker, and two pins on one spot — one
  // of them stale, since the map only refreshes every few seconds — reads as
  // a bug rather than as a room.
  excludeHandle?: string;
}): { rooms: PublicRoom[] | null; markers: WorldMapMarker[]; error: string | null } {
  const excludeHandle = options?.excludeHandle;
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

  const markers = useMemo<WorldMapMarker[]>(
    () =>
      (rooms ?? [])
        .filter((room): room is PublicRoom & { location: { lat: number; lng: number } } =>
          Boolean(room.location) && room.handle !== excludeHandle
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
    [rooms, excludeHandle]
  );

  return { rooms, markers, error };
}
