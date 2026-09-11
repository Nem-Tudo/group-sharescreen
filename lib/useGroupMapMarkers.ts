"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorldMapMarker } from "@/components/WorldMap";
import { fetchGroupMap, type GroupMapPin } from "./groupsApi";

// Every group whose owner or admins placed it on the map, as pins — the group
// half of /worldmap, beside usePublicRoomMarkers' rooms. Blue where rooms are
// green (see WorldMapImpl), and polled far less often: a room appears and
// empties out within minutes, a group's pin moves when somebody moves it.

const POLL_INTERVAL_MS = 30_000;

export function useGroupMapMarkers(options?: {
  // Left off the returned pins — the group whose pin is being placed right now
  // is already the picker's own `pick` marker (see the group settings' map tab).
  excludeId?: string;
}): { groups: GroupMapPin[] | null; markers: WorldMapMarker[]; error: string | null } {
  const excludeId = options?.excludeId;
  const [groups, setGroups] = useState<GroupMapPin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const result = await fetchGroupMap(controller.signal);
        if (cancelled) return;
        if (result.ok) {
          setGroups(result.groups);
          setError(null);
        } else {
          setError("Não foi possível carregar os grupos do mapa.");
        }
      } catch {
        if (!cancelled) setError("Não foi possível carregar os grupos do mapa.");
      }
    }

    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  const markers = useMemo<WorldMapMarker[]>(
    () =>
      (groups ?? [])
        .filter((group) => group.id !== excludeId)
        .map((group) => ({
          id: `group:${group.id}`,
          kind: "group",
          lat: group.location.lat,
          lng: group.location.lng,
          // A pin is plain HTML, so the verified badge is a character here
          // rather than the component every React surface draws.
          label: group.flags.includes("VERIFIED") ? `${group.name} ✓` : group.name,
          peopleCount: group.memberCount,
          countNoun: ["membro", "membros"],
          tag: "Grupo",
          description: group.description
            ? `${group.description} · ${group.onlineCount} online agora`
            : `${group.onlineCount} online agora`,
          // Only public groups are on the map, so this page lets anybody in
          // (see GroupPages' PublicGroupGate) — and simply opens it for a member.
          href: `/groups/${group.id}`,
          actionLabel: "Ver grupo",
        })),
    [groups, excludeId]
  );

  return { groups, markers, error };
}
