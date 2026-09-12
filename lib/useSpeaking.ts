"use client";

import { useCallback, useSyncExternalStore } from "react";
import { speakingDetector } from "./speakingDetector";

/**
 * Whether this stream is currently carrying speech.
 *
 * The measuring itself lives in lib/speakingDetector — one timer and one pass
 * for the whole page, rather than an analyser and an interval per row. This
 * hook keeps the same signature it always had, so the participant list and
 * the group sidebar did not have to change.
 *
 * Streams are keyed by id, so two rows showing the same person (the room's
 * list and a group's voice sidebar) share one measurement rather than each
 * building their own graph over the same audio.
 */
export function useSpeaking(stream: MediaStream | null | undefined): boolean {
  const key = stream?.id ?? null;

  // Acquiring the entry and subscribing to it are the same call, so the
  // detector's ref count can never drift from its listener set — which two
  // separate effects, each with its own cleanup, could not guarantee.
  const subscribe = useCallback(
    (cb: () => void) => (stream ? speakingDetector.acquire(stream, cb) : () => {}),
    [stream]
  );

  // A boolean, so there is no "getSnapshot should be cached" trap here: the
  // value is a primitive and compares by identity for free.
  const getSnapshot = useCallback(() => speakingDetector.isSpeaking(key), [key]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
