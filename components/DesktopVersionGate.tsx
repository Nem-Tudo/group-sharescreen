"use client";

import { useEffect, useState } from "react";
import { getDesktopBridge, isMobileApp } from "@/lib/desktop";
import { fetchDesktopMinVersion, isVersionBelow } from "@/lib/desktopUpdate";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectDesktopUpdateSeq } from "@/lib/signalingSelectors";
import { trackEvent } from "@/lib/analytics";
import { useT } from "@/lib/useI18n";

// "Piso de versão": the way out of a desktop build whose auto-updater broke.
//
// The shell's own updater (electron/updater.ts) ships inside the executable,
// so a bug there can only be fixed by the very mechanism it broke. But the UI
// is this site, loaded live — so the site can still reach those machines.
// When the admin sets a minimum version (admin → desktop update card) and the
// shell reports a lower one, this covers the page and hands the person the
// installer through /download; running it over the old copy replaces it,
// updater included.
//
// Deliberately escapable ("agora não", for this session): a floor typed wrong
// in the admin must cost people a click, not their app.
//
// Never shown in a browser, in the phone shells, or in the Microsoft Store
// build — the Store updates that one itself, and the /download installer would
// put a second copy beside it.

const DISMISS_KEY = "golive.desktopVersionGate.dismissed";

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

export function DesktopVersionGate() {
  const t = useT();
  const [blocked, setBlocked] = useState<{ current: string; min: string } | null>(null);
  // The admin's "lançar atualização" and a new floor both bump this — re-ask then.
  const desktopUpdateSeq = useSignalingSelector(selectDesktopUpdateSeq);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || isMobileApp()) return;
    const current = bridge.appVersion;
    if (!current || current === "0.0.0") return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // No storage: show it, which is the safe side.
    }

    let cancelled = false;
    void (async () => {
      const min = await fetchDesktopMinVersion();
      if (cancelled || !min || !isVersionBelow(current, min)) {
        if (!cancelled) setBlocked(null);
        return;
      }
      if (await isWindowsStoreBuild()) return;
      if (cancelled) return;
      setBlocked({ current, min });
      trackEvent("desktop_floor_shown", { current, min });
    })();
    return () => {
      cancelled = true;
    };
  }, [desktopUpdateSeq]);

  if (!blocked) return null;

  function handleDownload() {
    trackEvent("desktop_floor_download", { current: blocked?.current });
    const url = new URL("/download", window.location.origin).toString();
    const bridge = getDesktopBridge();
    if (bridge) void bridge.openExternal(url);
    else window.open(url, "_blank", "noopener");
  }

  function handleDismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Hides for this page only, then.
    }
    setBlocked(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-version-gate-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <h2 id="desktop-version-gate-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {t("desktopVersionGate.title")}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {t("desktopVersionGate.body", { current: blocked.current })}
        </p>
        <button
          type="button"
          onClick={handleDownload}
          className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
        >
          {t("desktopVersionGate.download")}
        </button>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("desktopVersionGate.hint")}</p>
        <button
          type="button"
          onClick={handleDismiss}
          className="mt-3 text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {t("desktopVersionGate.notNow")}
        </button>
      </div>
    </div>
  );
}
