"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { onNextUserGesture } from "@/lib/audioContext";
import { markFeatureUsed } from "@/components/NewBadge";
import {
  ANNIVERSARY_EVENTS,
  ANNIVERSARY_FEATURE,
  fetchAnniversaryStats,
  trackAnniversary,
  type AnniversaryStats,
} from "@/lib/anniversary";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "./gsap";
import { Chiptune, type MusicMood } from "./chiptune";
import { Mascot, type MascotMood } from "./Mascot";
import { Confetti } from "./shared";
import { IntroSection } from "./sections/Intro";
import { DayZeroSection } from "./sections/DayZero";
import { OnceUponSection } from "./sections/OnceUpon";
import { First72Section } from "./sections/First72";
import { OutageSection } from "./sections/Outage";
import { NumbersSection } from "./sections/Numbers";
import { RecapSection } from "./sections/Recap";
import { TimelineSection } from "./sections/Timeline";
import { BackstageSection } from "./sections/Backstage";
import { BugsSection } from "./sections/Bugs";
import { FinaleSection } from "./sections/Finale";
import "./anniversary.css";

type Scene = "intro" | "day0" | "day1" | "first72" | "outage" | "numbers" | "recap" | "timeline" | "night" | "bugs" | "finale";

const SCENES: Record<Scene, { mood: MascotMood; music: MusicMood }> = {
  intro: { mood: "wave", music: "calm" },
  day0: { mood: "think", music: "calm" },
  day1: { mood: "love", music: "calm" },
  first72: { mood: "happy", music: "calm" },
  outage: { mood: "sweat", music: "tense" },
  numbers: { mood: "party", music: "party" },
  recap: { mood: "love", music: "party" },
  timeline: { mood: "wave", music: "calm" },
  night: { mood: "sleep", music: "night" },
  bugs: { mood: "shock", music: "tense" },
  finale: { mood: "party", music: "party" },
};

const MUSIC_PREF_KEY = "sharescreen:anniversary:music";
const EASTER_EGG_CLICKS = 10;

function readMusicPref(): boolean {
  try {
    return window.localStorage.getItem(MUSIC_PREF_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMusicPref(on: boolean) {
  try {
    window.localStorage.setItem(MUSIC_PREF_KEY, on ? "1" : "0");
  } catch {
    // Not remembered in this browser; the button still works.
  }
}

export function AnniversaryContent() {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLButtonElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const music = useRef<Chiptune | null>(null);
  const [scene, setScene] = useState<Scene>("intro");
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState<AnniversaryStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [burst, setBurst] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [allSquashed, setAllSquashed] = useState(false);

  const getMusic = () => (music.current ??= new Chiptune());

  // Opening the page is "using" the feature: the NOVO badge on the way in goes away.
  useEffect(() => {
    trackAnniversary(ANNIVERSARY_EVENTS.view);
    markFeatureUsed(ANNIVERSARY_FEATURE);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAnniversaryStats(controller.signal)
      .then(setStats)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  // Charts and counters change height when the numbers land; the pinned
  // scenes below have to measure again.
  useEffect(() => {
    if (stats || failed) {
      requestAnimationFrame(() => {
        ScrollTrigger.sort();
        ScrollTrigger.refresh();
      });
    }
  }, [stats, failed]);

  // Music: off until asked for. Somebody who turned it on before gets it back
  // on their first click, which is the earliest a browser allows sound.
  useEffect(() => {
    const player = getMusic();
    let cancel: (() => void) | null = null;
    if (readMusicPref()) {
      cancel = onNextUserGesture(() => {
        void player.start().then((ok) => setPlaying(ok));
      });
    }
    return () => {
      cancel?.();
      player.stop();
    };
  }, []);

  useEffect(() => {
    music.current?.setMood(SCENES[scene].music);
  }, [scene]);

  const toggleMusic = async () => {
    const player = getMusic();
    if (player.playing) {
      player.stop();
      setPlaying(false);
      writeMusicPref(false);
      return;
    }
    player.setMood(SCENES[scene].music);
    const ok = await player.start();
    setPlaying(ok);
    writeMusicPref(ok);
    if (ok) trackAnniversary(ANNIVERSARY_EVENTS.musicOn);
  };

  useGSAP(
    () => {
      // Which scene is in the middle of the screen drives the mascot and the music.
      for (const el of gsap.utils.toArray<HTMLElement>("[data-scene]")) {
        ScrollTrigger.create({
          trigger: el,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => {
            if (self.isActive) setScene(el.dataset.scene as Scene);
          },
        });
      }

      // Progress bar + how far people get.
      let half = false;
      let end = false;
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          if (progress.current) progress.current.style.scale = `${self.progress} 1`;
          if (!half && self.progress >= 0.5) {
            half = true;
            trackAnniversary(ANNIVERSARY_EVENTS.scrollHalf);
          }
          if (!end && self.progress >= 0.97) {
            end = true;
            trackAnniversary(ANNIVERSARY_EVENTS.scrollEnd);
          }
        },
      });

      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-reveal]");
        gsap.set(items, { autoAlpha: 0, y: 40 });
        ScrollTrigger.batch(items, {
          start: "top 90%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.08, overwrite: true }),
        });
      });

      // Pinned scenes are measured once fonts have settled.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },
    { scope: root }
  );

  const poke = () => {
    trackAnniversary(ANNIVERSARY_EVENTS.mascotClick);
    const next = clicks + 1;
    setClicks(next);
    void getMusic().blip(next >= EASTER_EGG_CLICKS ? 96 : 76 + (next % 5) * 2);
    if (next === EASTER_EGG_CLICKS) setBurst((b) => b + 1);
    if (dock.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap
        .timeline()
        .to(dock.current, { y: -50, rotate: next >= EASTER_EGG_CLICKS ? 360 : 0, duration: 0.28, ease: "power2.out" })
        .to(dock.current, { y: 0, duration: 0.5, ease: "bounce.out" })
        .set(dock.current, { rotate: 0 });
    }
  };

  const egg = clicks >= EASTER_EGG_CLICKS;
  const mood: MascotMood = egg ? "love" : allSquashed && scene === "bugs" ? "party" : SCENES[scene].mood;
  const speech = egg
    ? t("anniversary.say.easterEgg")
    : allSquashed && scene === "bugs"
      ? t("anniversary.say.bugsFixed")
      : t(`anniversary.say.${scene}`);
  const dockVisible = scene !== "intro" && scene !== "finale";

  return (
    <div ref={root} className="anniv relative min-h-screen">
      {/* Top bar */}
      <div className="fixed inset-x-0 top-0 z-40">
        <div ref={progress} style={{ scale: "0 1" }} className="anniv-progress h-1 origin-left bg-[linear-gradient(90deg,#fbbf24,#fb7185,#c026d3,#818cf8)]" />
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full bg-black/40 py-1.5 pl-1.5 pr-3.5 text-sm font-bold text-white backdrop-blur transition hover:bg-black/60"
          >
            <img src="/icon.png" alt="" className="h-7 w-7 rounded-full" />
            GoLive
          </Link>
          <button
            type="button"
            onClick={toggleMusic}
            aria-pressed={playing}
            className={`flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-bold backdrop-blur transition ${playing ? "bg-white text-zinc-900" : "bg-black/40 text-white hover:bg-black/60"}`}
          >
            <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`w-[3px] rounded-full ${playing ? "golive-eq-bar bg-[var(--a-rose)]" : "bg-white/70"}`}
                  style={{ height: playing ? "100%" : `${35 + i * 15}%`, animationDelay: `${i * -0.25}s` }}
                />
              ))}
            </span>
            {playing ? t("anniversary.music.on") : t("anniversary.music.off")}
          </button>
        </div>
      </div>

      <main>
        <IntroSection />
        <DayZeroSection />
        <OnceUponSection />
        <First72Section />
        <OutageSection />
        <NumbersSection stats={stats} failed={failed} />
        <RecapSection />
        <TimelineSection />
        <BackstageSection />
        <BugsSection
          onSquash={(all) => {
            void getMusic().blip(all ? 96 : 72);
            if (all) {
              setAllSquashed(true);
              setBurst((b) => b + 1);
            }
          }}
        />
        <FinaleSection onCelebrate={() => setBurst((b) => b + 1)} />
      </main>

      {/* Livinho, following along */}
      <div
        className={`fixed bottom-[calc(var(--app-tabbar-h,0px)+1rem)] left-3 z-30 flex items-end gap-1 transition-all duration-500 sm:left-5 ${dockVisible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-32 opacity-0"}`}
      >
        <button
          ref={dock}
          type="button"
          onClick={poke}
          aria-label={t("anniversary.mascot.label")}
          className="w-[76px] shrink-0 cursor-pointer sm:w-[96px]"
        >
          <Mascot mood={mood} />
        </button>
        <p key={`${scene}-${egg}-${allSquashed}`} className="anniv-bubble mb-16 max-w-[190px] animate-[golive-appear_0.35s_ease-out] sm:mb-20 sm:max-w-[240px]" role="status">
          {speech}
        </p>
      </div>

      <Confetti burst={burst} />
    </div>
  );
}
