"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { MdChevronRight, MdVolumeUp } from "react-icons/md";
import { WatchRoom } from "@/app/watch/[handle]/WatchRoom";
import { Tooltip } from "@/components/Tooltip";
import {
  callNameFor,
  callPathFor,
  endCall,
  useCallChrome,
  useCallOutlet,
  useCallSession,
  type CallDockPhase,
  type CallSession,
} from "@/lib/callSession";
import { groupPath } from "@/lib/groupLinks";
import { playConnectSound } from "@/lib/soundEffects";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectRoomRemoval, selectRoom } from "@/lib/signalingSelectors";
import { useT } from "@/lib/useI18n";

// The one room there is, mounted above every page.
//
// It used to be the page: /watch rendered a WatchRoom, and the group shell
// rendered another one for the group's voice rooms. Both ended the call by
// unmounting it — which is what made leaving the page, or merely leaving
// /groups, hang up. Here it is mounted once, for as long as there is a session
// (see lib/callSession), so the call survives every navigation and only
// hanging up ends it.
//
// Where it is *drawn* still belongs to the page. The room lives in a div of
// this component's own making, and an effect moves that div into whichever
// outlet is on screen (see components/CallOutlet). Moving a node preserves it
// — the same <video> elements, still playing the same streams — while React
// sees no change at all, because the portal's container never changes.

// How long the extra buttons take to play their way out of the bar — the
// `.call-dock-conceal` animation in globals.css, which this must match: they
// are dropped when it ends, and dropping them sooner cuts it off.
const DOCK_COLLAPSE_MS = 180;

function noop() {}

export function RoomCallHost() {
  const session = useCallSession();
  const outlet = useCallOutlet();
  const chrome = useCallChrome();
  const router = useRouter();
  const dockRef = useRef<HTMLDivElement | null>(null);
  // Where the room puts its own call controls while it is docked — the real
  // ones, mic and camera and screen and the rest, not stand-ins (see
  // WatchRoom's inHeaderSlot). State rather than a ref, so the room re-renders
  // and fills it the moment the bar exists.
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
  // The bar's size. Compact to begin with, and then whatever it was last left
  // at for as long as this tab is open: somebody who opened it out to reach the
  // camera picker has said which bar they want.
  const [dockPhase, setDockPhase] = useState<CallDockPhase>("compact");
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleDock = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    // Opening wins over a close still playing out: a second click is somebody
    // changing their mind, and the buttons are still there to grow back.
    if (dockPhase !== "expanded") {
      setDockPhase("expanded");
      return;
    }
    // Played out first and dropped after, so they leave the way they came.
    setDockPhase("collapsing");
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      setDockPhase("compact");
    }, DOCK_COLLAPSE_MS);
  }, [dockPhase]);
  useEffect(
    () => () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    },
    []
  );
  // Created once, client-side only, and dressed here rather than in an effect:
  // it is the room's own box, and every page it is moved into expects a column
  // that fills what it was given. Nothing is created during the server pass —
  // there is no call yet on a page that has only just been sent.
  const [surface] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.className = "flex min-h-0 flex-1 flex-col";
    return el;
  });

  // The move itself. Runs after every change of outlet — a page arriving, a
  // page leaving, the call starting — and does nothing when the room is
  // already where it belongs.
  useEffect(() => {
    if (!surface) return;
    const target = outlet ?? dockRef.current;
    if (target && surface.parentElement !== target) target.appendChild(surface);
  }, [surface, outlet, session]);

  const callPath = session ? callPathFor(session) : null;

  const hangUp = useCallback(() => {
    if (!session) return;
    endCall();
    // Only when the page being looked at is the call's own, which is about to
    // have nothing left to show. From anywhere else, hanging up is not a
    // reason to move somebody off the page they are reading.
    if (typeof window !== "undefined" && window.location.pathname === callPath) {
      router.push(session.group ? groupPath(session.group.groupId) : "/");
    }
  }, [session, callPath, router]);

  return (
    <>
      {/* Where the room waits while no page is showing it: connected, audible,
          and a pixel wide in the corner. Deliberately not `display: none` —
          a hidden subtree is one the browser may stop painting, and what is
          parked here is a live call, not a closed page. */}
      <div
        ref={dockRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
      />
      {session &&
        surface &&
        createPortal(
          <>
            <ConnectSound key={`connect:${session.handle}`} handle={session.handle} />
            <RemovalGuard onRemoved={hangUp} />
            <WatchRoom
              key={session.handle}
              handle={session.handle}
              viewThemeId={session.viewThemeId}
              visible={outlet !== null}
              onDisconnect={hangUp}
              dockSlot={dockSlot}
              dockPhase={dockPhase}
              // A group's top bar, while the group's pages are on screen — for
              // any call, not only that group's. Null everywhere else.
              headerSlots={chrome?.headerSlots ?? null}
              musicSlot={chrome?.musicSlot ?? null}
              group={
                session.group
                  ? {
                      ...session.group,
                      onOpenNav: chrome?.onOpenNav ?? noop,
                    }
                  : undefined
              }
            />
          </>,
          surface
        )}
      {/* The way back, for every page that is not drawing the call. Never in a
          group's own pages: they have one of their own in the top bar, and two
          bars about the same call is one bar too many. */}
      {session && !outlet && !chrome && callPath && (
        <CallDock
          session={session}
          callPath={callPath}
          slotRef={setDockSlot}
          expanded={dockPhase === "expanded"}
          onToggle={toggleDock}
        />
      )}
    </>
  );
}

/**
 * "You are in a call" — where you are, the way back, and the call's own
 * controls. The floating half of the room, for the whole site outside it.
 *
 * The controls are not copies: the room draws its real ones into the box below
 * (see WatchRoom's inHeaderSlot), mic, headset, settings, screen, camera,
 * video sources, music and hanging up — every one of them with the menus and
 * the state it has in the room, because it *is* the room's row. Which is also
 * why there is no hang-up button of this component's own: that red button is
 * the last one in that row.
 */
function CallDock({
  session,
  callPath,
  slotRef,
  expanded,
  onToggle,
}: {
  session: CallSession;
  callPath: string;
  slotRef: (el: HTMLElement | null) => void;
  /** Whether the whole row is showing, rather than only the everyday buttons. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const name = callNameFor(session);

  return (
    <div
      // Bottom left, above the page and below a ringing call (see CallHost's
      // z-[100]): being in a call is a state, and being asked to answer one is
      // a question — the question goes on top.
      className="fixed bottom-3 left-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
      role="status"
    >
      <button
        type="button"
        onClick={() => router.push(callPath)}
        title={t("common.backToTheCall")}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
        <MdVolumeUp className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
        {session.group && (
          <span className="hidden min-w-0 truncate text-zinc-500 sm:inline dark:text-zinc-400">
            · {session.group.groupName}
          </span>
        )}
      </button>
      {/* The room's own controls land here. Scrolls rather than wraps: on a
          phone the row is wider than the screen, and a bar that reflows into
          two lines moves the button under the thumb that was reaching for it. */}
      <div ref={slotRef} className="flex min-w-0 items-center overflow-x-auto" />
      {/* Last in the bar, so what it opens grows out of it: the extra
          buttons slot in along the row and push this arrow right, and the
          arrow turns round to say which way closes them again. */}
      <Tooltip content={expanded ? t("roomCallHost.showLess") : t("roomCallHost.showAllTheControls")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? t("roomCallHost.showLess") : t("roomCallHost.showAllTheControls")}
          className="flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <MdChevronRight
            className={`h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Ends the call when the room throws this connection out — a kick from inside
 * it, or the group removing them. Reacts to the *transition* only: a removal
 * left in state from some earlier room must not end a call that has only just
 * started.
 */
function RemovalGuard({ onRemoved }: { onRemoved: () => void }) {
  const roomRemoval = useSignalingSelector(selectRoomRemoval);
  const previous = useRef(roomRemoval);
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
  }, [onRemoved]);
  useEffect(() => {
    if (roomRemoval && !previous.current) onRemovedRef.current();
    previous.current = roomRemoval;
  }, [roomRemoval]);
  return null;
}

/**
 * The sound of having got in: played once, the first time the room this
 * session is for actually answers the join — not when the click happened,
 * since a join that is refused should not sound like one that worked. A fresh
 * instance per room (see its key), so moving to another room plays it again
 * and a reconnect into the same one does not.
 */
function ConnectSound({ handle }: { handle: string }) {
  const room = useSignalingSelector(selectRoom);
  const played = useRef(false);
  useEffect(() => {
    if (played.current || room !== handle) return;
    played.current = true;
    playConnectSound();
  }, [room, handle]);
  return null;
}
