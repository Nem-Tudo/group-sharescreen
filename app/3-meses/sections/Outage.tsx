"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK } from "../gsap";
import { SceneTitle, useNumberFormat } from "../shared";
import { HARD_FIGURES } from "../historyData";

const NIGHT_LOG = [
  { at: "00:03", msg: "down site warn", color: "#f87171" },
  { at: "00:10", msg: "website is back", color: "#34d399" },
  { at: "00:13", msg: "site is down", color: "#f87171" },
  { at: "00:14", msg: "is back again (vou fazer uma API pra isso relaxa)", color: "#34d399" },
];

export function OutageSection({ peak }: { peak: number }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const fmt = useNumberFormat();

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const shake = gsap.timeline({ paused: true });
        shake
          .to(".out-flash", { autoAlpha: 0.55, duration: 0.06 })
          .to(".out-flash", { autoAlpha: 0, duration: 0.4 })
          .fromTo(
            ".out-crt",
            { x: 0, rotate: 0 },
            { x: "random(-14, 14)", rotate: "random(-1.5, 1.5)", duration: 0.05, repeat: 9, yoyo: true, ease: "none", clearProps: "x,rotate" },
            0
          );
        gsap.set(".out-crt", { autoAlpha: 0, scaleY: 0.02 });
        gsap
          .timeline({
            scrollTrigger: { trigger: ".out-crt-wrap", start: "top 70%", once: true },
          })
          .to(".out-crt", { autoAlpha: 1, duration: 0.01 })
          .to(".out-crt", { scaleY: 1, duration: 0.35, ease: "expo.out" })
          .from(".out-line", { autoAlpha: 0, x: -20, stagger: 0.18, duration: 0.3 })
          .add(() => {
            shake.restart();
          }, 0.2);

        gsap.from(".out-log", {
          autoAlpha: 0,
          x: (i) => (i % 2 ? 40 : -40),
          stagger: 0.25,
          duration: 0.5,
          ease: "back.out(2)",
          scrollTrigger: { trigger: ".out-logs", start: "top 80%", once: true },
        });
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="outage" className="relative overflow-hidden bg-black px-4 py-28 sm:py-36">
      <div className="anniv-static" />
      <div className="anniv-scanlines" />
      <div className="out-flash pointer-events-none invisible absolute inset-0 bg-red-600" />

      <SceneTitle
        kicker={t("anniversary.outage.kicker")}
        title={t("anniversary.outage.title")}
        sub={t("anniversary.outage.sub")}
        color="#f87171"
        glitch
      />

      <div className="out-crt-wrap relative mx-auto mt-12 max-w-6xl">
        <div className="out-crt relative max-w-2xl rounded-[28px] border-[10px] border-[#1f2230] bg-[#0b0b0b] p-6 shadow-[0_0_120px_rgba(244,63,94,0.25)] sm:p-9">
          <div className="anniv-scanlines rounded-[18px]" />
          <div className="relative space-y-3 font-[family-name:var(--font-geist-sans)] text-lg font-bold leading-snug sm:text-2xl">
            <h3 className="out-line" style={{ color: "#ff2828", fontSize: "1.3em" }}>
              {t("page.theSiteIsTemporarilyDown")}
            </h3>
            <p className="out-line" style={{ color: "#ff6767" }}>
              {t("page.theApiRestartedToUpdateAnd")}
            </p>
            <p className="out-line" style={{ color: "#ff6767" }}>
              {t("page.iMCodingALoadBalancing")}
            </p>
            <p className="out-line" style={{ color: "#ff6767" }}>
              {t("page.itShouldBeBackInAbout")}
            </p>
          </div>
          <p className="anniv-mono relative mt-6 text-right text-[9px] text-white/30">golive.nemtudo.me · 20/08 00:03</p>
        </div>
      </div>

      <div className="out-logs relative mx-auto mt-14 max-w-6xl [&>*]:max-w-2xl">
        <p data-reveal className="anniv-mono mb-4 text-xs uppercase text-white/50">
          {t("anniversary.outage.logTitle")}
        </p>
        <div className="space-y-2.5">
          {NIGHT_LOG.map((log) => (
            <div key={log.at} className="out-log flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-mono text-[13px] sm:text-sm">
              <span className="shrink-0 text-white/40">{log.at}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: log.color }} />
              <span className="min-w-0 break-words" style={{ color: log.color }}>
                {log.msg}
              </span>
            </div>
          ))}
        </div>
        <p data-reveal className="mt-10 text-lg leading-relaxed text-white/75">
          {t("anniversary.outage.moral", {
            people: fmt(HARD_FIGURES.reconnecting),
            sockets: fmt(peak),
          })}
        </p>
      </div>
    </section>
  );
}
