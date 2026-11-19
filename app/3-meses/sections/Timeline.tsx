"use client";

import { useRef } from "react";
import { useLocale, useT } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { gsap, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle } from "../shared";
import { TIMELINE } from "../historyData";

const MONTH_COLOR: Record<string, string> = {
  "08": "#fbbf24",
  "09": "#f472b6",
  "10": "#38bdf8",
  "11": "#34d399",
};

// Pinned: vertical scrolling slides the months sideways, like a train.
// With reduced motion it is a plain sideways-scrolling row.
export function TimelineSection() {
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLElement>(null);
  const dateFmt = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: "2-digit", month: "short", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "long", timeZone: "UTC" });

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const track = ref.current?.querySelector<HTMLElement>(".tl-track");
        if (!track) return;
        const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
        const slide = gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: ref.current,
            pin: ".tl-pin",
            start: "top top",
            end: () => `+=${distance()}`,
            scrub: 0.7,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });
        gsap.to(".tl-months", {
          x: () => -distance() * 0.35,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top top", end: () => `+=${distance()}`, scrub: 0.7, invalidateOnRefresh: true },
        });
        gsap.to(".tl-progress", {
          scaleX: 1,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top top", end: () => `+=${distance()}`, scrub: true, invalidateOnRefresh: true },
        });
        for (const card of gsap.utils.toArray<HTMLElement>(".tl-card")) {
          gsap.fromTo(
            card,
            { y: 80, rotate: 8, scale: 0.85, autoAlpha: 0.2 },
            {
              y: 0,
              rotate: 0,
              scale: 1,
              autoAlpha: 1,
              ease: "back.out(1.4)",
              scrollTrigger: { trigger: card, containerAnimation: slide, start: "left 92%", end: "left 62%", scrub: true },
            }
          );
        }
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="timeline" className="relative">
      <div className="tl-pin relative flex min-h-[100svh] flex-col justify-center overflow-hidden py-16">
        <div className="tl-months pointer-events-none absolute left-0 top-1/2 flex -translate-y-1/2 gap-[18vw] whitespace-nowrap pl-[60vw] text-[22vw] font-black uppercase leading-none text-white/[0.035] sm:text-[16vw]" aria-hidden="true">
          {["08", "09", "10", "11"].map((m) => (
            <span key={m}>{monthFmt.format(new Date(`2026-${m}-15T12:00:00Z`))}</span>
          ))}
        </div>

        <div className="px-4">
          <SceneTitle kicker={t("anniversary.timeline.kicker")} title={t("anniversary.timeline.title")} color="var(--a-violet)" />
        </div>

        <div className="relative mx-4 mt-10 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mx-auto sm:w-[min(640px,80vw)]">
          <div className="tl-progress h-full origin-left scale-x-0 rounded-full bg-[linear-gradient(90deg,#fbbf24,#f472b6,#38bdf8,#34d399)] motion-reduce:scale-x-100" />
        </div>

        <div className="tl-scroller mt-10 overflow-x-auto motion-safe:overflow-visible [scrollbar-width:none]">
          <ol className="tl-track flex w-max gap-5 px-[8vw] pb-4 sm:gap-6">
            {TIMELINE.map((m) => {
              const color = MONTH_COLOR[m.date.slice(0, 2)];
              return (
                <li
                  key={m.key}
                  className="tl-card relative flex h-[330px] w-[260px] shrink-0 flex-col rounded-[28px] border border-white/10 bg-[var(--a-card)] p-6 sm:w-[300px]"
                >
                  <span
                    className="absolute inset-x-0 top-0 h-1.5 rounded-t-[28px]"
                    style={{ background: color }}
                    aria-hidden="true"
                  />
                  <span className="anniv-pixel text-[10px]" style={{ color }}>
                    {dateFmt.format(new Date(`2026-${m.date}T12:00:00Z`)).replace(".", "")}
                  </span>
                  <span className="mt-5 text-6xl" aria-hidden="true">
                    {m.emoji}
                  </span>
                  <h3 className="mt-5 text-xl font-extrabold leading-tight">{t(`anniversary.tl.${m.key}.title`)}</h3>
                  <p className="mt-2 text-[14.5px] leading-snug text-[var(--a-mute)]">{t(`anniversary.tl.${m.key}.text`)}</p>
                </li>
              );
            })}
            <li className="tl-card flex h-[330px] w-[260px] shrink-0 flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-white/20 p-6 text-center sm:w-[300px]">
              <span className="text-6xl" aria-hidden="true">
                🔮
              </span>
              <h3 className="mt-5 text-xl font-extrabold">{t("anniversary.timeline.nextTitle")}</h3>
              <p className="mt-2 text-sm text-[var(--a-mute)]">{t("anniversary.timeline.nextText")}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
