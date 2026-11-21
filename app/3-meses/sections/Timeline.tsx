"use client";

import { useRef } from "react";
import { useLocale, useT, useTCount } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle } from "../shared";
import { TIMELINE } from "../historyData";

const MONTHS = ["08", "09", "10", "11"];

// The run of show: every launch in order, grouped by month, read top to
// bottom like a broadcast rundown. A tally line runs down the left as the
// page scrolls, and each entry lights up as it reaches the middle of the
// screen — the line is complete when the last entry is there.
export function TimelineSection() {
  const t = useT();
  const tc = useTCount();
  const locale = useLocale();
  const ref = useRef<HTMLElement>(null);
  const monthFmt = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "long", year: "numeric", timeZone: "UTC" });

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          ".tl-fill",
          { scaleY: 0 },
          { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".tl-list", start: "top center", end: "bottom center", scrub: true } }
        );
        for (const item of gsap.utils.toArray<HTMLElement>(".tl-item")) {
          ScrollTrigger.create({ trigger: item, start: "top center", toggleClass: { targets: item, className: "is-on" } });
        }
        gsap.set(".tl-item", { autoAlpha: 0, x: -16 });
        ScrollTrigger.batch(".tl-item", {
          start: "top 88%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, x: 0, duration: 0.45, ease: "power3.out", stagger: 0.05 }),
        });
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="timeline" className="relative px-4 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <SceneTitle kicker={t("anniversary.timeline.kicker")} title={t("anniversary.timeline.title")} color="var(--a-blue)" />

        <div className="tl-list relative mt-14">
          {/* The rail, and the tally that fills it */}
          <div className="absolute bottom-0 left-[4.75rem] top-0 w-px bg-[var(--a-line)] sm:left-[7.25rem]" aria-hidden="true">
            <div className="tl-fill h-full w-full origin-top bg-[var(--a-tally)] motion-reduce:scale-y-100" />
          </div>

          {MONTHS.map((month) => {
            const items = TIMELINE.filter((m) => m.date.startsWith(month));
            if (items.length === 0) return null;
            return (
              <div key={month} className="mb-10">
                <h3 className="anniv-mono relative mb-2 flex items-baseline gap-3 bg-[var(--a-bg)] py-2 text-xs uppercase text-[var(--a-mute)]">
                  <span className="font-semibold text-[var(--a-ink)]">{monthFmt.format(new Date(`2026-${month}-15T12:00:00Z`))}</span>
                  <span>· {tc("anniversary.timeline.entries", items.length)}</span>
                </h3>
                <ol>
                  {items.map((m) => (
                    <li
                      key={m.key}
                      className="tl-item group grid grid-cols-[4.75rem_1fr] items-baseline gap-x-6 border-b border-[var(--a-line)] py-5 sm:grid-cols-[7.25rem_1fr] sm:gap-x-10"
                    >
                      <span className="anniv-mono relative pr-4 text-sm tabular-nums text-[var(--a-mute)] transition-colors group-[.is-on]:text-[var(--a-ink)]">
                        {m.date.slice(3)}.{m.date.slice(0, 2)}
                        <span
                          className="absolute -right-[5px] top-1.5 h-[9px] w-[9px] border border-[var(--a-mute)] bg-[var(--a-bg)] transition-colors group-[.is-on]:border-[var(--a-tally)] group-[.is-on]:bg-[var(--a-tally)]"
                          aria-hidden="true"
                        />
                      </span>
                      <div className="min-w-0 pl-2">
                        <h4 className="text-lg font-semibold leading-snug sm:text-xl">{t(`anniversary.tl.${m.key}.title`)}</h4>
                        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-[var(--a-mute)]">{t(`anniversary.tl.${m.key}.text`)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}

          <div className="grid grid-cols-[4.75rem_1fr] items-baseline gap-x-6 py-5 sm:grid-cols-[7.25rem_1fr] sm:gap-x-10">
            <span className="anniv-mono text-sm text-[var(--a-tally)]">→</span>
            <div className="pl-2">
              <h4 className="text-lg font-semibold sm:text-xl">{t("anniversary.timeline.nextTitle")}</h4>
              <p className="mt-1 text-[15px] text-[var(--a-mute)]">{t("anniversary.timeline.nextText")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
