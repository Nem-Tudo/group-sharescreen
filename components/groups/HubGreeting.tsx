"use client";

import { useEffect, useState } from "react";
import { HUB_CENTRAL_EVENTS, trackHubCentral } from "@/lib/hubCentral";
import { useT } from "@/lib/useI18n";

// The line at the top of the central (experiment hub-central). Not "Bom dia,
// {name}" every visit: one of a pool of jokes and easter eggs that use the
// name, picked once per visit. Some only exist at a time of day or on a day of
// the week; when one fits, it gets a fair chance over the generic ones.
//
// And one in two hundred visits, Herobrine. A different look (dark, pixel
// face, white eyes) on purpose: an easter egg that looks like the other lines
// is one nobody notices. `?herobrine` in the URL forces it, to see it.

const GENERIC = Array.from({ length: 24 }, (_, i) => `g${i + 1}`);
const LATE_NIGHT = ["n1", "n2", "n3", "n4"];
const MORNING = ["morning", "m1", "m2"];
const AFTERNOON = ["afternoon", "a1", "a2"];
const EVENING = ["evening", "e1", "e2"];
const FRIDAY = ["fri1", "fri2"];
const MONDAY = ["mon1"];
const WEEKEND = ["wkd1"];

export const HEROBRINE_CHANCE = 0.005;

type Pick = { kind: "line"; key: string } | { kind: "herobrine"; forced: boolean };

const HEROBRINE_SEEN_KEY = "sharescreen:herobrine-seen";

function sample<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function pickGreeting(now: Date): Pick {
  let forced = false;
  try {
    forced = new URLSearchParams(window.location.search).has("herobrine");
  } catch {
    // no window (never here: picked in an effect)
  }
  if (forced) return { kind: "herobrine", forced: true };
  if (Math.random() < HEROBRINE_CHANCE) return { kind: "herobrine", forced: false };

  const hour = now.getHours();
  const day = now.getDay();
  const timely =
    hour < 5 ? LATE_NIGHT : hour < 12 ? MORNING : hour < 18 ? AFTERNOON : EVENING;
  const daily = day === 5 ? FRIDAY : day === 1 ? MONDAY : day === 0 || day === 6 ? WEEKEND : [];
  const fitting = [...timely, ...daily];
  // The late night lines are the joke at that hour; elsewhere a fitting line
  // is one option among many, so the generic pool still shows up a lot.
  const fittingShare = hour < 5 ? 0.6 : 0.3;
  const key = Math.random() < fittingShare ? sample(fitting) : sample(GENERIC);
  return { kind: "line", key };
}

export function HubGreeting({ name, summary }: { name: string; summary: string[] }) {
  const t = useT();
  // Picked once per mount, in the browser only. The central only renders for
  // a signed-in account, which the server never knows about, so there is no
  // server render of this to disagree with; the null path (plain greeting for
  // the hour) is there for safety, not as a real state.
  const [pick] = useState<Pick | null>(() => (typeof window === "undefined" ? null : pickGreeting(new Date())));
  useEffect(() => {
    if (pick?.kind !== "herobrine" || pick.forced) return;
    // The stats count occurrences, not people. Tag `seen: first` goes once
    // per browser (localStorage), so "first" ≈ how many people saw him and
    // "again" is the ones lucky twice. Forced views (?herobrine) never count.
    let seen: "first" | "again" = "first";
    try {
      if (window.localStorage.getItem(HEROBRINE_SEEN_KEY)) seen = "again";
      else window.localStorage.setItem(HEROBRINE_SEEN_KEY, String(Date.now()));
    } catch {
      // no storage: count it as first, the best guess there is
    }
    trackHubCentral(HUB_CENTRAL_EVENTS.herobrine, { tags: { seen } });
  }, [pick]);

  if (pick?.kind === "herobrine") return <Herobrine name={name} />;

  const hour = new Date().getHours();
  const fallback = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  const key = pick?.key ?? fallback;
  const text = ["morning", "afternoon", "evening"].includes(key)
    ? t(`groups.central.${key}`, { name })
    : t(`groups.central.hello.${key}`, { name });

  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{text}</h1>
      {summary.length > 0 && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{summary.join(" · ")}</p>}
    </div>
  );
}

// 8×8, one letter per pixel: h hair, s skin, d shade, e eye, m mouth/beard.
const FACE = [
  "hhhhhhhh",
  "hhhhhhhh",
  "hssssssh",
  "ssssssss",
  "seesseed",
  "sssddsss",
  "ssmmmmss",
  "ssmssmss",
];
const FACE_COLORS: Record<string, string> = {
  h: "#2a1c10",
  s: "#a8765c",
  d: "#8d5e47",
  m: "#4a2e1f",
};

function HerobrineFace() {
  return (
    <svg viewBox="0 0 8 8" className="hb-face h-14 w-14 shrink-0" shapeRendering="crispEdges" aria-hidden>
      {FACE.flatMap((row, y) =>
        row.split("").map((c, x) =>
          c === "e" ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} className="hb-eye" fill="#ffffff" />
          ) : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FACE_COLORS[c]} />
          )
        )
      )}
    </svg>
  );
}

function Herobrine({ name }: { name: string }) {
  const t = useT();
  return (
    <div className="hb-card relative flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl px-5 py-4">
      <HerobrineFace />
      <div className="relative min-w-0">
        <h1 className="hb-title font-mono text-xl font-bold uppercase tracking-[0.12em] text-[#f4f4f5]">
          {t("groups.central.herobrine", { name })}
        </h1>
        {/* Fixed colours, not the zinc tokens: a theme repaints those, and
            this card is the same dark room in every theme. */}
        <p className="mt-1 font-mono text-xs text-[#a1a1aa]">
          <span className="text-[#71717a]">{t("groups.central.herobrineLog")}</span>{" "}
          <span className="line-through decoration-red-500/80">{t("groups.central.herobrineSub")}</span>
        </p>
      </div>
    </div>
  );
}
