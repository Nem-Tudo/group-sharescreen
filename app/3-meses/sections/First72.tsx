"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle } from "../shared";
import { FIRST_HOURS } from "../historyData";

export function First72Section() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const msgs = gsap.utils.toArray<HTMLElement>(".f72-msg");
        gsap.set(msgs, { autoAlpha: 0, y: 30, scale: 0.9, transformOrigin: "0% 100%" });
        ScrollTrigger.batch(msgs, {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.8)", stagger: 0.12 }),
        });
        gsap.fromTo(
          ".f72-typing",
          { autoAlpha: 0 },
          { autoAlpha: 1, scrollTrigger: { trigger: ".f72-typing", start: "top 92%", toggleActions: "play none none reverse" } }
        );
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="first72" className="relative px-4 py-28 sm:py-36">
      <SceneTitle
        kicker={t("anniversary.first72.kicker")}
        title={t("anniversary.first72.title")}
        sub={t("anniversary.first72.sub")}
        color="var(--a-green)"
      />

      <div data-reveal className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-3xl border border-[var(--a-line)] bg-[#0d1117] shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
          <span className="text-white/40">#</span>
          <span className="font-bold">{t("anniversary.first72.channel")}</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-[var(--a-rose)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--a-rose)]">
            <span className="anniv-live-dot h-1.5 w-1.5 rounded-full bg-[var(--a-rose)]" />
            72h
          </span>
        </div>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          {FIRST_HOURS.map((item) => {
            const text = t(`anniversary.first72.${item.key}`);
            if (item.tag === "live") {
              return (
                <div key={item.key} className="f72-msg flex justify-center">
                  <span className="rounded-full bg-[var(--a-rose)] px-4 py-1.5 text-center text-xs font-bold text-white shadow-[0_0_30px_rgba(244,63,94,0.45)] sm:text-sm">
                    🔴 {text} <span className="font-medium opacity-80">· {item.at}</span>
                  </span>
                </div>
              );
            }
            const community = item.tag === "pr";
            return (
              <div key={item.key} className="f72-msg flex gap-3">
                {community ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#238636] text-lg">🧑‍💻</span>
                ) : (
                  <img src="/icon.png" alt="" className="h-10 w-10 shrink-0 rounded-full" />
                )}
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`font-bold ${community ? "text-[#3fb950]" : "text-[#a5b4fc]"}`}>
                      {community ? t("anniversary.first72.community") : "Nem Tudo"}
                    </span>
                    <span className="text-[11px] text-white/35">{item.at}</span>
                  </p>
                  <p className="mt-0.5 text-[15px] leading-snug text-white/85">{text}</p>
                </div>
              </div>
            );
          })}
          <p className="f72-typing pl-1 text-xs italic text-white/40">{t("anniversary.first72.typing")}</p>
        </div>
      </div>
    </section>
  );
}
