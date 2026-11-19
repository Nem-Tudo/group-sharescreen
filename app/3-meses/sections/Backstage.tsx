"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle, useNumberFormat } from "../shared";
import { COMMITS_PER_WEEK, DEV_STATS } from "../historyData";

export function BackstageSection() {
  const t = useT();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLElement>(null);
  const max = Math.max(...COMMITS_PER_WEEK.map((w) => w.commits));
  const min = Math.min(...COMMITS_PER_WEEK.map((w) => w.commits));

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // The clock runs from midnight to 3 a.m. as the section scrolls by.
        const digital = ref.current?.querySelector<HTMLElement>(".bs-digital");
        const time = { m: 0 };
        gsap
          .timeline({ scrollTrigger: { trigger: ".bs-clock", start: "top 80%", end: "bottom 30%", scrub: 0.6 } })
          .fromTo(".bs-hour", { rotation: 0, svgOrigin: "110 110" }, { rotation: 90, svgOrigin: "110 110", ease: "none", duration: 1 }, 0)
          .fromTo(".bs-minute", { rotation: 0, svgOrigin: "110 110" }, { rotation: 1080, svgOrigin: "110 110", ease: "none", duration: 1 }, 0)
          .to(
            time,
            {
              m: 180,
              ease: "none",
              duration: 1,
              onUpdate: () => {
                if (!digital) return;
                const total = Math.round(time.m);
                digital.textContent = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
              },
            },
            0
          );

        gsap.fromTo(
          ".bs-bar",
          { scaleY: 0 },
          {
            scaleY: 1,
            duration: 0.9,
            ease: "elastic.out(1, 0.6)",
            stagger: 0.06,
            transformOrigin: "50% 100%",
            scrollTrigger: { trigger: ".bs-bars", start: "top 80%", once: true },
          }
        );
        gsap.fromTo(
          ".bs-stat",
          { autoAlpha: 0, y: 40, scale: 0.9 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.6,
            ease: "back.out(1.8)",
            stagger: 0.1,
            scrollTrigger: { trigger: ".bs-stats", start: "top 85%", once: true },
          }
        );
        gsap.to(".bs-moon", {
          y: -120,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top bottom", end: "bottom top", scrub: true },
        });
      });
    },
    { scope: ref }
  );

  const stats = [
    { value: fmt(DEV_STATS.commits), label: t("anniversary.night.commits") },
    { value: String(DEV_STATS.repos), label: t("anniversary.night.repos") },
    { value: t("anniversary.night.linesValue", { n: fmt(DEV_STATS.linesOfCode / 1000) }), label: t("anniversary.night.lines") },
    { value: `${DEV_STATS.lateNightPercent}%`, label: t("anniversary.night.lateNight") },
  ];

  const facts = [
    { emoji: "🕒", text: t("anniversary.night.f1", { n: fmt(DEV_STATS.peakHourCommits) }) },
    { emoji: "☕", text: t("anniversary.night.f2", { n: DEV_STATS.morningCommits }) },
    { emoji: "🎃", text: t("anniversary.night.f3", { day: DEV_STATS.busiestDay, n: DEV_STATS.busiestDayCommits }) },
    { emoji: "🖥️", text: t("anniversary.night.f4", { from: DEV_STATS.desktopFrom, to: DEV_STATS.desktopTo }) },
  ];

  return (
    <section
      ref={ref}
      data-scene="night"
      className="relative overflow-hidden bg-[linear-gradient(180deg,#0a0c14_0%,#0d1033_18%,#171447_60%,#0a0c14_100%)] px-4 py-28 sm:py-36"
    >
      <div className="anniv-stars" />
      <div
        className="bs-moon pointer-events-none absolute right-[8%] top-[6%] h-24 w-24 rounded-full bg-[#fef3c7] shadow-[0_0_80px_30px_rgba(254,243,199,0.25)] sm:h-32 sm:w-32"
        aria-hidden="true"
      >
        <span className="absolute left-[22%] top-[30%] h-4 w-4 rounded-full bg-[#fde68a]" />
        <span className="absolute left-[55%] top-[55%] h-6 w-6 rounded-full bg-[#fde68a]" />
      </div>

      <SceneTitle kicker={t("anniversary.night.kicker")} title={t("anniversary.night.title")} sub={t("anniversary.night.sub")} color="#c7d2fe" />

      <div className="relative mx-auto mt-16 grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="bs-clock mx-auto flex flex-col items-center">
          <svg viewBox="0 0 220 220" className="w-56 sm:w-72" aria-hidden="true">
            <circle cx="110" cy="110" r="100" fill="#11152a" stroke="#c7d2fe" strokeOpacity="0.3" strokeWidth="6" />
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={i}
                x1="110"
                y1="20"
                x2="110"
                y2={i % 3 === 0 ? 36 : 30}
                stroke="#c7d2fe"
                strokeOpacity={i % 3 === 0 ? 0.9 : 0.4}
                strokeWidth={i % 3 === 0 ? 5 : 3}
                strokeLinecap="round"
                transform={`rotate(${i * 30} 110 110)`}
              />
            ))}
            <line className="bs-hour" x1="110" y1="110" x2="110" y2="62" stroke="#fbbf24" strokeWidth="9" strokeLinecap="round" transform="rotate(90 110 110)" />
            <line className="bs-minute" x1="110" y1="110" x2="110" y2="38" stroke="#f472b6" strokeWidth="5" strokeLinecap="round" />
            <circle cx="110" cy="110" r="8" fill="#fff" />
          </svg>
          <p className="bs-digital anniv-pixel mt-5 text-2xl text-[#fbbf24] sm:text-3xl">03:00</p>
          <p className="mt-2 text-sm font-semibold text-[#c7d2fe]/70">{t("anniversary.night.clockLabel")}</p>
        </div>

        <div>
          <div className="bs-stats grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="bs-stat rounded-3xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur">
                <p className="text-4xl font-black tracking-tight text-white sm:text-5xl">{s.value}</p>
                <p className="mt-1 text-sm font-semibold text-[#c7d2fe]/75">{s.label}</p>
              </div>
            ))}
          </div>
          <ul className="mt-6 space-y-3">
            {facts.map((f) => (
              <li key={f.emoji} data-reveal className="flex gap-3 text-[15.5px] leading-snug text-white/85">
                <span className="text-2xl" aria-hidden="true">
                  {f.emoji}
                </span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div data-reveal className="relative mx-auto mt-20 max-w-5xl rounded-[32px] border border-white/10 bg-white/[0.04] p-5 sm:p-8">
        <h3 className="text-xl font-extrabold sm:text-2xl">{t("anniversary.night.barsTitle")}</h3>
        <div className="bs-bars mt-8 flex h-56 items-end gap-1.5 sm:gap-3">
          {COMMITS_PER_WEEK.map((w) => {
            const peak = w.commits === max;
            const low = w.commits === min;
            return (
              <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className={`mb-1 text-[10px] font-bold tabular-nums sm:text-xs ${peak ? "text-[#fbbf24]" : "text-white/50"}`}>
                  {w.commits}
                </span>
                <div
                  className={`bs-bar w-full rounded-t-md ${peak ? "bg-[#fbbf24]" : low ? "bg-[#64748b]" : "bg-[linear-gradient(180deg,#f472b6,#818cf8)]"}`}
                  style={{ height: `${Math.max(2, (w.commits / max) * 100)}%` }}
                />
                <span className="mt-2 hidden text-[10px] text-white/40 sm:block">{w.week}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-5 text-sm text-white/60">{t("anniversary.night.barsNote", { max, min })}</p>
      </div>
    </section>
  );
}
