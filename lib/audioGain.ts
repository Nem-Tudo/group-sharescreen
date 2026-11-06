"use client";

// Lets a stream's volume go above the native <audio>/<video> element
// ceiling of 1.0 (100%) by routing it through a Web Audio GainNode instead
// of the element's own `.volume`, which browsers hard-clamp to [0, 1]. The
// context itself is the app-wide shared one (see audioContext.ts), which is
// also what guarantees it is actually running — a graph in a suspended
// context is silent, and this path mutes the element, so the two together
// used to add up to hearing nothing at all.

import {
  getSharedAudioContext,
  ensureSharedAudioContextRunning,
  canRouteToPreferredSink,
  sharedStreamSource,
} from "./audioContext";

export const MAX_GAIN = 3;

export interface GainHandle {
  setGain(value: number): void;
  setMuted(value: boolean): void;
  dispose(): void;
}

/**
 * Attaches `stream`'s audio to the shared gain graph. Returns null when
 * Web Audio isn't available or the stream simply has no audio track — the
 * caller falls back to the element's own volume/muted in that case.
 *
 * The caller must silence its own <audio>/<video> element once this
 * succeeds (this graph is a second, independent path to the speakers; left
 * unmuted, the element would play its own unboosted copy alongside it).
 */
export function attachGain(
  stream: MediaStream,
  initialGain: number,
  initialMuted: boolean
): GainHandle | null {
  const ctx = getSharedAudioContext();
  if (!ctx || stream.getAudioTracks().length === 0) return null;
  // The shared context's output can't be moved to the speaker this person
  // picked (no AudioContext.setSinkId in this browser), so taking over
  // playback here would quietly send their audio to the wrong device — and
  // "the wrong device" is frequently one with nothing plugged into it. The
  // element keeps playback instead: capped at 100%, but audible.
  if (!canRouteToPreferredSink()) return null;
  // Kicks the context, and arms a retry on the next click if the browser
  // refuses for now. Not awaited — the graph can be wired up while
  // suspended, it just won't make sound until this succeeds, and
  // useGainedAudio keeps the element unmuted meanwhile.
  void ensureSharedAudioContextRunning();

  // Shared with every other attach of this stream: see sharedStreamSource.
  const source = sharedStreamSource(stream);
  if (!source) return null;
  const gainNode = ctx.createGain();
  let gain = initialGain;
  let muted = initialMuted;
  const apply = () => {
    gainNode.gain.value = muted ? 0 : gain;
  };
  apply();
  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  return {
    setGain(value: number) {
      gain = value;
      apply();
    },
    setMuted(value: boolean) {
      muted = value;
      apply();
    },
    dispose() {
      // Only our own link: the source is shared (see sharedStreamSource), and
      // the bare disconnect() would silence whoever else is playing it.
      try {
        source.disconnect(gainNode);
      } catch {
        // Already disconnected — nothing to do.
      }
      try {
        gainNode.disconnect();
      } catch {
        // As above.
      }
    },
  };
}
