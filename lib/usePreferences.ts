"use client";

import { useSyncExternalStore } from "react";
import {
  getStoredDoubleClickFocus,
  getStoredOpenRoomsInApp,
  subscribeSharedPreferences,
} from "@/lib/mediaPreferences";

// Hooks for the stored preferences more than one mounted component shows at
// once. Separate from lib/mediaPreferences because that one is plain storage
// with no React in it, and is imported from outside components.

export function useStoredDoubleClickFocus(): boolean {
  return useSyncExternalStore(subscribeSharedPreferences, getStoredDoubleClickFocus, () => true);
}

export function useStoredOpenRoomsInApp(): boolean {
  return useSyncExternalStore(subscribeSharedPreferences, getStoredOpenRoomsInApp, () => false);
}
