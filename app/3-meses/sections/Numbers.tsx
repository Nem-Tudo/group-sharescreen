"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useT } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { usePeopleOnline } from "@/lib/peopleOnline";
import type { AnniversaryStats } from "@/lib/anniversary";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK, MOTION_REDUCED } from "../gsap";
import { SceneTitle, useNumberFormat } from "../shared";
import { HARD_FIGURES, TIMELINE, dayIndex } from "../historyData";

/** How far ahead a running total is aimed: one poll of the page (AnniversaryContent's STATS_POLL_MS). */
const PACE_S = 60;

/**
 * A number that rolls up from zero the first time it is on screen.
 *
 * Given a `rate` (per second), it is a running total: it keeps climbing on its
 * own, and each new reading re-aims it at where the figures say it will be one
 * poll from now — so it speeds up or slows down to meet the real number, and
 * never counts backwards (if it ran ahead, it waits for the figures to catch
 * up). Without one it simply rolls to each new value, up or down (people
 * online right now).
 *
 * React renders the first value only and never touches the text again: the
 * tweens and the ticker own it.
 */
export function Counter({ value, rate, className = "" }: { value: number; rate?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useNumberFormat();
  const [initial] = useState(value);
  const running = rate !== undefined;
  const shown = useRef(value);
  const written = useRef<number | null>(null);
  const target = useRef(value);
  const targetRate = useRef(rate ?? 0);
  const speed = useRef(0);
  const started = useRef(false);
  const tween = useRef<gsap.core.Tween | null>(null);

  const write = () => {
    const el = ref.current;
    const whole = Math.floor(shown.current + 1e-6);
    if (!el || whole === written.current) return;
    written.current = whole;
    el.textContent = fmt(whole);
  };
  const pace = () => {
    const ahead = target.current + targetRate.current * PACE_S;
    speed.current = Math.max(0, (ahead - shown.current) / PACE_S);
  };
  const rollTo = (to: number, duration: number, then?: () => void) => {
    tween.current?.kill();
    const state = { n: shown.current };
    tween.current = gsap.to(state, {
      n: to,
      duration,
      ease: "power3.out",
      onUpdate: () => {
        shown.current = state.n;
        write();
      },
      onComplete: then,
    });
  };

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        shown.current = 0;
        write();
        ScrollTrigger.create({
          trigger: el,
          start: "top 85%",
          once: true,
          onEnter: () => {
            started.current = true;
            rollTo(target.current, 1.6, running ? pace : undefined);
          },
        });
      });
      mm.add(MOTION_REDUCED, () => {
        started.current = true;
        if (running) pace();
      });
    },
    { scope: ref }
  );

  // A running total climbs every frame between readings.
  useEffect(() => {
    if (!running) return;
    const tick = (_time: number, deltaMs: number) => {
      if (!started.current || tween.current?.isActive() || speed.current <= 0) return;
      shown.current += (speed.current * deltaMs) / 1000;
      write();
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
    // write/fmt are recreated each render; the ticker only needs adding once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // A new reading.
  useEffect(() => {
    target.current = value;
    targetRate.current = rate ?? 0;
    if (!started.current) return;
    if (running) {
      // Mid roll-up, the roll's own ending paces it with these figures.
      if (!tween.current?.isActive()) pace();
      return;
    }
    if (Math.round(shown.current) === value) return;
    if (window.matchMedia(MOTION_REDUCED).matches) {
      shown.current = value;
      write();
      return;
    }
    rollTo(value, 1.4);
    // rollTo/pace/write are recreated each render; only new figures should act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, rate]);

  return (
    <span ref={ref} className={`inline-block tabular-nums ${className}`}>
      {fmt(Math.floor(initial))}
    </span>
  );
}

type Card = { id: string; value: number; fun?: string };

/** Which of the API's growth rates make up each card. */
const RATE_KEYS: Record<string, string[]> = {
  accounts: ["accounts"],
  callHours: ["callHours"],
  shareHours: ["shareHours"],
  micHours: ["micHours"],
  messages: ["groupMessages", "directMessages"],
  groups: ["groups"],
  dmCalls: ["dmCalls"],
  appInstalls: ["appInstalls"],
};

/**
 * A card's figure as of now (the reading aged by its own growth since the
 * server took it) and its growth per second. No rate from an older API: the
 * counter then just rolls to each reading.
 */
function liveFigure(stats: AnniversaryStats, id: string, value: number): { value: number; rate?: number } {
  if (!stats.rates) return { value };
  const rate = (RATE_KEYS[id] ?? []).reduce((sum, key) => sum + (stats.rates?.[key] ?? 0), 0);
  const ageS = stats.now ? Math.max(0, (stats.now - stats.at) / 1000) : 0;
  return { value: value + rate * ageS, rate };
}

export function NumbersSection({
  stats,
  failed,
  chartDays,
}: {
  stats: AnniversaryStats | null;
  failed: boolean;
  /** The curve as first loaded: it is drawn by the scroll, and redrawing it every minute would restart that. */
  chartDays: number[] | null;
}) {
  const t = useT();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLElement>(null);
  const online = usePeopleOnline();
  const locale = useLocale();
  const recordDate = (at: number) =>
    new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(at));

  const cards: Card[] = [];
  if (stats) {
    cards.push({ id: "accounts", value: stats.accounts });
    cards.push({
      id: "callHours",
      value: stats.callHours,
      fun: t("anniversary.numbers.callHoursFun", { years: fmt(stats.callHours / 8760, 1) }),
    });
    cards.push({
      id: "shareHours",
      value: stats.shareHours,
      fun: t("anniversary.numbers.shareHoursFun", { movies: fmt(Math.round(stats.shareHours / 2)) }),
    });
    cards.push({
      id: "micHours",
      value: stats.micHours,
      fun: t("anniversary.numbers.micHoursFun", { days: fmt(Math.round(stats.micHours / 24)) }),
    });
    if (stats.groupMessages !== null || stats.directMessages !== null) {
      cards.push({ id: "messages", value: (stats.groupMessages ?? 0) + (stats.directMessages ?? 0) });
    }
    if (stats.groups !== null) {
      cards.push({
        id: "groups",
        value: stats.groups,
        fun: stats.groupMembers !== null ? t("anniversary.numbers.groupsFun", { members: fmt(stats.groupMembers) }) : undefined,
      });
    }
    if (stats.dmCalls !== null) {
      cards.push({
        id: "dmCalls",
        value: stats.dmCalls,
        fun: stats.dmCallHours !== null ? t("anniversary.numbers.dmCallsFun", { hours: fmt(stats.dmCallHours) }) : undefined,
      });
    }
    if (stats.appInstalls !== null) cards.push({ id: "appInstalls", value: stats.appInstalls });
  }

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const rows = gsap.utils.toArray<HTMLElement>(".num-row");
        gsap.set(rows, { autoAlpha: 0, y: 24 });
        ScrollTrigger.batch(rows, {
          start: "top 88%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.06 }),
        });
      });
    },
    { scope: ref, dependencies: [cards.length] }
  );

  const label = "anniv-mono flex items-center gap-2 text-[11px] font-medium uppercase text-[var(--a-mute)]";
  const number = "anniv-display mt-3 block text-[3.4rem] leading-none tabular-nums sm:text-7xl";
  const row = "num-row min-w-0 border-b border-[var(--a-line)] py-7 sm:pr-8";

  return (
    <section ref={ref} data-scene="numbers" className="relative px-4 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <SceneTitle
          kicker={t("anniversary.numbers.kicker")}
          title={t("anniversary.numbers.title")}
          sub={t("anniversary.numbers.sub")}
          color="var(--a-tally)"
        />

        <div data-walk="num-board" className="mt-14 grid border-t border-[var(--a-line)] sm:grid-cols-2 sm:gap-x-10">
          {/* People in rooms this very moment: the one figure that goes down too. */}
          <div className={row}>
            <p className={label}>
              <span className="anniv-live-dot h-2 w-2 rounded-full bg-[var(--a-tally)]" />
              <span className="text-[var(--a-tally)]">{t("anniversary.numbers.liveNow")}</span>
            </p>
            <span className={number}>{online === null ? "…" : <Counter value={online} />}</span>
            <p className="mt-3 text-[15px] text-[var(--a-mute)]">{t("anniversary.numbers.liveNowLabel")}</p>
          </div>

          {cards.map((card) => (
            <div key={card.id} className={row}>
              <p className={label}>{t(`anniversary.numbers.${card.id}`)}</p>
              <span className={number}>
                <Counter {...liveFigure(stats!, card.id, card.value)} />
              </span>
              {card.fun && <p className="mt-3 text-[15px] text-[var(--a-mute)]">{card.fun}</p>}
            </div>
          ))}

          <div className={row}>
            <p className={label}>
              <span className="anniv-onair px-1.5 py-0 text-[10px]">REC</span>
              {t("anniversary.numbers.record")}
            </p>
            <span className={number}>
              <Counter value={stats?.peakSockets ?? HARD_FIGURES.sockets} />
            </span>
            <p className="mt-3 text-[15px] text-[var(--a-mute)]">
              {stats?.peakAt
                ? t("anniversary.numbers.recordAt", { date: recordDate(stats.peakAt) })
                : t("anniversary.numbers.recordFun")}
            </p>
          </div>

          {!stats &&
            !failed &&
            [0, 1, 2].map((i) => (
              <div key={i} className={row}>
                <div className="h-3 w-32 animate-pulse bg-white/[0.07]" />
                <div className="mt-4 h-14 w-56 animate-pulse bg-white/[0.07]" />
              </div>
            ))}
        </div>

        {failed && <p className="mt-6 text-sm text-[var(--a-mute)]">{t("anniversary.numbers.failed")}</p>}

        {stats && chartDays && chartDays.length > 1 && (
          <SignupChart perDay={chartDays} total={liveFigure(stats, "accounts", stats.accounts)} />
        )}
      </div>
    </section>
  );
}

const W = 1000;
const H = 420;
const TOP = 80;
const BOTTOM = 50;

function SignupChart({ perDay, total }: { perDay: number[]; total: { value: number; rate?: number } }) {
  const t = useT();
  const locale = useLocale();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLDivElement>(null);
  const n = perDay.length;

  const { line, area, bars, pins, months, cumulative } = useMemo(() => {
    const cum: number[] = [];
    perDay.reduce((sum, d, i) => (cum[i] = sum + d), 0);
    const max = Math.max(1, cum[n - 1]);
    const maxDay = Math.max(1, ...perDay);
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => TOP + (1 - v / max) * (H - TOP - BOTTOM);
    const points = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const linePath = `M${points.join(" L")}`;
    const base = H - BOTTOM;
    const monthFmt = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "short", timeZone: "UTC" });
    return {
      cumulative: cum,
      line: linePath,
      area: `${linePath} L${W},${base} L0,${base} Z`,
      bars: perDay.map((d, i) => ({ x: x(i), h: (d / maxDay) * 110, base })),
      pins: TIMELINE.filter((m) => m.pin)
        .map((m) => ({ ...m, i: dayIndex(m.date) }))
        .filter((m) => m.i >= 0 && m.i < n)
        .map((m, k) => ({ ...m, px: x(m.i), py: y(cum[m.i]), lift: 34 + (k % 2) * 30, n: k + 1 })),
      months: ["2026-08-17", "2026-09-01", "2026-10-01", "2026-11-01"]
        .map((iso) => ({ iso, i: dayIndex(iso.slice(5)) }))
        .filter((m) => m.i < n)
        .map((m) => ({ x: x(m.i), label: monthFmt.format(new Date(`${m.iso}T12:00:00Z`)).replace(".", "").toUpperCase() })),
    };
  }, [perDay, n, locale]);

  useGSAP(
    () => {
      const path = ref.current?.querySelector<SVGPathElement>(".sc-line");
      if (!path) return;
      const length = path.getTotalLength();
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        // Drawn while the chart rises into view, and complete by the time its
        // middle reaches the middle of the screen.
        const tl = gsap.timeline({
          scrollTrigger: { trigger: ".sc-plot", start: "top 85%", end: "center center", scrub: 0.3 },
        });
        tl.to(path, { strokeDashoffset: 0, duration: 1, ease: "none" }, 0)
          .fromTo(".sc-area", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, ease: "none" }, 0)
          .fromTo(".sc-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.05, stagger: 0.95 / n, transformOrigin: "50% 100%" }, 0);
        gsap.utils.toArray<SVGGElement>(".sc-pin").forEach((pin) => {
          tl.fromTo(
            pin,
            { autoAlpha: 0, y: 10 },
            { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" },
            Number(pin.dataset.at) / (n - 1)
          );
        });
      });
    },
    { scope: ref, dependencies: [line] }
  );

  const tick = { fill: "var(--a-mute)" } as const;

  return (
    <div ref={ref} data-reveal className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--a-line)] pb-5">
        <div>
          <p className="anniv-mono text-[11px] uppercase text-[var(--a-blue)]">{t("anniversary.numbers.chartKicker")}</p>
          <h3 className="anniv-display mt-2 text-4xl sm:text-5xl">{t("anniversary.numbers.chartTitle")}</h3>
        </div>
        <p className="text-right">
          <span className="anniv-display block text-5xl tabular-nums text-[var(--a-blue)] sm:text-6xl">
            <Counter {...total} />
          </span>
          <span className="anniv-mono text-[11px] uppercase text-[var(--a-mute)]">{t("anniversary.numbers.chartTotal")}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sc-plot mt-6 w-full overflow-visible" role="img" aria-label={t("anniversary.numbers.chartTitle")}>
        <defs>
          <linearGradient id="anniv-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4c86ff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#4c86ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={TOP + f * (H - TOP - BOTTOM)} y2={TOP + f * (H - TOP - BOTTOM)} stroke="#ece9e2" strokeOpacity="0.07" />
        ))}
        {bars.map((b, i) => (
          <rect key={i} className="sc-bar" x={b.x - 2} y={b.base - b.h} width="4" height={b.h} fill="#ece9e2" fillOpacity="0.16" />
        ))}
        <path className="sc-area" d={area} fill="url(#anniv-area)" />
        <path className="sc-line" d={line} fill="none" stroke="#4c86ff" strokeWidth="4" strokeLinejoin="round" />
        <line x1="0" x2={W} y1={H - BOTTOM} y2={H - BOTTOM} stroke="#ece9e2" strokeOpacity="0.25" />
        {months.map((m) => (
          <text key={m.x} x={m.x} y={H - 16} style={tick} fontSize="20" fontFamily="var(--font-anniv-mono), monospace" textAnchor={m.x === 0 ? "start" : "middle"}>
            {m.label}
          </text>
        ))}
        {pins.map((p) => (
          <g key={p.key} className="sc-pin" data-at={p.i}>
            <line x1={p.px} x2={p.px} y1={p.py} y2={p.py - p.lift} stroke="#ece9e2" strokeOpacity="0.45" strokeWidth="1.5" />
            <circle cx={p.px} cy={p.py} r="6" fill="#ece9e2" stroke="#111215" strokeWidth="3" />
            <rect x={p.px - 13} y={p.py - p.lift - 26} width="26" height="24" fill="#ece9e2" />
            <text x={p.px} y={p.py - p.lift - 8} fontSize="17" fontWeight="600" textAnchor="middle" fill="#111215" fontFamily="var(--font-anniv-mono), monospace">
              {p.n}
            </text>
          </g>
        ))}
      </svg>
      <ol className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {pins.map((p) => (
          <li key={p.key} className="flex items-baseline gap-3 text-sm">
            <span className="anniv-mono inline-flex h-5 w-5 shrink-0 items-center justify-center bg-[var(--a-ink)] text-[11px] font-semibold text-[var(--a-bg)]">
              {p.n}
            </span>
            <span className="min-w-0">
              <span className="font-semibold">{t(`anniversary.tl.${p.key}.title`)}</span>
              <span className="text-[var(--a-mute)]"> · {t("anniversary.numbers.pinAccounts", { n: fmt(cumulative[p.i]) })}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
