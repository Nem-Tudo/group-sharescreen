"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackEvent, trackDownloadClick } from "@/lib/analytics";
import { DownloadIcon, ShareIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform, type DownloadPlatform } from "@/lib/downloadTargets";

// Fired by Chromium browsers (Chrome/Edge on Android, desktop Chrome) when
// the page meets PWA installability criteria (manifest + icons + served
// over https — see app/manifest.ts and layout.tsx's `metadata.manifest`).
// Not a DOM-lib-standard event yet, hence the manual typing.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_STORAGE_KEY = "sharescreen:installPromptDismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari never fires/matches the standard media query — it exposes
  // its own `navigator.standalone` instead.
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

const LABEL: Record<DownloadPlatform, string> = {
  win: "Baixar para Windows",
  mac: "Baixar para macOS",
  linux: "Baixar para Linux",
};

// Small floating, dismissible control for "get GoLive as an app" — a
// deliberate explicit affordance rather than relying on visitors to notice
// the browser's own (easy to miss) install icon.
//
// What it offers depends on what actually exists for that machine:
//
//   desktop — the real Electron build (see electron/), which is strictly
//             better than a PWA here: a native screen picker, a working
//             OAuth handoff, and room links that open in the app.
//   Android — a PWA install via beforeinstallprompt, because there is no
//             native mobile build and there is not going to be one.
//   iOS     — the same PWA, but Safari has no install API, so it gets
//             instructions for the manual "Share > Add to Home Screen".
//
// Once installed (running standalone), already inside the desktop app, or
// dismissed, it stays gone — this is a one-time nudge, not a recurring nag.
export function InstallAppButton() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  // Non-null on desktop, and it is what switches this whole control from
  // "install the PWA" to "download the app".
  const [downloadPlatform, setDownloadPlatform] = useState<DownloadPlatform | null>(null);
  // Starts hidden — both branches below only ever reveal it from an effect
  // (after checking localStorage/standalone/platform), so there's no
  // server/client render mismatch and no flash of a control that's about to
  // disappear anyway.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    // Inside the Electron build already — offering to install it would be
    // offering something the person is looking at.
    if (isDesktopApp()) return;
    try {
      if (window.localStorage.getItem(DISMISSED_STORAGE_KEY) === "true") return;
    } catch {
      // ignored - localStorage may be unavailable (private mode, quota, etc.)
    }

    // Desktop: point at the real app rather than the PWA. Checked before the
    // PWA branches because desktop Chrome fires beforeinstallprompt too, and
    // whichever ran first would win — the native build is the better answer
    // on those machines, so it is the one that gets asked first.
    //
    // Same detection the /download route uses, so this can never advertise a
    // platform that route would then refuse to serve.
    const platform = detectDownloadPlatform(navigator.userAgent);
    if (platform) {
      // Deferred a tick for the same reason the iOS branch below is.
      const id = setTimeout(() => {
        setDownloadPlatform(platform);
        setVisible(true);
      }, 0);
      return () => clearTimeout(id);
    }

    if (isIos()) {
      // Deferred one tick via setTimeout (imperceptible) rather than
      // calling setState synchronously in the effect body — matches
      // AnnouncementBanner.tsx's identical "reveal something after checking
      // an external source once on mount" pattern.
      const id = setTimeout(() => {
        setShowIosHint(true);
        setVisible(true);
      }, 0);
      return () => clearTimeout(id);
    }

    // Android/Chrome/Edge: wait for the browser to actually confirm
    // installability instead of showing a button that might not do
    // anything — preventDefault suppresses the browser's own mini-infobar
    // so this control is the only prompt shown.
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, "true");
    } catch {
      // ignored - localStorage may be unavailable (private mode, quota, etc.)
    }
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    trackEvent("install_app_prompt_shown");
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    trackEvent("install_app_prompt_result", { outcome: choice.outcome });
    // Either way there's nothing left to prompt — a real browser install
    // prompt can only be triggered once per deferred event.
    dismiss();
  }

  if (!visible) return null;
  // On /app the desktop branch's button would point at the page it is
  // floating over, and the page below already makes the same offer with room
  // to explain it. The PWA branch stays: "adicionar à tela de início" is a
  // different thing from the download, and /app only mentions it in passing.
  if (downloadPlatform && pathname === "/app") return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-black/10 bg-white p-3 shadow-lg dark:border-white/10 dark:bg-zinc-900 sm:inset-x-auto sm:right-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950">
        <DownloadIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          {downloadPlatform ? "Baixar o app do GoLive" : "Instalar o GoLive"}
        </p>
        {downloadPlatform ? (
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Remova o eco de transmissões, obtenha melhor desempenho e mais.
          </p>
        ) : showIosHint ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            Toque em
            <ShareIcon className="h-3.5 w-3.5 shrink-0" />
            e depois em &quot;Adicionar à Tela de Início&quot;
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">Acesso rápido, direto da tela inicial.</p>
        )}
      </div>
      {downloadPlatform ? (
        // Lands on /app rather than starting the download: this prompt
        // interrupts someone who did not ask for it, so the honest next step
        // is a page explaining what the app is, not an installer appearing
        // in their downloads folder. Dismissed on click all the same — the
        // offer has been taken, and leaving it floating over the page
        // afterwards is just clutter.
        <Link
          href="/app"
          target="_blank"
          onClick={() => {
            trackDownloadClick("install-prompt", downloadPlatform);
            dismiss();
          }}
          title={LABEL[downloadPlatform]}
          className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-950"
        >
          Baixar
        </Link>
      ) : (
        !showIosHint && (
          <button
            type="button"
            onClick={handleInstallClick}
            className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-950"
          >
            Instalar
          </button>
        )
      )}
      <Tooltip content="Fechar">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar"
          className="shrink-0 text-lg leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </Tooltip>
    </div>
  );
}
