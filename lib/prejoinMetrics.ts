"use client";

// What the room is used for after the door — measured the same way for both
// sides of the experiment "room-prejoin", so the question "does one more step
// make people use rooms less?" has an answer.
//
// Counted for every visit that could have shown the screen (see
// WatchRoomStage's `eligible`), whichever side the person is on: the same kind
// of visit in both groups. Every event goes to that feature alone.
//
// Milestones rather than "how long it lasted": the end of a visit is mostly a
// tab being closed, and an event sent then is lost (the batch has already
// gone). "Still here at 30 s / 2 / 10 / 30 min" survives that, and a minute
// counter gives the total time.
//
// In blocks of BLOCK_MIN minutes, with the minutes as the value: feature
// events go out in a request of their own every couple of seconds, and one per
// minute per person in a room was a request per minute per person.

import { getCallSession, subscribeCallSession } from "./callSession";
import { trackFeatureEvent } from "./features";
import { signalingClient } from "./signalingClient";

export const ROOM_PREJOIN_FEATURE = "room-prejoin";

export const ROOM_VISIT_EVENTS = {
  /** Every BLOCK_MIN minutes in the call; value = minutes. Sum per group = total minutes in rooms. */
  minute: "prejoin_room_min",
  /** With the block above, when the mic was on in it; value = minutes with the mic on. */
  micMinute: "prejoin_room_mic_min",
  /** Same, for transmitting a screen or camera; value = minutes. */
  shareMinute: "prejoin_room_share_min",
  /** The mic came on at some point in this visit (once per visit). */
  mic: "prejoin_room_mic",
  /** Shared a screen or camera at some point in this visit (once per visit). */
  share: "prejoin_room_share",
  /** Every chat message sent in the room. */
  message: "prejoin_room_msg",
  /** Still in the call at each of these marks. */
  stay30s: "prejoin_stay_30s",
  stay2m: "prejoin_stay_2m",
  stay10m: "prejoin_stay_10m",
  stay30m: "prejoin_stay_30m",
  /** Hung up inside 30 s (in-app — a closed tab is the missing stay30s). */
  quickLeave: "prejoin_quick_leave",
} as const;

const STAY_MARKS: [number, string][] = [
  [30_000, ROOM_VISIT_EVENTS.stay30s],
  [120_000, ROOM_VISIT_EVENTS.stay2m],
  [600_000, ROOM_VISIT_EVENTS.stay10m],
  [1_800_000, ROOM_VISIT_EVENTS.stay30m],
];
const TICK_MS = 5_000;
const BLOCK_MIN = 5;

function track(name: string, value?: number) {
  trackFeatureEvent(name, { feature: ROOM_PREJOIN_FEATURE, ...(value ? { value } : {}) });
}

let stopCurrent: (() => void) | null = null;

/**
 * Starts measuring a visit to `handle`'s call, from now until that call is no
 * longer the session (hung up, or another room taken instead). One at a time:
 * starting another ends the one before.
 */
export function startRoomVisitMetrics(handle: string): void {
  stopCurrent?.();
  const startedAt = Date.now();
  let blocksCounted = 0;
  let lastTickAt = startedAt;
  let micMs = 0;
  let shareMs = 0;
  let marksPassed = 0;
  let micSeen = false;
  let shareSeen = false;
  // Messages already in the room's history are not ours to count.
  const seenMessages = new Set(signalingClient.state.chatMessages.map((m) => m.id));
  let lastMessages = signalingClient.state.chatMessages;

  const inCall = () => getCallSession()?.handle === handle;
  const sharing = () => signalingClient.state.selfScreen || signalingClient.state.selfCamera;

  const tick = () => {
    if (!inCall()) return;
    const now = Date.now();
    const elapsed = now - startedAt;
    const mic = signalingClient.isMicAnnounced();
    const share = sharing();
    // What was on since the last look is credited to it; a throttled
    // background tab looks less often, and the state at the look stands in.
    const step = now - lastTickAt;
    lastTickAt = now;
    if (mic) micMs += step;
    if (share) shareMs += step;
    if (mic && !micSeen) {
      micSeen = true;
      track(ROOM_VISIT_EVENTS.mic);
    }
    if (share && !shareSeen) {
      shareSeen = true;
      track(ROOM_VISIT_EVENTS.share);
    }
    while (marksPassed < STAY_MARKS.length && elapsed >= STAY_MARKS[marksPassed][0]) {
      track(STAY_MARKS[marksPassed][1]);
      marksPassed += 1;
    }
    const blocks = Math.floor(elapsed / (BLOCK_MIN * 60_000));
    if (blocks > blocksCounted) {
      const minutes = (blocks - blocksCounted) * BLOCK_MIN;
      blocksCounted = blocks;
      track(ROOM_VISIT_EVENTS.minute, minutes);
      if (micMs > 0) track(ROOM_VISIT_EVENTS.micMinute, Math.max(1, Math.round(micMs / 60_000)));
      if (shareMs > 0) track(ROOM_VISIT_EVENTS.shareMinute, Math.max(1, Math.round(shareMs / 60_000)));
      micMs = 0;
      shareMs = 0;
    }
  };

  const unsubscribeChat = signalingClient.subscribe(() => {
    const messages = signalingClient.state.chatMessages;
    if (messages === lastMessages) return;
    lastMessages = messages;
    const selfId = signalingClient.state.selfId;
    for (const message of messages) {
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      if (selfId && message.from === selfId && inCall()) track(ROOM_VISIT_EVENTS.message);
    }
  });

  const timer = setInterval(tick, TICK_MS);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    unsubscribeChat();
    unsubscribeSession();
    if (stopCurrent === stop) stopCurrent = null;
  };
  const unsubscribeSession = subscribeCallSession(() => {
    if (inCall()) return;
    if (Date.now() - startedAt < 30_000) track(ROOM_VISIT_EVENTS.quickLeave);
    stop();
  });
  stopCurrent = stop;
}
