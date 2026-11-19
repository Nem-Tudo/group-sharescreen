"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK, MOTION_REDUCED } from "../gsap";
import { Mascot } from "../Mascot";

const STICKERS: { emoji: string; x: string; y: string; size: number; speed: number; rot: number }[] = [
  { emoji: "🎥", x: "8%", y: "18%", size: 46, speed: 1.4, rot: -12 },
  { emoji: "💬", x: "84%", y: "14%", size: 40, speed: 0.8, rot: 10 },
  { emoji: "🎮", x: "12%", y: "72%", size: 44, speed: 1.1, rot: 8 },
  { emoji: "🎧", x: "88%", y: "64%", size: 42, speed: 1.6, rot: -8 },
  { emoji: "🖥️", x: "70%", y: "84%", size: 36, speed: 0.6, rot: 6 },
  { emoji: "🍿", x: "26%", y: "88%", size: 34, speed: 1.9, rot: -4 },
  { emoji: "⭐", x: "62%", y: "8%", size: 28, speed: 1.2, rot: 0 },
  { emoji: "📱", x: "4%", y: "44%", size: 34, speed: 0.9, rot: 14 },
  { emoji: "🎉", x: "93%", y: "38%", size: 36, speed: 1.3, rot: -16 },
];

export function IntroSection() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const title = "GoLive";

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ delay: 0.25 });
        gsap.set(".i-show", { autoAlpha: 1 });
        gsap.set([".i-live", ".i-kicker", ".i-char", ".i-sub", ".i-mascot", ".i-hint"], { autoAlpha: 0 });
        for (const el of gsap.utils.toArray<HTMLElement>(".i-count")) {
          tl.fromTo(el, { scale: 2.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: "back.out(2.4)" }).to(
            el,
            { scale: 0.3, autoAlpha: 0, duration: 0.22, ease: "power2.in" },
            "+=0.28"
          );
        }
        tl.fromTo(".i-live", { scale: 0, rotate: -20 }, { scale: 1, rotate: 0, autoAlpha: 1, duration: 0.5, ease: "elastic.out(1, 0.5)" })
          .to(".i-live", { scale: 0.62, y: -150, autoAlpha: 0, duration: 0.45, ease: "power3.in" }, "+=0.35")
          .fromTo(".i-kicker", { y: 20 }, { y: 0, autoAlpha: 1, duration: 0.4 }, "-=0.1")
          .fromTo(
            ".i-char",
            { y: 120, rotate: (i) => (i % 2 ? 14 : -14), autoAlpha: 0 },
            { y: 0, rotate: 0, autoAlpha: 1, duration: 0.7, ease: "back.out(1.8)", stagger: 0.06 },
            "-=0.2"
          )
          .fromTo(".i-mascot", { y: 140, scale: 0.4 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: "elastic.out(1, 0.55)" }, "-=0.45")
          .fromTo(".i-sub", { y: 16 }, { y: 0, autoAlpha: 1, duration: 0.45 }, "-=0.55")
          .fromTo(".i-sticker", { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out(2)", stagger: 0.05 }, "-=0.5")
          .to(".i-hint", { autoAlpha: 1, duration: 0.4 });

        // On the way out: stickers drift at their own speed, the title sinks back.
        for (const el of gsap.utils.toArray<HTMLElement>(".i-sticker")) {
          gsap.to(el, {
            y: -Number(el.dataset.speed) * 260,
            rotate: `+=${Number(el.dataset.speed) * 40}`,
            ease: "none",
            scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true },
          });
        }
        gsap.to(".i-center", {
          scale: 0.86,
          y: 80,
          autoAlpha: 0.15,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true },
        });
      });
      mm.add(MOTION_REDUCED, () => {
        gsap.set(".i-show", { autoAlpha: 1 });
        gsap.set([".i-count", ".i-live"], { display: "none" });
      });
    },
    { scope: ref }
  );

  return (
    <section ref={ref} data-scene="intro" className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-4 pb-16 pt-20">
      <div className="anniv-blob left-[-10%] top-[5%] h-[45vh] w-[45vh] bg-[#6366f1]" />
      <div className="anniv-blob right-[-12%] top-[30%] h-[50vh] w-[50vh] bg-[#c026d3]" style={{ animationDelay: "-5s" }} />
      <div className="anniv-blob bottom-[-15%] left-[30%] h-[40vh] w-[40vh] bg-[#f43f5e]" style={{ animationDelay: "-9s" }} />
      <div className="anniv-grid-floor" />

      {STICKERS.map((s) => (
        <span
          key={s.emoji}
          className="i-sticker i-show invisible absolute select-none drop-shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
          data-speed={s.speed}
          style={{ left: s.x, top: s.y, fontSize: s.size, rotate: `${s.rot}deg` }}
          aria-hidden="true"
        >
          {s.emoji}
        </span>
      ))}

      {/* Countdown — stacked, one at a time */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {["3", "2", "1"].map((n) => (
          <span key={n} className="i-count anniv-pixel invisible absolute text-[110px] text-white sm:text-[160px]">
            {n}
          </span>
        ))}
        <span className="i-live invisible absolute flex items-center gap-3 rounded-2xl bg-[var(--a-rose)] px-6 py-3 text-3xl font-black tracking-wider text-white shadow-[0_0_80px_rgba(244,63,94,0.6)] sm:text-5xl">
          <span className="anniv-live-dot h-4 w-4 rounded-full bg-white sm:h-5 sm:w-5" />
          {t("anniversary.intro.live")}
        </span>
      </div>

      <div className="i-center relative z-10 flex flex-col items-center text-center">
        <p className="i-kicker i-show invisible anniv-pixel text-[10px] text-[var(--a-amber)] sm:text-sm">
          {t("anniversary.intro.kicker")}
        </p>
        <h1 className="mt-4 flex flex-col items-center font-extrabold leading-[0.9] tracking-tight">
          <span className="i-kicker i-show invisible text-3xl text-white/90 sm:text-5xl">
            {t("anniversary.intro.threeMonthsOf")}
          </span>
          <span className="mt-1 flex text-[22vw] sm:text-[10rem]" aria-label={title}>
            {title.split("").map((c, i) => (
              <span key={i} className="i-char i-show invisible anniv-grad-text inline-block" aria-hidden="true">
                {c}
              </span>
            ))}
          </span>
        </h1>
        <div className="i-mascot i-show invisible mt-2 w-36 sm:w-44">
          <Mascot mood="wave" />
        </div>
        <p className="i-sub i-show invisible mt-4 max-w-md text-lg font-semibold text-[var(--a-mute)] sm:text-xl">
          {t("anniversary.intro.sub")}
        </p>
        <p className="i-hint i-show invisible anniv-bounce-y mt-10 text-sm font-bold text-white/70">
          {t("anniversary.intro.scroll")} ↓
        </p>
      </div>
    </section>
  );
}
