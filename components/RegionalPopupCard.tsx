"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { RubyVerifiedBadgeIcon } from "@/components/icons";
import { SITE_URL } from "@/lib/seo";
import {
  REGIONAL_EVENTS,
  REGIONAL_HOME_KM,
  REGIONAL_HQ,
  REGIONAL_RADIUS_KM,
  distanceKm,
  trackRegional,
  type RegionalSpot,
} from "@/lib/regional";
import { REGIONAL_STATES, REGIONAL_TOWNS_ALL } from "./regionalMapData";

// The card of the regional popup (RegionalPopup decides whether it opens).
//
// Paper, under a printed-atlas map that opens wide — São Paulo, Rio, the
// coast — and zooms down to the region: the visitor's pin drops, and a signal
// keeps running along the arc to the Go Live mark in Santa Rita. Go Live
// speaks, not its creator: the creator is a credit line with an Instagram
// link (asked for on 2026-11-20). Then the real shirt (black, the small GoLive mark on the
// chest, shown big in a loupe) and the deal, as a sticker.

/**
 * How long it cannot be closed (✕, Esc, a click outside, "Combinado!"): a
 * click or tap aimed at the page underneath, a reflex Esc or an Enter would
 * throw it away unread, and it is shown only once. The ✕ and the button fill
 * up while it lasts, so nobody thinks they are broken.
 */
const CLOSE_LOCK_MS = 3000;

const INSTAGRAM_URL = "https://www.instagram.com/onemtudo/";

const PAPER = "#f6f2e8";
const INK = "#1a1712";
const MUTED = "#6a6152";
const WATER = "#cfdfe3";
const BRAND = "#1a9bff";
/** The blue of the "o" on the shirt. */
const LOGO_BLUE = "#1d9bf0";
const RUBY = "#be123c";
const DISPLAY_FONT = "var(--font-jakarta), var(--font-geist-sans), sans-serif";

/** The map waits a beat, then zooms from the wide view down to the region. */
const ZOOM_DELAY_MS = 250;
const ZOOM_MS = 1900;

const KEYFRAMES = `
@keyframes rg-pop-in { from { opacity: 0; transform: translateY(28px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes rg-pulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(3); opacity: 0; } }
@keyframes rg-drop { 0% { transform: translateY(-46px); opacity: 0; } 55% { transform: translateY(3px); opacity: 1; } 75% { transform: translateY(-3px); } 100% { transform: none; opacity: 1; } }
@keyframes rg-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes rg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rg-swing { 0%, 100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
@keyframes rg-slap { 0% { opacity: 0; transform: scale(1.7) rotate(-14deg); } 60% { opacity: 1; transform: scale(0.94) rotate(-2deg); } 100% { opacity: 1; transform: scale(1) rotate(-3deg); } }
@keyframes rg-lock-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes rg-lock-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.rg-pop-in { animation: rg-pop-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.rg-pulse { transform-box: fill-box; transform-origin: center; animation: rg-pulse 2.4s ease-out infinite; }
.rg-pulse-2 { animation-delay: 1.2s; }
.rg-drop { transform-box: fill-box; transform-origin: bottom; animation: rg-drop 0.6s cubic-bezier(0.3, 1.2, 0.5, 1) both; }
.rg-draw { stroke-dasharray: 1; animation: rg-draw 0.7s 0.35s cubic-bezier(0.4, 0, 0.2, 1) both; }
.rg-in { animation: rg-fade 0.4s 0.15s both; }
.rg-in-late { animation: rg-fade 0.4s 0.9s both; }
.rg-swing { transform-box: view-box; transform-origin: 70px 2px; animation: rg-swing 4.2s ease-in-out infinite; }
.rg-slap { transform: rotate(-3deg); animation: rg-slap 0.55s 2.5s cubic-bezier(0.2, 1, 0.4, 1) both; }
.rg-lock-fill { transform-origin: left; animation: rg-lock-fill ${CLOSE_LOCK_MS}ms linear both; }
.rg-lock-ring { animation: rg-lock-ring ${CLOSE_LOCK_MS}ms linear both; }
@media (prefers-reduced-motion: reduce) {
  /* The lock's progress is a timer, not motion: it keeps its real length. */
  .rg-root, .rg-root *:not(.rg-lock) { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; }
}
`;

// Paper grain, drawn once by the browser (no image file).
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.1 0 0 0 0 0.08 0 0 0 0 0.05 0 0 0 0.55 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>")`;

// ---------------------------------------------------------------------------
// The map

const W = 420;
const H = 196;
const RAD = Math.PI / 180;
/** Visible on every card width ("slice" crops ~27 units off each side on a phone), above the bottom fade. */
const SAFE = { x0: 30, x1: W - 30, y0: 10, y1: H - 32 };
/** Where the card's ✕ sits over the map. */
const CLOSE_CORNER = { x0: W - 82, y0: 0, x1: W, y1: 52 };
/** px per km of the opening, wide view (about 350 km each side). */
const START_SCALE = 0.6;

const STATE_FILL: Record<string, string> = { MG: "#ede5d0", SP: "#e5dec9", RJ: "#e9e1cc", PR: "#e7e0cb", ES: "#e7e0cb" };

/** Context for the opening view; they fade as the map closes in. */
const CONTEXT_CITIES = [
  { name: "São Paulo", lat: -23.55, lng: -46.633 },
  { name: "Rio de Janeiro", lat: -22.907, lng: -43.173 },
  { name: "Campinas", lat: -22.906, lng: -47.061 },
  { name: "Ribeirão Preto", lat: -21.178, lng: -47.81 },
  { name: "Juiz de Fora", lat: -21.761, lng: -43.35 },
];
const STATE_LABELS = [
  { name: "MINAS GERAIS", lat: -21.15, lng: -44.6 },
  { name: "SÃO PAULO", lat: -22.95, lng: -48.3 },
  { name: "RIO DE JANEIRO", lat: -22.3, lng: -42.6 },
];
const OCEAN_AT = { lat: -23.92, lng: -44.9 };
/** MG/SP on each side of the border, checked against the outlines; the first pair that fits is used. */
const BORDER_TAGS: { mg: [number, number]; sp: [number, number] }[] = [
  { mg: [-22.45, -45.2], sp: [-22.8, -45.2] },
  { mg: [-22.3, -44.85], sp: [-22.62, -45.0] },
  { mg: [-22.45, -46.45], sp: [-22.78, -46.6] },
];
/** Which towns get a name on the zoomed map, biggest first. */
const LABEL_PRIORITY = [
  "Pouso Alegre", "Taubaté", "Pindamonhangaba", "Varginha", "Itajubá", "Guaratinguetá", "Lorena", "Três Corações",
  "Alfenas", "Caçapava", "Cruzeiro", "Extrema", "São Lourenço", "Campos do Jordão", "Cambuí", "Machado", "Ouro Fino",
  "Lambari", "Caxambu", "Andradas", "Aparecida", "Socorro", "Paraisópolis", "Brazópolis", "Cachoeira de Minas",
  "Natércia", "Conceição dos Ouros", "Careaçu", "Piranguinho", "Silvianópolis", "Borda da Mata", "Campanha",
  "São Gonçalo do Sapucaí", "Cristina", "Maria da Fé", "Elói Mendes", "Tremembé", "Jacutinga", "Monte Sião",
];
const MAX_TOWN_LABELS = 6;
/** Within this of a town's seat, the title names it ("Você é de Itajubá??"). */
const TOWN_GUESS_KM = 7;

type Pt = { x: number; y: number };
type Box = { x0: number; y0: number; x1: number; y1: number };
type Frame = { scale: number; hq: Pt };

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const labelWidth = (text: string, size: number, em = 0.58) => text.length * size * em;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Km east/north of Santa Rita. */
function offsetKm(lat: number, lng: number) {
  return {
    east: (lng - REGIONAL_HQ.lng) * Math.cos(REGIONAL_HQ.lat * RAD) * 111.32,
    north: (lat - REGIONAL_HQ.lat) * 110.57,
  };
}

function project(frame: Frame, lat: number, lng: number): Pt {
  const o = offsetKm(lat, lng);
  return { x: frame.hq.x + o.east * frame.scale, y: frame.hq.y - o.north * frame.scale };
}

function bezier(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

/**
 * "pouso-alegre": the town as an attribute value (the `city` of every popup
 * event); "unknown" when no seat is close enough.
 */
export function regionalCitySlug(town: string | null): string {
  if (!town) return "unknown";
  return town
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** windows, mac, linux, android, ios or other, from the user agent. */
function operatingSystem(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS reports itself as a Mac with a touch screen.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/macintosh|mac os x/i.test(ua)) return "mac";
  if (/linux|cros/i.test(ua)) return "linux";
  return "other";
}

/** The closest town seat, when the visitor is basically in it. */
function guessTown(spot: RegionalSpot): string | null {
  let best: string | null = null;
  let bestKm = TOWN_GUESS_KM;
  for (const town of REGIONAL_TOWNS_ALL) {
    const km = distanceKm(spot, town);
    if (km < bestKm) {
      best = town.name;
      bestKm = km;
    }
  }
  return best;
}

type Plan = {
  frame: Frame;
  youAt: Pt;
  ctrl: Pt;
  pill: Pt;
  hqBlockAbove: boolean;
  borderTag: { mg: Pt; sp: Pt } | null;
  townLabels: Map<string, "start" | "end">;
};

/** Where everything sits once the zoom has landed. */
function planMap(spot: RegionalSpot, home: boolean, youLabel: string, youHereLabel: string, hqName: string, coords: string): Plan {
  const you = offsetKm(spot.lat, spot.lng);
  const youKm = Math.hypot(you.east, you.north);
  const pinBelow = !home && you.north < 0;
  // How far each end reaches around its point: the mark with its two-line
  // name (on the side away from the pin), the pin with its label on top.
  const hqHalfW = Math.max(16, Math.max(labelWidth(hqName, 10.5, 0.55), labelWidth(coords, 8, 0.62)) / 2 + 4);
  const hqUp = pinBelow ? 44 : home ? 36 : 14;
  const hqDown = pinBelow ? 14 : 44;
  const youUp = 46;
  const youDown = 4;
  const youHalfW = (labelWidth(youLabel, 9.5, 0.62) + 14) / 2 + 2;

  let scale = 2.4;
  if (!home) {
    const wanted = Math.max(2.2, 120 / Math.max(youKm, 1));
    const fitV = (SAFE.y1 - SAFE.y0 - (pinBelow ? hqUp + youDown : youUp + hqDown)) / Math.max(Math.abs(you.north), 0.001);
    const fitH = (SAFE.x1 - SAFE.x0 - hqHalfW - youHalfW) / Math.max(Math.abs(you.east), 0.001);
    scale = Math.min(wanted, fitV, fitH);
  }
  const dx = home ? 0 : you.east * scale;
  const dy = home ? 0 : -you.north * scale;
  const top = Math.min(-hqUp, home ? 0 : dy - youUp);
  const bottom = Math.max(hqDown, home ? 0 : dy + youDown);
  const left = Math.min(-hqHalfW, home ? 0 : dx - youHalfW);
  const right = Math.max(hqHalfW, home ? 0 : dx + youHalfW);
  const hq = { x: (SAFE.x0 + SAFE.x1) / 2 - (left + right) / 2, y: (SAFE.y0 + SAFE.y1) / 2 - (top + bottom) / 2 };
  const frame = { scale, hq };
  const youAt = project(frame, spot.lat, spot.lng);

  // The signal arcs upward between the two.
  const mx = (youAt.x + hq.x) / 2;
  const my = (youAt.y + hq.y) / 2;
  const len = Math.hypot(hq.x - youAt.x, hq.y - youAt.y) || 1;
  let nx = -(hq.y - youAt.y) / len;
  let ny = (hq.x - youAt.x) / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const ctrl = { x: mx + nx * len * 0.2, y: my + ny * len * 0.2 };

  const hqBlockAbove = pinBelow;
  const blockY0 = hqBlockAbove ? hq.y - 44 : hq.y + 15;
  const taken: Box[] = [
    CLOSE_CORNER,
    { x0: hq.x - 15, y0: hq.y - 15, x1: hq.x + 15, y1: hq.y + 15 },
    { x0: hq.x - hqHalfW, y0: blockY0, x1: hq.x + hqHalfW, y1: blockY0 + 29 },
  ];
  if (home) {
    const tw = labelWidth(youHereLabel, 9.5, 0.62) + 14;
    taken.push({ x0: hq.x - tw / 2, y0: hq.y - 38, x1: hq.x + tw / 2, y1: hq.y - 20 });
  }
  let pill = bezier(youAt, ctrl, hq, 0.5);
  if (!home) {
    taken.push({ x0: youAt.x - 12, y0: youAt.y - 28, x1: youAt.x + 12, y1: youAt.y + youDown });
    taken.push({ x0: youAt.x - youHalfW, y0: youAt.y - youUp, x1: youAt.x + youHalfW, y1: youAt.y - 28 });
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66]) {
      const at = bezier(youAt, ctrl, hq, t);
      if (!taken.some((b) => overlaps(b, { x0: at.x - 25, y0: at.y - 10, x1: at.x + 25, y1: at.y + 10 }))) {
        pill = at;
        break;
      }
    }
    taken.push({ x0: pill.x - 25, y0: pill.y - 10, x1: pill.x + 25, y1: pill.y + 10 });
    // Nothing written across the signal.
    const steps = Math.ceil(len / 6);
    for (let i = 1; i < steps; i++) {
      const at = bezier(youAt, ctrl, hq, i / steps);
      taken.push({ x0: at.x - 3, y0: at.y - 3, x1: at.x + 3, y1: at.y + 3 });
    }
  }

  const fits = (b: Box) => b.x0 >= SAFE.x0 && b.x1 <= SAFE.x1 && b.y0 >= 2 && b.y1 <= H - 40 && !taken.some((t) => overlaps(t, b));

  let borderTag: Plan["borderTag"] = null;
  for (const pair of BORDER_TAGS) {
    const mg = project(frame, pair.mg[0], pair.mg[1]);
    const sp = project(frame, pair.sp[0], pair.sp[1]);
    const mgBox = { x0: mg.x - 10, y0: mg.y - 8, x1: mg.x + 10, y1: mg.y + 3 };
    const spBox = { x0: sp.x - 10, y0: sp.y - 8, x1: sp.x + 10, y1: sp.y + 3 };
    if (fits(mgBox) && fits(spBox)) {
      taken.push(mgBox, spBox);
      borderTag = { mg, sp };
      break;
    }
  }

  const townLabels = new Map<string, "start" | "end">();
  for (const name of LABEL_PRIORITY) {
    if (townLabels.size >= MAX_TOWN_LABELS) break;
    const town = REGIONAL_TOWNS_ALL.find((t) => t.name === name);
    if (!town) continue;
    // The pin already marks the visitor's own town.
    if (!home && distanceKm(town, spot) < 6) continue;
    const at = project(frame, town.lat, town.lng);
    const w = labelWidth(name, 9.5, 0.55);
    const sides = at.x > hq.x ? (["start", "end"] as const) : (["end", "start"] as const);
    for (const anchor of sides) {
      const x0 = anchor === "start" ? at.x + 5 : at.x - 5 - w;
      const box = { x0, y0: at.y - 8, x1: x0 + w, y1: at.y + 4 };
      if (!fits(box)) continue;
      taken.push(box);
      townLabels.set(name, anchor);
      break;
    }
  }

  return { frame, youAt, ctrl, pill, hqBlockAbove, borderTag, townLabels };
}

function ringPath(frame: Frame, ring: number[]): string {
  let d = "";
  for (let i = 0; i < ring.length; i += 2) {
    const p = project(frame, ring[i], ring[i + 1]);
    d += `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return `${d}Z`;
}

function RegionalMap({
  spot,
  home,
  km,
  youLabel,
  youHereLabel,
  coords,
  oceanLabel,
}: {
  spot: RegionalSpot;
  home: boolean;
  km: number;
  youLabel: string;
  youHereLabel: string;
  coords: string;
  oceanLabel: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hqName = "Santa Rita do Sapucaí";
  const plan = useMemo(() => planMap(spot, home, youLabel, youHereLabel, hqName, coords), [spot, home, youLabel, youHereLabel, coords]);

  // Zoom progress, 0 (wide) to 1 (landed).
  const [progress, setProgress] = useState(0);
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMotion(false);
      setProgress(1);
      return;
    }
    let raf = 0;
    const start = performance.now() + ZOOM_DELAY_MS;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ZOOM_MS));
      setProgress(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const e = easeInOutCubic(progress);
  const arrived = progress >= 1;
  // Scale interpolated geometrically (a zoom feels even that way), centre linearly.
  const frame: Frame = {
    scale: START_SCALE * (plan.frame.scale / START_SCALE) ** e,
    hq: {
      x: W / 2 + (plan.frame.hq.x - W / 2) * e,
      y: H / 2 - 8 + (plan.frame.hq.y - (H / 2 - 8)) * e,
    },
  };
  const hq = frame.hq;
  const wideOpacity = 1 - smoothstep(0.2, 0.65, e);

  // 0.5° graticule, like a road atlas.
  const latLines: number[] = [];
  for (let lat = -24; lat <= -20; lat += 0.5) latLines.push(project(frame, lat, REGIONAL_HQ.lng).y);
  const lngLines: number[] = [];
  for (let lng = -50; lng <= -41.5; lng += 0.5) lngLines.push(project(frame, REGIONAL_HQ.lat, lng).x);

  const kmText = km < 20 ? `${Math.round(km)} km` : `~${Math.round(km / 5) * 5} km`;
  const route = `M${plan.youAt.x.toFixed(1)} ${plan.youAt.y.toFixed(1)} Q${plan.ctrl.x.toFixed(1)} ${plan.ctrl.y.toFixed(1)} ${plan.frame.hq.x.toFixed(1)} ${plan.frame.hq.y.toFixed(1)}`;
  const youPillW = labelWidth(youLabel, 9.5, 0.62) + 14;
  const hereW = labelWidth(youHereLabel, 9.5, 0.62) + 14;
  const blockY = plan.hqBlockAbove ? hq.y - 30 : hq.y + 27;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="block h-[196px] w-full" aria-hidden="true">
      <defs>
        <pattern id={`${uid}-water`} width="6" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 2 H6" stroke="#b5cbd2" strokeWidth="0.7" />
        </pattern>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.78" stopColor={PAPER} stopOpacity="0" />
          <stop offset="1" stopColor={PAPER} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Sea, land, borders */}
      <rect width={W} height={H} fill={WATER} />
      <rect width={W} height={H} fill={`url(#${uid}-water)`} />
      {REGIONAL_STATES.map((state) => (
        <path
          key={state.uf}
          d={state.rings.map((ring) => ringPath(frame, ring)).join("")}
          fill={STATE_FILL[state.uf] ?? "#e8e1cd"}
          stroke="#a99d83"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      ))}
      {latLines.map((y, i) => (
        <line key={`la${i}`} x1="0" x2={W} y1={y} y2={y} stroke={INK} strokeOpacity="0.06" strokeWidth="0.6" />
      ))}
      {lngLines.map((x, i) => (
        <line key={`ln${i}`} y1="0" y2={H} x1={x} x2={x} stroke={INK} strokeOpacity="0.06" strokeWidth="0.6" />
      ))}

      {/* The opening view's context */}
      {wideOpacity > 0.01 && (
        <g opacity={wideOpacity}>
          {STATE_LABELS.map((s) => {
            const p = project(frame, s.lat, s.lng);
            return (
              <text key={s.name} x={p.x} y={p.y} textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="3" fill={INK} fillOpacity="0.28">
                {s.name}
              </text>
            );
          })}
          {(() => {
            const p = project(frame, OCEAN_AT.lat, OCEAN_AT.lng);
            return (
              <text x={p.x} y={p.y} textAnchor="middle" fontSize="9.5" fontStyle="italic" letterSpacing="1.5" fill="#5f8794">
                {oceanLabel}
              </text>
            );
          })()}
          {CONTEXT_CITIES.map((c) => {
            const p = project(frame, c.lat, c.lng);
            return (
              <g key={c.name}>
                <circle cx={p.x} cy={p.y} r="2.6" fill={INK} />
                <text x={p.x + 5} y={p.y + 3.5} fontSize="10" fontWeight="600" fill={INK} stroke={PAPER} strokeWidth="2.5" paintOrder="stroke">
                  {c.name}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* The region */}
      <circle cx={hq.x} cy={hq.y} r={REGIONAL_RADIUS_KM * frame.scale} fill={BRAND} fillOpacity="0.07" stroke={BRAND} strokeOpacity="0.7" strokeWidth="1.1" strokeDasharray="4 3" />
      {REGIONAL_TOWNS_ALL.map((town) => {
        const p = project(frame, town.lat, town.lng);
        if (p.x < -4 || p.x > W + 4 || p.y < -4 || p.y > H + 4) return null;
        const anchor = arrived ? plan.townLabels.get(town.name) : undefined;
        return (
          <g key={town.name}>
            <circle cx={p.x} cy={p.y} r="1.5" fill={INK} fillOpacity={anchor ? 0.75 : 0.32} />
            {anchor && (
              <text
                x={anchor === "start" ? p.x + 5 : p.x - 5}
                y={p.y + 3.2}
                textAnchor={anchor}
                fontSize="9.5"
                fontWeight="500"
                fill={INK}
                fillOpacity="0.72"
                stroke={STATE_FILL.MG}
                strokeWidth="2.5"
                paintOrder="stroke"
                className="rg-in"
              >
                {town.name}
              </text>
            )}
          </g>
        );
      })}
      {arrived && plan.borderTag && (
        <g className="rg-in" fontSize="8.5" fontWeight="700" letterSpacing="2" fill={INK} fillOpacity="0.38" textAnchor="middle">
          <text x={plan.borderTag.mg.x} y={plan.borderTag.mg.y}>MG</text>
          <text x={plan.borderTag.sp.x} y={plan.borderTag.sp.y}>SP</text>
        </g>
      )}

      {/* The signal, from the visitor to Santa Rita */}
      {arrived && !home && (
        <>
          <path d={route} fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" pathLength={1} className="rg-draw" />
          {motion && (
            <circle r="3.2" fill="#ffffff" stroke={BRAND} strokeWidth="1.6" className="rg-in-late">
              <animateMotion dur="2.2s" repeatCount="indefinite" path={route} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" />
            </circle>
          )}
          <g className="rg-in-late">
            <rect x={plan.pill.x - 24} y={plan.pill.y - 9.5} width="48" height="19" rx="9.5" fill={PAPER} stroke={INK} strokeWidth="1.1" />
            <text x={plan.pill.x} y={plan.pill.y + 3.6} textAnchor="middle" fontSize="10" fontWeight="700" fill={INK} className="font-mono">
              {kmText}
            </text>
          </g>
        </>
      )}

      {/* Santa Rita: the "o" of the shirt's GoLive, broadcasting */}
      <circle cx={hq.x} cy={hq.y} r="11" fill="none" stroke={BRAND} strokeWidth="1.6" className="rg-pulse" />
      <circle cx={hq.x} cy={hq.y} r="11" fill="none" stroke={BRAND} strokeWidth="1.6" className="rg-pulse rg-pulse-2" />
      <g transform={`translate(${hq.x} ${hq.y})`}>
        <circle r="12.5" fill={LOGO_BLUE} stroke={PAPER} strokeWidth="2.5" />
        <MonitorGlyph size={12.5} />
      </g>
      <g textAnchor="middle">
        <text x={hq.x} y={blockY} fontSize="10.5" fontWeight="800" fill={INK} stroke={PAPER} strokeWidth="3" paintOrder="stroke">
          {hqName}
        </text>
        <text x={hq.x} y={blockY + 11} fontSize="8" fill={INK} fillOpacity="0.6" stroke={PAPER} strokeWidth="2.5" paintOrder="stroke" className="font-mono">
          {coords}
        </text>
      </g>
      {home && arrived && (
        <g transform={`translate(${hq.x} ${hq.y - 29})`}>
          <g className="rg-drop">
            <rect x={-hereW / 2} y="-8.5" width={hereW} height="17" rx="8.5" fill={INK} />
            <text y="3.4" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#ffffff">
              {youHereLabel}
            </text>
          </g>
        </g>
      )}

      {/* The visitor */}
      {arrived && !home && (
        <g transform={`translate(${plan.youAt.x} ${plan.youAt.y})`}>
          <g className="rg-drop">
            <ellipse cx="0" cy="0" rx="5" ry="1.8" fill={INK} fillOpacity="0.3" />
            <path d="M0 0 C-2 -6 -8.5 -10 -8.5 -16.5 A8.5 8.5 0 1 1 8.5 -16.5 C8.5 -10 2 -6 0 0 Z" fill={INK} />
            <circle cx="0" cy="-16.5" r="3.3" fill={PAPER} />
            <g transform="translate(0 -37)">
              <rect x={-youPillW / 2} y="-8.5" width={youPillW} height="17" rx="8.5" fill={INK} />
              <text y="3.4" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#ffffff">
                {youLabel}
              </text>
            </g>
          </g>
        </g>
      )}

      <rect width={W} height={H} fill={`url(#${uid}-fade)`} pointerEvents="none" />
    </svg>
  );
}

/** The white monitor inside the blue "o", centred on 0,0 for a circle of radius r. */
function MonitorGlyph({ size }: { size: number }) {
  const r = size;
  return (
    <g fill="none" stroke="#ffffff" strokeWidth={r * 0.13} strokeLinejoin="round">
      <rect x={-r * 0.46} y={-r * 0.42} width={r * 0.92} height={r * 0.62} rx={r * 0.08} />
      <path d={`M0 ${r * 0.2} V${r * 0.36} M${-r * 0.24} ${r * 0.42} H${r * 0.24}`} strokeLinecap="round" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// The shirt (black, with the small GoLive mark on the chest)

/** "G", the blue "o" with its monitor, "Live" — as on the shirt. Baseline at y; x is the left edge, or the centre. */
function Wordmark({ x, y, size, centered = false }: { x: number; y: number; size: number; centered?: boolean }) {
  const gW = size * 0.76;
  const d = size * 0.64;
  const gap = size * 0.05;
  // Widths pinned with textLength: whatever sans the device has, the "o" sits where it should.
  const liveW = size * 1.95;
  const total = gW + gap + d + gap + liveW;
  const x0 = centered ? x - total / 2 : x;
  const cx = x0 + gW + gap + d / 2;
  const cy = y - d / 2 - size * 0.01;
  return (
    <g fontFamily="Helvetica, Arial, sans-serif" fontWeight="700" fontSize={size} fill="#f1f1f1">
      <text x={x0} y={y} textLength={gW} lengthAdjust="spacingAndGlyphs">
        G
      </text>
      <g transform={`translate(${cx} ${cy})`}>
        <circle r={d / 2} fill={LOGO_BLUE} />
        <MonitorGlyph size={d / 2} />
      </g>
      <text x={x0 + gW + gap + d + gap} y={y} textLength={liveW} lengthAdjust="spacingAndGlyphs">
        Live
      </text>
    </g>
  );
}

const SHIRT_PATH = "M54 30 C59 41 81 41 86 30 L118 40 L138 70 L120 82 L107 68 L106 157 Q70 161 34 157 L33 68 L20 82 L2 70 L22 40 Z";

function GoLiveShirt({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="-2 -2 144 170" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-side`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.6" />
          <stop offset="0.24" stopColor="#000" stopOpacity="0" />
          <stop offset="0.76" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={SHIRT_PATH} />
        </clipPath>
      </defs>
      <g className="rg-swing">
        {/* Hanger */}
        <path d="M70 26 V15 C70 11 73 9 75.5 6.5 C78.5 3.5 76.5 -0.5 72.5 0 C69.5 0.4 68.5 2.5 68.5 4.5" fill="none" stroke="#8d8577" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M70 24 L23 39.5 Q19.5 41.5 23.5 42.5 L116.5 42.5 Q120.5 41.5 117 39.5 Z" fill="none" stroke="#8d8577" strokeWidth="2.4" strokeLinejoin="round" />
        {/* Shirt */}
        <path d={SHIRT_PATH} fill="#151515" />
        <g clipPath={`url(#${uid}-clip)`}>
          <rect x="0" y="20" width="140" height="150" fill={`url(#${uid}-side)`} />
          <rect x="0" y="20" width="140" height="150" fill={`url(#${uid}-top)`} />
          <path d="M42 72 C52 98 50 126 45 156" stroke="#ffffff" strokeOpacity="0.045" strokeWidth="7" fill="none" />
          <path d="M98 76 C91 102 94 130 99 156" stroke="#000000" strokeOpacity="0.35" strokeWidth="6" fill="none" />
          <path d="M33 68 L20 82" stroke="#000000" strokeOpacity="0.3" strokeWidth="3" />
          <path d="M107 68 L120 82" stroke="#000000" strokeOpacity="0.3" strokeWidth="3" />
        </g>
        <path d="M54 30 C59 41 81 41 86 30" fill="none" stroke="#2c2c2c" strokeWidth="3.4" />
        {/* The mark on the chest (the wearer's left) */}
        <Wordmark x={77} y={62} size={7} />
        {/* Loupe on it */}
        <path d="M97 63 L108 95" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1" />
        <g transform="translate(110 119)">
          <circle r="26" fill="#151515" stroke="#ffffff" strokeWidth="2.6" />
          <Wordmark x={0} y={4.5} size={11.5} centered />
        </g>
      </g>
    </svg>
  );
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The card

export function RegionalPopupCard({
  spot,
  signedIn,
  returnTo,
  preview,
  onClose,
}: {
  spot: RegionalSpot;
  signedIn: boolean;
  returnTo: string;
  /** An admin's ?regional=preview: nothing is counted. */
  preview: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  const km = distanceKm(spot, REGIONAL_HQ);
  const home = km < REGIONAL_HOME_KM;
  const town = home ? null : guessTown(spot);

  // Every popup event carries where it was seen — city and system — so the
  // numbers cross ("on a phone in Taubaté"); the API adds the platform. The
  // feature declares these in its attributes (clientTags).
  const tags = useMemo(
    () => ({ city: regionalCitySlug(home ? "Santa Rita do Sapucaí" : town), os: operatingSystem() }),
    [home, town]
  );
  const track = (name: string, value?: number) => {
    if (!preview) trackRegional(name, value, tags);
  };

  // How it ended, for the numbers: seconds open on every way out, a try to
  // close during the lock, and leaving the page with it still open.
  const openedAt = useRef(0);
  const acted = useRef(false);
  const triedEarly = useRef(false);
  const secondsOpen = () => Math.max(1, Math.round((Date.now() - openedAt.current) / 1000));
  const finish = (name: string) => {
    acted.current = true;
    track(name, secondsOpen());
  };
  const tooEarly = () => {
    if (triedEarly.current) return;
    triedEarly.current = true;
    track(REGIONAL_EVENTS.early);
  };
  useEffect(() => {
    // Capture: runs before lib/features' own pagehide flush, so this event
    // still goes out with it.
    const onHide = () => {
      if (acted.current) return;
      acted.current = true;
      track(REGIONAL_EVENTS.left, secondsOpen());
    };
    openedAt.current = Date.now();
    window.addEventListener("pagehide", onHide, { capture: true });
    return () => window.removeEventListener("pagehide", onHide, { capture: true });
    // Reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The opening itself (value = km to Santa Rita), here rather than in
  // RegionalPopup so it carries the attributes too.
  const shownRef = useRef(false);
  useEffect(() => {
    // Once, even when effects run twice (React's dev double-invoke).
    if (shownRef.current) return;
    shownRef.current = true;
    track(REGIONAL_EVENTS.show, Math.max(1, Math.round(km)));
    // Counted for the popup's one opening, not on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      armedRef.current = true;
      setArmed(true);
    }, CLOSE_LOCK_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    if (!armedRef.current) {
      tooEarly();
      return;
    }
    finish(REGIONAL_EVENTS.close);
    onClose();
  };

  useEffect(() => {
    // The dialog itself, not "Combinado!": Enter on a focused button would
    // close it the moment it opens.
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // dismiss only reads refs and stable props; the listener is set once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = async () => {
    track(REGIONAL_EVENTS.share);
    const text = t("regional.shareText");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text, url: SITE_URL });
        return;
      }
    } catch {
      // Cancelled, or the sheet is not allowed here: nothing else to do.
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${SITE_URL}`)}`, "_blank", "noopener,noreferrer");
  };

  const kmRounded = km < 20 ? Math.round(km) : Math.round(km / 5) * 5;
  const title = home ? t("regional.titleHome") : town ? t("regional.titleTown", { town }) : t("regional.title");

  return (
    <div
      className="rg-root fixed inset-0 z-[95] flex items-end justify-center bg-black/60 p-3 backdrop-blur-[2px] sm:items-center"
      onClick={dismiss}
      role="presentation"
    >
      <style>{KEYFRAMES}</style>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rg-title"
        aria-describedby="rg-text"
        onClick={(e) => e.stopPropagation()}
        className="rg-pop-in relative max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-[18px] shadow-[0_30px_90px_rgba(0,0,0,0.55)] outline-none"
        style={{ background: PAPER, color: INK }}
      >
        <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.35] mix-blend-multiply" style={{ backgroundImage: GRAIN }} aria-hidden="true" />

        <RegionalMap
          spot={spot}
          home={home}
          km={km}
          youLabel={t("regional.you")}
          youHereLabel={t("regional.youHere")}
          coords={t("regional.coords")}
          oceanLabel={t("regional.ocean")}
        />

        <div className="relative px-5 pb-5">
          <h2 id="rg-title" className="mt-1 text-[25px] font-extrabold leading-[1.08] tracking-[-0.02em]" style={{ fontFamily: DISPLAY_FONT }}>
            {title}
          </h2>
          <p id="rg-text" className="mt-2.5 text-[15px] leading-relaxed" style={{ color: "#4a4337" }}>
            {home ? t("regional.textHome") : t("regional.text", { km: kmRounded })}
          </p>

          {/* Who made it: a credit, not the voice of the card */}
          <div className="mt-4 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/aniversario/equipe/nemtudo.jpg"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-full object-cover"
              style={{ boxShadow: `0 0 0 2px ${PAPER}, 0 0 0 3.5px ${INK}` }}
            />
            <div className="min-w-0 text-[13.5px] leading-snug">
              <p style={{ color: MUTED }}>
                <b className="font-bold" style={{ color: INK }}>
                  {t("regional.authorName")}
                </b>{" "}
                {t("regional.authorRole")}
              </p>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("regional.instagram")}
                onClick={() => track(REGIONAL_EVENTS.instagram)}
                className="mt-0.5 inline-flex items-center gap-1.5 font-semibold underline-offset-2 hover:underline"
              >
                <InstagramGlyph className="h-[14px] w-[14px]" />
                @onemtudo
              </a>
            </div>
          </div>

          {/* The shirt */}
          <div className="mt-5 border-t-[1.5px] border-dashed pt-4" style={{ borderColor: "rgba(26,23,18,0.22)" }}>
            <div className="flex items-center gap-2">
              <GoLiveShirt className="w-[124px] shrink-0 drop-shadow-[0_8px_10px_rgba(40,30,10,0.18)]" />
              <div className="min-w-0">
                <p className="text-[17px] font-extrabold leading-snug" style={{ fontFamily: DISPLAY_FONT }}>
                  {t("regional.shirtTitle")}
                </p>
                <p className="mt-1 text-[13.5px] leading-snug" style={{ color: MUTED }}>
                  {t("regional.shirtText")}
                </p>
                <div
                  className="rg-slap mt-3 inline-flex items-center gap-2 rounded-[10px] py-1.5 pl-1.5 pr-3 text-white"
                  style={{ background: RUBY, boxShadow: "0 0 0 3px #ffffff, 0 8px 18px rgba(60,20,10,0.25)" }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
                    <RubyVerifiedBadgeIcon className="h-5 w-5" />
                  </span>
                  <span className="leading-none">
                    <b className="block text-[15px] font-extrabold" style={{ fontFamily: DISPLAY_FONT }}>
                      {t("regional.prize")}
                    </b>
                    <span className="mt-0.5 block text-[10.5px] font-bold uppercase tracking-[0.14em] opacity-90">{t("regional.prizeFree")}</span>
                  </span>
                </div>
              </div>
            </div>
            {!signedIn && (
              <p className="mt-3 text-[12.5px] leading-snug" style={{ color: MUTED }}>
                {t("regional.giftNeedsAccount")}{" "}
                <Link
                  href={`/login?next=${encodeURIComponent(returnTo)}`}
                  onClick={() => {
                    finish(REGIONAL_EVENTS.login);
                    onClose();
                  }}
                  className="font-semibold underline underline-offset-2"
                  style={{ color: INK }}
                >
                  {t("regional.giftLogin")}
                </Link>
              </p>
            )}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              // aria-disabled, not disabled: a disabled button swallows the
              // click, and an early press is something worth counting.
              aria-disabled={!armed}
              onClick={() => {
                if (!armedRef.current) {
                  tooEarly();
                  return;
                }
                finish(REGIONAL_EVENTS.ok);
                onClose();
              }}
              className="relative flex-1 overflow-hidden rounded-xl px-4 py-3 text-sm font-bold text-white outline-offset-2 transition hover:opacity-90 aria-disabled:cursor-default aria-disabled:hover:opacity-100"
              style={{ background: armed ? INK : "#b9b09d" }}
            >
              {!armed && <span className="rg-lock rg-lock-fill absolute inset-0" style={{ background: INK }} aria-hidden="true" />}
              <span className="relative">{t("regional.ok")}</span>
            </button>
            <button
              type="button"
              onClick={() => void share()}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-bold transition hover:bg-black/5"
              style={{ boxShadow: `inset 0 0 0 1.5px ${INK}` }}
            >
              {t("regional.share")}
            </button>
          </div>
          <div className="mt-3 text-center">
            <Link
              href="/pro"
              onClick={() => {
                finish(REGIONAL_EVENTS.pro);
                onClose();
              }}
              className="text-[12.5px] underline-offset-2 transition hover:underline"
              style={{ color: MUTED }}
            >
              {t("regional.proLink")}
            </Link>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-disabled={!armed}
          aria-label={t("regional.close")}
          className="absolute right-2.5 top-2.5 z-[2] flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-white transition hover:opacity-85 aria-disabled:cursor-default aria-disabled:hover:opacity-100"
          style={{ background: INK }}
        >
          {!armed && (
            <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2" />
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="#ffffff" strokeWidth="2" pathLength={1} strokeDasharray="1" strokeLinecap="round" className="rg-lock rg-lock-ring" />
            </svg>
          )}
          <span aria-hidden="true" className={armed ? undefined : "opacity-40"}>
            ×
          </span>
        </button>
      </div>
    </div>
  );
}
