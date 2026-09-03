"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MdOutlineDesktopWindows } from "react-icons/md";
import { RoomSkeleton } from "@/components/RoomSkeleton";
import { DownloadAppButton } from "@/components/DownloadAppButton";
import { clearAppHandoff, requestAppHandoff, useAppHandoffCount } from "@/lib/appHandoff";
import { isDesktopApp } from "@/lib/desktop";
import { detectDownloadPlatform } from "@/lib/downloadTargets";
import {
  getStoredOpenInAppDismissed,
  getStoredOpenRoomsInApp,
  setStoredOpenInAppDismissed,
  setStoredOpenRoomsInApp,
} from "@/lib/mediaPreferences";

// Where a room decides whether it is a room at all yet.
//
// Two jobs, and they are two halves of one idea: the site cannot know whether
// the desktop app is installed — browsers removed every API that leaked it,
// because it is a fingerprinting vector — so it *learns*, once, from somebody
// actually using it.
//
//   Before it knows. Nothing is asked up front; the room opens exactly as it
//   always did, and OpenInAppBanner offers the handoff from inside it. Nobody
//   is made to answer a question about software they may not have.
//
//   The handoff. The room is left (unmounting WatchRoom is what calls
//   leaveRoom) and this screen takes its place, so the person is not sitting
//   in the room twice. If the tab actually loses visibility, the app opened —
//   that is the confirmation, and it is the only honest one available.
//
//   After it knows. The offer moves in front of the door: a confirmed
//   installation gets asked *before* joining, which is the whole point —
//   choosing the app after joining means arriving twice.
//
// Every screen here keeps a way into the browser, because nothing on this page
// can tell whether the OS found anything. A dead end would be the one failure
// with no recovery.

const PROTOCOL = "golive";

// The handoff is deliberately not one of these: it is driven by the shared
// store (see lib/appHandoff.ts), because it can be entered from inside the
// room — where this component has already handed over to its children.
type GateState =
  /** Still reading storage and the platform; renders as the room loading. */
  | "checking"
  /** Asking before joining. Only ever for a confirmed installation. */
  | "offer"
  /** Answered: the room may mount. */
  | "browser";

/**
 * `golive://watch/<handle>` is what electron/main.ts listens for; the app
 * validates the handle again on its side rather than trusting whatever
 * invoked the protocol.
 */
function openInApp(handle: string) {
  // Not an internal Next route, so the router is the wrong tool and the lint
  // rule's advice does not apply: this is a handoff to another *application*
  // over a custom OS protocol, which only a real navigation can trigger.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${PROTOCOL}://watch/${encodeURIComponent(handle)}`;
}

export function RoomAppGate({ handle, children }: { handle: string; children: ReactNode }) {
  // Every decision depends on localStorage and on whether we are inside the
  // app, neither of which exists during the server render — so this starts
  // undecided rather than guessing and hydrating into a mismatch.
  const [state, setState] = useState<GateState>("checking");
  // Read, never written here. The handoff is asked for through the store — by
  // the banner inside the room and by this component's own buttons alike — so
  // there is one path into it and no setState reacting to another setState.
  const handoffCount = useAppHandoffCount();
  // Whether this tab was ever put in the background after the handoff.
  //
  // This is the confirmation, and it is worth being precise about why it is
  // the click that does *not* confirm anything: pressing "abrir no app" is an
  // intention, and on a machine with no app the only thing that follows is an
  // OS error dialog nobody here can see. The tab going away is the one event
  // that cannot happen unless something else took the screen.
  const leftRef = useRef(false);

  const enterBrowser = useCallback(() => {
    clearAppHandoff();
    setState("browser");
  }, []);



  // Deferred by a tick rather than set synchronously in the effect body:
  // setting state there forces a second render pass before the browser
  // paints, which is the cascading-render pattern React 19 warns about.
  useEffect(() => {
    const id = setTimeout(() => {
      // Already in the app: there is nothing to hand off to.
      if (isDesktopApp()) {
        setState("browser");
        return;
      }
      // No mobile build exists (see electron-builder.yml — Windows, macOS and
      // Linux only), so on a phone this would be offering something that
      // cannot be installed. Same detection the /download route uses, so "no
      // build for you" means the same thing in both places.
      if (!detectDownloadPlatform(navigator.userAgent)) {
        setState("browser");
        return;
      }
      // Confirmed installation, and they have not turned the asking off.
      if (getStoredOpenRoomsInApp() && !getStoredOpenInAppDismissed()) {
        setState("offer");
        return;
      }
      setState("browser");
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // The navigation itself, re-run for each fresh request — which is what
  // makes "abrir no app de novo" a real retry rather than a no-op.
  useEffect(() => {
    if (handoffCount === 0) return;
    leftRef.current = false;
    openInApp(handle);
  }, [handoffCount, handle]);

  // The confirmation. Watched only while the handoff screen is up, so an
  // ordinary alt-tab from inside a room never counts as evidence of anything.
  useEffect(() => {
    if (handoffCount === 0) return;
    function onHidden() {
      if (document.visibilityState !== "hidden") return;
      leftRef.current = true;
      // Written here rather than on the click: this is the moment the app
      // demonstrably exists. Also clears any earlier "agora não", since the
      // person just chose the app of their own accord.
      setStoredOpenRoomsInApp(true);
      setStoredOpenInAppDismissed(false);
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [handoffCount]);

  // The handoff screen outranks everything: it is the one state that can be
  // entered from inside a room that is already mounted.
  if (handoffCount === 0 && state === "browser") return <>{children}</>;

  if (handoffCount === 0 && state === "checking") {
    return (
      <>
        <RoomSkeleton />
        <p className="sr-only" role="status">
          Abrindo a sala...
        </p>
      </>
    );
  }

  if (handoffCount > 0) {
    return (
      <GateCard
        title="Sala aberta no app"
        body="Você saiu da sala aqui no navegador para não entrar duas vezes. Se o app não abriu, ele pode não estar instalado nesta máquina."
      >
        <button
          type="button"
          onClick={requestAppHandoff}
          className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Abrir no app de novo
        </button>
        <button
          type="button"
          onClick={() => {
            // The negative signal, and the reason it is conditional: coming
            // back to the browser *after* having left is somebody who has the
            // app and wants both. Never having left at all is evidence the
            // handoff went nowhere, and forgetting the installation is what
            // stops this screen from meeting them on every room from now on.
            if (!leftRef.current) setStoredOpenRoomsInApp(false);
            enterBrowser();
          }}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Abrir no navegador
        </button>
        <DownloadAppButton source="room-gate" />
      </GateCard>
    );
  }

  return (
    <GateCard
      title="Abrir esta sala no app?"
      body="No app do GoLive você não ouve eco da sua própria voz na transmissão de outra pessoa, e o desempenho é melhor."
    >
      <button
        type="button"
        onClick={requestAppHandoff}
        className="flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        <MdOutlineDesktopWindows className="h-4 w-4 shrink-0" />
        Abrir no app
      </button>
      <button
        type="button"
        onClick={enterBrowser}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Continuar no navegador
      </button>
      <button
        type="button"
        onClick={() => {
          // Not "I have no app" — "stop asking". The installation stays
          // remembered, so the toggle in the room's menu can turn the asking
          // back on without having to prove the app exists again.
          setStoredOpenInAppDismissed(true);
          enterBrowser();
        }}
        className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        Não perguntar mais
      </button>
    </GateCard>
  );
}

function GateCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950">
          <MdOutlineDesktopWindows className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>
      </main>
    </div>
  );
}
