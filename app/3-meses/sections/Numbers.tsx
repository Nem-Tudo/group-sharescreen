"use client";

import { useMemo, useRef } from "react";
import { useLocale, useT } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { usePeopleOnline } from "@/lib/peopleOnline";
import type { AnniversaryStats } from "@/lib/anniversary";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle, useNumberFormat } from "../shared";
import { HARD_FIGURES, TIMELINE, dayIndex } from "../historyData";

/** A number that rolls up from zero the first time it is on screen. */
function Counter({ value, className = "" }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useNumberFormat();
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const state = { n: 0 };
        el.textContent = fmt(0);
        gsap.to(state, {
          n: value,
          duration: 2.2,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
          onUpdate: () => {
            el.textContent = fmt(Math.round(state.n));
          },
        });
      });
    },
    { dependencies: [value], scope: ref }
  );
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {fmt(value)}
    </span>
  );
}

type Card = { id: string; value: number; emoji: string; bg: string; ink: string; fun?: string; wide?: boolean };

export function NumbersSection({ stats, failed }: { stats: AnniversaryStats | null; failed: boolean }) {
  const t = useT();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLElement>(null);
  const online = usePeopleOnline();

  const cards: Card[] = [];
  if (stats) {
    cards.push({ id: "accounts", value: stats.accounts, emoji: "🙋", bg: "#fbbf24", ink: "#1c1400", wide: true });
    cards.push({
      id: "callHours",
      value: stats.callHours,
      emoji: "📞",
      bg: "#a78bfa",
      ink: "#1a0b3d",
      fun: t("anniversary.numbers.callHoursFun", { years: fmt(stats.callHours / 8760, 1) }),
    });
    cards.push({
      id: "shareHours",
      value: stats.shareHours,
      emoji: "🖥️",
      bg: "#38bdf8",
      ink: "#04223a",
      fun: t("anniversary.numbers.shareHoursFun", { movies: fmt(Math.round(stats.shareHours / 2)) }),
    });
    cards.push({
      id: "micHours",
      value: stats.micHours,
      emoji: "🎙️",
      bg: "#fb7185",
      ink: "#3b0712",
      fun: t("anniversary.numbers.micHoursFun", { days: fmt(Math.round(stats.micHours / 24)) }),
    });
    const messages = (stats.groupMessages ?? 0) + (stats.directMessages ?? 0);
    if (stats.groupMessages !== null || stats.directMessages !== null) {
      cards.push({ id: "messages", value: messages, emoji: "💬", bg: "#34d399", ink: "#032b1d", wide: true });
    }
    if (stats.groups !== null) {
      cards.push({
        id: "groups",
        value: stats.groups,
        emoji: "🏰",
        bg: "#f472b6",
        ink: "#3b0727",
        fun: stats.groupMembers !== null ? t("anniversary.numbers.groupsFun", { members: fmt(stats.groupMembers) }) : undefined,
      });
    }
    if (stats.dmCalls !== null) {
      cards.push({
        id: "dmCalls",
        value: stats.dmCalls,
        emoji: "☎️",
        bg: "#818cf8",
        ink: "#10123d",
        fun: stats.dmCallHours !== null ? t("anniversary.numbers.dmCallsFun", { hours: fmt(stats.dmCallHours) }) : undefined,
      });
    }
    if (stats.appInstalls !== null) {
      cards.push({ id: "appInstalls", value: stats.appInstalls, emoji: "📲", bg: "#fdba74", ink: "#3a1702" });
    }
  }

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>(".num-card");
        gsap.set(items, { autoAlpha: 0, y: 70, rotate: (i) => (i % 2 ? 6 : -6), scale: 0.9 });
        ScrollTrigger.batch(items, {
          start: "top 90%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, rotate: 0, scale: 1, duration: 0.8, ease: "back.out(1.6)", stagger: 0.1 }),
        });
      });
    },
    { scope: ref, dependencies: [cards.length] }
  );

  return (
    <section ref={ref} data-scene="numbers" className="relative px-4 py-28 sm:py-36">
      <SceneTitle
        kicker={t("anniversary.numbers.kicker")}
        title={t("anniversary.numbers.title")}
        sub={t("anniversary.numbers.sub")}
        color="var(--a-rose)"
      />

      <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Live now — always there, it does not depend on the stats endpoint */}
        <div className="num-card relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#4f46e5_0%,#a21caf_60%,#f97316_100%)] p-6 text-white">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">
            <span className="anniv-live-dot h-2 w-2 rounded-full bg-emerald-300" />
            {t("anniversary.numbers.liveNow")}
          </span>
          <p className="mt-5 text-5xl font-black tracking-tight sm:text-6xl">
            {online === null ? "…" : <span className="tabular-nums">{fmt(online)}</span>}
          </p>
          <p className="mt-2 font-semibold text-white/85">{t("anniversary.numbers.liveNowLabel")}</p>
        </div>

        {cards.map((card) => (
          <div
            key={card.id}
            className={`num-card relative overflow-hidden rounded-[28px] p-6 ${card.wide ? "lg:col-span-2" : ""}`}
            style={{ background: card.bg, color: card.ink }}
          >
            <span className="absolute -right-3 -top-4 rotate-12 text-[90px] opacity-25 sm:text-[110px]" aria-hidden="true">
              {card.emoji}
            </span>
            <p className="relative text-sm font-extrabold uppercase tracking-wide opacity-75">
              {t(`anniversary.numbers.${card.id}`)}
            </p>
            <p className={`relative mt-3 font-black leading-none tracking-tight ${card.wide ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"}`}>
              <Counter value={card.value} />
            </p>
            {card.fun && <p className="relative mt-3 text-[15px] font-bold leading-snug opacity-85">{card.fun}</p>}
          </div>
        ))}

        <div className="num-card relative overflow-hidden rounded-[28px] border border-[var(--a-line)] bg-[var(--a-card)] p-6">
          <p className="text-sm font-extrabold uppercase tracking-wide text-[var(--a-amber)]">{t("anniversary.numbers.record")}</p>
          <p className="mt-3 text-5xl font-black tracking-tight sm:text-6xl">
            <Counter value={HARD_FIGURES.sockets} />
          </p>
          <p className="mt-3 text-[15px] font-semibold leading-snug text-[var(--a-mute)]">{t("anniversary.numbers.recordFun")}</p>
        </div>

        {!stats &&
          !failed &&
          [0, 1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse rounded-[28px] bg-white/[0.06]" />)}
      </div>

      {failed && <p className="mx-auto mt-6 max-w-xl text-center text-sm text-[var(--a-mute)]">{t("anniversary.numbers.failed")}</p>}

      {stats && stats.signupsPerDay.length > 1 && <SignupChart perDay={stats.signupsPerDay} total={stats.accounts} />}
    </section>
  );
}

const W = 1000;
const H = 420;
const TOP = 70;
const BOTTOM = 50;

function SignupChart({ perDay, total }: { perDay: number[]; total: number }) {
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
    const tag = LOCALE_TAGS[locale];
    const monthFmt = new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" });
    return {
      cumulative: cum,
      line: linePath,
      area: `${linePath} L${W},${base} L0,${base} Z`,
      bars: perDay.map((d, i) => ({ x: x(i), h: (d / maxDay) * 110, base })),
      pins: TIMELINE.filter((m) => m.pin)
        .map((m) => ({ ...m, i: dayIndex(m.date) }))
        .filter((m) => m.i >= 0 && m.i < n)
        .map((m, k) => ({ ...m, px: x(m.i), py: y(cum[m.i]), lift: 46 + (k % 2) * 34 })),
      months: ["2026-08-17", "2026-09-01", "2026-10-01", "2026-11-01"]
        .map((iso) => ({ iso, i: dayIndex(iso.slice(5)) }))
        .filter((m) => m.i < n)
        .map((m) => ({ x: x(m.i), label: monthFmt.format(new Date(`${m.iso}T12:00:00Z`)).replace(".", "") })),
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
        const tl = gsap.timeline({
          scrollTrigger: { trigger: ref.current, start: "top 70%", end: "bottom 45%", scrub: 0.8 },
        });
        tl.to(path, { strokeDashoffset: 0, duration: 1, ease: "none" }, 0)
          .fromTo(".sc-area", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, ease: "none" }, 0)
          .fromTo(".sc-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.05, stagger: 0.95 / n, transformOrigin: "50% 100%" }, 0)
          .fromTo(".sc-total", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.9);
        gsap.utils.toArray<SVGGElement>(".sc-pin").forEach((pin) => {
          tl.fromTo(
            pin,
            { autoAlpha: 0, scale: 0, transformOrigin: "50% 100%" },
            { autoAlpha: 1, scale: 1, duration: 0.05, ease: "back.out(3)" },
            Number(pin.dataset.at) / (n - 1)
          );
        });
      });
    },
    { scope: ref, dependencies: [line] }
  );

  return (
    <div ref={ref} data-reveal className="mx-auto mt-16 max-w-6xl rounded-[32px] border border-[var(--a-line)] bg-[var(--a-bg-2)] p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wide text-[var(--a-sky)]">{t("anniversary.numbers.chartKicker")}</p>
          <h3 className="mt-1 text-2xl font-extrabold sm:text-3xl">{t("anniversary.numbers.chartTitle")}</h3>
        </div>
        <p className="sc-total text-right">
          <span className="block text-4xl font-black tabular-nums text-[var(--a-amber)] sm:text-5xl">{fmt(total)}</span>
          <span className="text-sm font-semibold text-[var(--a-mute)]">{t("anniversary.numbers.chartTotal")}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-6 w-full overflow-visible" role="img" aria-label={t("anniversary.numbers.chartTitle")}>
        <defs>
          <linearGradient id="anniv-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f43f5e" stopOpacity="0.45" />
            <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="anniv-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#818cf8" />
            <stop offset="0.6" stopColor="#f472b6" />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={TOP + f * (H - TOP - BOTTOM)} y2={TOP + f * (H - TOP - BOTTOM)} stroke="white" strokeOpacity="0.06" />
        ))}
        {bars.map((b, i) => (
          <rect key={i} className="sc-bar" x={b.x - 2.5} y={b.base - b.h} width="5" height={b.h} rx="2" fill="#38bdf8" fillOpacity="0.35" />
        ))}
        <path className="sc-area" d={area} fill="url(#anniv-area)" />
        <path className="sc-line" d={line} fill="none" stroke="url(#anniv-line)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="0" x2={W} y1={H - BOTTOM} y2={H - BOTTOM} stroke="white" strokeOpacity="0.2" />
        {months.map((m) => (
          <text key={m.x} x={m.x} y={H - 14} fill="white" fillOpacity="0.55" fontSize="22" fontWeight="700" textAnchor={m.x === 0 ? "start" : "middle"}>
            {m.label}
          </text>
        ))}
        {pins.map((p) => (
          <g key={p.key} className="sc-pin" data-at={p.i}>
            <line x1={p.px} x2={p.px} y1={p.py} y2={p.py - p.lift} stroke="white" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="4 4" />
            <circle cx={p.px} cy={p.py} r="7" fill="#fff" stroke="#0a0c14" strokeWidth="3" />
            <text x={p.px} y={p.py - p.lift - 8} fontSize="32" textAnchor="middle">
              {p.emoji}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-4 flex flex-wrap gap-2">
        {pins.map((p) => (
          <li key={p.key} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/75">
            {p.emoji} {t(`anniversary.tl.${p.key}.title`)} · {t("anniversary.numbers.pinAccounts", { n: fmt(cumulative[p.i]) })}
          </li>
        ))}
      </ul>
    </div>
  );
}
