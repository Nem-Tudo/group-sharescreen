// WebRTC field trials this app starts Chromium with — experiment sq-h264-qp
// (see the site's lib/streamQuality.ts).
//
// The connection-quality reports showed H264 screen shares stuck at ~540p
// with three to four times their bitrate available: WebRTC's quality scaler
// cuts resolution whenever the average QP passes 37 and only climbs back at
// 24 or less, and screen content after the cut sits right at ~25. Those
// thresholds are compiled in, and the only way to move them is the
// "WebRTC-Video-QualityScaling" field trial — which a web page cannot set, but
// the app that starts Chromium can, with --force-fieldtrials.
//
// A switch only counts if it is set before Chromium starts, so the site's
// decision (it is the one that knows the experiment) is written to disk here
// and takes effect at the *next* start. Every start records whether a
// decision was on disk at all, so the site can tell "control" from "assigned
// but not restarted yet" and only count the former and the applied.
//
// The trial string is the WebRTC default ("Enabled-29,95,149,205,24,37,26,36,
// 0.9995,0.9999,1": VP8 low/high, VP9 low/high, H264 low/high, generic
// low/high, then the smoothing and drop settings) with only the H264 pair
// moved, from 24/37 to 28/44. Every other codec keeps its own thresholds.

import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const H264_QP_TRIAL = "WebRTC-Video-QualityScaling/Enabled-29,95,149,205,28,44,26,36,0.9995,0.9999,1/";

const TRIALS_FILE = "webrtc-trials.json";

export interface WebrtcTrialState {
  /** Whether the site had written a decision before this start. */
  known: boolean;
  /** Whether this process runs with the sq-h264-qp trial. */
  h264Qp: boolean;
}

let state: WebrtcTrialState = { known: false, h264Qp: false };

function trialsPath(): string {
  return path.join(app.getPath("userData"), TRIALS_FILE);
}

/** Reads the stored decision and sets the switches. Call before the app is ready. */
export function applyWebrtcTrials(): void {
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(trialsPath(), "utf8"));
  } catch {
    // No file: the site has never decided, which is the common case.
  }
  const h264Qp = (stored as { h264Qp?: unknown } | null)?.h264Qp;
  state = { known: typeof h264Qp === "boolean", h264Qp: h264Qp === true };
  if (!state.h264Qp) return;
  // Chromium reads one --force-fieldtrials; join ours to any already given.
  const existing = app.commandLine.getSwitchValue("force-fieldtrials");
  app.commandLine.appendSwitch("force-fieldtrials", `${existing}${H264_QP_TRIAL}`);
}

export function webrtcTrialState(): WebrtcTrialState {
  return state;
}

/** The site's decision, for the next start. Written only when it changes. */
export function saveH264QpTrial(on: boolean): void {
  let current: unknown = null;
  try {
    current = JSON.parse(readFileSync(trialsPath(), "utf8"));
  } catch {
    // Nothing yet.
  }
  if ((current as { h264Qp?: unknown } | null)?.h264Qp === on) return;
  try {
    writeFileSync(trialsPath(), `${JSON.stringify({ h264Qp: on }, null, 2)}\n`, "utf8");
  } catch {
    // Read-only or full disk: the experiment just never applies here.
  }
}
