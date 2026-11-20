"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/useI18n";
import { gsap, useGSAP, MOTION_OK, MOTION_REDUCED } from "../gsap";
import { Mascot } from "../Mascot";
import { FIRST_COMMIT_AT } from "../historyData";

const FIRST_COMMIT_MS = Date.parse(FIRST_COMMIT_AT);
const FPS = 30;

/** Time since the first commit as a broadcast timecode, HHHH:MM:SS:FF. */
function timecode(ms: number): string {
  const totalFrames = Math.max(0, Math.floor((ms / 1000) * FPS));
  const frames = totalFrames % FPS;
  const totalSeconds = Math.floor(totalFrames / FPS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(totalSeconds / 3600)}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

// The opener: a test card (colour bars) counts down 3-2-1, cuts to air, and
// the page's title comes up as a lower third, with the station clock running
// since the first commit. The countdown waits for the opening click (StartGate).
export function IntroSection({ started }: { started: boolean }) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const opener = useRef<gsap.core.Timeline | null>(null);

  // The running timecode. Filled on the client only (it is "now").
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (clock.current) clock.current.textContent = timecode(Date.now() - FIRST_COMMIT_MS);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.set(".i-show", { autoAlpha: 1 });
        gsap.set([".i-tag", ".i-line", ".i-sub", ".i-mascot", ".i-meta", ".i-hint"], { autoAlpha: 0 });
        gsap.set(".i-card", { autoAlpha: 1 });
        const tl = gsap.timeline({ delay: 0.2, paused: true });
        opener.current = tl;
        for (const el of gsap.utils.toArray<HTMLElement>(".i-count")) {
          tl.set(el, { autoAlpha: 1 }).to({}, { duration: 0.5 }).set(el, { autoAlpha: 0 });
        }
        // Cut to air: the test card collapses to a line, like an old set switching channel.
        tl.to(".i-card", { scaleY: 0.004, duration: 0.18, ease: "power4.in" })
          .to(".i-card", { scaleX: 0, duration: 0.14, ease: "power2.in" })
          .set(".i-card", { display: "none" })
          .fromTo(".i-strip", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.out" })
          .fromTo(".i-tag", { x: -30 }, { x: 0, autoAlpha: 1, duration: 0.35, ease: "power3.out" }, "-=0.2")
          .fromTo(
            ".i-line",
            { yPercent: 100, autoAlpha: 0 },
            { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: "power4.out", stagger: 0.09 },
            "-=0.1"
          )
          .fromTo(".i-mascot", { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, ease: "back.out(1.6)" }, "-=0.4")
          .fromTo([".i-sub", ".i-meta", ".i-hint"], { y: 12 }, { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.08 }, "-=0.5");

        gsap.to(".i-content", {
          y: 60,
          autoAlpha: 0.2,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true },
        });
      });
      mm.add(MOTION_REDUCED, () => {
        gsap.set(".i-show", { autoAlpha: 1 });
        gsap.set(".i-card", { display: "none" });
      });
    },
    { scope: ref }
  );

  useEffect(() => {
    if (started) opener.current?.play();
  }, [started]);

  const lines = [t("anniversary.intro.threeMonthsOf"), "Go Live"];

  return (
    <section ref={ref} data-scene="intro" className="relative flex min-h-[100svh] flex-col overflow-hidden px-4 pb-10 pt-20 sm:px-8">
      {/* The test card, over everything until the cut */}
      <div className="i-card invisible pointer-events-none absolute inset-0 z-20 flex flex-col" aria-hidden="true">
        <div className="anniv-bars flex-[7]" />
        <div className="anniv-bars-low flex-1" />
        <div className="flex flex-[2] bg-[#111215]">
          <div className="flex-[5] bg-[#00214c]" />
          <div className="flex-[5] bg-white" />
          <div className="flex-[5] bg-[#32006a]" />
          <div className="flex-[10] bg-[#111215]" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex h-36 w-44 items-center justify-center bg-black sm:h-44 sm:w-56">
            {["3", "2", "1"].map((n) => (
              <span key={n} className="i-count anniv-mono invisible absolute text-8xl font-semibold text-white sm:text-9xl">
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* What stays of the card once on air */}
      <div className="i-strip anniv-bars absolute inset-x-0 top-0 h-1.5 origin-left" aria-hidden="true" />

      <div className="i-content relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="i-tag i-show invisible flex flex-wrap items-center gap-3">
            <span className="anniv-onair text-xs">
              <span className="anniv-live-dot h-1.5 w-1.5 rounded-full bg-white" />
              {t("anniversary.intro.live")}
            </span>
            <span className="anniv-mono text-xs uppercase text-[var(--a-mute)]">{t("anniversary.intro.onAirSince")}</span>
          </p>
          <h1 className="anniv-display mt-6">
            {lines.map((line, i) => (
              <span key={i} className="block overflow-hidden">
                <span
                  className={`i-line i-show invisible block ${i === 0 ? "text-[13vw] text-[var(--a-mute)] sm:text-[6.5rem]" : "text-[25vw] sm:text-[12rem] lg:text-[14rem]"}`}
                >
                  {line}
                </span>
              </span>
            ))}
          </h1>
          <p className="i-sub i-show invisible mt-6 max-w-xl text-lg leading-relaxed text-[var(--a-mute)] sm:text-xl">
            {t("anniversary.intro.sub")}
          </p>
          <div className="i-meta i-show invisible mt-8 inline-flex items-center gap-4 border border-[var(--a-line)] px-4 py-3">
            <span className="anniv-mono text-[11px] uppercase text-[var(--a-mute)]">{t("anniversary.intro.timecode")}</span>
            <span ref={clock} className="anniv-mono text-xl font-medium tabular-nums text-[var(--a-ink)] sm:text-2xl">
              0:00:00:00
            </span>
          </div>
        </div>
        <div className="i-mascot i-show invisible mx-auto w-40 sm:w-56 lg:w-64">
          <Mascot mood="wave" />
        </div>
      </div>

      <p className="i-hint i-show invisible anniv-mono relative z-10 mx-auto mt-8 w-full max-w-6xl text-xs uppercase text-[var(--a-mute)]">
        {t("anniversary.intro.scroll")} ↓
      </p>
    </section>
  );
}
