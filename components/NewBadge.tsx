"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/lib/useI18n";

// The blue "NOVO" on anything just launched. Every new button or feature
// gets one (see CLAUDE.md), keyed by a stable id:
//
//   <NewBadge id="room-clips" />          next to the button's label
//   markFeatureUsed("room-clips");        where the feature is actually used
//
// It goes away for good once the person uses the feature, or a week after
// this browser first showed it, whichever comes first. Per browser, in
// localStorage — nothing is sent anywhere.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = (id: string) => `sharescreen:newBadge:${id}`;

type BadgeState = { firstSeen: number; used?: boolean };

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(id: string): BadgeState | null {
  try {
    const raw = window.localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as BadgeState) : null;
  } catch {
    return null;
  }
}
function write(id: string, state: BadgeState) {
  try {
    window.localStorage.setItem(KEY(id), JSON.stringify(state));
  } catch {
    // Storage refused: the badge just keeps showing in this browser.
  }
  emit();
}

/** Call wherever the feature is actually used: the badge is gone from then on. */
export function markFeatureUsed(id: string) {
  if (typeof window === "undefined") return;
  const state = read(id);
  if (state?.used) return;
  write(id, { firstSeen: state?.firstSeen ?? Date.now(), used: true });
}

function isVisible(id: string): boolean {
  const state = read(id);
  if (!state) return true;
  return !state.used && Date.now() - state.firstSeen < WEEK_MS;
}

export function NewBadge({ id, className = "" }: { id: string; className?: string }) {
  const t = useT();
  // Hidden on the server and until storage is read, so it never flashes.
  const visible = useSyncExternalStore(subscribe, () => isVisible(id), () => false);
  useEffect(() => {
    if (visible && !read(id)) write(id, { firstSeen: Date.now() });
  }, [id, visible]);
  if (!visible) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-white ${className}`}
    >
      {t("common.newBadge")}
    </span>
  );
}
