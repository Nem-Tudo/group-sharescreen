"use client";

// "Controle remoto" on a screen tile (see lib/remoteControl.ts):
//   - RemoteControlTileButton: "Pedir controle" in the tile's corner, and
//     "Soltar controle" once it is yours.
//   - RemoteControlTileLayer: while you are controlling, the surface over the
//     picture that turns your mouse and keyboard into theirs; for everybody,
//     the label saying who is controlling this screen.
//   - RemoteControlPrompt: the room-wide card for an offer ("Fulano te deu o
//     controle") and the short notices (refused, ended).

import { useEffect, useRef, useState, type RefObject } from "react";
import { MdClose, MdMouse } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { containRect } from "@/components/roomTools/AnnotationLayer";
import { useT } from "@/lib/useI18n";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import type { PeerInfo, SignalingState } from "@/lib/signalingClient";
import {
  acceptRemoteControlOffer,
  releaseRemoteControl,
  releaseRemoteKeys,
  requestRemoteControl,
  sendRemoteButton,
  sendRemoteKey,
  sendRemoteMove,
  sendRemoteWheel,
  useRemoteControlState,
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

/** "Pedir controle" / "Aguardando…" / "Soltar controle", in the tile's corner. */
export function RemoteControlTileButton({ peerId }: { peerId: string }) {
  const t = useT();
  const peer = usePeer(peerId);
  const canRequest = useCanRequest();
  const { enabled, controller } = useRemoteControlState();
  if (!enabled || !peer) return null;
  const mine = controller?.hostId === peerId ? controller : null;

  if (mine && mine.phase !== "offered") {
    const label = mine.phase === "requesting" ? t("remoteControl.cancelRequest") : t("remoteControl.release");
    return (
      <Tooltip content={label}>
        <button
          type="button"
          onClick={releaseRemoteControl}
          aria-label={label}
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-white ${
            mine.phase === "requesting" ? "bg-black/60 hover:bg-black/80" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {mine.phase === "requesting" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <MdClose className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{label}</span>
        </button>
      </Tooltip>
    );
  }

  // Somebody who takes requests, sharing a screen from the app, nobody
  // controlling it yet — and you with an account, not already controlling.
  if (!canRequest || !peer.rc || !peer.screen || !peer.app || peer.rcBy || controller) return null;
  return (
    <Tooltip content={t("remoteControl.requestHint", { name: peer.name })}>
      <button
        type="button"
        onClick={() => requestRemoteControl(peer)}
        aria-label={t("remoteControl.request")}
        className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white hover:bg-black/80 active:bg-black/80"
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
 * Over the host's picture while you control it: pointer and keys go to their
 * computer. Also, for everybody, who is controlling this screen.
 */
export function RemoteControlTileLayer({
  peerId,
  videoRef,
}: {
  peerId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const t = useT();
  const peer = usePeer(peerId);
  const { enabled, controller } = useRemoteControlState();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mine = enabled && controller?.hostId === peerId ? controller : null;
  const driving = mine !== null && (mine.phase === "active" || mine.phase === "reconnecting" || mine.phase === "connecting");
  const [focused, setFocused] = useState(false);

  // Into the surface as soon as it is yours, so the first key already goes there.
  useEffect(() => {
    if (driving) surfaceRef.current?.focus();
  }, [driving]);

  // The wheel has to be a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !driving) return;
    let carryX = 0;
    let carryY = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
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
  // the Windows key, Esc) — where it supports that at all.
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

  const hint =
    mine.phase !== "active"
      ? t(mine.phase === "reconnecting" ? "remoteControl.reconnecting" : "remoteControl.connecting")
      : mine.localActive
        ? t("remoteControl.localActive", { name: mine.hostName ?? "?" })
        : mine.blocked
          ? t(`remoteControl.blocked.${mine.blocked.why}`)
          : focused
            ? t("remoteControl.activeHint")
            : t("remoteControl.clickToType");

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      role="application"
      aria-label={t("remoteControl.surfaceLabel", { name: mine.hostName ?? "?" })}
      className={`absolute inset-0 z-10 cursor-default outline-none ring-4 ring-inset ${
        focused ? "ring-blue-500" : "ring-blue-500/40"
      }`}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        // Nothing stays pressed on their computer because this tab lost focus.
        releaseRemoteKeys();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        const point = position(event.clientX, event.clientY);
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
        surfaceRef.current?.focus();
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
        className="absolute left-1/2 top-2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-950/85 py-1 pl-3 pr-1 text-xs text-white shadow-lg"
        // The bar's own button is for this page, not for their computer.
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <MdMouse className={`h-4 w-4 shrink-0 ${mine.phase === "active" ? "text-blue-400" : "animate-pulse text-zinc-400"}`} />
        <span className="truncate">{hint}</span>
        <button
          type="button"
          onClick={releaseRemoteControl}
          className="shrink-0 rounded-full bg-red-600 px-2.5 py-1 font-semibold hover:bg-red-700"
        >
          {t("remoteControl.release")}
        </button>
      </div>
    </div>
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
          {t(`remoteControl.notice.${shownNotice.key}`, { name: shownNotice.name ?? "?" })}
        </div>
      ) : null}
    </div>
  );
}
