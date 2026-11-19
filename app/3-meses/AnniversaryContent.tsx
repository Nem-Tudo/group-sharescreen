"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useI18n";
import { onNextUserGesture } from "@/lib/audioContext";
import { markFeatureUsed } from "@/components/NewBadge";
import {
  ANNIVERSARY_EVENTS,
  ANNIVERSARY_FEATURE,
  ANNIVERSARY_FROM_PARAM,
  ANNIVERSARY_SOURCES,
  ANNIVERSARY_STAY_MARKS,
  fetchAnniversaryStats,
  trackAnniversary,
  type AnniversarySource,
  type AnniversaryStats,
} from "@/lib/anniversary";
import { gsap, ScrollTrigger, useGSAP, MOTION_OK } from "./gsap";
import { Chiptune, type MusicMood } from "./chiptune";
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
import { TeamSection } from "./sections/Team";
import { FinaleSection } from "./sections/Finale";
import { HARD_FIGURES } from "./historyData";
import "./anniversary.css";

type Scene = "intro" | "day0" | "day1" | "first72" | "outage" | "numbers" | "recap" | "timeline" | "night" | "bugs" | "team" | "finale";

const SCENES: Record<Scene, { music: MusicMood }> = {
  intro: { music: "calm" },
  day0: { music: "calm" },
  day1: { music: "calm" },
  first72: { music: "calm" },
  outage: { music: "tense" },
  numbers: { music: "party" },
  recap: { music: "party" },
  timeline: { music: "calm" },
  night: { music: "night" },
  bugs: { music: "tense" },
  team: { music: "party" },
  finale: { music: "party" },
};

const MUSIC_PREF_KEY = "sharescreen:anniversary:music";
const STATS_POLL_MS = 60_000;

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
  const progress = useRef<HTMLDivElement>(null);
  const music = useRef<Chiptune | null>(null);
  const [scene, setScene] = useState<Scene>("intro");
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState<AnniversaryStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [chartDays, setChartDays] = useState<number[] | null>(null);
  const [burst, setBurst] = useState(0);

  const getMusic = () => (music.current ??= new Chiptune());

  // Opening the page is "using" the feature: the NOVO badge on the way in goes away.
  // Also where the visit came from: the ?from= the site's own links add (then
  // dropped from the address, so a copied link does not carry it on), else the referrer.
  useEffect(() => {
    trackAnniversary(ANNIVERSARY_EVENTS.view);
    markFeatureUsed(ANNIVERSARY_FEATURE);
    const url = new URL(window.location.href);
    const tagged = url.searchParams.get(ANNIVERSARY_FROM_PARAM);
    let source: AnniversarySource;
    if (tagged && (ANNIVERSARY_SOURCES as readonly string[]).includes(tagged)) source = tagged as AnniversarySource;
    else if (!document.referrer) source = "direct";
    else {
      try {
        source = new URL(document.referrer).origin === window.location.origin ? "site" : "external";
      } catch {
        source = "external";
      }
    }
    trackAnniversary(`anniv_from.${source}`);
    if (tagged !== null) {
      url.searchParams.delete(ANNIVERSARY_FROM_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  // Time on the page, counted only while it is visible: milestones as they
  // pass, and the total once when the page is left (or hidden for the first time).
  useEffect(() => {
    let visibleMs = 0;
    let since = document.visibilityState === "visible" ? Date.now() : null;
    let sent = false;
    const marks = new Set<string>();
    const elapsed = () => visibleMs + (since === null ? 0 : Date.now() - since);
    const checkMarks = () => {
      const seconds = elapsed() / 1000;
      for (const { mark, seconds: at } of ANNIVERSARY_STAY_MARKS) {
        if (seconds >= at && !marks.has(mark)) {
          marks.add(mark);
          trackAnniversary(`anniv_stay.${mark}`);
        }
      }
    };
    const sendTotal = () => {
      if (sent) return;
      sent = true;
      trackAnniversary(ANNIVERSARY_EVENTS.time, Math.max(1, Math.round(elapsed() / 1000)));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        since ??= Date.now();
      } else {
        if (since !== null) visibleMs += Date.now() - since;
        since = null;
        checkMarks();
        sendTotal();
      }
    };
    const timer = setInterval(checkMarks, 5000);
    document.addEventListener("visibilitychange", onVisibility);
    // Capture: ahead of lib/features' own pagehide flush, so the total goes out with it.
    window.addEventListener("pagehide", sendTotal, { capture: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", sendTotal, { capture: true });
      sendTotal();
    };
  }, []);

  // The numbers are live: asked for again every STATS_POLL_MS while the tab
  // is visible, and at once when it comes back. In between, the counters keep
  // climbing at the growth rates the answer carries (see Numbers' Counter).
  // The API answers from a 30-second cache (its anniversaryRoutes.ts).
  useEffect(() => {
    let controller: AbortController | null = null;
    let loaded = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      fetchAnniversaryStats(mine.signal)
        .then((data) => {
          loaded = true;
          setStats(data);
          setFailed(false);
          setChartDays((days) => days ?? data.signupsPerDay);
        })
        .catch(() => {
          // A miss after the first load keeps the numbers on screen.
          if (!mine.signal.aborted && !loaded) setFailed(true);
        });
    };
    load();
    const timer = setInterval(load, STATS_POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      controller?.abort();
    };
  }, []);

  // Charts and counters change height when the numbers first land; the
  // pinned scenes below have to measure again. Later updates change no height.
  const measured = useRef(false);
  useEffect(() => {
    if (measured.current || !(stats || failed)) return;
    measured.current = true;
    requestAnimationFrame(() => {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    });
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
      // Which scene is in the middle of the screen drives the mascot and the
      // music, and each one reached is counted once (anniv_seen.<scene>).
      const seen = new Set<string>();
      for (const el of gsap.utils.toArray<HTMLElement>("[data-scene]")) {
        ScrollTrigger.create({
          trigger: el,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => {
            if (!self.isActive) return;
            const name = el.dataset.scene as Scene;
            setScene(name);
            if (!seen.has(name)) {
              seen.add(name);
              trackAnniversary(`anniv_seen.${name}`);
            }
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

  return (
    <div ref={root} className="anniv relative min-h-screen">
      {/* Top bar */}
      <div className="fixed inset-x-0 top-0 z-40">
        <div ref={progress} style={{ scale: "0 1" }} className="anniv-progress h-[3px] origin-left bg-[var(--a-tally)]" />
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md bg-black/50 py-1.5 pl-1.5 pr-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/70"
          >
            <img src="/icon.png" alt="" className="h-7 w-7 rounded" />
            Go Live
          </Link>
          <button
            type="button"
            onClick={toggleMusic}
            aria-pressed={playing}
            className={`anniv-mono flex items-center gap-2.5 rounded-md px-3.5 py-2 text-xs font-semibold uppercase backdrop-blur transition ${playing ? "bg-[var(--a-ink)] text-[var(--a-bg)]" : "bg-black/50 text-white hover:bg-black/70"}`}
          >
            <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`w-[3px] ${playing ? "golive-eq-bar bg-[var(--a-tally)]" : "bg-white/70"}`}
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
        <OutageSection peak={stats?.peakSockets ?? HARD_FIGURES.sockets} />
        <NumbersSection stats={stats} failed={failed} chartDays={chartDays} />
        <RecapSection />
        <TimelineSection />
        <BackstageSection />
        <BugsSection
          onSquash={(all) => {
            void getMusic().blip(all ? 96 : 72);
            trackAnniversary(ANNIVERSARY_EVENTS.bugFix);
            if (all) {
              trackAnniversary(ANNIVERSARY_EVENTS.bugsAll);
              setBurst((b) => b + 1);
            }
          }}
        />
        <TeamSection />
        <FinaleSection onCelebrate={() => setBurst((b) => b + 1)} />
      </main>

      <Confetti burst={burst} />
    </div>
  );
}
