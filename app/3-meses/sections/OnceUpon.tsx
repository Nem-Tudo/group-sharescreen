"use client";

import { useRef } from "react";
import { useT } from "@/lib/useI18n";
import { ANNIVERSARY_EVENTS, trackAnniversary } from "@/lib/anniversary";
import { gsap, useGSAP } from "../gsap";
import { SceneTitle, ScaledStage } from "../shared";
import { Day1Landing, LaunchLanding, NewRoom, OldRoom } from "../mocks";

// Pinned: scrolling plays the first two days of the site in a browser
// window — "ShareScreen", the rename (and its subtitle), the launch landing
// with its counter, then the room of day one against the room of today.

export function OnceUponSection() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const compare = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);

  const setSplit = (percent: number) => {
    compare.current?.style.setProperty("--split", `${percent}%`);
  };

  useGSAP(
    () => {
      const move = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const counter = ref.current?.querySelector<HTMLElement>(".ou-count");
      gsap.set([".ou-cap-2", ".ou-cap-3", ".ou-cap-4", ".ou-tab-2", ".ou-tab-3", ".ou-url-2", ".ou-c", ".ou-d"], { autoAlpha: 0 });

      // The two moving pictures inside the scene (the launch counter and the
      // before/after sweep) play on their own clock once their step has
      // settled, rather than following the scroll: a number stopped halfway
      // by a pause in scrolling reads as the real one.
      const count = { n: 0 };
      let countTween: gsap.core.Tween | null = null;
      const showCount = () => {
        if (counter) counter.textContent = Math.round(count.n).toLocaleString();
      };
      const playCount = () => {
        countTween?.kill();
        count.n = 0;
        countTween = gsap.to(count, { n: 2000, duration: move ? 1.4 : 0, ease: "power2.out", onUpdate: showCount });
      };
      const resetCount = () => {
        countTween?.kill();
        count.n = 0;
        showCount();
      };
      const split = { v: 100 };
      let sweep: gsap.core.Timeline | null = null;
      const playSweep = () => {
        sweep?.kill();
        if (!move) return setSplit(50);
        split.v = 100;
        sweep = gsap
          .timeline({ onUpdate: () => setSplit(split.v) })
          .to(split, { v: 12, duration: 1, ease: "power2.inOut" })
          .to(split, { v: 50, duration: 0.6, ease: "power2.inOut" });
      };
      const resetSweep = () => {
        sweep?.kill();
        setSplit(100);
      };

      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut", duration: 0.5 },
        scrollTrigger: {
          trigger: ref.current,
          pin: ".ou-pin",
          start: "top top",
          end: "+=210%",
          scrub: 0.3,
          anticipatePin: 1,
          // Settles on a step instead of stopping between two pictures.
          snap: { snapTo: "labelsDirectional", duration: { min: 0.2, max: 0.5 }, delay: 0.05, ease: "power1.inOut" },
        },
      });
      const forward = () => (tl.scrollTrigger?.direction ?? 1) > 0;

      tl.addLabel("s0")
        .to({}, { duration: 0.25 })
        // 18/08 01:13 — the rename
        .to(".ou-cap-1", { autoAlpha: 0, y: move ? -16 : 0 })
        .fromTo(".ou-cap-2", { y: move ? 16 : 0 }, { autoAlpha: 1, y: 0 }, "<")
        .to(".ou-tab-1", { autoAlpha: 0 }, "<")
        .to(".ou-tab-2", { autoAlpha: 1 }, "<0.15")
        .to(".ou-url-1", { autoAlpha: 0 }, "<")
        .to(".ou-url-2", { autoAlpha: 1 }, "<")
        .to(".ou-old", { autoAlpha: 0, y: move ? -10 : 0 }, "<")
        .fromTo(".ou-new", { y: move ? 10 : 0 }, { autoAlpha: 1, y: 0 }, "<")
        .addLabel("s1")
        .to({}, { duration: 0.25 })
        // 19/08 — the launch landing and its counter
        .to(".ou-cap-2", { autoAlpha: 0, y: move ? -16 : 0 })
        .fromTo(".ou-cap-3", { y: move ? 16 : 0 }, { autoAlpha: 1, y: 0 }, "<")
        .to(".ou-a", { autoAlpha: 0, scale: move ? 0.96 : 1 }, "<")
        .fromTo(".ou-c", { y: move ? 30 : 0 }, { autoAlpha: 1, y: 0 }, "<0.1")
        .addLabel("s2")
        .call(() => (forward() ? playCount() : resetCount()))
        .to({}, { duration: 0.25 })
        // today
        .to(".ou-cap-3", { autoAlpha: 0, y: move ? -16 : 0 })
        .fromTo(".ou-cap-4", { y: move ? 16 : 0 }, { autoAlpha: 1, y: 0 }, "<")
        .to(".ou-tab-2", { autoAlpha: 0 }, "<")
        .to(".ou-tab-3", { autoAlpha: 1 }, "<0.15")
        .to(".ou-c", { autoAlpha: 0, scale: move ? 0.96 : 1 }, "<")
        .fromTo(".ou-d", { y: move ? 30 : 0 }, { autoAlpha: 1, y: 0 }, "<0.1")
        .addLabel("s3")
        .call(() => (forward() ? playSweep() : resetSweep()))
        .to({}, { duration: 0.25 });
    },
    { scope: ref }
  );

  const caption = "absolute inset-x-0 top-0 text-base font-semibold text-white/85 sm:text-lg";

  return (
    <section ref={ref} data-scene="day1" className="relative">
      <div className="ou-pin flex min-h-[100svh] flex-col items-center justify-center gap-5 px-4 py-10">
        <SceneTitle center compact kicker={t("anniversary.day1.kicker")} title={t("anniversary.day1.title")} color="var(--a-blue)" />

        <div className="relative h-14 w-full max-w-2xl text-center sm:h-12">
          <p className={`ou-cap-1 ${caption}`}>{t("anniversary.day1.c1")}</p>
          <p className={`ou-cap-2 ${caption}`}>{t("anniversary.day1.c2")}</p>
          <p className={`ou-cap-3 ${caption}`}>{t("anniversary.day1.c3")}</p>
          <p className={`ou-cap-4 ${caption}`}>{t("anniversary.day1.c4")}</p>
        </div>

        {/* Browser window */}
        {/* As wide as the screen allows, and never so tall that the pinned scene spills below it. */}
        <div
          className="w-full overflow-hidden rounded-lg border border-white/10 bg-[#202330] shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
          style={{ maxWidth: "min(56rem, calc((100svh - 370px) * 1.6 + 2px))" }}
        >
          <div className="flex items-end gap-2 px-3 pt-2.5">
            <span className="mb-2 hidden gap-1.5 sm:flex">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </span>
            <div className="relative h-8 w-52 rounded-t-lg bg-[#2d3142] px-3 text-[12px] leading-8 text-white/85 sm:ml-3 sm:w-64">
              <span className="ou-tab-1 absolute inset-x-3 truncate">▲ ShareScreen</span>
              <span className="ou-tab-2 absolute inset-x-3 truncate">🔴 GoLive: AntiJanja</span>
              <span className="ou-tab-3 absolute inset-x-3 truncate">🔴 Go Live</span>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-[#2d3142] px-3 py-2">
            <span className="hidden text-white/40 sm:inline">← → ⟳</span>
            <div className="relative h-7 flex-1 rounded-full bg-[#1a1d29] px-4 font-mono text-[11px] leading-7 text-white/60 sm:text-[12px]">
              <span className="ou-url-1 absolute inset-x-4">localhost:3000</span>
              <span className="ou-url-2 absolute inset-x-4">🔒 golive.nemtudo.me</span>
            </div>
          </div>

          <ScaledStage width={960} height={600}>
            <div className="ou-a absolute inset-0">
              <Day1Landing />
            </div>
            <div className="ou-c absolute inset-0">
              <LaunchLanding />
            </div>
            <div ref={compare} className="ou-d absolute inset-0" style={{ ["--split" as string]: "100%" }}>
              <NewRoom />
              <div className="absolute inset-0" style={{ clipPath: "inset(0 calc(100% - var(--split)) 0 0)" }}>
                <OldRoom />
              </div>
              <div className="pointer-events-none absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_20px_rgba(0,0,0,0.6)]" style={{ left: "var(--split)" }}>
                <span className="absolute top-1/2 flex h-16 w-16 -translate-x-[30px] -translate-y-1/2 items-center justify-center rounded-full bg-white text-2xl font-black text-zinc-900 shadow-xl">
                  ⇆
                </span>
              </div>
              <span className="absolute bottom-5 left-5 rounded-full bg-zinc-900 px-4 py-1.5 text-lg font-black text-white shadow-lg">17/08</span>
              <span className="absolute bottom-5 right-5 rounded-full bg-white px-4 py-1.5 text-lg font-black text-zinc-900 shadow-lg">
                {t("anniversary.day1.today")}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={100}
                aria-label={t("anniversary.day1.compare")}
                onInput={(e) => {
                  setSplit(Number(e.currentTarget.value));
                  if (!dragged.current) {
                    dragged.current = true;
                    trackAnniversary(ANNIVERSARY_EVENTS.compareDrag);
                  }
                }}
                className="anniv-range absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
              />
            </div>
          </ScaledStage>
        </div>
        <p className="text-xs text-white/40">{t("anniversary.day1.drag")}</p>
      </div>
    </section>
  );
}
