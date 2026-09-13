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
// The shortest gap between two playings of the *same* effect. Twenty people
// arriving at once is one event to a listener, not twenty — and before this
// it was twenty overlapping oscillator bursts, which is both unpleasant and
// real work on the audio thread. Per effect, so a join and a mention landing
// together still both play.
const MIN_REPEAT_MS = 120;
const lastPlayedAt = new Map<string, number>();

function playNotes(notes: Note[], dedupeKey?: string) {
  if (!getSoundEffectsEnabled()) return;
  if (dedupeKey) {
    const now = Date.now();
    const last = lastPlayedAt.get(dedupeKey) ?? 0;
    if (now - last < MIN_REPEAT_MS) return;
    lastPlayedAt.set(dedupeKey, now);
  }
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
  ], "join");
}

export function playLeaveSound() {
  playNotes([
    { freq: 660, start: 0, duration: 0.12 },
    { freq: 415, start: 0.09, duration: 0.18 },
  ], "leave");
}

export function playShareStartSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.09 },
    { freq: 659, start: 0.07, duration: 0.09 },
    { freq: 784, start: 0.14, duration: 0.18 },
  ], "share-start");
}

export function playShareStopSound() {
  playNotes([{ freq: 392, start: 0, duration: 0.18, type: "triangle" }], "share-stop");
}

export function playMentionSound() {
  playNotes([
    { freq: 988, start: 0, duration: 0.1, gain: 0.18 },
    { freq: 988, start: 0.14, duration: 0.14, gain: 0.18 },
  ], "mention");
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

/**
 * You hung up.
 *
 * Deliberately not playLeaveSound, which announces *somebody else* leaving:
 * this is the heavier event of the two and the one you caused, so it falls
 * further and ends lower — three steps down, triangle, like a handset going
 * back on the cradle. Mistaking "I left" for "someone left" is the one
 * confusion these two must not allow.
 */
export function playHangUpSound() {
  playNotes([
    { freq: 587, start: 0, duration: 0.09, gain: 0.14, type: "triangle" },
    { freq: 440, start: 0.08, duration: 0.1, gain: 0.14, type: "triangle" },
    { freq: 294, start: 0.17, duration: 0.26, gain: 0.14, type: "triangle" },
  ]);
}

/**
 * You are in — a call you walked into from a group just connected.
 *
 * The mirror of playHangUpSound, note for note: the same three triangle steps
 * rising instead of falling, a handset coming *off* the cradle. Deliberately
 * not playJoinSound, which announces somebody *else* arriving — "I got in" and
 * "someone got in" must not sound alike, for the same reason the two leave
 * sounds do not.
 */
export function playConnectSound() {
  playNotes([
    { freq: 294, start: 0, duration: 0.09, gain: 0.14, type: "triangle" },
    { freq: 440, start: 0.08, duration: 0.1, gain: 0.14, type: "triangle" },
    { freq: 587, start: 0.17, duration: 0.22, gain: 0.14, type: "triangle" },
  ]);
}

/**
 * Something arrived in the bell (see components/SocialNotifier).
 *
 * Two rising notes, softer and rounder than the mention chime: a friend
 * request is not urgent and should not sound like being called out by name in
 * a room you are already in.
 */
export function playFriendRequestSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.1, gain: 0.12 },
    { freq: 784, start: 0.09, duration: 0.2, gain: 0.12 },
  ], "friend-request");
}

/**
 * A private message arrived.
 *
 * Deliberately not the mention chime: being named in a room you are already
 * in is an interruption of something you are doing, while a DM is somebody
 * knocking. Two soft notes a tone apart, quieter than either.
 */
export function playDirectMessageSound() {
  playNotes([
    { freq: 700, start: 0, duration: 0.08, gain: 0.1 },
    { freq: 880, start: 0.07, duration: 0.14, gain: 0.1 },
  ], "dm");
}

/**
 * A payment went through (see PurchaseCelebration).
 *
 * The one effect here meant to feel like a reward rather than a notice: a
 * major arpeggio climbing an octave, a two-note sparkle over the top, and the
 * chord held underneath so it lands instead of just stopping. Longer than
 * anything else in this file on purpose — it plays once per purchase, not
 * once per event in a busy room.
 */
export function playPurchaseSound() {
  playNotes([
    { freq: 523, start: 0, duration: 0.14, gain: 0.12 },
    { freq: 659, start: 0.08, duration: 0.14, gain: 0.12 },
    { freq: 784, start: 0.16, duration: 0.14, gain: 0.12 },
    { freq: 1047, start: 0.24, duration: 0.3, gain: 0.13 },
    { freq: 1319, start: 0.36, duration: 0.2, gain: 0.07, type: "triangle" },
    { freq: 1568, start: 0.44, duration: 0.35, gain: 0.07, type: "triangle" },
    { freq: 523, start: 0.36, duration: 0.9, gain: 0.06 },
    { freq: 659, start: 0.36, duration: 0.9, gain: 0.05 },
    { freq: 784, start: 0.36, duration: 0.9, gain: 0.05 },
  ], "purchase");
}

// Used for site-wide "top" warnings/announcements (see AnnouncementBanner).
export function playWarningSound() {
  playNotes([
    { freq: 784, start: 0, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.14, duration: 0.1, type: "square", gain: 0.1 },
    { freq: 784, start: 0.28, duration: 0.16, type: "square", gain: 0.1 },
  ]);
}

// ─── Chamadas ─────────────────────────────────────────────────────────────
//
// The two sounds here are the only ones in this file that *repeat*, and that
// is the whole difference between a notification and a ring: a chime says
// something happened, a ring says somebody is waiting for you right now and
// keeps saying it until one of you gives up.
//
// Both are driven by a plain interval re-firing the same short pattern rather
// than by a long scheduled score, because a ring has to be stoppable on the
// exact beat somebody presses "atender" — and Web Audio's scheduled notes,
// once started, are the one thing that cannot be taken back.

let ringTimer: ReturnType<typeof setInterval> | null = null;

/** The classic two-burst pattern, one cycle. */
function ringCycle() {
  playNotes([
    { freq: 440, start: 0, duration: 0.38, gain: 0.13, type: "triangle" },
    { freq: 480, start: 0, duration: 0.38, gain: 0.09, type: "sine" },
    { freq: 440, start: 0.5, duration: 0.38, gain: 0.13, type: "triangle" },
    { freq: 480, start: 0.5, duration: 0.38, gain: 0.09, type: "sine" },
  ]);
}

/** The single low pulse the *caller* hears while the other side rings. */
function ringbackCycle() {
  playNotes([{ freq: 392, start: 0, duration: 0.45, gain: 0.07, type: "sine" }]);
}

/**
 * Starts ringing, and keeps ringing.
 *
 * Idempotent: a second call while one is already going is a no-op rather than
 * a second overlapping ring, which is what would otherwise happen the moment
 * two components both decide they are responsible for the sound.
 *
 * Respects the global sound switch through playNotes like everything else
 * here — somebody who turned effects off turned this off too, and the OS
 * notification (which they did not turn off) is what still reaches them.
 */
export function startRingtone(kind: "incoming" | "outgoing" = "incoming") {
  if (ringTimer) return;
  const cycle = kind === "incoming" ? ringCycle : ringbackCycle;
  cycle();
  // Two seconds between bursts for an incoming ring, four for the caller's
  // own ringback — the one you are meant to answer should be twice as
  // insistent as the one you are meant to wait through.
  ringTimer = setInterval(cycle, kind === "incoming" ? 2000 : 4000);
}

/** Stops whatever is ringing. Safe to call when nothing is. */
export function stopRingtone() {
  if (!ringTimer) return;
  clearInterval(ringTimer);
  ringTimer = null;
}
