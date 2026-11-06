"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { attachGain, type GainHandle } from "./audioGain";
import {
  subscribeAudioStatus,
  getAudioStatusVersion,
  getAudioStatusVersionServer,
  isSharedAudioContextRunning,
  ensureSharedAudioContextRunning,
  playWhenAllowed,
} from "./audioContext";

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

/**
 * Wires a <video>/<audio> element's audio through the shared Web Audio gain
 * graph (see audioGain.ts) instead of the element's own volume, so the dial
 * can go up to MAX_GAIN (300%) instead of being capped at 100%. Falls back
 * to the element's native volume/muted when the graph can't carry the audio,
 * so the element still behaves correctly, just capped at 100% in that case.
 *
 * The element is muted only while the graph is *actually running*, and that
 * distinction is the whole point. Muting it the moment a graph existed meant
 * a suspended AudioContext — which is how every browser starts one created
 * before the page has been clicked, see audioContext.ts — produced complete
 * silence out of a UI that looked entirely normal. Now the element carries
 * the audio until the graph can take over, and takes it back if the context
 * is suspended again later (an interruption on iOS, for instance).
 */
export function useGainedAudio<T extends HTMLMediaElement>(
  elementRef: RefObject<T | null>,
  stream: MediaStream | null | undefined,
  volume: number,
  muted: boolean
) {
  const gainRef = useRef<GainHandle | null>(null);
  // Which of the two paths is the audible one right now. The volume/muted
  // effects below need it: while the element is carrying the audio, they have
  // to move *its* dial, not the silent graph's.
  const graphAudibleRef = useRef(false);
  // Re-runs the attach below on anything that changes which path can carry
  // the audio: the context starting or being suspended, or the chosen output
  // device changing (see canRouteToPreferredSink, which attachGain consults).
  const audioStatus = useSyncExternalStore(
    subscribeAudioStatus,
    getAudioStatusVersion,
    getAudioStatusVersionServer
  );

  // Only re-attaches when the stream (or the audio status above) changes —
  // volume/muted below update the existing graph in place instead of tearing
  // it down, which would otherwise pop/click on every slider drag.
  useEffect(() => {
    if (!stream) return;
    // Creates the shared context if this is the first audio on the page, and
    // resumes it (retrying on the next gesture if the browser says no).
    // Deliberately not awaited: the synchronous part is what matters here —
    // by the time it returns, the context exists and is already running if
    // the page had been interacted with.
    void ensureSharedAudioContextRunning();
    // The graph is only wired up when it can actually be heard. Attaching a
    // silent graph and muting nothing would be harmless, but attaching it and
    // then muting the element on the resume would leave both paths audible
    // for the frame in between — a brief doubled voice.
    const handle = isSharedAudioContextRunning() ? attachGain(stream, volume, muted) : null;
    gainRef.current = handle;
    const graphAudible = Boolean(handle);
    graphAudibleRef.current = graphAudible;

    const el = elementRef.current;
    let cancelPlay: (() => void) | null = null;
    if (el) {
      // The graph is a second, independent path to the speakers, so exactly
      // one of the two may be audible at a time. The element's volume is set
      // either way, so it is already right if it has to take over.
      el.muted = graphAudible ? true : muted;
      el.volume = clampVolume(volume);
      // Autoplay is a separate gate from the audio graph's, and a blocked
      // play() is just as silent — retried on the next gesture, same as the
      // context's resume.
      cancelPlay = playWhenAllowed(el);
    }
    return () => {
      // A retry still waiting for a gesture holds the element: let it go with
      // the stream it was for (see playWhenAllowed).
      cancelPlay?.();
      handle?.dispose();
      if (gainRef.current === handle) {
        gainRef.current = null;
        graphAudibleRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, audioStatus]);

  useEffect(() => {
    gainRef.current?.setGain(volume);
    const el = elementRef.current;
    if (el && !graphAudibleRef.current) el.volume = clampVolume(volume);
  }, [volume, elementRef]);

  useEffect(() => {
    gainRef.current?.setMuted(muted);
    const el = elementRef.current;
    if (el && !graphAudibleRef.current) el.muted = muted;
  }, [muted, elementRef]);
}
