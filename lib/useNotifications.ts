"use client";

// React surface over lib/notifications.ts. Components never poke the module's
// permission/mute functions directly — they read this hook, which keeps them
// re-rendering as the permission or the global mute changes (including from
// another tab, via the storage event) and exposes the two gestures a UI needs:
// enable() to ask for permission, and setMuted() to flip the local toggle.

import { useCallback, useSyncExternalStore } from "react";
import {
  areNotificationsMuted,
  getNotificationPermission,
  isNotificationSupported,
  onNotificationStateChange,
  refreshNotificationPermission,
  requestNotificationPermission,
  setNotificationsMuted,
  type NotificationPermissionState,
} from "./notifications";

export interface UseNotifications {
  supported: boolean;
  permission: NotificationPermissionState;
  muted: boolean;
  /** True only when permission is granted and the user hasn't muted. */
  active: boolean;
  /** Ask for permission (call from a click). Returns the resulting state. */
  enable: () => Promise<NotificationPermissionState>;
  setMuted: (muted: boolean) => void;
}

// A single snapshot object so useSyncExternalStore can compare by reference and
// only re-render on an actual change. Recomputed lazily and memoized until the
// next emitted change, which is what getSnapshot's referential-stability
// contract requires.
interface Snapshot {
  supported: boolean;
  permission: NotificationPermissionState;
  muted: boolean;
}

let cached: Snapshot | null = null;

function getSnapshot(): Snapshot {
  const next: Snapshot = {
    supported: isNotificationSupported(),
    permission: getNotificationPermission(),
    muted: areNotificationsMuted(),
  };
  if (
    cached &&
    cached.supported === next.supported &&
    cached.permission === next.permission &&
    cached.muted === next.muted
  ) {
    return cached;
  }
  cached = next;
  return next;
}

// The server has no notifications; a stable snapshot keeps hydration quiet.
const SERVER_SNAPSHOT: Snapshot = { supported: false, permission: "unsupported", muted: false };


function subscribe(onChange: () => void): () => void {
  const off = onNotificationStateChange(onChange);
  // A mute toggled in another tab arrives as a storage event, not through our
  // in-process emitter, so bridge that in too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === "sharescreen:notificationsMuted") onChange();
  };
  window.addEventListener("storage", onStorage);
  // Pull the async Capacitor permission once on mount so a native shell's real
  // state replaces the optimistic "default" without a user gesture.
  void refreshNotificationPermission();
  return () => {
    off();
    window.removeEventListener("storage", onStorage);
  };
}

export function useNotifications(): UseNotifications {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  const enable = useCallback(async () => {
    const state = await requestNotificationPermission();
    // Asking to enable implies un-muting — otherwise a user who muted, then
    // clicked "enable", would grant permission yet still get nothing.
    if (state === "granted") setNotificationsMuted(false);
    return state;
  }, []);

  const setMuted = useCallback((muted: boolean) => setNotificationsMuted(muted), []);

  return {
    supported: snapshot.supported,
    permission: snapshot.permission,
    muted: snapshot.muted,
    active: snapshot.permission === "granted" && !snapshot.muted,
    enable,
    setMuted,
  };
}
