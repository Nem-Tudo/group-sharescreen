"use client";

// The microphone's peer connections, measured — and the four experiments that
// try to make them more reliable.
//
// Why this file exists: the mic mesh was the one part of a call nothing looked
// at. Its connections are never put in connectionRegistry (that registry is
// about video quality), so the quality telemetry, the stats panel and the
// admin's "Qualidade" tab all saw video only. "Às vezes o áudio não sai" and
// "um ouve e o outro não" could not be confirmed or ruled out from data. The
// events below are that data:
//
//   - send side, per person we were transmitting to when the mic came on: how
//     long until our connection to them was up, or that it never came up;
//   - receive side, per person with the mic on: how long until their audio's
//     connection to us was up, that it never came up, or that it came up late.
//
// They are counted for the experiments they measure, and only those (each
// event is sent with `feature`, so it does not land in every live feature's
// numbers). At 0% rollout everybody is in "control", which is the baseline.

import { useCallback, useEffect, useRef, useState } from "react";
import { trackFeatureEvent } from "./features";

/** "Ativar som": a notice when the browser holds the room's audio back until a click. */
export const AUDIO_UNBLOCK_FEATURE = "audio-unblock";
export const AUDIO_UNBLOCK_EVENTS = {
  /** A blocked stretch began while there was somebody to hear. */
  blocked: "audio_blocked",
  /** It ended; value = how long it lasted, in ms. */
  unblocked: "audio_unblocked",
  /** The notice's button was pressed. */
  click: "audio_unblock_click",
} as const;

/** Per person, "sem áudio" in the participant list, with a retry. */
export const MIC_LINK_STATUS_FEATURE = "mic-link-status";
export const MIC_LINK_STATUS_EVENTS = {
  /** A person's row started saying their audio is not reaching us. */
  shown: "mic_link_stuck_shown",
  /** The retry on that row was pressed. */
  retry: "mic_link_retry",
  /** Their audio connected after a retry; value = ms after the press. */
  retryOk: "mic_link_retry_ok",
} as const;

/** Muting keeps the connections and only cuts the input (see rnnoise's detachGraphInputs). */
export const MIC_SOFT_MUTE_FEATURE = "mic-soft-mute";
export const MIC_SOFT_MUTE_EVENTS = {
  /** Muted the soft way. */
  mute: "mic_soft_mute",
  /** Unmuted the soft way; value = ms to reopen the microphone. */
  unmute: "mic_soft_unmute",
  /** Wanted a soft mute, got the old full stop (no graph, a phone mic, a big room). */
  fallback: "mic_soft_fallback",
  /** Stayed muted past SOFT_MUTE_HOLD_MS, so the connections were let go. */
  expired: "mic_soft_expired",
} as const;

/** TURN (the site's own VPS) for the mic's connections only, for accounts without Pro. */
export const MIC_TURN_FREE_FEATURE = "mic-turn-free";
export const MIC_TURN_FREE_EVENTS = {
  /** The API granted the audio-only relay. */
  granted: "mic_turn_granted",
} as const;

export const MIC_LINK_EVENTS = {
  /** Send side: our connection to a person came up; value = ms after the mic came on. */
  txOk: "mic_tx_ok",
  /** Send side: still not up after LINK_FAIL_MS. */
  txFail: "mic_tx_fail",
  /** Receive side: a person's audio connection came up; value = ms after we saw their mic on. */
  rxOk: "mic_rx_ok",
  /** Receive side: still not up after LINK_FAIL_MS. */
  rxFail: "mic_rx_fail",
  /** Receive side: came up after having been counted as failed; value = ms in total. */
  rxLate: "mic_rx_late",
} as const;

/** After this long without a connection, a pair counts as failed. */
export const LINK_FAIL_MS = 20_000;
/**
 * After this long, a person's row says their audio is not reaching us. Shorter
 * than LINK_FAIL_MS — the row is for the person waiting, the event for the
 * numbers — and long enough that an ordinary join (a second or two, more
 * through TURN) never flashes it.
 */
export const LINK_STUCK_MS = 12_000;

// The experiments each kind of event measures. Send-side outcomes are what
// soft mute and the audio relay change for the sender; receive-side ones are
// what the listener sees, which the per-person status (its retry) also moves.
const TX_FEATURES = [MIC_SOFT_MUTE_FEATURE, MIC_TURN_FREE_FEATURE];
const RX_FEATURES = [MIC_SOFT_MUTE_FEATURE, MIC_TURN_FREE_FEATURE, MIC_LINK_STATUS_FEATURE];

function trackFor(features: readonly string[], name: string, value?: number) {
  // A value of 0 is dropped by trackFeatureEvent, and "connected in 0 ms" is a
  // real answer (a connection that was already up): 1 ms stands in for it.
  const v = value === undefined ? undefined : Math.max(1, Math.round(value));
  for (const feature of features) trackFeatureEvent(name, { feature, value: v });
}

/**
 * Watches the send side of a mic that just came on: for each person we
 * transmit to, how long until our connection to them is up. `stateOf` reads
 * the live connection (it is rebuilt on retries, so it is looked up each time,
 * never captured). Returns the way to stop watching — the mic going off again
 * before the answer, which is not a failure.
 */
export function watchMicSendLinks(
  peerIds: readonly string[],
  stateOf: (peerId: string) => RTCPeerConnectionState | undefined
): () => void {
  if (peerIds.length === 0) return () => {};
  const startedAt = Date.now();
  const pending = new Set(peerIds);
  const check = () => {
    const elapsed = Date.now() - startedAt;
    for (const peerId of [...pending]) {
      if (stateOf(peerId) === "connected") {
        pending.delete(peerId);
        trackFor(TX_FEATURES, MIC_LINK_EVENTS.txOk, elapsed);
      } else if (elapsed >= LINK_FAIL_MS) {
        pending.delete(peerId);
        trackFor(TX_FEATURES, MIC_LINK_EVENTS.txFail);
      }
    }
    if (pending.size === 0) stop();
  };
  const timer = setInterval(check, 250);
  function stop() {
    clearInterval(timer);
  }
  // A connection that is already up (soft mute) answers on the first look.
  check();
  return stop;
}

type RxEntry = { since: number; done: boolean; failed: boolean; shown: boolean; retriedAt: number | null };

interface RxPeer {
  id: string;
  mic: boolean;
  bot?: boolean;
}

/**
 * The receive side, for a room: measures each person's audio connection from
 * the moment we see their mic on, and returns who has had it on for longer
 * than LINK_STUCK_MS without their audio reaching us.
 *
 * `live` is false while our own signalling is down or we are not in the room —
 * everybody would look unreachable then, and none of it would be about them.
 */
export function useMicReceiveLinks(
  peers: readonly RxPeer[],
  states: Record<string, RTCPeerConnectionState>,
  live: boolean
): { stuck: ReadonlySet<string>; noteRetry: (peerId: string) => void } {
  const entries = useRef(new Map<string, RxEntry>());
  const peersRef = useRef(peers);
  const statesRef = useRef(states);
  const liveRef = useRef(live);
  const [stuck, setStuck] = useState<ReadonlySet<string>>(() => new Set());

  const evaluateRef = useRef<() => boolean>(() => false);
  const evaluate = useCallback((): boolean => {
    const map = entries.current;
    const now = Date.now();
    if (!liveRef.current) {
      map.clear();
      setStuck((prev) => (prev.size === 0 ? prev : new Set()));
      return false;
    }
    const wanted = new Set<string>();
    for (const peer of peersRef.current) {
      if (!peer.mic || peer.bot) continue;
      wanted.add(peer.id);
      const state = statesRef.current[peer.id];
      let entry = map.get(peer.id);
      // Their connection went away under a mic that stayed on (a rebuild, a
      // retry): a new wait starts. "disconnected" and "connecting" are given
      // the benefit of the doubt — both usually come back on their own.
      if (entry?.done && (state === undefined || state === "failed" || state === "closed" || state === "new")) {
        entry = undefined;
      }
      if (!entry) {
        entry = { since: now, done: false, failed: false, shown: false, retriedAt: null };
        map.set(peer.id, entry);
      }
      if (entry.done) continue;
      if (state === "connected") {
        entry.done = true;
        trackFor(RX_FEATURES, entry.failed ? MIC_LINK_EVENTS.rxLate : MIC_LINK_EVENTS.rxOk, now - entry.since);
        if (entry.retriedAt !== null) {
          trackFeatureEvent(MIC_LINK_STATUS_EVENTS.retryOk, {
            feature: MIC_LINK_STATUS_FEATURE,
            value: Math.max(1, now - entry.retriedAt),
          });
        }
        continue;
      }
      if (!entry.failed && now - entry.since >= LINK_FAIL_MS) {
        entry.failed = true;
        trackFor(RX_FEATURES, MIC_LINK_EVENTS.rxFail);
      }
    }
    for (const id of [...map.keys()]) if (!wanted.has(id)) map.delete(id);

    const next = new Set<string>();
    let waiting = false;
    for (const [id, entry] of map) {
      if (entry.done) continue;
      waiting = true;
      if (now - entry.since >= LINK_STUCK_MS) next.add(id);
    }
    setStuck((prev) =>
      prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next
    );
    return waiting;
  }, []);
  useEffect(() => {
    evaluateRef.current = evaluate;
  }, [evaluate]);

  useEffect(() => {
    peersRef.current = peers;
    statesRef.current = states;
    liveRef.current = live;
    evaluateRef.current();
  }, [peers, states, live]);

  // Timeouts need a clock: only ticks while somebody is still being waited on.
  useEffect(() => {
    const timer = setInterval(() => evaluateRef.current(), 1000);
    return () => clearInterval(timer);
  }, []);

  const noteRetry = useCallback((peerId: string) => {
    const entry = entries.current.get(peerId);
    if (!entry || entry.done) return;
    entry.retriedAt = Date.now();
  }, []);

  return { stuck, noteRetry };
}

/** Marks a row as having been shown stuck, once per wait. For the "shown" event. */
export function useStuckShownEvents(stuck: ReadonlySet<string>, enabled: boolean) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const id of [...seen.current]) if (!stuck.has(id)) seen.current.delete(id);
    if (!enabled) return;
    for (const id of stuck) {
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      trackFeatureEvent(MIC_LINK_STATUS_EVENTS.shown, { feature: MIC_LINK_STATUS_FEATURE });
    }
  }, [stuck, enabled]);
}
