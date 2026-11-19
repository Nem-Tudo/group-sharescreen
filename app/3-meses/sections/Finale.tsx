"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { ANNIVERSARY_EVENTS, trackAnniversary } from "@/lib/anniversary";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "../gsap";
import { Mascot } from "../Mascot";

const DISCORD_URL = "https://go.nemtudo.me/golive-nemtudodiscord";

export function FinaleSection({ onCelebrate }: { onCelebrate: () => void }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useGSAP(
    () => {
      ScrollTrigger.create({ trigger: ref.current, start: "top 45%", onEnter: () => onCelebrate() });
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          ".fin-mascot",
          { y: 120, scale: 0.3, autoAlpha: 0 },
          {
            y: 0,
            scale: 1,
            autoAlpha: 1,
            duration: 1.1,
            ease: "elastic.out(1, 0.5)",
            scrollTrigger: { trigger: ref.current, start: "top 55%", once: true },
          }
        );
        gsap.to(".fin-mascot-jump", { y: -26, duration: 0.42, ease: "power2.out", yoyo: true, repeat: -1 });
        gsap.fromTo(
          ".fin-word",
          { y: 80, autoAlpha: 0, rotate: (i) => (i % 2 ? 10 : -10) },
          {
            y: 0,
            autoAlpha: 1,
            rotate: 0,
            duration: 0.8,
            ease: "back.out(2)",
            stagger: 0.08,
            scrollTrigger: { trigger: ".fin-title", start: "top 80%", once: true },
          }
        );
      });
    },
    { scope: ref }
  );

  const share = async () => {
    trackAnniversary(ANNIVERSARY_EVENTS.share);
    const url = `${window.location.origin}/3-meses`;
    const data = { title: t("anniversary.meta.title"), text: t("anniversary.finale.shareText"), url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      // Cancelled, or refused: fall through to copying the link.
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Nothing more to try.
    }
  };

  const words = t("anniversary.finale.title").split(" ");
  const thanks = ["obrigado", "thank you", "gracias", "valeu", "obrigada", "merci", "danke", "arigatō"];

  return (
    <section ref={ref} data-scene="finale" className="relative overflow-hidden px-4 pb-16 pt-28 sm:pt-36">
      <div className="anniv-blob left-[-10%] top-[20%] h-[40vh] w-[40vh] bg-[#f43f5e]" />
      <div className="anniv-blob right-[-10%] top-[40%] h-[45vh] w-[45vh] bg-[#6366f1]" style={{ animationDelay: "-6s" }} />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="fin-mascot w-44 sm:w-56">
          <div className="fin-mascot-jump">
            <Mascot mood="party" />
          </div>
        </div>
        <h2 className="fin-title mt-6 flex flex-wrap justify-center gap-x-[0.28em] text-[2.6rem] font-black leading-[1.02] tracking-tight sm:text-7xl">
          {words.map((w, i) => (
            <span key={i} className="fin-word anniv-grad-text inline-block">
              {w}
            </span>
          ))}
        </h2>
        <p data-reveal className="mt-6 text-lg leading-relaxed text-white/80 sm:text-xl">
          {t("anniversary.finale.p1")}
        </p>
        <p data-reveal className="mt-4 text-lg leading-relaxed text-white/80 sm:text-xl">
          {t("anniversary.finale.p2")}
        </p>

        <div data-reveal className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={share}
            className="rounded-2xl bg-white px-7 py-4 text-base font-extrabold text-zinc-900 shadow-[0_10px_40px_rgba(255,255,255,0.25)] transition hover:scale-[1.04] active:scale-95"
          >
            {copied ? `✔ ${t("anniversary.finale.copied")}` : `📣 ${t("anniversary.finale.share")}`}
          </button>
          <Link
            href="/"
            className="rounded-2xl bg-[var(--a-rose)] px-7 py-4 text-base font-extrabold text-white shadow-[0_10px_40px_rgba(244,63,94,0.4)] transition hover:scale-[1.04] active:scale-95"
          >
            🔴 {t("anniversary.finale.createRoom")}
          </Link>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl border border-white/20 px-7 py-4 text-base font-extrabold text-white transition hover:scale-[1.04] hover:bg-white/10 active:scale-95"
          >
            💬 {t("anniversary.finale.discord")}
          </a>
        </div>
      </div>

      <div className="relative mt-24 -rotate-2 overflow-hidden bg-[var(--a-amber)] py-3 text-zinc-900" aria-hidden="true">
        <div className="anniv-marquee flex w-max gap-8 whitespace-nowrap text-2xl font-black uppercase">
          {[...thanks, ...thanks, ...thanks, ...thanks].map((w, i) => (
            <span key={i}>
              {w} <span className="opacity-50">✦</span>
            </span>
          ))}
        </div>
      </div>

      <p className="relative mt-16 text-center text-sm text-white/45">{t("anniversary.finale.footer")}</p>
    </section>
  );
}
