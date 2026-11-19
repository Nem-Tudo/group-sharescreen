"use client";

import { trackFeatureEvent } from "./features";

// Experiment "share-own-audio-filter": a share's system audio leaves out what
// Go Live itself is playing.
//
// Sharing "the sound of the screen" captures everything the computer plays —
// which, in a call, includes the call: the voices of everyone in the room and
// the audio of any share being watched. The room then hears itself back, once
// live and once through the share, a fraction of a second apart (tickets
// 21.6, 22.3, 2.2: "a voz minha e dos meus amigos saem também, eu acabo
// ouvindo duas vezes"). The desktop app on Windows 11 never had this: its
// native helper captures the mix with Go Live's own process tree excluded
// (see lib/desktopSystemAudio.ts). Every other path — Chrome and Edge, the app
// on Windows 10, the app on macOS — asked for the whole mix.
//
// `restrictOwnAudio` is the browser's own version of that helper: "the
// captured system audio will be filtered to exclude audio originating from
// the document that performed getDisplayMedia". Shipped in Chromium 140 on
// Windows and macOS (Electron 38 is 140); elsewhere the constraint is simply
// unknown and ignored, and it has no effect at all on a tab or window share,
// which never carried the room's audio to begin with.
//
// Behind an experiment rather than switched on for everyone because the
// failure that matters cannot be seen from here: a system that refuses the
// filtered capture fails the whole getDisplayMedia with NotReadableError, and
// the existing retry then shares video only — no echo, but no sound either.
// The events below are what tell that apart from it working.

export const OWN_AUDIO_FILTER_FEATURE = "share-own-audio-filter";

export const OWN_AUDIO_FILTER_EVENTS = {
  /** A screen share that asked for system audio. Both sides, the denominator. */
  asked: "share_sysaudio_asked",
  /** ...and came back with an audio track. A drop on the "on" side is the failure above. */
  got: "share_sysaudio_got",
  /** ...and the browser says the filter is in effect on it. "On" side only, by definition. */
  filtered: "own_audio_filtered",
  /** The capture with system audio refused outright (NotReadableError) and retried without it. */
  refused: "share_sysaudio_refused",
} as const;

let enabled = false;

/** Set from useRoomMedia, which is where the experiment is read. */
export function setOwnAudioFilterEnabled(value: boolean) {
  enabled = value;
}

/** Whether the next share asks for its own audio to be left out. */
export function ownAudioFilterEnabled(): boolean {
  return enabled;
}

/** The extra audio constraint for getDisplayMedia, or nothing outside the experiment. */
export function ownAudioConstraints(): { restrictOwnAudio?: boolean } {
  return enabled ? { restrictOwnAudio: true } : {};
}

function count(name: string) {
  trackFeatureEvent(name, { feature: OWN_AUDIO_FILTER_FEATURE, value: 1 });
}

/** Reports what a share that asked for system audio actually got. */
export function reportShareAudio(stream: MediaStream) {
  count(OWN_AUDIO_FILTER_EVENTS.asked);
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  count(OWN_AUDIO_FILTER_EVENTS.got);
  // Not in lib.dom's MediaTrackSettings yet. Only a browser that applied the
  // filter reports it as true.
  const settings = track.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean };
  if (settings.restrictOwnAudio === true) count(OWN_AUDIO_FILTER_EVENTS.filtered);
}

/** A share whose system-audio request was refused outright (see the retry in useRoomMedia). */
export function reportShareAudioRefused() {
  count(OWN_AUDIO_FILTER_EVENTS.refused);
}
