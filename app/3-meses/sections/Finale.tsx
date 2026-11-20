"use client";

import Link from "next/link";
import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { ANNIVERSARY_EVENTS, ANNIVERSARY_HASHTAG, anniversaryShareUrl, trackAnniversary, type AnniversaryStats } from "@/lib/anniversary";
import { HARD_FIGURES } from "../historyData";
import { useNumberFormat } from "../shared";
import { ShareSheet } from "../ShareSheet";
import { drawPageCard } from "../shareCard";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "../gsap";
import { Mascot } from "../Mascot";

const DISCORD_URL = "https://go.nemtudo.me/golive-nemtudodiscord";
const THANKS = ["obrigado", "thank you", "gracias", "valeu", "obrigada", "merci", "danke", "grazie", "arigatō"];

// Sign-off: the thank-you, the three ways out, and a news crawl along the
// bottom like the end of a broadcast.
export function FinaleSection({ onCelebrate, stats }: { onCelebrate: () => void; stats: AnniversaryStats | null }) {
  const t = useT();
  const fmt = useNumberFormat();
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      ScrollTrigger.create({ trigger: ref.current, start: "top 45%", onEnter: () => onCelebrate() });
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          ".fin-line",
          { yPercent: 100, autoAlpha: 0 },
          {
            yPercent: 0,
            autoAlpha: 1,
            duration: 0.7,
            ease: "power4.out",
            stagger: 0.08,
            scrollTrigger: { trigger: ".fin-title", start: "top 80%", once: true },
          }
        );
        gsap.fromTo(
          ".fin-mascot",
          { y: 80, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.9, ease: "back.out(1.6)", scrollTrigger: { trigger: ref.current, start: "top 60%", once: true } }
        );
        gsap.to(".fin-mascot-jump", { y: -18, duration: 0.45, ease: "power2.out", yoyo: true, repeat: -1 });
      });
    },
    { scope: ref }
  );

  // The page's own story picture, for whoever has no recap to post.
  const drawCard = () =>
    drawPageCard(
      {
        kicker: t("anniversary.card.pageKicker"),
        title: t("anniversary.card.pageTitle").split("|"),
        stats: [
          ...(stats ? [{ value: fmt(stats.accounts), label: t("anniversary.numbers.accounts") }] : []),
          ...(stats ? [{ value: fmt(stats.callHours), label: t("anniversary.numbers.callHours") }] : []),
          { value: fmt(stats?.peakSockets ?? HARD_FIGURES.sockets), label: t("anniversary.card.record") },
        ],
        text: t("anniversary.card.pageText"),
      },
      { live: t("anniversary.card.live"), brand: t("anniversary.card.brand"), hashtag: ANNIVERSARY_HASHTAG, url: "golive.nemtudo.me/3-meses" }
    );

  const lines = t("anniversary.finale.title").split("|");
  const button =
    "anniv-mono inline-flex items-center justify-center gap-2 px-6 py-4 text-sm font-semibold uppercase transition-colors";

  return (
    <section ref={ref} data-scene="finale" className="relative overflow-hidden pb-14 pt-28 sm:pt-36">
      <div className="mx-auto grid max-w-6xl items-end gap-10 px-4 sm:px-8 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="anniv-mono flex items-center gap-2.5 text-xs uppercase text-[var(--a-tally)]">
            <span className="h-2 w-2 bg-[var(--a-tally)]" aria-hidden="true" />
            {t("anniversary.finale.kicker")}
          </p>
          <h2 className="fin-title anniv-display mt-5 text-[15vw] sm:text-[8rem] lg:text-[9.5rem]">
            {lines.map((line, i) => (
              <span key={i} className="block overflow-hidden">
                <span className={`fin-line block ${i === lines.length - 1 ? "text-[var(--a-blue)]" : ""}`}>{line}</span>
              </span>
            ))}
          </h2>
          <p data-reveal className="mt-8 max-w-2xl text-lg leading-relaxed text-[var(--a-ink)]/85 sm:text-xl">
            {t("anniversary.finale.p1")}
          </p>
          <p data-reveal className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--a-mute)] sm:text-xl">
            {t("anniversary.finale.p2")}
          </p>

          <div data-reveal className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.ctaRoom)}
              className={`${button} bg-[var(--a-tally)] text-white hover:brightness-110`}
            >
              <span className="h-2 w-2 rounded-full bg-white" aria-hidden="true" />
              {t("anniversary.finale.createRoom")}
            </Link>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackAnniversary(ANNIVERSARY_EVENTS.ctaDiscord)}
              className={`${button} border border-[var(--a-line)] text-[var(--a-ink)] hover:border-[var(--a-ink)]`}
            >
              {t("anniversary.finale.discord")} ↗
            </a>
          </div>

          <div data-reveal className="mt-10">
            <p className="anniv-mono mb-3 text-xs uppercase text-[var(--a-mute)]">{t("anniversary.finale.share")}</p>
            <ShareSheet
              text={t("anniversary.finale.shareText")}
              url={anniversaryShareUrl("share")}
              card={drawCard}
              onShare={() => trackAnniversary(ANNIVERSARY_EVENTS.share)}
            />
          </div>
        </div>
        <div className="fin-mascot mx-auto w-40 sm:w-52">
          <div className="fin-mascot-jump">
            <Mascot mood="party" />
          </div>
        </div>
      </div>

      {/* The crawl */}
      <div className="mt-24 flex items-stretch border-y border-[var(--a-line)] bg-[var(--a-bg-2)]" aria-hidden="true">
        <span className="anniv-onair z-10 shrink-0 rounded-none px-4 text-sm">{t("anniversary.intro.live")}</span>
        <div className="min-w-0 flex-1 overflow-hidden py-3">
          <div className="anniv-crawl anniv-mono flex w-max gap-10 whitespace-nowrap text-sm uppercase text-[var(--a-ink)]">
            {[...THANKS, ...THANKS, ...THANKS, ...THANKS].map((word, i) => (
              <span key={i}>
                {word} <span className="text-[var(--a-mute)]">/</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="anniv-mono mx-auto mt-10 max-w-6xl px-4 text-xs uppercase text-[var(--a-mute)] sm:px-8">{t("anniversary.finale.footer")}</p>
    </section>
  );
}
