"use client";

import { useEffect, useState } from "react";
import { MdOutlineDesktopWindows } from "react-icons/md";
import { requestAppHandoff } from "@/lib/appHandoff";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform } from "@/lib/downloadTargets";
import {
  getStoredOpenInAppDismissed,
  getStoredOpenRoomsInApp,
  setStoredOpenInAppDismissed,
} from "@/lib/mediaPreferences";
import { DownloadAppButton } from "./DownloadAppButton";

// The offer, for somebody the site has never seen use the app.
//
// It sits *inside* the room on purpose, and that is the whole shape of the
// feature: a stranger should not be stopped at the door and asked about
// software they may not own. They get the room. The offer sits above it, and
// only if they take it does anything change.
//
// Once taken and confirmed (see RoomAppGate, which watches for this tab
// actually losing the screen), the question moves in front of the door and
// this banner stops appearing — there is nothing left for it to find out.
export function OpenInAppBanner() {
  // Every decision here depends on localStorage and on whether we are inside
  // the app, neither of which exists during the server render — so the banner
  // renders nothing until after mount rather than hydrating into a mismatch.
  const [visible, setVisible] = useState(false);

  // Deferred by a tick rather than set synchronously in the effect body:
  // setting state there forces a second render pass before the browser
  // paints, which is the cascading-render pattern React 19 warns about.
  useEffect(() => {
    const id = setTimeout(() => {
      // Already in the app: there is nothing to hand off to.
      if (isDesktopApp()) return;
      // No mobile build exists (see electron-builder.yml), so on a phone this
      // would offer something that cannot be installed.
      if (!detectDownloadPlatform(navigator.userAgent)) return;
      // The installation is already known, so the gate asks before the room
      // is even joined and this would be the second offer on one screen.
      if (getStoredOpenRoomsInApp()) return;
      if (getStoredOpenInAppDismissed()) return;
      setVisible(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/10 bg-zinc-100 px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-900 sm:px-4">
      <MdOutlineDesktopWindows className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <span className="text-zinc-700 dark:text-zinc-300">
        Não ouça eco (ouvir sua própria voz na transmissão do amigo) utilizando o app oficial do Go
        Live!
      </span>
      <span className="ml-auto flex items-center gap-2">
        <DownloadAppButton source="room-banner" />
        <button
          type="button"
          onClick={() => {
            // Asked for rather than done here. The gate is what owns the
            // handoff, because leaving the room is half of it — and leaving
            // the room means unmounting the component this button is inside.
            setVisible(false);
            requestAppHandoff();
          }}
          className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Abrir no app
        </button>
        <button
          type="button"
          onClick={() => {
            setStoredOpenInAppDismissed(true);
            setVisible(false);
          }}
          className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Agora não
        </button>
      </span>
    </div>
  );
}
