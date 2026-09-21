"use client";

// "A transmissão por GPU ficou melhor?" — asked once, of somebody who has
// just finished a long one.
//
// Why here and not in the component that shows it: the two ends of the
// question are in different places. What is being asked about is a capture
// that lives in lib/nativeVideoCapture.ts and ends when a track stops —
// possibly because the user clicked "parar" in Windows' own bar, with no
// React anywhere near it. What asks is a dialog mounted in the room. This is
// the small store between them.
//
// When it is asked
// ----------------
// A GPU capture that ran for at least MIN_SHARE_MS, and then ended. Five
// minutes because the question is comparative — "melhor ou pior que a normal"
// — and somebody who shared for forty seconds has no opinion worth the
// interruption, only the politeness to invent one.
//
// And at most once. A survey that reappears after every long share is not a
// survey, it is a tax on using the feature; the second time somebody sees it
// they learn to dismiss it without reading, which is also what they will do
// to the next one we ask. Dismissed without answering, it comes back once
// more after RETRY_AFTER_MS — a dialog can arrive at a bad moment — and never
// again after that.

import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";
import { getDesktopBridge } from "./desktop";
import { trackFeatureEvent } from "./features";

/**
 * The questionnaire shown after a long GPU-captured share — whether it was
 * better than the ordinary one, and what made them turn it on (see
 * lib/gpuShareSurvey.ts). Its own rollout so the asking can be switched off
 * without touching the capture it asks about, and so it can be pointed at a
 * slice of the people on the experiment rather than all of them.
 */
export const GPU_SURVEY_FEATURE = "gpu-capture-survey";

/** Counted on the site; the answers themselves go to Discord, not here. */
export const GPU_SURVEY_EVENTS = {
  /** The dialog was put on screen. */
  shown: "gpu_survey_shown",
  /** Sent, with something filled in. */
  sent: "gpu_survey_sent",
  /** Closed without answering. */
  dismissed: "gpu_survey_dismissed",
} as const;

/** How long a share has to have run for the question to be worth asking. */
const MIN_SHARE_MS = 5 * 60_000;
/** A dismissal is "not now" once, and an answer the second time. */
const RETRY_AFTER_MS = 7 * 24 * 3600_000;
const MAX_PROMPTS = 2;

const STORAGE_KEY = "sharescreen:gpuSurvey";

/** What the answers are about, collected while the share is running. */
export interface GpuShareContext {
  /** How long it ran, in whole minutes. */
  minutes: number;
  /** The hardware encoder's own name ("NVIDIA H.264 Encoder"). */
  encoder: string;
  method: "duplication" | "wgc";
  /** "1920x1080", as the share was configured. */
  resolution: string;
  fps: number;
}

/** What somebody answered. Every field is optional, by design. */
export interface GpuShareAnswers {
  verdict?: string;
  again?: string;
  reasons?: string[];
  comment?: string;
}

interface Stored {
  /** They answered. Never asked again. */
  answered?: boolean;
  /** How many times the dialog has been put in front of them. */
  prompts?: number;
  /** When the last one was dismissed without an answer. */
  dismissedAt?: number;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    // Private mode, blocked storage, or somebody's hand-edited JSON. An
    // unreadable record reads as "never asked", which is the side that
    // fails towards asking one extra time rather than never asking.
    return {};
  }
}

function write(next: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage refused. The survey may then be asked again on a later share,
    // which is a far smaller failure than refusing to ask at all.
  }
}

function mayAsk(): boolean {
  const stored = read();
  if (stored.answered) return false;
  if ((stored.prompts ?? 0) >= MAX_PROMPTS) return false;
  if (stored.dismissedAt && Date.now() - stored.dismissedAt < RETRY_AFTER_MS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The store

let pending: GpuShareContext | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The survey waiting to be shown, or null. Subscribe with useSyncExternalStore
 * — see useGpuShareSurvey below, which is what components use.
 */
export const gpuShareSurveyStore = {
  subscribe,
  get: (): GpuShareContext | null => pending,
};

// ---------------------------------------------------------------------------
// The share's lifetime

interface Running {
  startedAt: number;
  context: Omit<GpuShareContext, "minutes">;
}

let running: Running | null = null;

/**
 * A GPU capture just started. `enabled` is the experiment: when it is off
 * nothing is armed at all, so a share that ends after the flag is flipped
 * cannot surface a question about a share nobody was being asked about.
 */
export function noteGpuShareStarted(
  enabled: boolean,
  context: Omit<GpuShareContext, "minutes">
): void {
  running = enabled && mayAsk() ? { startedAt: Date.now(), context } : null;
}

/** It ended — by the user, by Windows' own bar, or by the helper dying. */
export function noteGpuShareEnded(): void {
  const share = running;
  running = null;
  if (!share) return;
  const elapsed = Date.now() - share.startedAt;
  // Re-checked rather than trusted from the start: a share can outlast the
  // answer given to another one in a different tab.
  if (elapsed < MIN_SHARE_MS || !mayAsk()) return;
  pending = { ...share.context, minutes: Math.round(elapsed / 60_000) };
  emit();
}

/** The dialog is on screen. Counts as one of the two chances. */
export function markGpuSurveyShown(): void {
  const stored = read();
  write({ ...stored, prompts: (stored.prompts ?? 0) + 1 });
  trackFeatureEvent(GPU_SURVEY_EVENTS.shown);
}

/** Closed without answering. */
export function dismissGpuShareSurvey(): void {
  pending = null;
  write({ ...read(), dismissedAt: Date.now() });
  trackFeatureEvent(GPU_SURVEY_EVENTS.dismissed);
  emit();
}

/**
 * Sends what was filled in and closes. Never rejects and never reports a
 * failure: the person has said their piece and is looking at a dialog that
 * should close, and "não foi possível enviar sua opinião" is a worse ending
 * than a lost answer.
 */
export function submitGpuShareSurvey(answers: GpuShareAnswers): void {
  const context = pending;
  pending = null;
  write({ ...read(), answered: true });
  // value: how long the share they are talking about ran, so "quem transmitiu
  // muito achou melhor?" is answerable from the counts alone.
  trackFeatureEvent(GPU_SURVEY_EVENTS.sent, { value: context?.minutes ?? 0 });
  emit();
  if (!context) return;

  const token = getAccountToken() ?? getStoredGuestToken();
  void fetch(`${getSignalingHttpBase()}/feedback/gpu-capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      verdict: answers.verdict,
      again: answers.again,
      reasons: answers.reasons,
      comment: answers.comment,
      minutes: context.minutes,
      encoder: context.encoder,
      method: context.method,
      resolution: context.resolution,
      fps: context.fps,
      appVersion: getDesktopBridge()?.appVersion,
    }),
    keepalive: true,
  }).catch(() => {
    // Nothing to do about it, and nothing to tell anybody.
  });
}
