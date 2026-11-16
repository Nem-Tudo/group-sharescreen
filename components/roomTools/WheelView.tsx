"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MdAdd,
  MdClose,
  MdDeleteSweep,
  MdHistory,
  MdList,
  MdShuffle,
  MdSortByAlpha,
  MdTune,
  MdVolumeOff,
  MdVolumeUp,
} from "react-icons/md";
import {
  MAX_WHEEL_ENTRIES,
  MAX_WHEEL_WEIGHT,
  ROOM_TOOLS_EVENTS,
  WHEEL_DURATIONS,
  roomTools,
  trackRoomToolsEvent,
  wheelSpinStart,
  type WheelSettings,
  type WheelTool,
} from "@/lib/roomTools";
import { signalingClient } from "@/lib/signalingClient";
import { useT } from "@/lib/useI18n";
import {
  WHEEL_RESULT_MS,
  isSpinning,
  shortLabel,
  sliceUnderPointer,
  textOn,
  wheelAngle,
  wheelEntriesAt,
  wheelSlices,
} from "@/lib/wheel";

// The room's wheel, as a tile: the wheel itself, and beside it (over it, on a
// narrow tile) its list, its history and — for the managers — its settings.
// The server draws every result (see the API's spinWheel); this only turns
// the wheel to where it said, the same on every screen.

const MUTED_KEY = "sharescreen:wheelMuted";

type Tab = "entries" | "history" | "settings";

export function WheelView({ tool, isManager, canUse }: { tool: WheelTool; isManager: boolean; canUse: boolean }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("entries");
  const canEdit = canUse && (isManager || tool.settings.edit === "everyone");
  const canSpin = canUse && (isManager || tool.settings.spin === "everyone");

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const isNarrow = entry.contentRect.width < 560;
      setNarrow((was) => {
        // Becoming narrow puts the list away; the wheel is what matters there.
        if (isNarrow && !was) setSideOpen(false);
        if (!isNarrow && was) setSideOpen(true);
        return isNarrow;
      });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: "entries", icon: <MdList className="h-4 w-4" />, label: t("roomTools.wheel.tabEntries") },
    { id: "history", icon: <MdHistory className="h-4 w-4" />, label: t("roomTools.wheel.tabHistory") },
    ...(isManager ? [{ id: "settings" as Tab, icon: <MdTune className="h-4 w-4" />, label: t("roomTools.wheel.tabSettings") }] : []),
  ];

  return (
    <div ref={boxRef} className="relative flex h-full w-full gap-2 overflow-hidden">
      <WheelStage tool={tool} canSpin={canSpin} />
      {!sideOpen && (
        <button
          type="button"
          onClick={() => setSideOpen(true)}
          className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-900"
        >
          <MdList className="h-4 w-4" />
          {t("roomTools.wheel.entriesCount", { count: tool.entries.length })}
        </button>
      )}
      {sideOpen && (
        <aside
          className={`flex min-h-0 flex-col overflow-hidden border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
            narrow ? "absolute inset-0 z-20 rounded-lg border" : "w-64 shrink-0 border-l pl-2"
          }`}
        >
          <div className="flex shrink-0 items-center gap-1 pb-1.5">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  tab === item.id
                    ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {item.icon}
                <span className={narrow ? "" : "hidden xl:inline"}>{item.label}</span>
              </button>
            ))}
            <span className="flex-1" />
            {narrow && (
              <button
                type="button"
                onClick={() => setSideOpen(false)}
                aria-label={t("roomTools.wheel.backToWheel")}
                className="rounded-md p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <MdClose className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {tab === "entries" && <EntriesTab tool={tool} canEdit={canEdit} />}
            {tab === "history" && <HistoryTab tool={tool} isManager={isManager} />}
            {tab === "settings" && isManager && <SettingsTab tool={tool} />}
          </div>
        </aside>
      )}
    </div>
  );
}

// --- The wheel -----------------------------------------------------------------

function WheelStage({ tool, canSpin }: { tool: WheelTool; canSpin: boolean }) {
  const t = useT();
  const rotorRef = useRef<SVGGElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => (typeof performance !== "undefined" ? performance.now() : 0));
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [dismissedSpin, setDismissedSpin] = useState<string | null>(null);
  const mutedRef = useRef(muted);
  const toolRef = useRef(tool);
  useEffect(() => {
    mutedRef.current = muted;
    toolRef.current = tool;
  });

  const spin = tool.spin;
  const spinning = isSpinning(spin, now);
  const entries = wheelEntriesAt(tool, now);
  const { angle, progress, sinceEnd } = wheelAngle(tool, now);
  const showResult = Boolean(spin && progress >= 1 && sinceEnd < WHEEL_RESULT_MS && dismissedSpin !== spin.id);

  // While it turns, every frame: the rotor is turned directly (no render per
  // frame), the ticks are played as slices pass the pointer, and the state
  // moves on when it stops.
  useEffect(() => {
    if (!spin) return;
    const start = wheelSpinStart(spin);
    const end = start + spin.duration;
    let frame = 0;
    let lastSlice = -1;
    let stopped = false;
    let first = true;
    // Only a spin seen turning gets the fanfare, not one over before this mounted.
    const sawTurning = performance.now() < end;
    const step = () => {
      const current = performance.now();
      if (first) {
        first = false;
        if (sawTurning) setNow(current);
      }
      const { angle: at } = wheelAngle(toolRef.current, current);
      rotorRef.current?.setAttribute("transform", `rotate(${at})`);
      const slice = sliceUnderPointer(spin.entries, at);
      if (lastSlice !== -1 && slice !== lastSlice && !mutedRef.current) playTick();
      lastSlice = slice;
      if (current < end) {
        frame = requestAnimationFrame(step);
      } else if (!stopped) {
        stopped = true;
        setNow(current);
        if (sawTurning) {
          if (!mutedRef.current) playWin();
          burstConfetti(confettiRef.current);
        }
      }
    };
    frame = requestAnimationFrame(step);
    // When the result goes away and the list takes over the wheel again.
    const settle = window.setTimeout(() => setNow(performance.now()), Math.max(0, end + WHEEL_RESULT_MS - performance.now()) + 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
    // A new spin is a new id; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id]);

  function toggleMute() {
    setMuted((was) => {
      try {
        localStorage.setItem(MUTED_KEY, was ? "0" : "1");
      } catch {}
      return !was;
    });
  }

  const ready = canSpin && !spinning && tool.entries.length >= 2;
  const spinNow = () => {
    if (ready) roomTools.wheelSpin(tool.id);
  };
  const slices = wheelSlices(entries);
  const fontSize = Math.max(3.2, Math.min(9, 150 / Math.max(entries.length, 6)));

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden">
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <svg viewBox="-110 -116 220 226" className="h-full max-h-full w-full max-w-full select-none" role="img" aria-label={tool.title}>
          <circle r="104" fill="#18181b" />
          <circle r="101" fill="#3f3f46" />
          <g ref={rotorRef} transform={`rotate(${angle})`}>
            {entries.length === 0 ? (
              <circle r="98" className="fill-zinc-200 dark:fill-zinc-700" />
            ) : entries.length === 1 ? (
              <circle r="98" fill={entries[0].color} />
            ) : (
              slices.map(({ entry, start, end }) => (
                <path key={entry.id} d={slicePath(start, end, 98)} fill={entry.color} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} />
              ))
            )}
            {slices.map(({ entry, start, end }) => (
              <g key={entry.id} transform={`rotate(${(start + end) / 2 - 90})`}>
                <text
                  x={92}
                  y={0}
                  textAnchor="end"
                  dominantBaseline="central"
                  fill={textOn(entry.color)}
                  fontSize={fontSize}
                  fontWeight={600}
                >
                  {shortLabel(entry.text, entries.length)}
                </text>
              </g>
            ))}
            {/* The pegs on the rim. */}
            {slices.length > 1 &&
              slices.map(({ entry, start }) => {
                const [x, y] = polar(start, 99.5);
                return <circle key={entry.id} cx={x} cy={y} r={1.3} fill="#fafafa" />;
              })}
          </g>
          {/* The pointer, at the top. */}
          <path d="M -9 -113 L 9 -113 L 0 -92 Z" fill="#fafafa" stroke="#18181b" strokeWidth={2} strokeLinejoin="round" />
        </svg>
        <button
          type="button"
          onClick={spinNow}
          disabled={!ready}
          aria-label={t("roomTools.wheel.spin")}
          className="absolute left-1/2 top-1/2 flex aspect-square w-[16%] min-w-12 max-w-24 -translate-x-1/2 -translate-y-[44%] items-center justify-center rounded-full border-4 border-zinc-900 bg-white text-[11px] font-black uppercase tracking-wide text-zinc-900 shadow-lg transition enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default sm:text-xs"
        >
          {spinning ? "…" : t("roomTools.wheel.spinShort")}
        </button>
        {entries.length === 0 && (
          <p className="pointer-events-none absolute inset-x-4 bottom-2 text-center text-xs text-zinc-500">
            {t("roomTools.wheel.empty")}
          </p>
        )}
        {showResult && spin && (
          <button
            type="button"
            onClick={() => setDismissedSpin(spin.id)}
            className="absolute inset-x-3 bottom-2 mx-auto flex max-w-sm flex-col items-center rounded-2xl bg-zinc-900/90 px-4 py-2.5 text-center text-white shadow-xl backdrop-blur"
          >
            <span className="text-[11px] uppercase tracking-wide text-zinc-300">{t("roomTools.wheel.result")}</span>
            <span className="max-w-full break-words text-lg font-bold sm:text-2xl">🎉 {spin.winnerText}</span>
            <span className="text-[11px] text-zinc-400">{t("roomTools.wheel.spunBy", { name: spin.byName })}</span>
          </button>
        )}
        <div ref={confettiRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={spinNow}
          disabled={!ready}
          className="rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {spinning
            ? t("roomTools.wheel.spinning")
            : !canSpin
              ? t("roomTools.wheel.cannotSpin")
              : tool.entries.length < 2
                ? t("roomTools.wheel.needTwo")
                : t("roomTools.wheel.spin")}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          title={muted ? t("roomTools.wheel.soundOn") : t("roomTools.wheel.soundOff")}
          aria-label={muted ? t("roomTools.wheel.soundOn") : t("roomTools.wheel.soundOff")}
          className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {muted ? <MdVolumeOff className="h-4 w-4" /> : <MdVolumeUp className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function polar(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
}

function slicePath(start: number, end: number, r: number): string {
  const [x0, y0] = polar(start, r);
  const [x1, y1] = polar(end, r);
  const large = end - start > 180 ? 1 : 0;
  return `M 0 0 L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`;
}

// --- Sound and confetti ---------------------------------------------------------

let audio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, length: number, volume: number, type: OscillatorType = "triangle") {
  const ctx = audioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + at;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

let lastTick = 0;
function playTick() {
  // A fast wheel passes more slices than ears can count — and than a speaker
  // should be asked to click.
  const now = performance.now();
  if (now - lastTick < 45) return;
  lastTick = now;
  tone(1400, 0, 0.03, 0.05, "square");
}

function playWin() {
  [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * 0.09, 0.25, 0.08));
}

const CONFETTI_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

function burstConfetti(box: HTMLDivElement | null) {
  if (!box || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const { width, height } = box.getBoundingClientRect();
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("span");
    const size = 4 + Math.random() * 5;
    piece.style.cssText = `position:absolute;left:${width / 2}px;top:${height * 0.45}px;width:${size}px;height:${size * 1.6}px;background:${
      CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    };border-radius:1px;`;
    box.appendChild(piece);
    const angle = Math.random() * Math.PI * 2;
    const distance = (0.25 + Math.random() * 0.4) * Math.max(width, height);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance * 0.6 + height * 0.35;
    const animation = piece.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 900, easing: "cubic-bezier(.15,.7,.4,1)" }
    );
    animation.onfinish = () => piece.remove();
  }
}

// --- The list -------------------------------------------------------------------

const inputClass =
  "w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const smallButton =
  "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800";

type Preset = "people" | "yesNo" | "coin" | "dice" | "numbers" | "letters";
const PRESETS: Preset[] = ["people", "yesNo", "coin", "dice", "numbers", "letters"];

/** Everybody in the room right now, once each — yourself included. */
function roomNames(): string[] {
  const snapshot = signalingClient.getSnapshot();
  const names = new Map<string, string>();
  if (snapshot.selfUserId && snapshot.name) names.set(snapshot.selfUserId, snapshot.name);
  for (const peer of snapshot.peers) {
    // A moderator watching and an OBS source are not people in the room.
    if (peer.role === "moderator" || peer.role === "obs") continue;
    const key = peer.userId ?? peer.id;
    if (!names.has(key) && peer.name) names.set(key, peer.name);
  }
  return [...names.values()];
}

/** Splits pasted text into entries: a line each (or a comma each, when it is one line). */
export function splitEntries(text: string): string[] {
  const lines = text.includes("\n") ? text.split(/\r?\n/) : text.split(/[,;]/);
  return lines.map((line) => line.trim()).filter(Boolean);
}

export function presetEntries(preset: Preset, t: ReturnType<typeof useT>, range: { from: number; to: number }): string[] {
  switch (preset) {
    case "people":
      return roomNames();
    case "yesNo":
      return [t("roomTools.wheel.yes"), t("roomTools.wheel.no")];
    case "coin":
      return [t("roomTools.wheel.heads"), t("roomTools.wheel.tails")];
    case "dice":
      return ["1", "2", "3", "4", "5", "6"];
    case "letters":
      return Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    case "numbers": {
      const from = Math.min(range.from, range.to);
      const to = Math.min(Math.max(range.from, range.to), from + MAX_WHEEL_ENTRIES - 1);
      return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
    }
  }
}

/** The presets and the range of numbers — when opening the wheel, and in its list. */
export function WheelPresets({ onPick }: { onPick: (entries: string[], preset: Preset) => void }) {
  const t = useT();
  const [range, setRange] = useState({ from: 1, to: 10 });
  const [askRange, setAskRange] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              if (preset === "numbers" && !askRange) {
                setAskRange(true);
                return;
              }
              onPick(presetEntries(preset, t, range), preset);
            }}
            className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:border-emerald-500 dark:border-zinc-700 dark:text-zinc-300"
          >
            {t(`roomTools.wheel.preset.${preset}`)}
          </button>
        ))}
      </div>
      {askRange && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          {t("roomTools.wheel.from")}
          <input
            type="number"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: Math.trunc(Number(e.target.value) || 0) })}
            className={`${inputClass} w-16`}
          />
          {t("roomTools.wheel.to")}
          <input
            type="number"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: Math.trunc(Number(e.target.value) || 0) })}
            className={`${inputClass} w-16`}
          />
          <button
            type="button"
            onClick={() => {
              onPick(presetEntries("numbers", t, range), "numbers");
              setAskRange(false);
            }}
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

function EntriesTab({ tool, canEdit }: { tool: WheelTool; canEdit: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [bulk, setBulk] = useState<string | null>(null);
  const full = tool.entries.length >= MAX_WHEEL_ENTRIES;
  const totalWeight = useMemo(() => tool.entries.reduce((sum, e) => sum + e.weight, 0) || 1, [tool.entries]);

  function add(texts: string[], replace = false) {
    roomTools.wheelAdd(
      tool.id,
      texts.map((text) => ({ text })),
      replace
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {canEdit && (
        <>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const texts = splitEntries(draft);
              if (texts.length === 0) return;
              add(texts);
              setDraft("");
            }}
          >
            <input
              value={draft}
              maxLength={2000}
              disabled={full}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                // A pasted list goes in whole, a line each.
                const text = e.clipboardData.getData("text");
                if (!text.includes("\n")) return;
                e.preventDefault();
                add(splitEntries(text));
              }}
              placeholder={full ? t("roomTools.wheel.full") : t("roomTools.wheel.addPlaceholder")}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={full || !draft.trim()}
              aria-label={t("roomTools.wheel.add")}
              className="rounded-md bg-emerald-600 px-2 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </form>
          <WheelPresets
            onPick={(texts, preset) => {
              if (texts.length === 0) return;
              if (tool.entries.length > 0 && !window.confirm(t("roomTools.wheel.replaceQuestion"))) return;
              add(texts, true);
              trackRoomToolsEvent(ROOM_TOOLS_EVENTS.wheelPreset);
              trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.wheelPreset}.${preset}`);
            }}
          />
          <div className="flex flex-wrap items-center gap-0.5">
            <button type="button" className={smallButton} disabled={tool.entries.length < 2} onClick={() => roomTools.wheelArrange(tool.id, "shuffle")}>
              <MdShuffle className="h-3.5 w-3.5" />
              {t("roomTools.wheel.shuffle")}
            </button>
            <button type="button" className={smallButton} disabled={tool.entries.length < 2} onClick={() => roomTools.wheelArrange(tool.id, "sort")}>
              <MdSortByAlpha className="h-3.5 w-3.5" />
              {t("roomTools.wheel.sort")}
            </button>
            <button type="button" className={smallButton} onClick={() => setBulk(bulk === null ? tool.entries.map((e) => e.text).join("\n") : null)}>
              <MdList className="h-3.5 w-3.5" />
              {t("roomTools.wheel.editAsText")}
            </button>
            <button
              type="button"
              className={smallButton}
              disabled={tool.entries.length === 0}
              onClick={() => {
                if (window.confirm(t("roomTools.wheel.clearQuestion"))) roomTools.wheelArrange(tool.id, "clear");
              }}
            >
              <MdDeleteSweep className="h-3.5 w-3.5" />
              {t("roomTools.wheel.clear")}
            </button>
          </div>
          {bulk !== null && (
            <div className="flex flex-col gap-1">
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={6}
                placeholder={t("roomTools.wheel.bulkPlaceholder")}
                className={`${inputClass} resize-y font-mono text-xs`}
              />
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => setBulk(null)} className={smallButton}>
                  {t("roomTools.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    add(splitEntries(bulk.includes("\n") ? bulk : `${bulk}\n`), true);
                    setBulk(null);
                  }}
                  className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                >
                  {t("roomTools.save")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-zinc-500">
        {t("roomTools.wheel.entriesCount", { count: tool.entries.length })}
        {tool.settings.removeWinner ? ` · ${t("roomTools.wheel.removeWinnerOn")}` : ""}
      </p>
      {tool.entries.length === 0 && !canEdit && <p className="text-xs text-zinc-500">{t("roomTools.wheel.emptyMember")}</p>}
      <ul className="flex flex-col gap-1">
        {tool.entries.map((entry) => (
          <EntryRow key={entry.id} toolId={tool.id} entry={entry} canEdit={canEdit} chance={(entry.weight / totalWeight) * 100} />
        ))}
      </ul>
    </div>
  );
}

function EntryRow({
  toolId,
  entry,
  canEdit,
  chance,
}: {
  toolId: string;
  entry: WheelTool["entries"][number];
  canEdit: boolean;
  chance: number;
}) {
  const t = useT();
  const [text, setText] = useState(entry.text);
  // Somebody else renamed it: show their name (adjusted while rendering, as React suggests).
  const [seenText, setSeenText] = useState(entry.text);
  if (seenText !== entry.text) {
    setSeenText(entry.text);
    setText(entry.text);
  }
  // The colour picker reports every shade it passes through: only where it
  // rests goes to the room.
  const [color, setColor] = useState<string | null>(null);
  const colorTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(colorTimer.current), []);
  const pickColor = (value: string) => {
    setColor(value);
    window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => {
      roomTools.wheelEdit(toolId, entry.id, { color: value });
      setColor(null);
    }, 300);
  };
  const commit = () => {
    const next = text.trim();
    if (next && next !== entry.text) roomTools.wheelEdit(toolId, entry.id, { text: next });
    else setText(entry.text);
  };
  return (
    <li className="group flex items-center gap-1.5">
      <label className="relative h-4 w-4 shrink-0 cursor-pointer rounded-full border border-black/10" style={{ background: color ?? entry.color }}>
        {canEdit && (
          <input
            type="color"
            value={color ?? entry.color}
            onChange={(e) => pickColor(e.target.value)}
            aria-label={t("roomTools.wheel.color")}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </label>
      {canEdit ? (
        <input
          value={text}
          maxLength={80}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(entry.text);
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-900 hover:border-zinc-300 focus:border-emerald-500 focus:outline-none dark:text-zinc-100 dark:hover:border-zinc-700"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-1 text-sm text-zinc-900 dark:text-zinc-100">{entry.text}</span>
      )}
      <span className="shrink-0 text-[10px] tabular-nums text-zinc-400" title={t("roomTools.wheel.chance")}>
        {chance < 10 ? chance.toFixed(1) : Math.round(chance)}%
      </span>
      {canEdit && (
        <>
          <select
            value={entry.weight}
            onChange={(e) => roomTools.wheelEdit(toolId, entry.id, { weight: Number(e.target.value) })}
            title={t("roomTools.wheel.weight")}
            aria-label={t("roomTools.wheel.weight")}
            className="shrink-0 rounded border border-zinc-200 bg-transparent px-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          >
            {Array.from({ length: MAX_WHEEL_WEIGHT }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                ×{w}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => roomTools.wheelRemove(toolId, entry.id)}
            aria-label={t("roomTools.remove")}
            className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </li>
  );
}

// --- The history ----------------------------------------------------------------

function HistoryTab({ tool, isManager }: { tool: WheelTool; isManager: boolean }) {
  const t = useT();
  // A result is in the history from the moment it is drawn; it shows once
  // the wheel has stopped on it. `now` moves on when it does.
  const [now, setNow] = useState(() => performance.now());
  const spin = tool.spin;
  useEffect(() => {
    if (!spin) return;
    const timer = window.setTimeout(
      () => setNow(performance.now()),
      Math.max(0, wheelSpinStart(spin) + spin.duration - performance.now()) + 50
    );
    return () => window.clearTimeout(timer);
  }, [spin]);
  const turning = spin && isSpinning(spin, now) ? spin : null;
  const shown = tool.history.filter((h) => h.spinId !== turning?.id);
  const tally = useMemo(() => {
    const counts = new Map<string, { text: string; color: string; count: number }>();
    for (const h of shown) {
      const current = counts.get(h.text);
      if (current) current.count += 1;
      else counts.set(h.text, { text: h.text, color: h.color, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [shown]);

  if (shown.length === 0) return <p className="text-xs text-zinc-500">{t("roomTools.wheel.noHistory")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {tally.length > 1 && tally[0].count > 1 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t("roomTools.wheel.mostDrawn")}</h4>
          {tally.map((item) => (
            <div key={item.text} className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
              <span className="min-w-0 flex-1 truncate">{item.text}</span>
              <span className="tabular-nums text-zinc-500">×{item.count}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t("roomTools.wheel.lastResults")}</h4>
        <ol className="flex flex-col gap-1">
          {shown.map((h, i) => (
            <li key={h.id} className="flex items-center gap-1.5 text-xs">
              <span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{shown.length - i}.</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">{h.text}</span>
              <span className="shrink-0 truncate text-[10px] text-zinc-500" title={new Date(h.at).toLocaleString()}>
                {h.byName} · {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {isManager && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("roomTools.wheel.clearHistoryQuestion"))) roomTools.wheelArrange(tool.id, "clear-history");
          }}
          className={`${smallButton} self-start`}
        >
          <MdDeleteSweep className="h-3.5 w-3.5" />
          {t("roomTools.wheel.clearHistory")}
        </button>
      )}
    </div>
  );
}

// --- Settings (managers) --------------------------------------------------------

/** The wheel's settings as fields — when opening it, and in its tile. */
export function WheelSettingsFields({
  settings,
  onChange,
}: {
  settings: WheelSettings;
  onChange: (settings: Partial<WheelSettings>) => void;
}) {
  const t = useT();
  const check = "flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200";
  const row = "flex items-center justify-between gap-2 text-sm text-zinc-800 dark:text-zinc-200";
  const select = "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950";
  return (
    <div className="flex flex-col gap-2.5">
      <label className={row}>
        {t("roomTools.wheel.duration")}
        <select value={settings.duration} onChange={(e) => onChange({ duration: Number(e.target.value) })} className={select}>
          {WHEEL_DURATIONS.map((s) => (
            <option key={s} value={s}>
              {t("roomTools.wheel.seconds", { count: s })}
            </option>
          ))}
        </select>
      </label>
      <label className={check}>
        <input
          type="checkbox"
          checked={settings.removeWinner}
          onChange={(e) => onChange({ removeWinner: e.target.checked })}
          className="accent-emerald-600"
        />
        <span>
          {t("roomTools.wheel.removeWinner")}
          <span className="block text-[11px] text-zinc-500">{t("roomTools.wheel.removeWinnerHint")}</span>
        </span>
      </label>
      <label className={check}>
        <input type="checkbox" checked={settings.announce} onChange={(e) => onChange({ announce: e.target.checked })} className="accent-emerald-600" />
        {t("roomTools.wheel.announce")}
      </label>
      {(["spin", "edit"] as const).map((rule) => (
        <label key={rule} className={row}>
          {t(`roomTools.wheel.rule.${rule}`)}
          <select value={settings[rule]} onChange={(e) => onChange({ [rule]: e.target.value })} className={select}>
            <option value="everyone">{t("roomTools.tasks.who.everyone")}</option>
            <option value="managers">{t("roomTools.tasks.who.managers")}</option>
          </select>
        </label>
      ))}
    </div>
  );
}

function SettingsTab({ tool }: { tool: WheelTool }) {
  return <WheelSettingsFields settings={tool.settings} onChange={(changes) => roomTools.wheelSettings(tool.id, changes)} />;
}
