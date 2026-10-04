"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import { useRoomTools, useRoomToolsSelector, type RoomToolsState } from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";
import { TOOL_ICONS } from "./toolIcons";
import { PIP_HEIGHT, PIP_WIDTH, toolDrawer } from "./canvasPip";

// The browser's own picture-in-picture for things that are not a <video>: a
// tool (whiteboard, notepad, code editor) or a screen with the room's notes
// drawn over it. Document Picture-in-Picture (Chrome, Edge) — a window that
// stays on top even outside the tab. Only to watch: everything is used in the
// room itself. The picture-in-picture inside the site is components/DockedPip.

type DocumentPip = { requestWindow(options?: { width?: number; height?: number }): Promise<Window> };

function documentPip(): DocumentPip | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

export function windowPipSupported(): boolean {
  return documentPip() !== null;
}

/**
 * Opens the browser's picture-in-picture window, with the page's styles in it.
 * Must be called straight from a click, before anything else is awaited: the
 * browser only opens it on a user gesture.
 */
export async function openPipWindow(width = 640, height = 400): Promise<Window | null> {
  const api = documentPip();
  if (!api) return null;
  const win = await api.requestWindow({ width, height });
  const doc = win.document;
  // The page's stylesheets, so Tailwind's classes mean the same thing there.
  // Links rebuilt with their absolute address: the window is about:blank, and
  // a relative one would resolve against nothing.
  for (const node of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = node.href;
      doc.head.appendChild(link);
    } else {
      const style = doc.createElement("style");
      style.textContent = node.textContent;
      doc.head.appendChild(style);
    }
  }
  // And its theme: dark mode hangs off the root element.
  doc.documentElement.className = document.documentElement.className;
  for (const attr of document.documentElement.attributes) {
    if (attr.name.startsWith("data-") || attr.name === "style") doc.documentElement.setAttribute(attr.name, attr.value);
  }
  doc.body.style.margin = "0";
  doc.body.style.height = "100vh";
  doc.body.style.background = "#09090b";
  return win;
}

/**
 * Renders `children` into an open picture-in-picture window, and calls
 * `onClosed` when the window goes away by its own ×. Closes the window when
 * unmounted for good.
 */
export function PipWindowPortal({
  pipWindow,
  title,
  icon,
  onClose,
  children,
}: {
  pipWindow: Window;
  title: ReactNode;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onHide = () => onCloseRef.current();
    pipWindow.addEventListener("pagehide", onHide);
    // Closed a moment later, not right away: React (in development) unmounts
    // and mounts every effect once on the way in, and closing here would shut
    // the window the instant it opened.
    const pending = (pipWindow as Window & { __closeTimer?: number }).__closeTimer;
    if (pending) window.clearTimeout(pending);
    return () => {
      pipWindow.removeEventListener("pagehide", onHide);
      (pipWindow as Window & { __closeTimer?: number }).__closeTimer = window.setTimeout(() => {
        if (!pipWindow.closed) pipWindow.close();
      }, 0);
    };
  }, [pipWindow]);

  return createPortal(
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between gap-2 bg-zinc-900 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-base text-emerald-400">{icon}</span>
          <span className="truncate text-sm font-medium text-white">{title}</span>
        </span>
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label={t("roomTools.pipBack")}
          title={t("roomTools.pipBack")}
          className="rounded-full p-1.5 text-white transition hover:bg-white/10"
        >
          <MdClose className="h-4 w-4" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>,
    pipWindow.document.body
  );
}

/**
 * A tool, by id, only to watch: what is drawn or written there, live, drawn
 * the same way as in the browser's picture-in-picture (see canvasPip) — no
 * toolbars or buttons, which nobody could use from a picture.
 */
export function ToolPipView({ toolId }: { toolId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Re-rendered on every change to the tools, and redrawn after each.
  const state = useRoomTools();
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const draw = () => toolDrawer(toolId)(ctx, PIP_WIDTH, PIP_HEIGHT);
    draw();
    // And again when the theme changes, which the tools store knows nothing of.
    const observer = new MutationObserver(draw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [state, toolId]);
  return (
    <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center bg-white dark:bg-zinc-950">
      <canvas ref={canvasRef} width={PIP_WIDTH} height={PIP_HEIGHT} className="h-full w-full object-contain" />
    </div>
  );
}

const noSubscribe = () => () => {};

/** Whether the browser has the picture-in-picture window — false while rendering on the server. */
export function useWindowPipSupported(): boolean {
  return useSyncExternalStore(noSubscribe, windowPipSupported, () => false);
}

/** A tool's title and icon, by id — for the lists of what a picture-in-picture can show. */
export function ToolPipLabel({ toolId, iconClassName }: { toolId: string; iconClassName?: string }) {
  const select = useCallback(
    (s: RoomToolsState) => s.tools.find((t) => t.id === toolId) ?? null,
    [toolId]
  );
  const tool = useRoomToolsSelector(select);
  if (!tool) return null;
  return (
    <>
      {iconClassName !== undefined && <span className={iconClassName}>{TOOL_ICONS[tool.kind]}</span>}
      <span className="truncate">{tool.title}</span>
    </>
  );
}
