"use client";

// Experiment "memory-guard": RAM leak prevention and aggressive media/WebRTC
// resource release for large rooms and long-duration calls/streams in both the
// browser and desktop app.
//
// Why this matters especially in the browser:
// - Chromium and Firefox retain closed RTCPeerConnection C++ objects, RTP
//   receivers/senders, jitter buffers, and closures in native memory whenever
//   event handlers (`onicecandidate`, `onconnectionstatechange`, `ontrack`,
//   `iceconnectionstatechange`, `selectedcandidatepairchange`) remain attached
//   after `pc.close()`.
// - Detached or offscreen `<video>`/`<audio>` elements that keep `srcObject`
//   or uncleaned MediaRecorder segment buffers pin decoded video frames and
//   encoded blobs in RAM across long calls.
// - ClipBuffers running 4 concurrent MediaRecorder instances per tile multiply
//   encoder memory in rooms with many streams.

import { trackFeatureEvent } from "./features";

export const MEMORY_GUARD_FEATURE = "memory-guard";

export const MEMORY_GUARD_EVENTS = {
  pcRelease: "memory_guard_pc_release",
  tileRelease: "memory_guard_tile_release",
  clipTrim: "memory_guard_clip_trim",
  heapSampleMb: "memory_guard_heap_mb",
  highRamAlert: "memory_guard_high_ram",
} as const;

const HIGH_RAM_THRESHOLD_MB = 500;

let enabled = false;
let pcReleaseCount = 0;
let tileReleaseCount = 0;

export function setMemoryGuardEnabled(value: boolean) {
  enabled = value;
}

export function isMemoryGuardEnabled(): boolean {
  return enabled;
}

/**
 * Scrubs all listeners and stops transceivers/senders on an RTCPeerConnection
 * before closing it, breaking JS<->Blink/WebRTC cycles that otherwise keep
 * closed connections and media buffers alive in browser RAM during long calls.
 */
export function releasePeerConnection(
  pc: RTCPeerConnection,
  cleanupCallbacks?: Array<(() => void) | undefined>
) {
  if (cleanupCallbacks) {
    for (const fn of cleanupCallbacks) {
      try {
        fn?.();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
  if (enabled) {
    try {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.oniceconnectionstatechange = null;
      pc.onnegotiationneeded = null;
      pc.onsignalingstatechange = null;
      for (const sender of pc.getSenders()) {
        try {
          void sender.replaceTrack(null).catch(() => {});
        } catch {
          // Ignore on already-closed senders
        }
      }
    } catch {
      // Ignore if PC is already torn down
    }
    pcReleaseCount += 1;
    // Sample every 10 connection releases to avoid flooding site events in huge rooms.
    if (pcReleaseCount % 10 === 1) {
      trackFeatureEvent(MEMORY_GUARD_EVENTS.pcRelease);
    }
  }
  try {
    pc.close();
  } catch {
    // Ignore close errors
  }
}

export function noteTileBufferReleased() {
  if (!enabled) return;
  tileReleaseCount += 1;
  if (tileReleaseCount % 5 === 1) {
    trackFeatureEvent(MEMORY_GUARD_EVENTS.tileRelease);
  }
}

export function noteClipBufferTrimmed() {
  if (!enabled) return;
  trackFeatureEvent(MEMORY_GUARD_EVENTS.clipTrim);
}

/**
 * Reads Chromium's JS heap usage (when exposed via performance.memory) and
 * reports `memory_guard_heap_mb` and `memory_guard_high_ram` so the experiment
 * dashboard can compare RAM usage between control and treatment in browsers
 * and the desktop app.
 */
export function sampleHeapMemory(): number | null {
  if (typeof performance === "undefined") return null;
  const mem = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  const usedBytes = mem?.usedJSHeapSize;
  if (typeof usedBytes !== "number" || !Number.isFinite(usedBytes) || usedBytes <= 0) {
    return null;
  }
  const mb = Math.round(usedBytes / (1024 * 1024));
  trackFeatureEvent(MEMORY_GUARD_EVENTS.heapSampleMb, { value: mb });
  if (mb >= HIGH_RAM_THRESHOLD_MB) {
    trackFeatureEvent(MEMORY_GUARD_EVENTS.highRamAlert, { value: mb });
  }
  return mb;
}

