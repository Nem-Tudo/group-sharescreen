"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK, MOTION_REDUCED } from "../gsap";
import { SceneTitle } from "../shared";
import { BUGS } from "../historyData";

const TILT = [-3, 2, -1.5, 3, -2.5, 1.5, -2, 2.5, -1, 2];
const PAPER = ["#fef08a", "#fbcfe8", "#bae6fd", "#bbf7d0", "#fed7aa", "#ddd6fe"];

export function BugsSection({ onSquash }: { onSquash: (all: boolean) => void }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const [fixed, setFixed] = useState<Set<string>>(new Set());

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const cards = gsap.utils.toArray<HTMLElement>(".bug-card");
        gsap.set(cards, { autoAlpha: 0, y: -260, rotate: (i) => (i % 2 ? 40 : -40) });
        ScrollTrigger.batch(cards, {
          start: "top 92%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              rotate: (_i, el: HTMLElement) => Number(el.dataset.tilt),
              duration: 1.1,
              ease: "bounce.out",
              stagger: 0.12,
            }),
        });
      });
      mm.add(MOTION_REDUCED, () => {
        gsap.set(".bug-card", { rotate: (_i: number, el: HTMLElement) => Number(el.dataset.tilt) });
      });
    },
    { scope: ref }
  );

  const squash = (key: string, el: HTMLElement) => {
    if (fixed.has(key)) return;
    const next = new Set(fixed).add(key);
    setFixed(next);
    onSquash(next.size === BUGS.length);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(el, { scale: 0.92 }, { scale: 1, duration: 0.5, ease: "elastic.out(1.2, 0.4)" });
    }
  };

  return (
    <section ref={ref} data-scene="bugs" className="relative px-4 py-28 sm:py-36">
      <SceneTitle
        kicker={t("anniversary.bugs.kicker")}
        title={t("anniversary.bugs.title")}
        sub={t("anniversary.bugs.sub")}
        color="#fb7185"
        glitch
      />
      <p data-reveal className="mt-4 text-center text-sm font-bold text-[var(--a-amber)]">
        {fixed.size === BUGS.length
          ? t("anniversary.bugs.allFixed")
          : t("anniversary.bugs.progress", { n: fixed.size, total: BUGS.length })}
      </p>

      <ul className="mx-auto mt-12 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {BUGS.map((bug, i) => {
          const done = fixed.has(bug.key);
          const title = t(`anniversary.bugs.${bug.key}.title`);
          return (
            <li key={bug.key} className="bug-card" data-tilt={TILT[i % TILT.length]}>
              <button
                type="button"
                onClick={(e) => squash(bug.key, e.currentTarget)}
                className="anniv-bug relative block w-full rounded-2xl p-5 text-left text-zinc-900 shadow-[0_14px_40px_rgba(0,0,0,0.35)] hover:-translate-y-1"
                style={{ background: PAPER[i % PAPER.length] }}
                aria-pressed={done}
              >
                <span className="absolute left-1/2 top-[-10px] h-5 w-16 -translate-x-1/2 rotate-[-3deg] bg-white/60" aria-hidden="true" />
                <div className="flex items-start justify-between gap-3">
                  <span className="text-4xl" aria-hidden="true">
                    {bug.emoji}
                  </span>
                  <span className="rounded-full bg-black/10 px-2.5 py-1 text-xs font-bold">{bug.date}</span>
                </div>
                <h3 className={`mt-3 text-lg font-extrabold leading-tight ${done ? "line-through decoration-[3px] opacity-60" : ""}`}>{title}</h3>
                <p className="mt-2 text-[14.5px] leading-snug text-zinc-700">{t(`anniversary.bugs.${bug.key}.text`)}</p>
                {bug.commit && (
                  <p className="mt-3 break-words rounded-lg bg-zinc-900 px-3 py-2 font-mono text-[12px] text-[#f87171]">
                    git commit -m &quot;{bug.commit}&quot;
                  </p>
                )}
                {done ? (
                  <span className="anniv-stamp pointer-events-none absolute right-4 top-1/2 rounded-lg border-[3px] border-emerald-600 px-3 py-1 text-lg font-black uppercase tracking-wider text-emerald-600">
                    {t("anniversary.bugs.stamp")}
                  </span>
                ) : (
                  <span className="mt-3 block text-xs font-bold text-zinc-500">{t("anniversary.bugs.tapToFix")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
