"use client";

import { useEffect, useState } from "react";
import { getDesktopBridge, isMobileApp } from "@/lib/desktop";
import { fetchDesktopVersionPolicy, isVersionBelow, reportDesktopUpdateClick } from "@/lib/desktopUpdate";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectDesktopUpdateSeq, selectRoom } from "@/lib/signalingSelectors";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";

// Keeps desktop apps from staying old — the same two levels most apps use
// (Slack, Discord, WhatsApp), plus a nudge for the commonest way to stay old.
//
//   - "required": below the admin's minimum version. Covers the page with no
//     way past it except updating. For versions too old to support, and the
//     way out of a build whose auto-updater broke: the shell's UI is this
//     site, loaded live, so even a shell that can no longer update itself
//     reaches this and is sent to /download, whose installer, run over the
//     old copy, replaces it — updater included.
//   - "recommended": below the admin's recommended version, *or* an update
//     that has sat downloaded for STALE_PENDING_DAYS without being applied.
//     The second needs no admin at all, and it is the usual case: the shell
//     installs on quit (electron/updater.ts), but someone who keeps it in the
//     tray never quits, and the green button is easy to ignore forever. Can
//     be put off, and comes back after SNOOZE_MS.
//
// Neither ever appears in the middle of a call: it waits for the room to be
// left. Never shown in a browser, in the phone shells, or in the Microsoft
// Store build — the Store updates that one itself, and the /download
// installer would put a second copy beside it.
//
// The API refuses a version above the newest published release, so a typo in
// the admin cannot block everybody with no version able to get past it.

const STALE_PENDING_DAYS = 3;
const SNOOZE_MS = 24 * 60 * 60_000;
const SNOOZE_KEY = "golive.desktopVersionGate.snoozedAt";
/** { version, at } — when this machine first had that update downloaded and waiting. */
const PENDING_SEEN_KEY = "golive.desktopVersionGate.pendingSeen";

type Gate = { mode: "required" | "recommended"; current: string; pending: string | null };

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // No storage: the reminder simply comes back sooner.
  }
}

/** How long `pending` has been waiting on this machine, recording now as the start if it is new. */
function pendingAgeMs(pending: string): number {
  try {
    const seen = JSON.parse(readStorage(PENDING_SEEN_KEY) ?? "null") as { version?: string; at?: number } | null;
    if (seen?.version === pending && typeof seen.at === "number") return Date.now() - seen.at;
  } catch {
    // Unreadable: start over.
  }
  writeStorage(PENDING_SEEN_KEY, JSON.stringify({ version: pending, at: Date.now() }));
  return 0;
}

function snoozed(): boolean {
  const at = Number(readStorage(SNOOZE_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
}

/**
 * The Store build, told apart the only way a shell from before this can be:
 * on Windows, the Store package is the one place starting with the system is
 * reported as unsupported (see electron/background.ts's loginItemSupported).
 * A shell without getBackgroundSettings predates the Store build.
 */
async function isWindowsStoreBuild(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (bridge?.platform !== "win32" || !bridge.getBackgroundSettings) return false;
  try {
    const settings = await bridge.getBackgroundSettings();
    return settings ? !settings.supported : false;
  } catch {
    return false;
  }
}

async function readPendingUpdate(): Promise<string | null> {
  try {
    return (await getDesktopBridge()?.pendingUpdate?.()) ?? null;
  } catch {
    return null;
  }
}

export function DesktopVersionGate() {
  const t = useT();
  const [gate, setGate] = useState<Gate | null>(null);
  const [installing, setInstalling] = useState(false);
  // The admin's "lançar atualização" and a policy change both bump this — re-ask then.
  const desktopUpdateSeq = useSignalingSelector(selectDesktopUpdateSeq);
  const inRoom = useSignalingSelector(selectRoom) !== null;
  // Re-evaluated now and then too, for a window left open for days.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60 * 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || isMobileApp()) return;
    const current = bridge.appVersion;
    if (!current || current === "0.0.0") return;
    // Picked up again when the call ends (inRoom is a dependency).
    if (inRoom) return;

    let cancelled = false;
    void (async () => {
      const [policy, pending, store] = await Promise.all([
        fetchDesktopVersionPolicy(),
        readPendingUpdate(),
        isWindowsStoreBuild(),
      ]);
      if (cancelled) return;
      if (store) {
        setGate(null);
        return;
      }
      let next: Gate | null = null;
      if (policy.minVersion && isVersionBelow(current, policy.minVersion)) {
        next = { mode: "required", current, pending };
      } else if (!snoozed()) {
        const belowRecommended = !!policy.recommendedVersion && isVersionBelow(current, policy.recommendedVersion);
        const stalePending = !!pending && pendingAgeMs(pending) >= STALE_PENDING_DAYS * 24 * 60 * 60_000;
        if (belowRecommended || stalePending) next = { mode: "recommended", current, pending };
      }
      setGate((prev) => {
        if (next && prev?.mode !== next.mode) {
          trackEvent("desktop_floor_shown", { mode: next.mode, current, pending: pending ?? undefined });
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [desktopUpdateSeq, inRoom, tick]);

  if (!gate) return null;

  // A call started from another device or a deep link while this was up:
  // get out of the way, it comes back when the call ends.
  if (inRoom && gate.mode === "recommended") return null;

  const canInstall = !!gate.pending && !!getDesktopBridge()?.installUpdate;

  function handleInstall() {
    const bridge = getDesktopBridge();
    if (!bridge?.installUpdate || !gate) return;
    trackEvent("desktop_floor_install", { mode: gate.mode, version: gate.pending });
    void reportDesktopUpdateClick(gate.pending);
    setInstalling(true);
    bridge.installUpdate();
  }

  function handleDownload() {
    trackEvent("desktop_floor_download", { mode: gate?.mode, current: gate?.current });
    const url = new URL("/download", window.location.origin).toString();
    const bridge = getDesktopBridge();
    if (bridge) void bridge.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }

  function handleSnooze() {
    trackEvent("desktop_floor_snooze", { current: gate?.current });
    writeStorage(SNOOZE_KEY, String(Date.now()));
    setGate(null);
  }

  const required = gate.mode === "required";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-version-gate-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <h2 id="desktop-version-gate-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {required ? t("desktopVersionGate.title") : t("desktopVersionGate.recommendedTitle")}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {required
            ? t("desktopVersionGate.requiredBody", { current: gate.current })
            : t("desktopVersionGate.recommendedBody", { current: gate.current })}
        </p>
        {canInstall ? (
          <>
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing}
              className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-70"
            >
              {installing ? t("updateAppButton.restarting") : t("desktopVersionGate.restartAndUpdate")}
            </button>
            {/* The in-app install is the one click; the installer is the fallback
                for a machine where that does not take. */}
            <button
              type="button"
              onClick={handleDownload}
              className="mt-2 text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              {t("desktopVersionGate.orDownload")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleDownload}
              className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
            >
              {t("desktopVersionGate.download")}
            </button>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("desktopVersionGate.hint")}</p>
          </>
        )}
        {!required && (
          <button
            type="button"
            onClick={handleSnooze}
            className="mt-3 block w-full text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            {t("desktopVersionGate.notNow")}
          </button>
        )}
      </div>
    </div>
  );
}
