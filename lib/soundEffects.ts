"use client";

import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";

// Every effect here is synthesized with the Web Audio API instead of
// shipped as audio files — keeps this asset-free and avoids having to pick
// (and clear the rights to) actual sound files. It plays through the
// app-wide shared AudioContext (see audioContext.ts), which is also what
// tracks whether the browser has let audio start at all yet.

// Global on/off switch for every effect in this file (room join/leave,
// share start/stop, mentions, and the site-wide warning banner) — a single
// source of truth here means one toggle covers all of them regardless of
// which component fired the sound.
const SOUND_EFFECTS_ENABLED_KEY = "sharescreen:soundEffectsEnabled";

export function getSoundEffectsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SOUND_EFFECTS_ENABLED_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setSoundEffectsEnabled(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_EFFECTS_ENABLED_KEY, String(value));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

function getAudioContext(): AudioContext | null {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  // Resuming here also arms a retry on the next click (see audioContext.ts),
  // so an effect that fired while the context was still blocked isn't the
  // reason the next one is silent too.
  if (ctx.state !== "running") void ensureSharedAudioContextRunning();
  return ctx;
}

type Note = {
  freq: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

// Each note gets its own oscillator + gain envelope (quick linear attack,
// exponential decay) so notes sound like soft chimes instead of harsh
// on/off clicks.
function playNotes(notes: Note[]) {
  if (!getSoundEffectsEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    const startAt = now + note.start;
    const endAt = startAt + note.duration;
    const peakGain = note.gain ?? 0.15;
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}

export function playJoinSound() {
  playNotes([
    { freq: 587, start: 0, duration: 0.12 },
    { freq: 880, start: 0.09, duration: 0.16 },
  ]);
}

export function playLeaveSound() {
  playNotes([
    { freq: 660, start: 0, duration: 0.12 },
    { freq: 415, start: 0.09, duration: 0.18 },
  ]);
}

export function playShareStartSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.09 },
    { freq: 659, start: 0.07, duration: 0.09 },
    { freq: 784, start: 0.14, duration: 0.18 },
  ]);
}

export function playShareStopSound() {
  playNotes([{ freq: 392, start: 0, duration: 0.18, type: "triangle" }]);
}

export function playMentionSound() {
  playNotes([
    { freq: 988, start: 0, duration: 0.1, gain: 0.18 },
    { freq: 988, start: 0.14, duration: 0.14, gain: 0.18 },
  ]);
}

// ─── Your own mic and speakers ────────────────────────────────────────────
//
// The other effects in this file all announce something *somebody else* did,
// on the reasoning that you already watched your own button change. That
// reasoning does not survive the global shortcuts: muting from inside a game,
// with the app behind it, is the case these exist for — there is no button to
// watch, and without a sound the only way to know whether it worked is to
// switch windows and look.
//
// Two pairs, and the pairs have to be distinguishable from each other, not
// just internally: hitting the wrong key and hearing "something happened" is
// no better than silence. So the mic pair is a bright, short blip and the
// speaker pair is lower and rounder — deafening yourself is the heavier
// action and sounds like it.
//
// Rising for on, falling for off, in both pairs. It is the one convention
// nobody has to be taught.

/** Your mic just opened. */
export function playMicOnSound() {
  playNotes([
    { freq: 660, start: 0, duration: 0.06, gain: 0.12 },
    { freq: 880, start: 0.05, duration: 0.08, gain: 0.12 },
  ]);
}

/** Your mic just closed. */
export function playMicOffSound() {
  playNotes([
    { freq: 880, start: 0, duration: 0.06, gain: 0.12 },
    { freq: 660, start: 0.05, duration: 0.08, gain: 0.12 },
  ]);
}

/**
 * You silenced everyone else ("silenciar microfones").
 *
 * Triangle rather than sine, and a fourth below the mic pair: it is the same
 * gesture one level heavier, and it should not be mistakable for having muted
 * yourself.
 */
export function playDeafenSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.07, gain: 0.13, type: "triangle" },
    { freq: 349, start: 0.06, duration: 0.12, gain: 0.13, type: "triangle" },
  ]);
}

/** You can hear the room again. */
export function playUndeafenSound() {
  playNotes([
    { freq: 349, start: 0, duration: 0.07, gain: 0.13, type: "triangle" },
    { freq: 523, start: 0.06, duration: 0.12, gain: 0.13, type: "triangle" },
  ]);
}

// Used for site-wide "top" warnings/announcements (see AnnouncementBanner).
export function playWarningSound() {
  playNotes([
    { freq: 784, start: 0, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.14, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.28, duration: 0.16, type: "square", gain: 0.1 },
  ]);
}
