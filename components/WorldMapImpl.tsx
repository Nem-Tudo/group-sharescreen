"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MdSearch, MdClose } from "react-icons/md";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { searchPlaces, type PlaceResult } from "@/lib/geocoding";
import type { WorldMapMarker, WorldMapProps } from "./WorldMap";

// Esri's Canvas basemaps. Two things ruled out the more obvious choices:
// CARTO's basemaps now stamp "API KEY REQUIRED" across every tile, and
// OpenStreetMap's own tile servers ask apps of any real size not to point at
// them directly (and only come in one, very bright, look). These are keyless,
// come in a light and a dark variant that actually match this app's two
// themes, and are deliberately low-contrast — which is what a basemap under a
// scatter of room pins wants to be.
//
// Esri splits them in two: the base carries the land and water with no
// writing on it at all, and a separate transparent "Reference" layer carries
// every place name. Both are needed, in that order — a map of unlabelled grey
// shapes is a poor thing to try to find your own city on.
//
// Note the `{z}/{y}/{x}` order: Esri's REST tile endpoint takes row before
// column, the opposite of the {z}/{x}/{y} every other provider uses. Getting
// this backwards yields a map that loads without error and shows the wrong
// part of the world.
const ESRI_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const TILE_URL_LIGHT = `${ESRI_BASE}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const TILE_URL_DARK = `${ESRI_BASE}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const LABELS_URL_LIGHT = `${ESRI_BASE}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const LABELS_URL_DARK = `${ESRI_BASE}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
// Required by Esri's terms of use, and the reason this is not something to
// quietly drop for looks.
const TILE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

// Esri's Canvas tiles stop here; asking for a deeper one returns nothing at
// all rather than an upscaled tile, so the map is capped to what exists.
const MAX_ZOOM = 16;

const DARK_QUERY = "(prefers-color-scheme: dark)";

// How long the search box waits after the last keystroke before asking. Long
// enough that typing a city name is one request rather than one per letter,
// short enough that it still feels like it is answering as you type.
const SEARCH_DEBOUNCE_MS = 350;

// Where a search result lands when it has no bounds of its own to frame (a
// street address, a single building) — close enough to see the block.
const SEARCH_FALLBACK_ZOOM = 13;

// Enough of the world to see at once without letting someone zoom out into
// the grey void around a single repeated globe.
const MIN_ZOOM = 2;

// Escapes text going into a divIcon's HTML. Leaflet takes a raw HTML string
// there, so a room named `<img onerror=...>` would otherwise be markup rather
// than a name — the handles are server-validated against HANDLE_RE, but this
// component also draws names typed into "Definir local do mundo", and one
// escape at the boundary is cheaper than trusting every future caller.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A room pin: a rounded label with the room's name and headcount, on a stem.
// A divIcon rather than Leaflet's default marker image, so there are no image
// assets to bundle and the pin can be styled with the same Tailwind palette
// as the rest of the app (inline, since Leaflet inserts this outside React
// and Tailwind's scanner never sees a class name built at runtime).
function roomIcon(marker: WorldMapMarker): L.DivIcon {
  const label = escapeHtml(marker.label);
  const badge = marker.badge ? `<span style="opacity:.75">${escapeHtml(marker.badge)}</span>` : "";
  return L.divIcon({
    className: "",
    html: `
      <div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
        <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;border-radius:9999px;background:#059669;color:#fff;padding:4px 10px;font-size:12px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.35)">
          <span>${label}</span>${badge}
        </div>
        <div style="width:2px;height:10px;background:#059669"></div>
        <div style="width:8px;height:8px;border-radius:9999px;background:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.28)"></div>
      </div>`,
    // The whole thing is positioned by the CSS transform above, so Leaflet's
    // own anchor maths has nothing left to do — hence a zero-size icon.
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

// What opens when a room pin is clicked. Plain HTML, because Leaflet owns
// this node — an <a> rather than a Next <Link>, so it is an ordinary
// navigation into the room (which is a full page's worth of new code anyway).
function popupHtml(marker: WorldMapMarker): string {
  const label = escapeHtml(marker.label);
  const badge = marker.badge
    ? `<div style="font-size:12px;opacity:.7;margin-top:2px">${escapeHtml(marker.badge)}</div>`
    : "";
  return `
    <div style="min-width:140px">
      <div style="font-weight:600;font-size:14px;word-break:break-all">${label}</div>
      ${badge}
      <a href="${escapeHtml(marker.href ?? "#")}" style="display:block;margin-top:8px;border-radius:8px;background:#09090b;color:#fff;padding:6px 10px;text-align:center;font-size:13px;font-weight:500;text-decoration:none">Entrar na sala</a>
    </div>`;
}

// The pin being placed in "Definir local do mundo" — deliberately a different
// shape and color from a room pin, since one is "here is a room" and the
// other is "here is where this room will be once you press Salvar".
//
// Unlike the room pin, this one has a fixed size, so it can tell Leaflet what
// that size is and let Leaflet place the tip: a real iconSize/iconAnchor
// instead of a 0x0 box whose contents overflow it and are pulled into place
// by a CSS transform. The 0x0 trick is only there for the room pin, whose
// width depends on the room's name — and an element painting outside its own
// zero-sized box is exactly the kind of thing a browser is free to snap
// differently as the compositing around it changes during a zoom.
const PICK_PIN_WIDTH = 18;
const PICK_PIN_HEIGHT = 30;

function pickIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;width:${PICK_PIN_WIDTH}px;height:${PICK_PIN_HEIGHT}px">
        <div style="width:18px;height:18px;border-radius:9999px;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>
        <div style="width:2px;height:12px;background:#dc2626"></div>
      </div>`,
    iconSize: [PICK_PIN_WIDTH, PICK_PIN_HEIGHT],
    // The tip of the stem, bottom-centre — that is the point being placed.
    iconAnchor: [PICK_PIN_WIDTH / 2, PICK_PIN_HEIGHT],
  });
}

// The actual Leaflet map. Never imported directly — `leaflet` touches
// `window` the moment it is loaded, so everything goes through WorldMap.tsx's
// ssr:false dynamic import instead. See WorldMap.tsx for the prop docs.
export default function WorldMapImpl({
  markers = [],
  pick = null,
  onPick,
  center,
  zoom,
  searchable = false,
  className = "",
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);
  // Held in a ref so the click handler registered once at mount always calls
  // the latest callback rather than the one that existed at mount. Written in
  // an effect rather than during render — a click can only happen after the
  // commit anyway, so there is no window where this is stale.
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const prefersDark = useMediaQuery(DARK_QUERY);

  const [query, setQuery] = useState("");
  // Tagged with the query it answers, so a list left over from two keystrokes
  // ago is never shown under a different word. The alternative — clearing it
  // whenever the box changes — means a setState in the effect body for what
  // is really just "these results are for that query".
  const [results, setResults] = useState<{ query: string; places: PlaceResult[] } | null>(null);
  const [searching, setSearching] = useState(false);
  // The query that failed, tagged for the same reason.
  const [searchError, setSearchError] = useState<string | null>(null);
  // The query the search box was filled with by *picking a result*, rather
  // than by typing. Picking one puts the place's name in the box, and without
  // this that write looks exactly like typing it: the effect below searches
  // for it again and the list someone just dismissed springs back open.
  const pickedQueryRef = useRef<string | null>(null);

  // Create once. Deliberately not keyed on center/zoom: those are the
  // *initial* view, and re-running this on every prop change would yank the
  // map back from wherever the user had panned to.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: center ?? [15, 0],
      zoom: zoom ?? 2,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      // Stops the horizontal infinite repeat, so panning east forever doesn't
      // scatter the same rooms across a dozen copies of the world.
      worldCopyJump: false,
      maxBounds: L.latLngBounds([-85, -180], [85, 180]),
      maxBoundsViscosity: 1,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      onPickRef.current?.(e.latlng.lat, e.latlng.lng);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      labelLayerRef.current = null;
      markerLayerRef.current = null;
      pickMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap when the OS theme flips — a light map in a dark room is
  // the one thing on this page bright enough to be the whole page.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    if (labelLayerRef.current) map.removeLayer(labelLayerRef.current);
    tileLayerRef.current = L.tileLayer(prefersDark ? TILE_URL_DARK : TILE_URL_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: MAX_ZOOM,
    }).addTo(map);
    // Added after the base so the place names sit on top of it, and given a
    // pane below Leaflet's marker pane so a room pin is never hidden behind a
    // city label.
    labelLayerRef.current = L.tileLayer(prefersDark ? LABELS_URL_DARK : LABELS_URL_LIGHT, {
      maxZoom: MAX_ZOOM,
    }).addTo(map);
  }, [prefersDark]);

  // Redraw the room pins whenever the list changes. Cleared and rebuilt
  // wholesale rather than diffed: the caller polls every few seconds and the
  // list is a handful of rooms, so the bookkeeping a diff would need costs
  // more than it saves.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const marker of markers) {
      const pin = L.marker([marker.lat, marker.lng], {
        icon: roomIcon(marker),
        // Above the tile layer's own panes, so a pin is never buried by a
        // neighbouring one's label.
        riseOnHover: true,
        title: marker.label,
      });
      // A popup rather than navigating on the click itself: a pin is a small
      // target on a map people are dragging around, and a misclick that drops
      // someone into a stranger's room is a bad way to find that out. Leaflet
      // handles the click for a pin with a popup bound, so this also never
      // reaches the map's own handler and can't move a pick pin.
      if (marker.href) {
        pin.bindPopup(popupHtml(marker), { closeButton: true, autoPan: true });
      }
      pin.addTo(layer);
    }
  }, [markers]);

  // The single "you are placing this here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickMarkerRef.current) {
      map.removeLayer(pickMarkerRef.current);
      pickMarkerRef.current = null;
    }
    if (!pick) return;
    pickMarkerRef.current = L.marker([pick.lat, pick.lng], { icon: pickIcon() }).addTo(map);
  }, [pick]);

  // The search box sits *inside* the map's own element (so it can be
  // positioned over it), which means Leaflet sees every click, drag and wheel
  // in it as a click, drag and wheel on the map — typing would pan, and
  // scrolling the result list would zoom. These two calls are Leaflet's own
  // answer for exactly this.
  useEffect(() => {
    const node = searchBoxRef.current;
    if (!node) return;
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);
  }, [searchable]);

  // Answers as you type, one request per pause rather than per keystroke. The
  // abort matters for correctness as much as for load: without it a slow
  // answer to "bel" can land after a fast one to "belo horizonte" and replace
  // it with the wrong list.
  useEffect(() => {
    const trimmed = query.trim();
    // Nothing worth asking about — and nothing to reset either, since the
    // dropdown is gated on this same test and simply doesn't render whatever
    // is still sitting in `results`.
    if (trimmed.length < 2) return;
    // Filled in by goToPlace, not typed — see the ref's comment. Cleared here
    // so editing that same text afterwards searches normally again.
    if (pickedQueryRef.current === trimmed) {
      pickedQueryRef.current = null;
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const places = await searchPlaces(trimmed, controller.signal);
        setResults({ query: trimmed, places });
        setSearchError(null);
      } catch (err) {
        // An abort is this effect being superseded, not a failure — showing
        // "search unavailable" for it would flash on every keystroke.
        if ((err as Error)?.name === "AbortError") return;
        setSearchError(trimmed);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length >= 2;
  // Only ever the answer to what is in the box right now.
  const currentResults = results?.query === trimmedQuery ? results.places : null;
  const currentError = searchError !== null && searchError === trimmedQuery;

  // Frames the chosen place and closes the list. A place with bounds gets
  // framed by them (a whole city fills the view rather than sitting as a dot
  // in the middle of a continent); anything else gets a fixed close-in zoom.
  //
  // In pick mode it also drops the pin there, since "put my room in this
  // city" is the whole reason to search from the picker — clicking the map
  // afterwards still moves it, so this is a starting point, not a decision.
  function goToPlace(place: PlaceResult) {
    const map = mapRef.current;
    if (!map) return;
    if (place.bounds) {
      const [south, west, north, east] = place.bounds;
      map.fitBounds(L.latLngBounds([south, west], [north, east]), { maxZoom: MAX_ZOOM });
    } else {
      map.setView([place.lat, place.lng], SEARCH_FALLBACK_ZOOM);
    }
    onPickRef.current?.(place.lat, place.lng);
    pickedQueryRef.current = place.name.trim();
    setQuery(place.name);
    setResults(null);
    setSearchError(null);
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter takes the first result — the ordinary "I typed my city and hit
    // enter" path, without making someone aim at the list.
    const first = currentResults?.[0];
    if (first) goToPlace(first);
  }

  function clearSearch() {
    setQuery("");
    setResults(null);
    setSearchError(null);
  }

  // Leaflet measures its container once, at creation — inside a popup or a
  // freshly mounted pane that measurement can land before the element has its
  // final size, leaving the map rendered into a sliver of it. Re-measuring on
  // every resize (including the first one after layout settles) is the
  // standard fix.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative z-0 bg-zinc-200 dark:bg-zinc-900 ${className}`}
      // Leaflet's own controls carry a light background of their own; this
      // just keeps the attribution readable against a dark basemap.
      style={{ colorScheme: "light" }}
    >
      {searchable && (
        // A child of the map element, not a sibling: it has to sit over the
        // tiles, and Leaflet owns this element's positioning. z-[1000] clears
        // Leaflet's own panes and controls, which top out in the 800s.
        <div
          ref={searchBoxRef}
          // `left-14` leaves the zoom buttons in the top-left corner alone.
          className="absolute left-14 top-2 z-[1000] w-[min(20rem,calc(100%-4.5rem))]"
        >
          <form onSubmit={handleSearchSubmit} className="relative">
            <MdSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar cidade, país, endereço..."
              aria-label="Pesquisar um lugar no mapa"
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-900 shadow-md outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Limpar pesquisa"
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition hover:bg-black/10 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
              >
                <MdClose className="h-4 w-4" />
              </button>
            )}
          </form>

          {/* Nothing at all until there is something to say — an empty
              dropdown hanging under the box would just cover the map. */}
          {canSearch && (currentResults !== null || currentError || searching) && (
            <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {currentError ? (
                <p className="px-3 py-2 text-xs text-red-500">
                  Não foi possível pesquisar agora.
                </p>
              ) : currentResults === null ? (
                <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">Pesquisando...</p>
              ) : currentResults.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Nenhum lugar encontrado.
                </p>
              ) : (
                <ul>
                  {currentResults.map((place) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => goToPlace(place)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {place.name}
                        </span>
                        {place.context && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {place.context}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
