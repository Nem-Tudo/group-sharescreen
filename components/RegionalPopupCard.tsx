"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { RubyVerifiedBadgeIcon } from "@/components/icons";
import { SITE_URL } from "@/lib/seo";
import {
  REGIONAL_EVENTS,
  REGIONAL_HOME_KM,
  REGIONAL_HQ,
  REGIONAL_RADIUS_KM,
  REGIONAL_TOWNS,
  distanceKm,
  guessTown,
  trackRegional,
  type RegionalSpot,
} from "@/lib/regional";

// The card of the regional popup (RegionalPopup decides whether it opens).
// A night radar centred on Santa Rita do Sapucaí, where the Go Live logo
// sits; the visitor's pin drops in and a signal line runs from it to the
// logo. Below: who makes Go Live, and the shirt deal as a Pro Ultra ticket.

/**
 * How long it cannot be closed (✕, Esc, a click outside, "Combinado!"): a
 * click or tap aimed at the page underneath, a reflex Esc or an Enter would
 * throw it away unread, and it is shown only once. The ✕ and the button fill
 * up while it lasts, so nobody thinks they are broken.
 */
const CLOSE_LOCK_MS = 3000;

const KEYFRAMES = `
@keyframes rg-pop-in { from { opacity: 0; transform: translateY(28px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes rg-pulse { 0% { transform: scale(0.5); opacity: 0.85; } 100% { transform: scale(3.2); opacity: 0; } }
@keyframes rg-drop { 0% { transform: translateY(-46px); opacity: 0; } 55% { transform: translateY(3px); opacity: 1; } 75% { transform: translateY(-3px); } 100% { transform: none; opacity: 1; } }
@keyframes rg-march { to { stroke-dashoffset: -14; } }
@keyframes rg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rg-shine { 0%, 60% { transform: translateX(-140%) skewX(-18deg); } 100% { transform: translateX(340%) skewX(-18deg); } }
@keyframes rg-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
@keyframes rg-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
.rg-pop-in { animation: rg-pop-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.rg-pulse { transform-box: fill-box; transform-origin: center; animation: rg-pulse 2.6s ease-out infinite; }
.rg-pulse-2 { animation-delay: 1.3s; }
.rg-drop { transform-box: fill-box; transform-origin: bottom; animation: rg-drop 0.75s 0.45s cubic-bezier(0.3, 1.2, 0.5, 1) both; }
.rg-march { animation: rg-march 0.8s linear infinite, rg-fade 0.4s 1s both; }
.rg-late { animation: rg-fade 0.45s 1.15s both; }
.rg-shine { animation: rg-shine 4s 1.4s ease-in-out infinite; }
.rg-sway { transform-origin: 50% 6%; animation: rg-sway 3.4s ease-in-out infinite; }
.rg-blink { animation: rg-blink 1.1s ease-in-out infinite; }
@keyframes rg-lock-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes rg-lock-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.rg-lock-fill { transform-origin: left; animation: rg-lock-fill ${CLOSE_LOCK_MS}ms linear both; }
.rg-lock-ring { animation: rg-lock-ring ${CLOSE_LOCK_MS}ms linear both; }
@media (prefers-reduced-motion: reduce) {
  /* The lock's progress is a timer, not motion: it keeps its real length. */
  .rg-root, .rg-root *:not(.rg-lock) { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; }
}
`;

const CARD_BG = "#0a0e18";
const BRAND = "#1a9bff";
const PIN = "#fbbf24";

// ---------------------------------------------------------------------------
// The map

const W = 420;
const H = 176;
/** Visible on every card width ("slice" crops ~27 units off each side on a phone), above the bottom fade. */
const SAFE = { x0: 30, x1: W - 30, y0: 8, y1: 150 };
/** Where the card's ✕ sits over the map: no town names under it. */
const CLOSE_CORNER = { x0: W - 82, y0: 0, x1: W, y1: 48 };
const RAD = Math.PI / 180;

type Box = { x0: number; y0: number; x1: number; y1: number };

function overlaps(a: Box, b: Box) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Km east/north of Santa Rita, for a point. */
function offsetKm(p: { lat: number; lng: number }) {
  return {
    east: (p.lng - REGIONAL_HQ.lng) * Math.cos(REGIONAL_HQ.lat * RAD) * 111.32,
    north: (p.lat - REGIONAL_HQ.lat) * 110.57,
  };
}

/** Mono 9px, roughly. Good enough to keep labels from piling up. */
const labelWidth = (text: string, size: number) => text.length * size * 0.6;

function RegionalMap({ spot, home, km, youLabel, hqLabel }: { spot: RegionalSpot; home: boolean; km: number; youLabel: string; hqLabel: string }) {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    // The sweep is SMIL, which ignores prefers-reduced-motion on its own.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const layout = useMemo(() => {
    const you = offsetKm(spot);
    const youKm = Math.hypot(you.east, you.north);
    // The logo's name goes on the side away from the pin.
    const pinBelow = !home && you.north < 0;
    // How far each end reaches around its own point: the logo with its name,
    // the pin with its label on top.
    const hqUp = pinBelow ? 31 : 16;
    const hqDown = pinBelow ? 16 : 29;
    const hqHalfW = Math.max(16, labelWidth(hqLabel, 10) / 2 + 4);
    const youUp = 46;
    const youDown = 4;
    const youHalfW = (labelWidth(youLabel, 9.5) + 14) / 2 + 2;

    // Zoomed so the pin sits at least ~110 units from the logo (room for the
    // distance between them), ~95 km each side when that is already true —
    // and never so close that the pair stops fitting.
    let scale = 2.2;
    if (!home) {
      const wanted = Math.max(2.2, 110 / Math.max(youKm, 1));
      const fitV = (SAFE.y1 - SAFE.y0 - (pinBelow ? hqUp + youDown : youUp + hqDown)) / Math.max(Math.abs(you.north), 0.001);
      const fitH = (SAFE.x1 - SAFE.x0 - hqHalfW - youHalfW) / Math.max(Math.abs(you.east), 0.001);
      scale = Math.min(wanted, fitV, fitH);
    }

    // The pair (logo + pin, with their labels) centred in the safe area.
    const dx = home ? 0 : you.east * scale;
    const dy = home ? 0 : -you.north * scale;
    const top = Math.min(-hqUp, home ? 0 : dy - youUp);
    const bottom = Math.max(hqDown, home ? 0 : dy + youDown);
    const left = Math.min(-hqHalfW, home ? 0 : dx - youHalfW);
    const right = Math.max(hqHalfW, home ? 0 : dx + youHalfW);
    const hq = {
      x: (SAFE.x0 + SAFE.x1) / 2 - (left + right) / 2,
      y: (SAFE.y0 + SAFE.y1) / 2 - (top + bottom) / 2,
    };
    const project = (p: { lat: number; lng: number }) => {
      const o = offsetKm(p);
      return { x: hq.x + o.east * scale, y: hq.y - o.north * scale };
    };
    const youAt = project(spot);
    const hqLabelY = pinBelow ? hq.y - 19 : hq.y + 25;

    const taken: Box[] = [
      CLOSE_CORNER,
      { x0: hq.x - 16, y0: hq.y - 16, x1: hq.x + 16, y1: hq.y + 16 },
      { x0: hq.x - hqHalfW, y0: hqLabelY - 11, x1: hq.x + hqHalfW, y1: hqLabelY + 4 },
    ];
    // The distance rides the signal line, wherever along it nothing else is.
    let pill = { x: (youAt.x + hq.x) / 2, y: (youAt.y + hq.y) / 2 };
    if (!home) {
      taken.push({ x0: youAt.x - 12, y0: youAt.y - 28, x1: youAt.x + 12, y1: youAt.y + youDown });
      taken.push({ x0: youAt.x - youHalfW, y0: youAt.y - youUp, x1: youAt.x + youHalfW, y1: youAt.y - 28 });
      for (const t of [0.5, 0.42, 0.58, 0.34, 0.66]) {
        const at = { x: hq.x + (youAt.x - hq.x) * t, y: hq.y + (youAt.y - hq.y) * t };
        if (!taken.some((b) => overlaps(b, { x0: at.x - 24, y0: at.y - 10, x1: at.x + 24, y1: at.y + 10 }))) {
          pill = at;
          break;
        }
      }
      taken.push({ x0: pill.x - 24, y0: pill.y - 10, x1: pill.x + 24, y1: pill.y + 10 });
      // No town name written across the signal line.
      const steps = Math.ceil(Math.hypot(youAt.x - hq.x, youAt.y - hq.y) / 6);
      for (let i = 1; i < steps; i++) {
        const x = hq.x + ((youAt.x - hq.x) * i) / steps;
        const y = hq.y + ((youAt.y - hq.y) * i) / steps;
        taken.push({ x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 });
      }
    }

    const towns: { name: string; x: number; y: number; label: null | { x: number; anchor: "start" | "end" } }[] = [];
    let labels = 0;
    for (const town of REGIONAL_TOWNS) {
      const at = project(town);
      if (at.x < 4 || at.x > W - 4 || at.y < 4 || at.y > H - 4) continue;
      // The pin (or the logo) already marks this place.
      if (!home && distanceKm(town, spot) < 6) continue;
      if (distanceKm(town, REGIONAL_HQ) < 4) continue;
      const w = labelWidth(town.name, 9);
      // Names lean away from the logo, unless that side is taken.
      const sides = at.x > hq.x ? (["start", "end"] as const) : (["end", "start"] as const);
      let label: (typeof towns)[number]["label"] = null;
      if (labels < 6) {
        for (const anchor of sides) {
          const x0 = anchor === "start" ? at.x + 5 : at.x - 5 - w;
          const box = { x0, y0: at.y - 8, x1: x0 + w, y1: at.y + 4 };
          if (box.x0 < SAFE.x0 || box.x1 > SAFE.x1 || box.y0 < 2 || box.y1 > H - 8) continue;
          if (taken.some((b) => overlaps(b, box))) continue;
          taken.push(box);
          label = { x: anchor === "start" ? at.x + 5 : at.x - 5, anchor };
          labels += 1;
          break;
        }
      }
      towns.push({ name: town.name, x: at.x, y: at.y, label });
    }
    return { scale, hq, youAt, pill, towns, hqLabelY };
  }, [spot, home, youLabel, hqLabel]);

  const { scale, hq, youAt, pill, towns, hqLabelY } = layout;
  const regionR = REGIONAL_RADIUS_KM * scale;
  const rings = [25, 50, 75].map((r) => r * scale).filter((r) => r > 14);
  // The sweep: thin slices fading behind a bright leading edge (SVG has no conic gradient).
  const SLICES = 14;
  const sweepR = Math.max(regionR, 60);
  const slice = (i: number) => {
    const a0 = i * 4 * RAD;
    const a1 = (i + 1) * 4 * RAD + 0.004;
    return `M0 0 L${sweepR * Math.cos(a0)} ${sweepR * Math.sin(a0)} A${sweepR} ${sweepR} 0 0 1 ${sweepR * Math.cos(a1)} ${sweepR * Math.sin(a1)} Z`;
  };
  const kmText = km < 20 ? `${Math.round(km)} km` : `~${Math.round(km / 5) * 5} km`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="block h-40 w-full sm:h-44" aria-hidden="true">
      <defs>
        <radialGradient id="rg-bg" cx="50%" cy="48%" r="70%">
          <stop offset="0" stopColor="#13213a" />
          <stop offset="0.6" stopColor="#0b1222" />
          <stop offset="1" stopColor={CARD_BG} />
        </radialGradient>
        <pattern id="rg-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#ffffff" fillOpacity="0.07" />
        </pattern>
        <linearGradient id="rg-fade-bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.82" stopColor={CARD_BG} stopOpacity="0" />
          <stop offset="1" stopColor={CARD_BG} stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#rg-bg)" />
      <rect width={W} height={H} fill="url(#rg-dots)" />

      {/* The region (100 km) and the rings inside it */}
      <circle cx={hq.x} cy={hq.y} r={regionR} fill={BRAND} fillOpacity="0.05" stroke={BRAND} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 4" />
      {rings.map((r) => (
        <circle key={r} cx={hq.x} cy={hq.y} r={r} fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1" />
      ))}

      {motion && (
        <g transform={`translate(${hq.x} ${hq.y})`}>
          <g>
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="5.5s" repeatCount="indefinite" />
            {Array.from({ length: SLICES }, (_, i) => (
              <path key={i} d={slice(i)} fill={BRAND} fillOpacity={((i + 1) / SLICES) * 0.16} />
            ))}
            <line x1="0" y1="0" x2={sweepR * Math.cos(SLICES * 4 * RAD)} y2={sweepR * Math.sin(SLICES * 4 * RAD)} stroke={BRAND} strokeOpacity="0.6" strokeWidth="1" />
          </g>
        </g>
      )}

      {/* Towns */}
      {towns.map((town) => (
        <g key={town.name}>
          <circle cx={town.x} cy={town.y} r="1.8" fill="#ffffff" fillOpacity="0.45" />
          {town.label && (
            <text
              x={town.label.x}
              y={town.y + 3}
              textAnchor={town.label.anchor}
              fontSize="9"
              fill="#ffffff"
              fillOpacity="0.5"
              className="font-mono"
            >
              {town.name}
            </text>
          )}
        </g>
      ))}

      {/* The signal: from the visitor to Santa Rita */}
      {!home && (
        <>
          <line x1={youAt.x} y1={youAt.y - 2} x2={hq.x} y2={hq.y} stroke={PIN} strokeOpacity="0.85" strokeWidth="1.6" strokeDasharray="4 3" strokeLinecap="round" className="rg-march" />
          <g className="rg-late">
            <rect x={pill.x - 23} y={pill.y - 9} width="46" height="18" rx="9" fill={CARD_BG} stroke="#ffffff" strokeOpacity="0.2" />
            <text x={pill.x} y={pill.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#ffffff" className="font-mono">
              {kmText}
            </text>
          </g>
        </>
      )}

      {/* Santa Rita: the logo, broadcasting */}
      <circle cx={hq.x} cy={hq.y} r="11" fill="none" stroke={BRAND} strokeWidth="1.5" className="rg-pulse" />
      <circle cx={hq.x} cy={hq.y} r="11" fill="none" stroke={BRAND} strokeWidth="1.5" className="rg-pulse rg-pulse-2" />
      <g transform={`translate(${hq.x - 12} ${hq.y - 12})`}>
        <rect width="24" height="24" rx="6.5" fill={BRAND} stroke="#ffffff" strokeOpacity="0.25" />
        <rect x="5" y="5.5" width="14" height="10" rx="1.6" fill="none" stroke="#ffffff" strokeWidth="2.2" />
        <rect x="11" y="15.5" width="2" height="2.6" fill="#ffffff" />
        <path d="M8.6 20 L15.4 20 L14.4 18.1 L9.6 18.1 Z" fill="#ffffff" />
      </g>
      <text
        x={hq.x}
        y={hqLabelY}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="#ffffff"
        stroke={CARD_BG}
        strokeWidth="3"
        paintOrder="stroke"
      >
        {hqLabel}
      </text>

      {/* The visitor */}
      {!home && (
        <g transform={`translate(${youAt.x} ${youAt.y})`}>
          <g className="rg-drop">
            <ellipse cx="0" cy="0" rx="5" ry="1.8" fill="#000000" fillOpacity="0.45" />
            <path d="M0 0 C-2 -6 -8.5 -10 -8.5 -16.5 A8.5 8.5 0 1 1 8.5 -16.5 C8.5 -10 2 -6 0 0 Z" fill={PIN} stroke="#ffffff" strokeOpacity="0.6" />
            <circle cx="0" cy="-16.5" r="3.4" fill={CARD_BG} />
            <g transform="translate(0 -37)">
              <rect
                x={-(labelWidth(youLabel, 9.5) + 14) / 2}
                y="-8"
                width={labelWidth(youLabel, 9.5) + 14}
                height="16"
                rx="8"
                fill={PIN}
              />
              <text y="3.3" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#1a1205" className="font-mono">
                {youLabel}
              </text>
            </g>
          </g>
        </g>
      )}

      <rect width={W} height={H} fill="url(#rg-fade-bottom)" pointerEvents="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The shirt

function GoLiveShirt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 112" className={className} aria-hidden="true">
      <path
        d="M40 6 L20 13 L3 34 L18 47 L28 39 L28 106 Q28 108 30 108 L90 108 Q92 108 92 106 L92 39 L102 47 L117 34 L100 13 L80 6 C76 16 69 20 60 20 C51 20 44 16 40 6 Z"
        fill="#111318"
        stroke="#ffffff"
        strokeOpacity="0.28"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M40 6 C44 16 51 20 60 20 C69 20 76 16 80 6" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M28 39 L28 44 M92 39 L92 44" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="1.5" />
      {/* Go Live mark on the chest */}
      <g transform="translate(47 38)">
        <rect width="26" height="26" rx="7" fill={BRAND} />
        <rect x="5.5" y="6" width="15" height="10.5" rx="1.7" fill="none" stroke="#ffffff" strokeWidth="2.3" />
        <rect x="12" y="16.5" width="2" height="2.8" fill="#ffffff" />
        <path d="M9.4 21.6 L16.6 21.6 L15.6 19.3 L10.4 19.3 Z" fill="#ffffff" />
      </g>
      <text x="60" y="78" textAnchor="middle" fontSize="9.5" fontWeight="900" letterSpacing="1" fill="#ffffff">
        GO LIVE
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The card

export function RegionalPopupCard({
  spot,
  username,
  returnTo,
  preview,
  onClose,
}: {
  spot: RegionalSpot;
  username: string | null;
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

  const track = (name: string) => {
    if (!preview) trackRegional(name);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      armedRef.current = true;
      setArmed(true);
    }, CLOSE_LOCK_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    if (!armedRef.current) return;
    track(REGIONAL_EVENTS.close);
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
  const title = home
    ? t("regional.titleHome")
    : town
      ? t("regional.titleTown", { town: town.name })
      : t("regional.title");

  return (
    <div
      className="rg-root fixed inset-0 z-[95] flex items-end justify-center bg-black/65 p-3 backdrop-blur-[2px] sm:items-center"
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
        className="rg-pop-in relative max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 text-white shadow-[0_30px_90px_rgba(0,0,0,0.65)] outline-none"
        style={{ background: CARD_BG }}
      >
        <RegionalMap
          spot={spot}
          home={home}
          km={km}
          youLabel={t("regional.you")}
          hqLabel={home ? t("regional.hqHome") : "Santa Rita do Sapucaí"}
        />

        <div className="px-5 pb-5">
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: PIN }}>
            <span className="rg-blink h-1.5 w-1.5 rounded-full" style={{ background: PIN }} aria-hidden="true" />
            {home ? t("regional.eyebrowHome") : t("regional.eyebrow", { km: kmRounded })}
          </p>
          <h2 id="rg-title" className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
            {title}
          </h2>
          <p id="rg-text" className="mt-2 text-[14.5px] leading-relaxed text-white/70">
            {home ? t("regional.textHome") : t("regional.text")}
          </p>

          {/* Who makes it */}
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aniversario/equipe/nemtudo.jpg" alt="" width={38} height={38} className="h-[38px] w-[38px] shrink-0 rounded-full object-cover" />
            <p className="text-[13px] leading-snug text-white/65">
              <b className="font-semibold text-white">{t("regional.creatorName")}</b> {t("regional.creatorRole")}
            </p>
          </div>

          {/* The shirt deal */}
          <div
            className="relative mt-4 overflow-hidden rounded-xl"
            style={{ background: "linear-gradient(135deg, #f43f5e 0%, #be123c 52%, #450a0a 100%)" }}
          >
            <span
              className="rg-shine pointer-events-none absolute inset-y-0 left-0 w-1/3"
              style={{ background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))" }}
              aria-hidden="true"
            />
            <div className="relative flex items-center gap-3 p-4 pb-3.5">
              <GoLiveShirt className="rg-sway w-[76px] shrink-0 drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/75">{t("regional.giftKicker")}</p>
                <p className="mt-0.5 text-[16px] font-bold leading-snug">{t("regional.giftTitle")}</p>
                <p className="mt-1 text-[13px] leading-snug text-white/85">{t("regional.giftText")}</p>
              </div>
            </div>
            {/* Perforation, with the card's colour biting the two sides */}
            <div className="relative h-4" aria-hidden="true">
              <span className="absolute -left-2 top-0 h-4 w-4 rounded-full" style={{ background: CARD_BG }} />
              <span className="absolute -right-2 top-0 h-4 w-4 rounded-full" style={{ background: CARD_BG }} />
              <span className="absolute inset-x-4 top-1/2 border-t-2 border-dashed border-white/30" />
            </div>
            <div className="relative flex items-center gap-3 px-4 pb-4 pt-2">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-md">
                <RubyVerifiedBadgeIcon className="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <p className="text-balance text-[19px] font-black leading-[1.05] tracking-tight">{t("regional.giftPrize")}</p>
                {username ? (
                  <p className="mt-1.5 truncate font-mono text-[11px] text-white/80">
                    {t("regional.giftFor")} <span className="font-semibold text-white">@{username}</span>
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12px] leading-snug text-white/85">
                    {t("regional.giftNeedsAccount")}{" "}
                    <Link
                      href={`/login?next=${encodeURIComponent(returnTo)}`}
                      onClick={() => {
                        track(REGIONAL_EVENTS.login);
                        onClose();
                      }}
                      className="font-semibold text-white underline underline-offset-2"
                    >
                      {t("regional.giftLogin")}
                    </Link>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={!armed}
              onClick={() => {
                if (!armedRef.current) return;
                track(REGIONAL_EVENTS.ok);
                onClose();
              }}
              className="relative flex-1 overflow-hidden rounded-xl px-4 py-3 text-sm font-bold text-white outline-offset-2 transition hover:brightness-110 disabled:cursor-default disabled:hover:brightness-100"
              style={{ background: armed ? BRAND : `color-mix(in srgb, ${BRAND} 45%, ${CARD_BG})` }}
            >
              {!armed && <span className="rg-lock rg-lock-fill absolute inset-0" style={{ background: BRAND }} aria-hidden="true" />}
              <span className="relative">{t("regional.ok")}</span>
            </button>
            <button
              type="button"
              onClick={() => void share()}
              className="flex-1 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/90 transition hover:border-white/40 hover:bg-white/5"
            >
              {t("regional.share")}
            </button>
          </div>
          <div className="mt-3 text-center">
            <Link
              href="/pro"
              onClick={() => {
                track(REGIONAL_EVENTS.pro);
                onClose();
              }}
              className="text-[12.5px] text-white/55 underline-offset-2 transition hover:text-white hover:underline"
            >
              {t("regional.proLink")}
            </Link>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          disabled={!armed}
          aria-label={t("regional.close")}
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-lg leading-none text-white transition hover:bg-black disabled:cursor-default disabled:hover:bg-black/55"
        >
          {!armed && (
            <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="2" />
              <circle cx="16" cy="16" r="14.5" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2" pathLength={1} strokeDasharray="1" strokeLinecap="round" className="rg-lock rg-lock-ring" />
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
