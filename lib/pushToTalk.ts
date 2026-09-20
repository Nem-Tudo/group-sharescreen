"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopBridge, isDesktopApp } from "./desktop";
import {
  shortcutToElectronAccelerator,
  matchesShortcut,
  useShortcuts,
} from "./keyboardShortcuts";
import { TILE_EXPERIMENT_EVENTS, trackTileExperiment, useTileExperiment } from "./clipsMode";
import { markFeatureUsed } from "@/components/NewBadge";

/**
 * "Apertar para falar" — the microphone stays open and silent, and a key
 * decides when it is heard.
 *
 * Only in the desktop app, deliberately. A website can only follow a key
 * while it has focus, and a push-to-talk key that stops working the moment
 * you tab into a game is not one: the point of the feature is being able to
 * speak from inside whatever you are doing. The shell follows the key
 * system-wide (see electron/main.ts's push-to-talk section) and this hook
 * follows it in the page too, for the keys an OS refuses to register as a
 * global hotkey.
 *
 * Two gates, like every experiment here (see lib/clipsMode): the
 * "push-to-talk" feature decides who is offered it, and the person's own
 * switch in the room's "Mais opções", off by default, decides whether it is
 * on. A third thing is needed before it does anything at all — a key, which
 * they record in the shortcuts panel — because a push-to-talk with no key is
 * a microphone nobody can open.
 */
export const PUSH_TO_TALK_BADGE = "push-to-talk";

const EVENTS = TILE_EXPERIMENT_EVENTS.pushToTalk;

export interface PushToTalkState {
  /** In the experiment — whether or not the switch is on. */
  available: boolean;
  /** The person's own switch in "Mais opções". */
  on: boolean;
  /** Switched on, in the app, and with a key recorded: the mic is gated. */
  active: boolean;
  /** Switched on and in the app, but no key recorded yet. */
  needsKey: boolean;
  /** The key is down right now, so the mic is being heard. */
  held: boolean;
  /** What the person recorded, as they see it ("Ctrl+Shift+V"), or "". */
  combo: string;
}

export function usePushToTalk(): PushToTalkState {
  const mode = useTileExperiment("pushToTalk", { track: true });
  const { shortcuts } = useShortcuts();
  const combo = shortcuts.pushToTalk || "";
  const inApp = isDesktopApp();
  const active = mode.active && inApp && combo !== "";

  // The shell's view of the key and the page's own are kept apart and OR'd:
  // a global hotkey usually swallows the key before the page ever sees it, so
  // most of the time only the first of these ever moves — but when the OS
  // refused to register it, the second is all there is. Neither may be left
  // stuck: this is the difference between a microphone and an open one.
  const [shellHeld, setShellHeld] = useState(false);
  const [domHeld, setDomHeld] = useState(false);
  const held = active && (shellHeld || domHeld);

  // How long this press has been open, for the usage stat. A ref, not state:
  // it is read at the end of a press, not rendered.
  const talkStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (held) {
      if (talkStartedAt.current === null) {
        talkStartedAt.current = Date.now();
        // Counted where the feature is actually used, which for this one is
        // the first time somebody speaks through it — not switching it on.
        markFeatureUsed(PUSH_TO_TALK_BADGE);
      }
      return;
    }
    const startedAt = talkStartedAt.current;
    talkStartedAt.current = null;
    if (startedAt !== null) {
      trackTileExperiment(EVENTS.talk, (Date.now() - startedAt) / 1000);
    }
  }, [held]);

  // The key, handed to the shell. Cleared — not merely left behind — when the
  // switch goes off or the key is unset, or the shell would go on holding a
  // system-wide hotkey for a feature that is no longer on.
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.setPushToTalk) return;
    bridge.setPushToTalk(active ? shortcutToElectronAccelerator(combo) : "");
    return () => bridge.setPushToTalk?.("");
  }, [active, combo]);

  // Both subscriptions put their own state back to false as they go, rather
  // than on the way in: whatever they last reported is only true for as long
  // as they are listening, and a feature switched off mid-press must not
  // leave a "held" behind it. (`held` below ANDs `active` anyway — this is
  // the belt to that's braces.)
  useEffect(() => {
    if (!active) return;
    const bridge = getDesktopBridge();
    if (!bridge?.onPushToTalk) return;
    const unsubscribe = bridge.onPushToTalk(setShellHeld);
    return () => {
      unsubscribe();
      setShellHeld(false);
    };
  }, [active]);

  // The page's own view of the key. `repeat` events are ignored: the mic is
  // already open and the auto-repeat says nothing new.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (matchesShortcut(event, combo)) setDomHeld(true);
    }
    // Any key coming up ends it, not only the combo's own. A combo is the
    // main key *plus* modifiers, and letting go of Ctrl first would otherwise
    // leave a press that can never be closed — open microphone, nobody told.
    function onKeyUp() {
      setDomHeld(false);
    }
    // Losing focus is the one moment the page stops hearing keys at all, so
    // whatever it thinks is held is the last thing it will ever know. The
    // shell keeps following the key from here (that is its whole job) and its
    // own state is untouched by this.
    function onBlur() {
      setDomHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setDomHeld(false);
    };
  }, [active, combo]);

  return {
    available: mode.available,
    on: mode.on,
    active,
    needsKey: mode.active && inApp && combo === "",
    held,
    combo,
  };
}

/** Counted when a key is recorded for it — an experiment switched on and never given one is not in use. */
export function trackPushToTalkKeySet() {
  trackTileExperiment(EVENTS.keySet);
}

/**
 * Lets the microphone through, or does not. Silence by muted track rather
 * than by stopping the capture: starting a capture takes a device open that
 * can be hundreds of milliseconds away, which would swallow the first word of
 * every sentence, and would flash the OS's microphone indicator on and off
 * all call long.
 */
export function applyPushToTalkGate(stream: MediaStream | null, open: boolean) {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) track.enabled = open;
}

/** Undoes the gate — every track back on. For when the feature goes off. */
export function releasePushToTalkGate(stream: MediaStream | null) {
  applyPushToTalkGate(stream, true);
}

/** The hook's `useCallback`-friendly shape, for callers that gate in an effect. */
export function usePushToTalkGate(stream: MediaStream | null, ptt: PushToTalkState) {
  const gate = useCallback(
    (open: boolean) => applyPushToTalkGate(stream, open),
    [stream]
  );
  useEffect(() => {
    if (!ptt.active) {
      // Back to an ordinary microphone — including the case where the switch
      // went off mid-press, which must not leave the track muted forever.
      releasePushToTalkGate(stream);
      return;
    }
    gate(ptt.held);
    return () => releasePushToTalkGate(stream);
  }, [stream, ptt.active, ptt.held, gate]);
}
