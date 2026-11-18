"use client";

// Talking and listening with the iPhone app in the background.
//
// The room's audio lives in this page (WebRTC inside the app's WKWebView). On
// its own, iOS stops treating it as anything worth keeping alive once the app
// leaves the screen: the page can be suspended, and WebKit mutes a microphone
// it is capturing for a page that is not visible. What phones do for calls is
// register them with the system — CallKit — and that is what this does while
// you are in a room: iOS sees an ongoing call ("Go Live", the green pill),
// keeps the app running with its microphone and sound, and lets the system's
// own call controls drive ours. ios/App/App/BackgroundCallPlugin.swift.
//
//   - the system's mute button and this room's mic are the same switch, both
//     ways;
//   - ending the call from the system (the pill, the lock screen) leaves the
//     room, as hanging up does;
//   - leaving the room ends the call.
//
// Behind the experiment below: it changes how the app's audio session is run,
// which is only testable on a real phone.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isIOSApp } from "./desktop";
import { trackFeatureEvent, useFeature } from "./features";

/** The feature's key in the admin panel. Target: user. */
export const IOS_BACKGROUND_CALL_FEATURE = "ios-background-call";

/** Every event this reports — each must be a site event of the feature. */
export const IOS_BACKGROUND_CALL_EVENTS = {
  /** The system call started (entering a room). */
  start: "ios_call_start",
  /** Muted or unmuted from the system's controls. */
  systemMute: "ios_call_system_mute",
  /** Ended from the system's controls, which left the room. */
  systemEnd: "ios_call_system_end",
  /** The system call could not be started (the message is shown in the room). */
  fail: "ios_call_fail",
} as const;

interface BackgroundCallPlugin {
  /** Starts the system call. `supported: false` where CallKit may not be used. */
  start(options: { title: string; muted: boolean }): Promise<{ supported: boolean }>;
  end(): Promise<void>;
  setMuted(options: { muted: boolean }): Promise<void>;
  addListener(event: "muteChanged", listener: (event: { muted: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: "ended", listener: () => void): Promise<PluginListenerHandle>;
}

const BackgroundCall = registerPlugin<BackgroundCallPlugin>("BackgroundCall");

function isAvailable(): boolean {
  return isIOSApp() && Capacitor.isPluginAvailable("BackgroundCall");
}
function noopSubscribe() {
  return () => {};
}

/**
 * Runs the system call for as long as `inRoom` is true, kept in step with the
 * room's microphone. Mounted by the room page.
 */
export function useIOSBackgroundCall({
  inRoom,
  title,
  micOn,
  toggleMic,
  hangUp,
  deafened,
  toggleDeafen,
}: {
  inRoom: boolean;
  title: string;
  micOn: boolean;
  /** The room's own mic button — so a system mute goes through the same path a press does. */
  toggleMic: () => void;
  /** The room's own "Sair". */
  hangUp: () => void;
  /** The room's headphones button: everybody silenced for this person. */
  deafened: boolean;
  toggleDeafen: () => void;
}): { error: string | null; dismissError: () => void } {
  const available = useSyncExternalStore(noopSubscribe, isAvailable, () => false);
  const iosApp = useSyncExternalStore(noopSubscribe, isIOSApp, () => false);

  // Whatever the call does, the room's audio is a call's audio while you are
  // in it. Left on "auto", WebKit picks the category from what the page is
  // doing at the moment — and with the mic closed it picks one that obeys the
  // silent switch, so the room went quiet on a phone set to silent, and the
  // mic reopening flipped it back. "play-and-record" keeps it one voice-call
  // session for the whole stay (Audio Session API, WebKit on iOS 17+).
  useEffect(() => {
    if (!iosApp || !inRoom) return;
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    const previous = session.type;
    try {
      session.type = "play-and-record";
    } catch {
      return;
    }
    return () => {
      try {
        session.type = previous === "play-and-record" ? "auto" : previous;
      } catch {
        // Nothing to undo.
      }
    };
  }, [iosApp, inRoom]);

  // What iOS shows for the room's sound — the Dynamic Island, the lock
  // screen, Control Center. WebKit files it as media playing and, told
  // nothing, shows a music player titled with the site's domain, with ±10 s
  // and a pause that silences the call. Told what it is: the room and Go Live,
  // no seeking or tracks, and play/pause as the headphones button.
  const deafenedRef = useRef(deafened);
  const toggleDeafenRef = useRef(toggleDeafen);
  useEffect(() => {
    deafenedRef.current = deafened;
    toggleDeafenRef.current = toggleDeafen;
  });
  useEffect(() => {
    if (!iosApp || !inRoom || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title,
        artist: "Go Live",
        artwork: [{ src: "/icon.png", sizes: "500x500", type: "image/png" }],
      });
    } catch {
      // MediaMetadata missing: the player keeps the defaults.
    }
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this WebKit does not know.
      }
    };
    for (const action of ["seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"] as MediaSessionAction[]) {
      set(action, null);
    }
    set("pause", () => {
      if (!deafenedRef.current) toggleDeafenRef.current();
    });
    set("play", () => {
      if (deafenedRef.current) toggleDeafenRef.current();
    });
    return () => {
      set("pause", null);
      set("play", null);
      try {
        session.metadata = null;
        session.playbackState = "none";
      } catch {
        // Nothing to undo.
      }
    };
  }, [iosApp, inRoom, title]);
  useEffect(() => {
    if (!iosApp || !inRoom || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = deafened ? "paused" : "playing";
    } catch {
      // Older WebKit: the player guesses on its own.
    }
  }, [iosApp, inRoom, deafened]);
  const enabled = useFeature(IOS_BACKGROUND_CALL_FEATURE, { track: available }).enabled && available;
  const active = enabled && inRoom;
  // Why the system call did not start, said in the room rather than
  // swallowed: without it the voice dies in the background with no clue why.
  const [error, setError] = useState<string | null>(null);

  // Read through refs by the listeners, which are set up once per call.
  const micOnRef = useRef(micOn);
  const toggleMicRef = useRef(toggleMic);
  const hangUpRef = useRef(hangUp);
  useEffect(() => {
    micOnRef.current = micOn;
    toggleMicRef.current = toggleMic;
    hangUpRef.current = hangUp;
  });

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    void BackgroundCall.addListener("muteChanged", ({ muted }) => {
      trackFeatureEvent(IOS_BACKGROUND_CALL_EVENTS.systemMute, { feature: IOS_BACKGROUND_CALL_FEATURE });
      // Only when the system disagrees with the room: the echo of our own
      // setMuted below must not flip the mic back.
      if (muted === micOnRef.current) toggleMicRef.current();
    }).then((h) => (disposed ? void h.remove() : handles.push(h)));
    void BackgroundCall.addListener("ended", () => {
      trackFeatureEvent(IOS_BACKGROUND_CALL_EVENTS.systemEnd, { feature: IOS_BACKGROUND_CALL_FEATURE });
      hangUpRef.current();
    }).then((h) => (disposed ? void h.remove() : handles.push(h)));
    void BackgroundCall.start({ title, muted: !micOnRef.current })
      .then(({ supported }) => {
        if (disposed) return;
        if (supported) {
          setError(null);
          trackFeatureEvent(IOS_BACKGROUND_CALL_EVENTS.start, { feature: IOS_BACKGROUND_CALL_FEATURE });
        } else {
          setError("CallKit indisponível neste aparelho (região).");
          trackFeatureEvent(IOS_BACKGROUND_CALL_EVENTS.fail, { feature: IOS_BACKGROUND_CALL_FEATURE, value: 1 });
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(`Chamada do sistema não iniciou: ${message || "erro desconhecido"}`);
        trackFeatureEvent(IOS_BACKGROUND_CALL_EVENTS.fail, { feature: IOS_BACKGROUND_CALL_FEATURE, value: 2 });
      });
    return () => {
      disposed = true;
      handles.forEach((h) => void h.remove());
      void BackgroundCall.end().catch(() => {});
    };
    // The title is the call's name on the lock screen; a rename mid-call is
    // not worth ending and restarting the call for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void BackgroundCall.setMuted({ muted: !micOn }).catch(() => {});
  }, [active, micOn]);

  return { error: active ? error : null, dismissError: () => setError(null) };
}
