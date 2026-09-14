"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MdSearch, MdClose } from "react-icons/md";
import { useResolvedTheme } from "@/lib/useTheme";
import { searchPlaces, type PlaceResult } from "@/lib/geocoding";
import type { WorldMapMarker, WorldMapProps } from "./WorldMap";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { groupInitials } from "@/lib/groupLinks";

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

// ─── Room and group pins ─────────────────────────────────────────────────
//
// A pin is a round face — the group's picture, or its initials — ringed in
// the colour of its kind, with its name on a small neutral tag underneath.
// Two things keep a busy region readable, which is exactly what the old
// "one coloured pill per room" pins could not do once a few dozen of them
// sat over south-east Brazil:
//
//   - Pins closer together on screen than CLUSTER_RADIUS fold into one: the
//     biggest of them keeps its face and its place, drawn as a small stack
//     with a "+N" on it. Clicking the stack zooms in until it comes apart —
//     or, where it never will (the same spot, or already at the deepest
//     zoom), lists what is in it.
//   - A name tag is only drawn where it does not land on another tag or on
//     another pin, biggest first — under the face if there is room, else
//     beside or above it. The rest keep their name one hover (see
//     globals.css) or one click away. At every zoom that leaves a map of
//     faces with as many names as fit, instead of names on top of names.
//
// All of this is laid out in screen pixels at the current zoom, so it is
// redone on every zoomend — never while panning, which moves everything by
// the same amount and changes nothing about what overlaps what.
//
// Styled by class from globals.css (".gl-pin…", ".gl-popup…"), not inline:
// the tags follow the site's theme, and a hidden name reappearing on hover
// is a :hover rule that no inline style can express.

// The face's diameter, ring included. Fixed, which is what lets the icon hand
// Leaflet a real size and anchor — the point is the centre of the face.
const PIN_SIZE = 32;

// How close two pins may get, centre to centre, before they fold into one.
// A little over a pin and a half: close enough that neighbouring towns stay
// apart once zoomed in, far enough that two faces never touch.
const CLUSTER_RADIUS = 48;

// The name tag's geometry, as globals.css draws it — only used to guess where
// a tag would land before deciding whether it is drawn at all.
const LABEL_GAP = 4;
const LABEL_GAP_STACKED = 12;
const LABEL_SIDE_GAP = 6;
const LABEL_SIDE_GAP_STACKED = 14;
const LABEL_HEIGHT = 17;
const LABEL_PAD_X = 6;
const LABEL_NAME_MAX = 104;
const LABEL_FONT_SIZE = 11;

// Green for a live room, blue for a group — the one difference between the
// two kinds of pin, so the map can be read at a glance (see WorldMapMarker.kind).
function kindColor(marker: WorldMapMarker): string {
  return marker.kind === "group" ? "#2563eb" : "#059669";
}

// Which of two pins keeps its face when they fold together, and whose name is
// drawn first when only one fits: the bigger one. A live room beats a group of
// the same size, since somebody can walk into it right now.
function priority(marker: WorldMapMarker): number {
  return (marker.peopleCount ?? 0) + (marker.kind === "group" ? 0 : 0.5);
}

// 2748 → "2.7k". The pin's tag is a few dozen pixels wide; the exact number is
// in the popup.
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const VERIFIED_SVG =
  '<svg class="gl-verified" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z"/></svg>';

// The face itself. A picture that fails to load is swapped for the initials
// kept on it (see wireImageFallbacks) — the same promise GroupIcon makes.
function faceHtml(marker: WorldMapMarker): string {
  const initials = escapeHtml(groupInitials(marker.label));
  const inner = marker.iconUrl
    ? `<img src="${escapeHtml(marker.iconUrl)}" alt="" draggable="false" data-initials="${initials}">`
    : `<span>${initials}</span>`;
  return `<span class="gl-face" style="--pin-ring:${kindColor(marker)}">${inner}</span>`;
}

// Leaflet inserts these pins and popups outside React, so an <img> that fails
// has nobody to re-render it — this puts the initials in its place instead.
function wireImageFallbacks(root: HTMLElement | undefined | null) {
  root?.querySelectorAll<HTMLImageElement>("img[data-initials]").forEach((img) => {
    const fallback = () => {
      const span = document.createElement("span");
      span.textContent = img.dataset.initials ?? "?";
      img.replaceWith(span);
    };
    if (img.complete && img.naturalWidth === 0 && img.src) fallback();
    else img.addEventListener("error", fallback, { once: true });
  });
}

// Where a pin's name tag sits around its face, in the order they are tried:
// under it is where a name is expected, beside it is the next best thing, and
// above it is last because that is where the popup opens.
const LABEL_SIDES = ["below", "right", "left", "above"] as const;
type LabelSide = (typeof LABEL_SIDES)[number];

// One thing drawn on the map: a single pin, or a stack of them whose first
// member is the face on top. `labelAt` is null for a name that fit nowhere.
type Place = {
  members: WorldMapMarker[];
  point: L.Point;
  labelAt: LabelSide | null;
};

type Box = { x1: number; y1: number; x2: number; y2: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

// The width a string will have on screen, for guessing a tag's size before it
// exists. A guess on the generous side is fine: it only ever costs a name
// that would have just fitted.
function textWidth(text: string, font: string): number {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * LABEL_FONT_SIZE * 0.62;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

// Folds the markers into places and decides which of them get their name —
// see the comment at the top of this section.
function layoutPlaces(markers: WorldMapMarker[], map: L.Map, zoom: number, fontFamily: string): Place[] {
  const items = markers
    .map((marker) => ({ marker, point: map.project([marker.lat, marker.lng], zoom) }))
    .sort((a, b) => priority(b.marker) - priority(a.marker));

  // Greedy, biggest first: each pin not yet taken starts a place where it
  // stands, and takes every smaller one within reach. Quadratic, which at a
  // few hundred pins is still well under a frame — and only runs on zoomend.
  const taken = new Uint8Array(items.length);
  const places: Place[] = [];
  for (let i = 0; i < items.length; i++) {
    if (taken[i]) continue;
    taken[i] = 1;
    const seed = items[i];
    const members = [seed.marker];
    for (let j = i + 1; j < items.length; j++) {
      if (taken[j] || seed.point.distanceTo(items[j].point) > CLUSTER_RADIUS) continue;
      taken[j] = 1;
      members.push(items[j].marker);
    }
    places.push({ members, point: seed.point, labelAt: null });
  }

  // Every face is an obstacle for every other place's tag. A stack's box
  // reaches up and right, over the cards behind it and its "+N".
  const half = PIN_SIZE / 2;
  const faces: Box[] = places.map(({ point, members }) => ({
    x1: point.x - half - 2,
    y1: point.y - half - (members.length > 1 ? 10 : 2),
    x2: point.x + half + (members.length > 1 ? 16 : 2),
    y2: point.y + half + 2,
  }));
  const boldFont = `600 ${LABEL_FONT_SIZE}px ${fontFamily}`;
  const plainFont = `500 ${LABEL_FONT_SIZE}px ${fontFamily}`;
  const labels: Box[] = [];
  places.forEach((place, index) => {
    const face = place.members[0];
    const stacked = place.members.length > 1;
    let width =
      Math.min(textWidth(face.label, boldFont), LABEL_NAME_MAX) + LABEL_PAD_X * 2 + 2;
    if (face.verified) width += 15;
    if (typeof face.peopleCount === "number") {
      width += textWidth(compactCount(face.peopleCount), plainFont) + 4;
    }
    const { x, y } = place.point;
    for (const side of LABEL_SIDES) {
      const box = labelBox(side, x, y, width, stacked);
      const blocked =
        labels.some((other) => overlaps(box, other)) ||
        faces.some((other, i) => i !== index && overlaps(box, other));
      if (blocked) continue;
      place.labelAt = side;
      labels.push(box);
      break;
    }
  });
  return places;
}

// Where a tag of this width would land on each side of a face at (x, y) —
// mirroring the .gl-pin-label[data-at] rules in globals.css, with a pixel of
// air around it. A stack's tag keeps clear of its cards and "+N" on the right
// and above.
function labelBox(side: LabelSide, x: number, y: number, width: number, stacked: boolean): Box {
  const half = PIN_SIZE / 2;
  const pad = 2;
  const middle = { y1: y - LABEL_HEIGHT / 2 - pad, y2: y + LABEL_HEIGHT / 2 + pad };
  switch (side) {
    case "below": {
      const top = y + half + LABEL_GAP;
      return { x1: x - width / 2 - pad, y1: top - pad, x2: x + width / 2 + pad, y2: top + LABEL_HEIGHT + pad };
    }
    case "right": {
      const left = x + half + (stacked ? LABEL_SIDE_GAP_STACKED : LABEL_SIDE_GAP);
      return { x1: left - pad, x2: left + width + pad, ...middle };
    }
    case "left": {
      const right = x - half - LABEL_SIDE_GAP;
      return { x1: right - width - pad, x2: right + pad, ...middle };
    }
    case "above": {
      const bottom = y - half - (stacked ? LABEL_GAP_STACKED : LABEL_GAP);
      return { x1: x - width / 2 - pad, y1: bottom - LABEL_HEIGHT - pad, x2: x + width / 2 + pad, y2: bottom + pad };
    }
  }
}

function pinHtml(place: Place): string {
  const [face, ...rest] = place.members;
  // The cards peeking out behind a stack, in the colours of the next two in
  // it — so a stack of groups and rooms says so before it is opened.
  const cards = rest
    .slice(0, 2)
    .map((m, i) => `<span class="gl-pin-card gl-pin-card-${i + 1}" style="--pin-ring:${kindColor(m)}"></span>`)
    .reverse()
    .join("");
  const more = rest.length > 0 ? `<span class="gl-pin-more">+${rest.length}</span>` : "";
  const count =
    typeof face.peopleCount === "number"
      ? `<span class="gl-pin-count">${compactCount(face.peopleCount)}</span>`
      : "";
  // A tag that fit nowhere is hidden rather than left out, so it still reads
  // to a screen reader and still shows (under the face) on hover — see
  // globals.css.
  const label = `<span class="gl-pin-label${place.labelAt ? "" : " is-hidden"}" data-at="${
    place.labelAt ?? "below"
  }"><span class="gl-pin-name">${escapeHtml(face.label)}</span>${face.verified ? VERIFIED_SVG : ""}${count}</span>`;
  return `<div class="gl-pin-body${rest.length > 0 ? " gl-pin-stack" : ""}">${cards}${faceHtml(face)}${more}${label}</div>`;
}

function pinIcon(html: string): L.DivIcon {
  return L.divIcon({
    className: "gl-pin",
    html,
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  });
}

// How a count is worded in a popup — "1 pessoa", "2748 membros". A room counts
// people in it; a group counts its members.
function countText(marker: WorldMapMarker): string {
  if (typeof marker.peopleCount !== "number") return "";
  const [one, many] = marker.countNoun ?? [
    translate("common.personNoun.one"),
    translate("common.personNoun.other"),
  ];
  return `${marker.peopleCount} ${marker.peopleCount === 1 ? one : many}`;
}

// What opens when a single pin is clicked. Plain HTML, because Leaflet owns
// this node — an <a> rather than a Next <Link>, so it is an ordinary
// navigation into the room (which is a full page's worth of new code anyway).
function popupHtml(marker: WorldMapMarker): string {
  const tag = marker.tag ? `<div class="gl-popup-tag">${escapeHtml(marker.tag)}</div>` : "";
  const count = countText(marker);
  // The one thing here with real length — capped by the server at 120
  // characters, so it can be shown whole rather than clamped.
  const description = marker.description
    ? `<div class="gl-popup-desc">${escapeHtml(marker.description)}</div>`
    : "";
  return `<div class="gl-popup">
<div class="gl-popup-head">${faceHtml(marker)}<div class="gl-popup-titles">${tag}<div class="gl-popup-name"><span>${escapeHtml(
    marker.label
  )}</span>${marker.verified ? VERIFIED_SVG : ""}</div>${count ? `<div class="gl-popup-meta">${escapeHtml(count)}</div>` : ""}</div></div>
${description}
<a class="gl-popup-action" href="${escapeHtml(marker.href ?? "#")}">${escapeHtml(
    marker.actionLabel ?? translate("common.joinTheRoom")
  )}</a>
</div>`;
}

// A stack that zooming will not pull apart, as a list: one row per room or
// group, each a link straight to it.
function listPopupHtml(members: WorldMapMarker[]): string {
  const rows = members
    .map((marker) => {
      const meta = [marker.tag, countText(marker)].filter(Boolean).join(" · ");
      const inner = `${faceHtml(marker)}<span class="gl-popup-row-text"><span class="gl-popup-name"><span>${escapeHtml(
        marker.label
      )}</span>${marker.verified ? VERIFIED_SVG : ""}</span>${meta ? `<span class="gl-popup-meta">${escapeHtml(meta)}</span>` : ""}</span>`;
      return marker.href
        ? `<a class="gl-popup-row" href="${escapeHtml(marker.href)}">${inner}</a>`
        : `<div class="gl-popup-row">${inner}</div>`;
    })
    .join("");
  return `<div class="gl-popup"><div class="gl-popup-list-title">${escapeHtml(
    translate("worldMapImpl.placesHere", { count: members.length })
  )}</div><div class="gl-popup-rows">${rows}</div></div>`;
}

// Opened on the map rather than bound to the pin: the pins are rebuilt as the
// lists they come from refresh and as the zoom regroups them, and a popup
// bound to a pin closes with it — every few seconds, mid-read.
function openPopup(map: L.Map, place: Place, html: string) {
  const face = place.members[0];
  const popup = L.popup({
    className: "gl-map-popup",
    closeButton: true,
    autoPan: true,
    autoPanPadding: [16, 16],
    maxWidth: 260,
    // Just above the face, which is centred on the point.
    offset: [0, -(PIN_SIZE / 2) + 4],
  })
    .setLatLng([face.lat, face.lng])
    .setContent(html)
    .openOn(map);
  wireImageFallbacks(popup.getElement());
}

// A single pin opens its popup. A stack zooms in until it comes apart, unless
// it never will — its members share one spot, or the map is as deep as it
// goes — and then lists them instead.
function openPlace(map: L.Map, place: Place) {
  const { members } = place;
  if (members.length === 1) {
    if (members[0].href) openPopup(map, place, popupHtml(members[0]));
    return;
  }
  const seed = map.project([members[0].lat, members[0].lng], MAX_ZOOM);
  const splits = members.some(
    (m) => map.project([m.lat, m.lng], MAX_ZOOM).distanceTo(seed) > CLUSTER_RADIUS
  );
  if (!splits || map.getZoom() >= MAX_ZOOM) {
    openPopup(map, place, listPopupHtml(members));
    return;
  }
  const bounds = L.latLngBounds(members.map((m) => [m.lat, m.lng] as [number, number]));
  const padding = L.point(60, 60);
  const target = Math.min(map.getBoundsZoom(bounds, false, padding), MAX_ZOOM);
  // A stack always gets at least one step closer, even where framing it
  // exactly would not move the zoom at all.
  if (target <= map.getZoom()) map.setView(bounds.getCenter(), map.getZoom() + 1);
  else map.fitBounds(bounds, { padding, maxZoom: MAX_ZOOM });
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
  // The *initial* zoom, renamed on the way in: the live one lives in state
  // below, and two things called `zoom` in one component is how a prop that
  // must not drive the map ends up driving it.
  zoom: zoomProp,
  searchable = false,
  className = "",
}: WorldMapProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);
  // The room and group pins on the map now, by the id of the face each wears
  // — see the marker effect below.
  const pinsRef = useRef(new Map<string, { marker: L.Marker; html: string; place: Place }>());
  // Held in a ref so the click handler registered once at mount always calls
  // the latest callback rather than the one that existed at mount. Written in
  // an effect rather than during render — a click can only happen after the
  // commit anyway, so there is no window where this is stale.
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // The theme the person chose, not the OS preference this used to read: the
  // map's tiles are the largest block of colour on the page, and a light map
  // inside a dark page is the one place a mismatch is unmissable.
  const prefersDark = useResolvedTheme() === "dark";

  // What the map is currently at, mirrored into React so the marker effect can
  // depend on it. Only ever read to lay the pins out (see layoutPlaces); the
  // map's own view is never driven from it.
  const [zoom, setZoom] = useState(() => zoomProp ?? 2);
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
      zoom: zoomProp ?? 2,
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
    const pins = pinsRef.current;
    // Regroups the pins and their names for the new scale — see layoutPlaces.
    // `zoomend` rather than `zoom`: the mid-animation values would rebuild
    // every marker on every frame of a pinch.
    setZoom(map.getZoom());
    map.on("zoomend", () => setZoom(map.getZoom()));
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
      pins.clear();
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

  // Lays the pins out again whenever the list or the zoom changes (see
  // layoutPlaces). The result is matched against what is already on the map by
  // the face each place wears, and a pin whose markup came out the same is
  // left alone: the callers poll every few seconds, and rebuilding every pin
  // each time would flicker the one under the cursor and re-fetch every
  // group's picture.
  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    const container = containerRef.current;
    if (!map || !layer || !container) return;
    const pins = pinsRef.current;
    const places = layoutPlaces(markers, map, zoom, getComputedStyle(container).fontFamily);
    const seen = new Set<string>();
    places.forEach((place, rank) => {
      const face = place.members[0];
      seen.add(face.id);
      const html = pinHtml(place);
      // Bigger places on top wherever two still touch — the order the
      // layout already ranked them in.
      const zIndexOffset = (places.length - rank) * 10;
      const existing = pins.get(face.id);
      if (existing) {
        existing.place = place;
        if (existing.html !== html) {
          existing.marker.setIcon(pinIcon(html));
          existing.html = html;
          wireImageFallbacks(existing.marker.getElement());
        }
        const at = existing.marker.getLatLng();
        if (at.lat !== face.lat || at.lng !== face.lng) existing.marker.setLatLng([face.lat, face.lng]);
        existing.marker.setZIndexOffset(zIndexOffset);
        return;
      }
      const marker = L.marker([face.lat, face.lng], {
        icon: pinIcon(html),
        riseOnHover: true,
        zIndexOffset,
      });
      const entry = { marker, html, place };
      // A popup rather than navigating on the click itself: a pin is a small
      // target on a map people are dragging around, and a misclick that drops
      // someone into a stranger's room is a bad way to find that out. A
      // marker's click never bubbles to the map, so this can't move a pick pin.
      marker.on("click", () => openPlace(map, entry.place));
      marker.addTo(layer);
      wireImageFallbacks(marker.getElement());
      pins.set(face.id, entry);
    });
    for (const [id, entry] of pins) {
      if (seen.has(id)) continue;
      layer.removeLayer(entry.marker);
      pins.delete(id);
    }
  }, [markers, zoom]);

  // The single "you are placing this here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickMarkerRef.current) {
      map.removeLayer(pickMarkerRef.current);
      pickMarkerRef.current = null;
    }
    if (!pick) return;
    // Above every room and group pin: it is the one thing on the map being
    // decided right now.
    pickMarkerRef.current = L.marker([pick.lat, pick.lng], {
      icon: pickIcon(),
      zIndexOffset: 100_000,
    }).addTo(map);
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
      // `gl-map` is what the pin and popup styles in globals.css hang off.
      className={`gl-map relative z-0 bg-zinc-200 dark:bg-zinc-900 ${className}`}
      style={{
        // Leaflet's own controls carry a light background of their own; this
        // just keeps the attribution readable against a dark basemap.
        colorScheme: "light",
        // Not cosmetic — this is what keeps the pins on the right spot.
        //
        // Every pin is a divIcon whose HTML is written as a multi-line
        // template literal above (the pick pin's indented; the popups carry
        // newlines too), and a pin's position comes from the size and layout
        // of that markup: each is a fixed box whose centre or tip Leaflet
        // anchors. Under
        // the inherited `white-space: pre-wrap` of the popup this map is
        // opened inside (see ManageRoomModal and ntpopups' own styles), the
        // newlines and indentation in that markup stop collapsing: they
        // become rendered whitespace and anonymous flex items, the icon grows
        // by a line or two it was never meant to have, and every pin ends up
        // a fixed number of pixels away from the point it names. A fixed
        // pixel error covers more ground the further you zoom out, which is
        // why it reads as "roughly right" up close and puts rooms in the sea
        // at world zoom — and why /worldmap, which inherits nothing of the
        // sort, has always looked correct.
        //
        // Set here, on the element every pane and popup hangs off, so the map
        // renders the same wherever it is dropped rather than depending on
        // what its host happens to inherit.
        whiteSpace: "normal",
      }}
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
              placeholder={t("worldMapImpl.searchCityCountryAddress")}
              aria-label={t("worldMapImpl.searchForAPlaceOnThe")}
              className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-900 shadow-md outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t("worldMapImpl.clearSearch")}
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
                  {t("worldMapImpl.couldNotSearchRightNow")}
                </p>
              ) : currentResults === null ? (
                <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{t("worldMapImpl.searching")}</p>
              ) : currentResults.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("worldMapImpl.noPlaceFound")}
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
