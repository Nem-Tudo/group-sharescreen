"use client";

import { trackFeatureEvent, type FeatureEventTags } from "@/lib/features";
import { takeRendererRecovery } from "@/lib/nativeApp";

// "O app trava" (experiment android-jank): measures how much the page itself
// freezes inside the Android app, which Play's own numbers cannot see — the
// page runs in WebView's renderer, a separate process, so a stuck page is
// never an ANR there. Measurement only: nothing on screen changes.
//
// What it reads, all of it passive except the short fps samples:
//
//   - Long animation frames (PerformanceObserver "long-animation-frame",
//     Chromium 123+; "longtask" on older WebViews): every frame the main
//     thread held up for 50 ms or more, with what started it. Summed per
//     visible minute as "jank_min" (value = blocked ms), and each one of a
//     second or more is a "jank_freeze" of its own.
//   - Frame rate (jank_fps): a requestAnimationFrame loop, but only 3 s in
//     every 20 s. A loop that never stops would make the page produce frames
//     it otherwise would not, which costs exactly the battery and CPU this is
//     here to measure. The rate counts the compositor too, so it also sees
//     the GPU-bound slowness (blur over video, big layers) a main-thread
//     measure misses.
//   - Renderer recoveries (renderer_reload): the native side tells the page
//     it was loaded again because the previous renderer died (MainActivity's
//     RendererCrashRecovery) — once a crash, now a reload.
//
// Every event carries the device and the moment as attributes, so the admin
// can cross them: how much a 3 GB phone freezes in a room with four videos
// against an 8 GB one on the groups page.

export const ANDROID_JANK_FEATURE = "android-jank";

export const ANDROID_JANK_EVENTS = {
  /** One per minute the page was visible; value = ms the main thread blocked frames. */
  minute: "jank_min",
  /** One per minute that had an fps sample; value = average fps of the samples. */
  fps: "jank_fps",
  /** A single frame held for 1 s or more; value = its length in ms. */
  freeze: "jank_freeze",
  /** This page replaced one whose renderer died. */
  rendererReload: "renderer_reload",
} as const;

const MINUTE_MS = 60_000;
const FREEZE_MS = 1_000;
const SAMPLE_EVERY_MS = 20_000;
const SAMPLE_FOR_MS = 3_000;
const VIDEO_CHECK_MS = 10_000;

// ─── Attributes ───────────────────────────────────────────────────────────

/** What navigator.deviceMemory says (Chromium rounds it, and caps it at 8). */
function memBucket(): string {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (!mem) return "unknown";
  if (mem <= 1) return "1";
  if (mem <= 2) return "2";
  if (mem <= 4) return "4";
  return "8";
}

function coresBucket(): string {
  const cores = navigator.hardwareConcurrency || 0;
  if (!cores) return "unknown";
  if (cores <= 4) return "4";
  if (cores <= 6) return "6";
  return "8";
}

/** JS heap in MB (Chromium's non-standard performance.memory). */
function heapBucket(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  if (!memory?.usedJSHeapSize) return "unknown";
  const mb = memory.usedJSHeapSize / 1_048_576;
  if (mb < 50) return "50";
  if (mb < 100) return "100";
  if (mb < 200) return "200";
  if (mb < 400) return "400";
  return "more";
}

function pageBucket(): string {
  const path = location.pathname;
  if (path.startsWith("/watch") || path.startsWith("/chamado") || path.startsWith("/stream")) return "room";
  if (path.startsWith("/groups")) return "group";
  if (path === "/" || path === "") return "home";
  return "other";
}

/** Videos actually decoding on screen right now. */
function countPlayingVideos(): number {
  let count = 0;
  for (const video of document.querySelectorAll("video")) {
    if (!video.paused && video.readyState >= 2 && video.offsetWidth > 0) count += 1;
  }
  return count;
}

function videosBucket(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2-3";
  if (count <= 6) return "4-6";
  return "7p";
}

/** How the minute felt, by how long its frames were held up. */
function levelBucket(blockedMs: number): string {
  if (blockedMs < 200) return "smooth";
  if (blockedMs < 1_000) return "mild";
  if (blockedMs < 5_000) return "bad";
  return "awful";
}

function track(name: string, value: number, tags: FeatureEventTags) {
  trackFeatureEvent(name, {
    feature: ANDROID_JANK_FEATURE,
    ...(value > 0 ? { value: Math.round(value) } : {}),
    tags,
  });
}

// ─── Long frames ──────────────────────────────────────────────────────────

/** The fields of a long-animation-frame entry this reads (not in TS's DOM lib yet). */
interface LongFrameEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: { invokerType?: string; duration?: number }[];
}

/** What started the longest script of a frame: "event-listener", "user-callback"… */
function frameSource(entry: LongFrameEntry): string {
  let longest: { invokerType?: string; duration?: number } | null = null;
  for (const script of entry.scripts ?? []) {
    if (!longest || (script.duration ?? 0) > (longest.duration ?? 0)) longest = script;
  }
  const type = longest?.invokerType;
  return type && /^[a-z0-9_.-]{1,40}$/.test(type) ? type : "render";
}

function supportedEntryType(): "long-animation-frame" | "longtask" | null {
  const types = (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes) || [];
  if (types.includes("long-animation-frame")) return "long-animation-frame";
  if (types.includes("longtask")) return "longtask";
  return null;
}

// ─── The monitor ──────────────────────────────────────────────────────────

/**
 * Starts measuring; returns the function that stops it. Call only inside the
 * Android app and only for people in the experiment.
 */
export function startAndroidJankMonitor(): () => void {
  let blockedMs = 0;
  let visibleMs = 0;
  let visibleSince = document.visibilityState === "visible" ? performance.now() : null;
  let maxVideos = countPlayingVideos();
  const fpsSamples: number[] = [];

  const tagsNow = (): FeatureEventTags => ({
    mem: memBucket(),
    cores: coresBucket(),
    page: pageBucket(),
    videos: videosBucket(maxVideos),
    heap: heapBucket(),
  });

  // Long frames.
  const entryType = supportedEntryType();
  let observer: PerformanceObserver | null = null;
  if (entryType) {
    observer = new PerformanceObserver((list) => {
      if (document.visibilityState !== "visible") return;
      for (const entry of list.getEntries() as LongFrameEntry[]) {
        // The part of a long frame past the first 50 ms is what a person
        // feels as a stuck page; blockingDuration is that, where it exists.
        const blocked = entry.blockingDuration ?? Math.max(0, entry.duration - 50);
        blockedMs += blocked;
        if (entry.duration >= FREEZE_MS) {
          track(ANDROID_JANK_EVENTS.freeze, entry.duration, {
            mem: memBucket(),
            page: pageBucket(),
            videos: videosBucket(countPlayingVideos()),
            src: entryType === "long-animation-frame" ? frameSource(entry) : "longtask",
          });
        }
      }
    });
    try {
      observer.observe({ type: entryType, buffered: false });
    } catch {
      observer = null;
    }
  }

  // Frame rate, sampled.
  let sampleFrame: number | null = null;
  const runSample = () => {
    if (document.visibilityState !== "visible" || sampleFrame !== null) return;
    const startedAt = performance.now();
    let frames = 0;
    const step = (now: number) => {
      frames += 1;
      if (now - startedAt < SAMPLE_FOR_MS && document.visibilityState === "visible") {
        sampleFrame = requestAnimationFrame(step);
        return;
      }
      sampleFrame = null;
      const elapsed = now - startedAt;
      // A sample cut short by the page going away says nothing.
      if (elapsed >= SAMPLE_FOR_MS * 0.9) fpsSamples.push((frames * 1000) / elapsed);
    };
    sampleFrame = requestAnimationFrame(step);
  };
  const sampleTimer = window.setInterval(runSample, SAMPLE_EVERY_MS);

  const videoTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") maxVideos = Math.max(maxVideos, countPlayingVideos());
  }, VIDEO_CHECK_MS);

  // A minute of visible time closes a report.
  const flushIfMinute = () => {
    const now = performance.now();
    const total = visibleMs + (visibleSince !== null ? now - visibleSince : 0);
    if (total < MINUTE_MS) return;
    const tags = tagsNow();
    track(ANDROID_JANK_EVENTS.minute, blockedMs, { ...tags, level: levelBucket(blockedMs) });
    if (fpsSamples.length > 0) {
      const fps = fpsSamples.reduce((sum, value) => sum + value, 0) / fpsSamples.length;
      track(ANDROID_JANK_EVENTS.fps, fps, { ...tags, level: levelBucket(blockedMs) });
    }
    blockedMs = 0;
    visibleMs = 0;
    visibleSince = visibleSince !== null ? now : null;
    maxVideos = countPlayingVideos();
    fpsSamples.length = 0;
  };
  const minuteTimer = window.setInterval(flushIfMinute, 5_000);

  const onVisibility = () => {
    const now = performance.now();
    if (document.visibilityState === "visible") {
      if (visibleSince === null) visibleSince = now;
    } else if (visibleSince !== null) {
      visibleMs += now - visibleSince;
      visibleSince = null;
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    observer?.disconnect();
    window.clearInterval(sampleTimer);
    window.clearInterval(videoTimer);
    window.clearInterval(minuteTimer);
    if (sampleFrame !== null) cancelAnimationFrame(sampleFrame);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

// ─── Renderer recoveries ──────────────────────────────────────────────────

/**
 * Reports, once, that this page replaced one whose renderer died. An APK
 * from before the native half existed answers null, which is just "no".
 */
export async function reportRendererRecovery(): Promise<void> {
  const recovery = await takeRendererRecovery();
  if (!recovery) return;
  track(ANDROID_JANK_EVENTS.rendererReload, 1, {
    // crashed_fg, crashed_bg, killed_fg, killed_bg: one attribute, since a
    // feature takes at most eight and these two are only ever read together.
    how: `${recovery.reason === "crashed" ? "crashed" : "killed"}_${recovery.background ? "bg" : "fg"}`,
    mem: memBucket(),
  });
}
