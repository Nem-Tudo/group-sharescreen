"use client";

// A call that keeps going with the Android app out of sight.
//
// Leaving the app mid-call used to break it in two ways, neither of which the
// page can do anything about on its own: Android feeds silence to the
// microphone of an app that is not in the foreground, and freezes (or, on
// most OEM builds, kills) a process with nothing on screen and no foreground
// service — the room going quiet first and its connection after. The native
// half, android/…/CallService.java, is that foreground service: the call's
// notification, with a mute button and a hang-up button, for as long as the
// room is held.
//
// Everything here is a no-op off the Android shell, and on an APK from before
// the plugin existed.

import { useEffect, useRef } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { translate } from "@/lib/i18n";

interface CallServicePluginInterface {
  update(options: {
    title: string;
    text: string;
    micOn: boolean;
    muteLabel: string;
    unmuteLabel: string;
  }): Promise<{ mic: boolean }>;
  stop(): Promise<void>;
  addListener(
    eventName: "action",
    listener: (event: { action: "toggleMic" | "leave" }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const CallService = registerPlugin<CallServicePluginInterface>("CallService");

function hasCallService(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("CallService")
  );
}

/**
 * Holds the call's foreground service while `active`.
 *
 * `title` names the call in the notification; `micOn` decides which way its
 * button reads. The two callbacks are what the notification's buttons do, and
 * may change on every render.
 */
export function useAndroidCallService({
  active,
  title,
  micOn,
  onToggleMic,
  onLeave,
}: {
  active: boolean;
  title: string;
  micOn: boolean;
  onToggleMic: () => void;
  onLeave: () => void;
}) {
  const handlersRef = useRef({ onToggleMic, onLeave });
  useEffect(() => {
    handlersRef.current = { onToggleMic, onLeave };
  }, [onToggleMic, onLeave]);

  // The buttons, for the whole call.
  useEffect(() => {
    if (!active || !hasCallService()) return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;
    void CallService.addListener("action", ({ action }) => {
      if (action === "leave") handlersRef.current.onLeave();
      else handlersRef.current.onToggleMic();
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
      void CallService.stop().catch(() => {});
    };
  }, [active]);

  // The notification itself, re-sent whenever what it shows changes — and
  // whenever the app comes back to the front. Android refuses to *start* the
  // service from the background (a call that reconnected while the app was
  // away), and grants the microphone type only to one started with the app on
  // screen, which is also usually after the mic permission was first granted:
  // both are put right by asking again from the foreground.
  useEffect(() => {
    if (!active || !hasCallService()) return;
    const send = () => {
      void CallService.update({
        title,
        text: translate("androidCall.ongoing"),
        micOn,
        muteLabel: translate("androidCall.mute"),
        unmuteLabel: translate("androidCall.unmute"),
      }).catch(() => {});
    };
    send();
    const onVisible = () => {
      if (document.visibilityState === "visible") send();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, title, micOn]);
}
