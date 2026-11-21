"use client";

import Link from "next/link";
import { useMemo, useState, type MouseEvent } from "react";
import { MdOpenInFull } from "react-icons/md";
import { WorldMap } from "@/components/WorldMap";
import { usePublicRoomMarkers } from "@/lib/usePublicRoomMarkers";
import { useGroupMapMarkers } from "@/lib/useGroupMapMarkers";
import { parseGroupsPath } from "@/lib/groupLinks";
import { noteExploreVisit } from "@/lib/groupsHub";
import { EXPLORE_MAP_EVENTS, trackExploreMap } from "@/lib/exploreMap";
import { useT } from "@/lib/useI18n";

// The rooms-and-groups map at the top of "Explorar grupos" (experiment
// explore-map, see lib/exploreMap). The same pins as /worldmap's
// RoomsMapClient — live rooms green, groups blue — in a card, with its filter
// doubling as the legend.

type MapFilter = "all" | "rooms" | "groups";
const FILTER_VALUE: Record<MapFilter, number> = { all: 1, rooms: 2, groups: 3 };

export function ExploreMap() {
  const t = useT();
  const { rooms, markers: roomMarkers } = usePublicRoomMarkers();
  const { groups, markers: groupMarkers } = useGroupMapMarkers();
  const [filter, setFilter] = useState<MapFilter>("all");

  const shown = useMemo(
    () =>
      filter === "rooms" ? roomMarkers : filter === "groups" ? groupMarkers : [...groupMarkers, ...roomMarkers],
    [filter, roomMarkers, groupMarkers]
  );

  function pickFilter(next: MapFilter) {
    if (next === filter) return;
    setFilter(next);
    trackExploreMap(EXPLORE_MAP_EVENTS.filter, { value: FILTER_VALUE[next] });
  }

  // The pins' popups are Leaflet's own HTML (see WorldMapImpl), so their
  // links are caught on the way through rather than handed a callback. A
  // group opened from here is Explorar's like one opened from the list below,
  // so joining it counts the same way (see lib/groupsHub's noteExploreVisit).
  function onMapClick(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest("a.gl-popup-action, a.gl-popup-row");
    const href = link?.getAttribute("href");
    if (!href || href === "#") return;
    const route = parseGroupsPath(href);
    if (route?.kind === "group") noteExploreVisit(route.groupId);
    trackExploreMap(EXPLORE_MAP_EVENTS.pin, { tags: { kind: route?.kind === "group" ? "group" : "room" } });
  }

  const filterButton = (id: MapFilter, label: string, count: number | null, dot?: string) => (
    <button
      key={id}
      type="button"
      onClick={() => pickFilter(id)}
      aria-pressed={filter === id}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        filter === id
          ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
      {label}
      {count !== null && <span className="font-normal text-zinc-400">{count}</span>}
    </button>
  );

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div
          role="group"
          aria-label={t("worldmap.roomsMapClient.whatToShowOnTheMap")}
          className="inline-flex gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900"
        >
          {filterButton("all", t("worldmap.roomsMapClient.everything"), null)}
          {filterButton("rooms", t("worldmap.roomsMapClient.activeRooms"), rooms === null ? null : roomMarkers.length, "#059669")}
          {filterButton("groups", t("common.groups"), groups === null ? null : groupMarkers.length, "#2563eb")}
        </div>
        <Link
          href="/worldmap"
          onClick={() => trackExploreMap(EXPLORE_MAP_EVENTS.full)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <MdOpenInFull className="h-3.5 w-3.5" />
          {t("groups.exploreMap.full")}
        </Link>
      </div>
      <div className="h-72 sm:h-80" onClickCapture={onMapClick}>
        <WorldMap markers={shown} wheelZoom={false} className="h-full w-full" />
      </div>
      {/* Same note as /worldmap: a pin is where the owner put it, not anybody's location. */}
      <p className="px-3 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
        {t("worldmap.roomsMapClient.eachPinIsWhereTheRoom")}
      </p>
    </section>
  );
}
