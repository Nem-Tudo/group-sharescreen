"use client";

// "Controle remoto" on a screen tile (see lib/remoteControl.ts):
//   - RemoteControlTileButton: "Pedir controle" in the tile's corner.
//   - RemoteControlTileLayer: while you are controlling, the surface over the
//     picture that turns your mouse and keyboard into theirs, with a small bar
//     on top (who, how fast, fullscreen, Windows shortcuts, let go); for
//     everybody, the label saying who is controlling this screen.
//   - RemoteControlDockButton: the same thing from the room's bottom bar —
//     allow requests, ask, stop — where people look for it.
//   - RemoteControlPrompt: the room-wide card for an offer ("Fulano te deu o
//     controle") and the short notices (refused, ended).
//
// How it should feel is AnyDesk's: your own pointer is the one you aim with,
// so it moves the instant your hand does, and it takes the shape of theirs
// (an I-beam over text, a hand over a link) and a "no entry" sign where a
// click would not go through. The picture follows as fast as it can, but
// pointing never waits for it.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  MdClose,
  MdFullscreen,
  MdFullscreenExit,
  MdKeyboard,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdContentPaste,
  MdMouse,
  MdSportsEsports,
} from "react-icons/md";
import Tippy from "@tippyjs/react";
import { Tooltip } from "@/components/Tooltip";
import { useTileExperimentTip } from "@/lib/clipsMode";
import { containRect } from "@/components/roomTools/AnnotationLayer";
import { useT } from "@/lib/useI18n";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { signalingClient, type PeerInfo, type SignalingState } from "@/lib/signalingClient";
import {
  REMOTE_CONTROL_EVENTS,
  acceptRemoteControlOffer,
  canGrabRemoteKeys,
  releaseRemoteControl,
  releaseRemoteKeys,
  requestRemoteControl,
  sendRemoteButton,
  sendRemoteButtonHere,
  sendRemoteRelative,
  sendRemoteCombo,
  sendRemoteKey,
  sendRemoteMove,
  sendRemoteWheel,
  setRemoteKeyGrab,
  stopHostingRemoteControl,
  trackRemoteControlEvent,
  useRemoteControlState,
  type RemoteControlSnapshot,
} from "@/lib/remoteControl";

function samePeer(a: PeerInfo | null, b: PeerInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.rc === b.rc &&
    a.screen === b.screen &&
    a.app === b.app &&
    a.name === b.name &&
    a.userId === b.userId &&
    (a.rcBy?.id ?? null) === (b.rcBy?.id ?? null) &&
    (a.rcBy?.name ?? null) === (b.rcBy?.name ?? null)
  );
}

function usePeer(peerId: string): PeerInfo | null {
  return useSignalingSelector(
    (state: SignalingState) => state.peers.find((p) => p.id === peerId) ?? null,
    samePeer
  );
}

function useCanRequest(): boolean {
  return useSignalingSelector((state: SignalingState) => Boolean(state.account) && Boolean(state.room));
}

/** Whether somebody could ask this peer for control right now. */
function requestable(peer: PeerInfo): boolean {
  return Boolean(peer.rc && peer.screen && peer.app && !peer.rcBy && peer.userId);
}

/** True while this page drives the screen of `peerId` — the tile hides its own buttons then. */
export function useRemoteDriving(peerId: string | undefined): boolean {
  const { enabled, controller } = useRemoteControlState();
  return Boolean(
    peerId &&
      enabled &&
      controller?.hostId === peerId &&
      (controller.phase === "active" || controller.phase === "reconnecting" || controller.phase === "connecting")
  );
}

/** "Pedir controle" / "Cancelar pedido", in the tile's corner. */
export function RemoteControlTileButton({ peerId }: { peerId: string }) {
  const t = useT();
  const peer = usePeer(peerId);
  const canRequest = useCanRequest();
  const { enabled, controller } = useRemoteControlState();
  if (!enabled || !peer) return null;
  const mine = controller?.hostId === peerId ? controller : null;

  // While driving, the bar over the picture has "Soltar" (see the layer).
  if (mine && mine.phase === "requesting") {
    const label = t("remoteControl.cancelRequest");
    return (
      <Tooltip content={label}>
        <button
          type="button"
          onClick={releaseRemoteControl}
          aria-label={label}
          className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white hover:bg-black/80"
        >
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </Tooltip>
    );
  }

  // Somebody who takes requests, sharing a screen from the app, nobody
  // controlling it yet — and you with an account, not already controlling.
  if (!canRequest || !requestable(peer) || controller) return null;
  return (
    <Tooltip content={t("remoteControl.requestHint", { name: peer.name })}>
      <button
        type="button"
        onClick={() => requestRemoteControl(peer)}
        aria-label={t("remoteControl.request")}
        className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 active:bg-blue-700"
      >
        <MdMouse className="h-4 w-4" />
        <span className="hidden sm:inline">{t("remoteControl.request")}</span>
      </button>
    </Tooltip>
  );
}

// Wheel deltas, in Windows' units (120 per notch). Chromium reports about 100
// pixels a notch; lines and pages are converted the way browsers scroll them.
function wheelUnits(event: WheelEvent): { dx: number; dy: number } {
  const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 360 : 1.2;
  return { dx: event.deltaX * scale, dy: event.deltaY * scale };
}

// The browser's buttons (0 left, 1 middle, 2 right, 3 back, 4 forward) in the
// helper's order (0 left, 1 right, 2 middle, 3 back, 4 forward).
const BUTTON_MAP = [0, 2, 1, 3, 4];

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };

/**
 * The shortcuts a browser (or Windows here) keeps for itself, sent whole from
 * the bar's menu. Win+L is left out on purpose: it locks their computer, and
 * nothing here can type the password back in.
 */
const SHORTCUTS: { id: string; keys: string[]; label: string }[] = [
  { id: "start", keys: ["MetaLeft"], label: "Win" },
  { id: "run", keys: ["MetaLeft", "KeyR"], label: "Win + R" },
  { id: "explorer", keys: ["MetaLeft", "KeyE"], label: "Win + E" },
  { id: "desktop", keys: ["MetaLeft", "KeyD"], label: "Win + D" },
  { id: "settings", keys: ["MetaLeft", "KeyI"], label: "Win + I" },
  { id: "switch", keys: ["AltLeft", "Tab"], label: "Alt + Tab" },
  { id: "close", keys: ["AltLeft", "F4"], label: "Alt + F4" },
  { id: "taskManager", keys: ["ControlLeft", "ShiftLeft", "Escape"], label: "Ctrl + Shift + Esc" },
  { id: "snip", keys: ["MetaLeft", "ShiftLeft", "KeyS"], label: "Win + Shift + S" },
];

const BAR_COLLAPSED_KEY = "golive:remoteControl:barCollapsed";
const GAME_MODE_KEY = "golive:remoteControl:gameMode";

function readGameMode(): boolean {
  try {
    return window.localStorage.getItem(GAME_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGameMode(value: boolean) {
  try {
    window.localStorage.setItem(GAME_MODE_KEY, value ? "1" : "0");
  } catch {
    // Not remembered, then.
  }
}

type LockableElement = HTMLElement & {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
};

/**
 * The mouse held inside the surface, reporting movement. Raw movement where
 * the browser has it — the mouse's own counts, not Windows' acceleration on
 * top of the other computer's — and the ordinary kind where it does not.
 */
async function lockPointer(element: HTMLElement) {
  const lockable = element as LockableElement;
  try {
    await lockable.requestPointerLock({ unadjustedMovement: true });
  } catch {
    try {
      await lockable.requestPointerLock();
    } catch {
      // Refused (no gesture, or not allowed here): the next click asks again.
    }
  }
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(BAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(BAR_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Not remembered, then.
  }
}

type Driving = NonNullable<RemoteControlSnapshot["controller"]>;

/** The pointer this side shows over their picture. */
function pointerFor(mine: Driving): string {
  if (mine.phase !== "active") return "progress";
  if (mine.zone !== "ok") return "not-allowed";
  // Hidden over there (a video playing, typing) — but this side still needs
  // something to aim with.
  return mine.cursor === "none" ? "default" : mine.cursor;
}

function latencyTone(ms: number): string {
  if (ms < 90) return "text-emerald-400";
  if (ms < 200) return "text-amber-400";
  return "text-red-400";
}

/** Keeps a click inside the bar from also counting as one on their computer. */
const keepToPage = {
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerUp: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerMove: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onDoubleClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onContextMenu: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyUp: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

function BarButton({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition ${
          active ? "bg-white/20 text-white" : "text-zinc-200 hover:bg-white/15 hover:text-white"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Over the host's picture while you control it: pointer and keys go to their
 * computer. Also, for everybody, who is controlling this screen.
 */
export function RemoteControlTileLayer({
  peerId,
  videoRef,
  isFullscreen = false,
  onToggleFullscreen,
}: {
  peerId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const t = useT();
  const peer = usePeer(peerId);
  const { enabled, controller } = useRemoteControlState();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mine = enabled && controller?.hostId === peerId ? controller : null;
  const driving = mine !== null && (mine.phase === "active" || mine.phase === "reconnecting" || mine.phase === "connecting");
  const active = mine?.phase === "active";
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const grabsKeys = canGrabRemoteKeys();
  // "Modo jogo" (Parsec's approach): games aim with how far the mouse moved,
  // and ignore where a pointer is put, so the mouse is held inside the
  // surface (pointer lock) and only movement goes across. Remembered for
  // next time, per viewer.
  const [gameMode, setGameMode] = useState(readGameMode);
  const [locked, setLocked] = useState(false);
  const pendingDelta = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const sync = () => {
      const now = document.pointerLockElement === surfaceRef.current && surfaceRef.current !== null;
      setLocked(now);
      // Let go of the mouse, let go of its buttons over there.
      if (!now) releaseRemoteKeys();
    };
    document.addEventListener("pointerlockchange", sync);
    return () => document.removeEventListener("pointerlockchange", sync);
  }, []);

  // Out of game mode, or out of the session: the mouse is this page's again.
  useEffect(() => {
    if ((!gameMode || !driving) && document.pointerLockElement === surfaceRef.current && surfaceRef.current) {
      document.exitPointerLock();
    }
  }, [gameMode, driving]);

  // Into the surface as soon as it is yours, so the first key already goes there.
  useEffect(() => {
    if (driving) surfaceRef.current?.focus();
  }, [driving]);

  // The shell's grab of the Windows key follows the keyboard: on while the
  // surface has it and the session is up, off the moment either stops.
  // Only the tile being driven has a surface to focus, so only it ever turns
  // the grab on — and off again, on its way out.
  useEffect(() => {
    if (!focused || !active) return;
    setRemoteKeyGrab(true);
    return () => setRemoteKeyGrab(false);
  }, [focused, active]);

  // The wheel has to be a non-passive listener to keep the page from
  // scrolling — and kept from the tile, whose own wheel (zoom in fullscreen)
  // has nothing to do with their computer.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !driving) return;
    let carryX = 0;
    let carryY = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if ((event.target as Element | null)?.closest?.("[data-rc-ui]")) return;
      const { dx, dy } = wheelUnits(event);
      carryX += dx;
      carryY += dy;
      const sendX = Math.trunc(carryX);
      const sendY = Math.trunc(carryY);
      if (sendX === 0 && sendY === 0) return;
      carryX -= sendX;
      carryY -= sendY;
      sendRemoteWheel(sendX, sendY);
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [driving]);

  // In fullscreen, ask the browser for the keys it normally keeps (Alt+Tab,
  // the Windows key, Esc) — where it supports that at all. The Windows app
  // grabs them itself (see setRemoteKeyGrab), fullscreen or not.
  useEffect(() => {
    if (!driving) return;
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    const sync = () => {
      if (document.fullscreenElement) void keyboard?.lock?.().catch(() => {});
      else keyboard?.unlock?.();
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      keyboard?.unlock?.();
    };
  }, [driving]);

  // The shortcuts menu closes on a press anywhere else.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  // This side's pointer, in the shape of theirs. Set on the element directly:
  // it changes with every move in and out of the picture's black bars, and a
  // re-render per move would be a lot of React for one CSS property.
  const outsideRef = useRef(false);
  const pointer = mine ? pointerFor(mine) : "default";
  const pointerRef = useRef(pointer);
  useEffect(() => {
    pointerRef.current = pointer;
    const surface = surfaceRef.current;
    if (surface && !outsideRef.current) surface.style.cursor = pointer;
  }, [pointer, driving]);

  // Moves coalesced to one per frame: the newest position is the only one that matters.
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const position = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const box = surface.getBoundingClientRect();
    const picture = containRect(videoRef.current, box.width, box.height);
    if (picture.w <= 0 || picture.h <= 0) return null;
    const fx = (clientX - box.left - picture.x) / picture.w;
    const fy = (clientY - box.top - picture.y) / picture.h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return { x: Math.round(fx * 65535), y: Math.round(fy * 65535) };
  };

  const rcBy = peer?.rcBy ?? null;
  const label =
    rcBy && !mine ? (
      <div className="pointer-events-none absolute left-2 top-12 z-20 flex max-w-[80%] items-center gap-1.5 rounded-full bg-blue-600/90 px-2.5 py-1 text-xs font-semibold text-white shadow">
        <MdMouse className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("remoteControl.controlledBy", { name: rcBy.name ?? "?" })}</span>
      </div>
    ) : null;

  if (!driving || !mine) return label;

  const refocus = () => surfaceRef.current?.focus();
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
    setMenuOpen(false);
    refocus();
  };

  // One line at a time under the bar, and only when there is something to
  // say: connecting, the person there has the mouse, a click that was
  // refused, or the keyboard is somewhere else.
  const hint =
    mine.phase !== "active"
      ? t(mine.phase === "reconnecting" ? "remoteControl.reconnecting" : "remoteControl.connecting")
      : mine.localActive
        ? t("remoteControl.localActive", { name: mine.hostName ?? "?" })
        : mine.blocked
          ? t(`remoteControl.blocked.${mine.blocked.why}`)
          : // What the person there let through, when it is not everything.
            mine.perms && !mine.perms.mouse
            ? t("remoteControl.perms.keyboardOnly")
            : mine.perms && !mine.perms.keyboard
              ? t("remoteControl.perms.mouseOnly")
              : gameMode && !locked
            ? t("remoteControl.game.clickToLock")
            : !focused
              ? t("remoteControl.clickToType")
              : !gameMode && mine.cursor === "none"
                ? // The pointer vanished over there: very often a game.
                  t("remoteControl.game.suggest")
                : null;

  const toggleGameMode = () => {
    const next = !gameMode;
    setGameMode(next);
    writeGameMode(next);
    if (next) trackRemoteControlEvent(REMOTE_CONTROL_EVENTS.gameMode);
    refocus();
  };

  const rtt = mine.rtt;

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      role="application"
      aria-label={t("remoteControl.surfaceLabel", { name: mine.hostName ?? "?" })}
      // The pointer's shape is set on the element by the effect above and the
      // move handler, never here: a re-render (the latency ticking) would
      // otherwise put back the wrong one while over the black bars.
      // rounded-[inherit]: the ring follows the tile's rounded corners instead
      // of being clipped square by them.
      className={`absolute inset-0 z-30 rounded-[inherit] outline-none ring-2 ring-inset ${focused ? "ring-blue-500" : "ring-blue-500/40"}`}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Focus moving to the bar's own buttons is still this surface's.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
        // Nothing stays pressed on their computer because this tab lost focus.
        releaseRemoteKeys();
      }}
      onContextMenu={(event) => event.preventDefault()}
      // A double-click is theirs (opening a file), not the tile's fullscreen.
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerMove={(event) => {
        if (locked) {
          // Movement only, added up and sent once a frame.
          pendingDelta.current.x += event.movementX;
          pendingDelta.current.y += event.movementY;
          if (frame.current !== null) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const { x, y } = pendingDelta.current;
            pendingDelta.current = { x: 0, y: 0 };
            if (x !== 0 || y !== 0) sendRemoteRelative(x, y);
          });
          return;
        }
        const point = position(event.clientX, event.clientY);
        const outside = point === null;
        if (outside !== outsideRef.current) {
          outsideRef.current = outside;
          // Over the black bars around the picture there is nothing to click.
          event.currentTarget.style.cursor = outside ? "not-allowed" : pointerRef.current;
        }
        if (!point) return;
        pendingMove.current = point;
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const next = pendingMove.current;
          pendingMove.current = null;
          if (next) sendRemoteMove(next.x, next.y);
        });
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") return;
        event.currentTarget.focus();
        if (locked) {
          const button = BUTTON_MAP[event.button];
          if (button === undefined) return;
          event.preventDefault();
          sendRemoteButtonHere(button, true);
          return;
        }
        // In game mode the first click takes the mouse, and is not a click
        // over there: it would land wherever their pointer happens to be.
        if (gameMode && mine.phase === "active") {
          event.preventDefault();
          void lockPointer(event.currentTarget);
          return;
        }
        const point = position(event.clientX, event.clientY);
        const button = BUTTON_MAP[event.button];
        if (!point || button === undefined) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        sendRemoteButton(button, true, point.x, point.y);
      }}
      onPointerUp={(event) => {
        const button = BUTTON_MAP[event.button];
        if (button === undefined) return;
        if (locked) {
          sendRemoteButtonHere(button, false);
          return;
        }
        const point = position(event.clientX, event.clientY) ?? { x: 0, y: 0 };
        sendRemoteButton(button, false, point.x, point.y);
      }}
      onKeyDown={(event) => {
        if (!event.code) return;
        event.preventDefault();
        event.stopPropagation();
        sendRemoteKey(event.code, true);
      }}
      onKeyUp={(event) => {
        if (!event.code) return;
        event.preventDefault();
        event.stopPropagation();
        sendRemoteKey(event.code, false);
      }}
    >
      <div
        data-rc-ui
        {...keepToPage}
        // Top right, out of the way of the title bars and tabs in the middle
        // of their screen.
        className="absolute right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] cursor-default flex-col items-end gap-1"
      >
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t("remoteControl.bar.expand")}
            title={t("remoteControl.bar.expand")}
            className="flex cursor-pointer items-center gap-1 rounded-full bg-zinc-950/80 px-2 py-0.5 text-white shadow-lg ring-1 ring-white/10 hover:bg-zinc-900"
          >
            <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
            <MdKeyboardArrowDown className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex max-w-full items-center gap-1 rounded-full bg-zinc-950/85 py-0.5 pl-2.5 pr-0.5 text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
            <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
            <MdMouse className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            <span className="min-w-0 truncate font-semibold">{mine.hostName ?? "?"}</span>
            {rtt !== null && (
              <Tooltip content={t("remoteControl.bar.latency", { ms: rtt })} placement="bottom">
                <span className={`shrink-0 px-1 tabular-nums ${latencyTone(rtt)}`}>{rtt} ms</span>
              </Tooltip>
            )}
            {mine.perms?.clipboard && (
              <Tooltip content={t("remoteControl.perms.clipboardOn")} placement="bottom">
                <span className="flex shrink-0" aria-label={t("remoteControl.perms.clipboardOn")}>
                  <MdContentPaste className="h-3.5 w-3.5 text-emerald-400" />
                </span>
              </Tooltip>
            )}
            <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" />
            <div ref={menuRef} className="relative">
              <BarButton
                label={t("remoteControl.bar.shortcuts")}
                active={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MdKeyboard className="h-4 w-4" />
              </BarButton>
              {menuOpen && (
                // Drawn inside the tile rather than on <body>: in fullscreen
                // the tile is all there is on screen.
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1.5 w-64 overflow-hidden rounded-xl bg-zinc-900 py-1 text-sm text-zinc-100 shadow-2xl ring-1 ring-white/10"
                >
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    {t("remoteControl.bar.shortcuts")}
                  </p>
                  {SHORTCUTS.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      type="button"
                      role="menuitem"
                      disabled={!active}
                      onClick={() => {
                        sendRemoteCombo(shortcut.keys);
                        setMenuOpen(false);
                        refocus();
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate">{t(`remoteControl.shortcut.${shortcut.id}`)}</span>
                      <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-sans text-[11px] text-zinc-300">
                        {shortcut.label}
                      </kbd>
                    </button>
                  ))}
                  <p className="border-t border-white/10 px-3 pb-1.5 pt-2 text-[11px] leading-snug text-zinc-400">
                    {grabsKeys ? t("remoteControl.bar.keysHintApp") : t("remoteControl.bar.keysHintBrowser")}
                  </p>
                </div>
              )}
            </div>
            <BarButton
              label={t(gameMode ? "remoteControl.game.off" : "remoteControl.game.on")}
              active={gameMode}
              onClick={toggleGameMode}
            >
              <MdSportsEsports className="h-4 w-4" />
            </BarButton>
            <BarButton label={t("remoteControl.bar.collapse")} onClick={toggleCollapsed}>
              <MdKeyboardArrowUp className="h-4 w-4" />
            </BarButton>
            <button
              type="button"
              onClick={releaseRemoteControl}
              className="ml-0.5 flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 font-semibold hover:bg-red-700"
            >
              <MdClose className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("remoteControl.release")}</span>
            </button>
            {/* Last, at the far right: the corner of the screen is where people
                reach for fullscreen. */}
            {onToggleFullscreen && (
              <BarButton
                label={t(isFullscreen ? "remoteControl.bar.exitFullscreen" : "remoteControl.bar.fullscreen")}
                active={isFullscreen}
                onClick={() => {
                  if (!isFullscreen) trackRemoteControlEvent(REMOTE_CONTROL_EVENTS.fullscreen);
                  onToggleFullscreen();
                  refocus();
                }}
              >
                {isFullscreen ? <MdFullscreenExit className="h-4 w-4" /> : <MdFullscreen className="h-4 w-4" />}
              </BarButton>
            )}
          </div>
        )}
        {hint && (
          <div className="pointer-events-none flex max-w-full items-center gap-1.5 rounded-full bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-100 shadow">
            {mine.phase !== "active" && (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            <span className="truncate">{hint}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const FINE_POINTER = "(any-pointer: fine)";

function hasFinePointer(): boolean {
  return window.matchMedia?.(FINE_POINTER).matches ?? true;
}

function subscribeFinePointer(onChange: () => void): () => void {
  const query = window.matchMedia?.(FINE_POINTER);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/**
 * What turning requests on means, before it is on. Opened by the bar's
 * button; nothing changes until "Ativar".
 */
function AllowRemoteControlDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const points = ["request", "consent", "stop", "limits"] as const;
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rc-allow-title"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            <MdMouse className="h-5 w-5" />
          </span>
          <h2 id="rc-allow-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t("remoteControl.allowDialog.title")}
          </h2>
        </div>
        <ul className="mt-4 flex flex-col gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
          {points.map((point) => (
            <li key={point} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              <span>{t(`remoteControl.allowDialog.${point}`)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("remoteControl.allowDialog.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "Controle remoto" in the room's bottom bar, next to the screen button —
 * where people look for it, rather than in the settings:
 *   - the switch to take requests: for everybody in the experiment, greyed
 *     out with the reason where it cannot work here (the browser: it takes
 *     the app; no account: it takes one). Turning it on explains first, in a
 *     dialog. On is on everywhere and stays on (lib/clipsMode's stored mode)
 *     until turned off;
 *   - "stop" while somebody is in control, "Soltar controle" while you are;
 *   - "Pedir controle" when somebody takes requests and this switch is off
 *     (a list when more than one does).
 */
export function RemoteControlDockButton({
  isApp,
  appOutdated = false,
  hasAccount,
  allowOn,
  onSetAllow,
  className = "",
}: {
  /** The Windows app, with the helper: the only place a computer can be controlled. */
  isApp: boolean;
  /** The Windows app, but from before remote control: it needs updating first. */
  appOutdated?: boolean;
  hasAccount: boolean;
  /** The "take requests" switch. */
  allowOn: boolean;
  onSetAllow: (on: boolean) => void;
  className?: string;
}) {
  const t = useT();
  const { host, controller } = useRemoteControlState();
  const [dialogOpen, setDialogOpen] = useState(false);
  const canRequest = useCanRequest();
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hosts = useSignalingSelector(
    (state: SignalingState) =>
      state.peers
        .filter((p) => p.id !== state.selfId && requestable(p))
        .map((p) => ({ id: p.id, name: p.name })),
    (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id && p.name === b[i].name)
  );

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!listRef.current?.contains(event.target as Node)) setListOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [listOpen]);

  // Driving a computer takes a mouse: a phone gets no "Pedir controle" here
  // (the surface ignores touch). False on the server, so its render and the
  // first one here agree.
  const finePointer = useSyncExternalStore(subscribeFinePointer, hasFinePointer, () => false);

  // The blue "novo" tip, on this button only when it is the way *in*: the
  // switch while sharing from the app, or "Pedir controle". Not over a
  // session, where the button means "stop". Once, and not for people new to
  // GoLive (see useTileExperimentTip).
  const inSession = Boolean(host) || Boolean(controller && controller.phase !== "offered");
  const canAsk = canRequest && finePointer && hosts.length > 0 && !controller;
  // Why this computer cannot take requests here, if it cannot. The app comes
  // first: an account in a browser still could not be controlled.
  const hostBlock: "app" | "update" | "account" | null = appOutdated
    ? "update"
    : !isApp
      ? "app"
      : !hasAccount
        ? "account"
        : null;
  const tip = useTileExperimentTip("remoteControl", !inSession && (hostBlock === null || canAsk));

  const withTip = (node: ReactElement, text: string) => (
    <Tippy
      visible={tip.show}
      placement="bottom"
      interactive
      theme="golive-panel"
      appendTo={() => document.body}
      content={
        <span
          role="status"
          className="relative block w-64 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
        >
          <span className="tip-arrow absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-blue-600" />
          <span className="flex items-start gap-2">
            <span className="flex-1">{text}</span>
            <button
              type="button"
              onClick={tip.dismiss}
              aria-label={t("watch.watchRoom.clipsModeTipDismiss")}
              className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
            >
              ✕
            </button>
          </span>
        </span>
      }
    >
      <span className="flex">{node}</span>
    </Tippy>
  );
  // Pressing what the tip points at, while it shows: counted, and it goes.
  const tipClicked = () => {
    if (tip.show) tip.clicked();
  };

  // One event for every use of the button, whatever it did — the point is
  // whether people find it here at all.
  const click = () => trackRemoteControlEvent(REMOTE_CONTROL_EVENTS.dockClick);
  const base = `flex items-center gap-1.5 rounded-lg px-3 py-2 text-white transition ${className}`;

  // Your computer, being controlled (or about to be).
  if (host) {
    const label =
      host.phase === "consent"
        ? t("remoteControl.dock.consent")
        : t("remoteControl.dock.stopHost", { name: host.name ?? "?" });
    return (
      <Tooltip content={label}>
        <button
          type="button"
          onClick={() => {
            click();
            stopHostingRemoteControl();
          }}
          disabled={host.phase === "consent"}
          aria-label={label}
          className={`${base} bg-red-600 hover:bg-red-700 disabled:animate-pulse disabled:cursor-wait`}
        >
          <MdMouse className="h-5 w-5" />
        </button>
      </Tooltip>
    );
  }

  // Their computer, under your control.
  if (controller && controller.phase !== "offered") {
    const requesting = controller.phase === "requesting";
    const label = requesting ? t("remoteControl.cancelRequest") : t("remoteControl.release");
    return (
      <Tooltip content={label}>
        <button
          type="button"
          onClick={() => {
            click();
            releaseRemoteControl();
          }}
          aria-label={label}
          className={`${base} ${requesting ? "bg-zinc-600 hover:bg-zinc-700" : "bg-red-600 hover:bg-red-700"}`}
        >
          {requesting ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <MdMouse className="h-5 w-5" />
          )}
        </button>
      </Tooltip>
    );
  }

  // The switch. On: a click turns it off. Off: a click explains first (the
  // dialog), and "Ativar" there is what turns it on. Where it cannot work,
  // greyed out, saying why — the tooltip on a wrapper, since a disabled
  // button fires no hover of its own.
  const allowButton = (on: boolean) => {
    const label = hostBlock
      ? t(
          hostBlock === "app"
            ? "remoteControl.dock.needsApp"
            : hostBlock === "update"
              ? "remoteControl.dock.needsUpdate"
              : "remoteControl.dock.needsAccount"
        )
      : on
        ? t("remoteControl.dock.allowOn")
        : t("remoteControl.dock.allowOff");
    return (
      <>
        {withTip(
          <Tooltip content={label} wrapperClassName="flex">
            <button
              type="button"
              disabled={hostBlock !== null}
              onClick={() => {
                click();
                tipClicked();
                if (on) onSetAllow(false);
                else setDialogOpen(true);
              }}
              aria-pressed={on}
              aria-label={label}
              className={`${base} disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? "bg-blue-600 hover:bg-blue-700" : "bg-zinc-500 hover:bg-zinc-600 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              }`}
            >
              <MdMouse className={`h-5 w-5 ${on ? "" : "opacity-70"}`} />
            </button>
          </Tooltip>,
          t("watch.watchRoom.remoteControlTip")
        )}
        {dialogOpen && (
          <AllowRemoteControlDialog
            onClose={() => setDialogOpen(false)}
            onConfirm={() => {
              setDialogOpen(false);
              onSetAllow(true);
            }}
          />
        )}
      </>
    );
  };

  // Taking requests here: the switch, on, whoever else is in the room.
  if (allowOn && hostBlock === null) return allowButton(true);

  // Nobody to ask: the switch, off (or greyed out, saying why).
  if (!canAsk) return allowButton(false);

  const ask = (id: string) => {
    const peer = signalingClient.state.peers.find((p) => p.id === id);
    if (peer) requestRemoteControl(peer);
  };
  if (hosts.length === 1) {
    const only = hosts[0];
    const label = t("remoteControl.requestHint", { name: only.name });
    return withTip(
      <Tooltip content={label}>
        <button
          type="button"
          onClick={() => {
            click();
            tipClicked();
            ask(only.id);
          }}
          aria-label={label}
          className={`${base} bg-blue-600 hover:bg-blue-700`}
        >
          <MdMouse className="h-5 w-5" />
        </button>
      </Tooltip>,
      t("watch.watchRoom.remoteControlTipRequest")
    );
  }
  return withTip(
    <div ref={listRef} className="relative flex">
      <Tooltip content={t("remoteControl.request")}>
        <button
          type="button"
          onClick={() => {
            tipClicked();
            setListOpen((open) => !open);
          }}
          aria-expanded={listOpen}
          aria-label={t("remoteControl.request")}
          className={`${base} bg-blue-600 hover:bg-blue-700`}
        >
          <MdMouse className="h-5 w-5" />
        </button>
      </Tooltip>
      {listOpen && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          {hosts.map((h) => (
            <button
              key={h.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setListOpen(false);
                click();
                ask(h.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <MdMouse className="h-4 w-4 shrink-0 text-blue-500" />
              <span className="truncate">{t("remoteControl.requestHint", { name: h.name })}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    t("watch.watchRoom.remoteControlTipRequest")
  );
}

/** The offer card and the short notices, once per room. */
export function RemoteControlPrompt() {
  const t = useT();
  // The notice clears itself (see lib/remoteControl's notice).
  const { enabled, controller, notice: shownNotice } = useRemoteControlState();
  const offer = enabled && controller?.phase === "offered" ? controller : null;
  if (!offer && !shownNotice) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4">
      {offer ? (
        <div className="pointer-events-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-blue-500/40 bg-white p-4 shadow-2xl dark:bg-zinc-900">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <MdMouse className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                {t("remoteControl.offerTitle", { name: offer.hostName ?? "?" })}
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">{t("remoteControl.offerText")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={releaseRemoteControl}
              className="flex-1 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              {t("remoteControl.decline")}
            </button>
            <button
              type="button"
              onClick={acceptRemoteControlOffer}
              className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {t("remoteControl.accept")}
            </button>
          </div>
        </div>
      ) : shownNotice ? (
        <div className="pointer-events-auto rounded-full bg-zinc-900/95 px-4 py-2 text-sm text-white shadow-xl">
          {t(`remoteControl.notice.${shownNotice.key}`, {
            name: shownNotice.name ?? "?",
            // "Espere 30 s" / "Espere 4 min" — see the server's remoteControlKnock.
            time:
              (shownNotice.seconds ?? 0) < 60
                ? `${shownNotice.seconds ?? 0} s`
                : `${Math.ceil((shownNotice.seconds ?? 0) / 60)} min`,
          })}
        </div>
      ) : null}
    </div>
  );
}
