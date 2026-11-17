"use client";

import { useEffect, useRef } from "react";
import { getDesktopBridge, isMobileApp } from "@/lib/desktop";
import { useFeature, trackFeatureEvent } from "@/lib/features";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectRoom } from "@/lib/signalingSelectors";

// Updates the desktop app while nobody is using it — experiment
// "desktop-idle-update".
//
// The app installs a downloaded update when it quits (electron/updater.ts),
// but this app lives in the tray and rarely quits, and the site only picks up
// a deploy when the page is loaded again. So once the machine has gone
// IDLE_MS without input and no call is going on, this applies whichever is
// waiting:
//
//   - a shell update already downloaded: installed silently, and the app
//     comes back hidden in the tray if that is where it was (see the shell's
//     installUpdateWhenIdle — it refuses anything that would need a window
//     or a UAC prompt, since nobody is there to answer one);
//   - a site deploy newer than this page: the page is reloaded.
//
// Lives in the site so the rules can change with a deploy; the shell only
// answers "how long has the machine been idle" and "install quietly".
//
// Idle is the *system's* idle time where the shell can tell it, so someone
// working in another program is never counted as away. On a shell from
// before that, only the site update applies, judged by input to this page.

export const IDLE_UPDATE_FEATURE = "desktop-idle-update";
export const IDLE_UPDATE_EVENTS = {
  shell: "idle_update_shell",
  web: "idle_update_web",
} as const;

const IDLE_MS = 2 * 60 * 60_000;
const CHECK_EVERY_MS = 5 * 60_000;
/** One reload per remote build per this long — see the mixed-deploy note below. */
const RELOAD_RETRY_MS = 60 * 60_000;
const RELOAD_KEY = "golive.idleAutoUpdate.reload";

/** The commit this page was built from, inlined at build time. Empty when unknown. */
const PAGE_COMMIT = (process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "").trim();

async function fetchServerCommit(): Promise<string | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { commit?: unknown };
    const commit = typeof data.commit === "string" ? data.commit.trim() : "";
    return commit && commit !== "unknown" ? commit : null;
  } catch {
    return null;
  }
}

/** Short and full shas name the same commit. */
function sameCommit(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

export function IdleAutoUpdate() {
  const shell = typeof window !== "undefined" && !!getDesktopBridge() && !isMobileApp();
  // Exposure counted here, the only place the behaviour lives.
  const { enabled } = useFeature(IDLE_UPDATE_FEATURE, { track: shell });
  const inRoom = useSignalingSelector(selectRoom) !== null;
  const inRoomRef = useRef(inRoom);
  useEffect(() => {
    inRoomRef.current = inRoom;
  }, [inRoom]);

  useEffect(() => {
    if (!shell || !enabled) return;
    const bridge = getDesktopBridge();
    if (!bridge) return;

    // The fallback idle reading for shells without systemIdleSeconds.
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };
    const inputEvents = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of inputEvents) window.addEventListener(name, onInput, { passive: true });

    // A deploy seen on one check is only acted on if the next check still
    // sees it: production is two instances deployed one after the other, and
    // mid-deploy /api/health answers from either.
    let newerCommitSeen: string | null = null;
    let busy = false;

    async function idleMs(): Promise<number> {
      if (bridge?.systemIdleSeconds) {
        try {
          return (await bridge.systemIdleSeconds()) * 1000;
        } catch {
          // Fall through to the page's own reading.
        }
      }
      return Date.now() - lastInput;
    }

    async function check() {
      if (busy || inRoomRef.current) return;
      busy = true;
      try {
        if ((await idleMs()) < IDLE_MS || inRoomRef.current) return;

        // The shell first: installing it restarts the app, which loads the
        // newest site too, so one restart covers both.
        if (bridge?.installUpdateWhenIdle && bridge.pendingUpdate) {
          const pending = await bridge.pendingUpdate().catch(() => null);
          if (pending && (await bridge.installUpdateWhenIdle().catch(() => false))) {
            trackFeatureEvent(IDLE_UPDATE_EVENTS.shell, { feature: IDLE_UPDATE_FEATURE });
            return;
          }
        }

        if (!PAGE_COMMIT) return;
        const server = await fetchServerCommit();
        if (!server || sameCommit(server, PAGE_COMMIT)) {
          newerCommitSeen = null;
          return;
        }
        if (newerCommitSeen !== server) {
          newerCommitSeen = server;
          return;
        }
        // A reload can land on the instance still serving the old build; it
        // then sees the new one again and would reload every check. Once per
        // remote build per RELOAD_RETRY_MS is enough to get there.
        try {
          const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? "null") as { commit?: string; at?: number } | null;
          if (last?.commit === server && typeof last.at === "number" && Date.now() - last.at < RELOAD_RETRY_MS) return;
          sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ commit: server, at: Date.now() }));
        } catch {
          // No storage: reload anyway; the idle wait still spaces them out.
        }
        if (inRoomRef.current) return;
        trackFeatureEvent(IDLE_UPDATE_EVENTS.web, { feature: IDLE_UPDATE_FEATURE });
        window.location.reload();
      } finally {
        busy = false;
      }
    }

    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      clearInterval(timer);
      for (const name of inputEvents) window.removeEventListener(name, onInput);
    };
  }, [shell, enabled]);

  return null;
}
