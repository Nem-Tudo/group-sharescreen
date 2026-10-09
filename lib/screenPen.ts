"use client";

import { useEffect, useMemo } from "react";
import { getDesktopBridge } from "./desktop";
import { trackFeatureEvent, useFeature } from "./features";
import { translate } from "./i18n";
import { markFeatureUsed } from "@/components/NewBadge";

// "Desenhar na tela": in the desktop app, a pen over the real screen — the
// way screenshot and presentation tools have one — driven by three shortcuts
// recorded in "Atalhos de teclado":
//
//   - "Desenhar na tela"            the pen comes down (the screen stops
//                                   answering the mouse, the toolbar shows);
//                                   again, or Esc, to give the mouse back;
//   - "Mostrar/esconder desenhos"   the marks over the screen or not, while
//                                   the mouse keeps working underneath;
//   - "Desenhos na transmissão"     whether the people watching the share
//                                   see them — independent of the other two.
//
// The windows, the drawing and the capture exclusion are all the shell's (see
// electron/screenPen.ts). This file only tells it whether this person has the
// feature, in which words, and passes the shortcuts on.
//
// The feature costs nothing until a shortcut is recorded: nothing is created
// before the first press. So the shortcuts are its switch.

export const SCREEN_PEN_FEATURE = "screen-pen";

// Every name has to be listed in the feature's "site events" in the admin
// panel to count. The shell sends them (see electron/screenPen.ts); listed
// here so they live in one place on this side too.
export const SCREEN_PEN_EVENTS = {
  drawStart: "screen_pen_draw_start",
  drawStop: "screen_pen_draw_stop", // value: seconds with the pen down
  mark: "screen_pen_mark", // one stroke, shape or text drawn
  clear: "screen_pen_clear",
  show: "screen_pen_show",
  hide: "screen_pen_hide",
  viewersShow: "screen_pen_viewers_show",
  viewersHide: "screen_pen_viewers_hide",
  keySet: "screen_pen_key_set", // a shortcut was recorded for it
} as const;

const KNOWN_EVENTS = new Set<string>(Object.values(SCREEN_PEN_EVENTS));

function labels(): Record<string, string> {
  const keys = [
    "toolPen",
    "toolHighlighter",
    "toolArrow",
    "toolRect",
    "toolEllipse",
    "toolText",
    "toolEraser",
    "undo",
    "redo",
    "clear",
    "stop",
    "viewersOn",
    "viewersOff",
    "viewersHint",
    "cannotHide",
    "size",
    "noticeShown",
    "noticeHidden",
    "noticeViewersShown",
    "noticeViewersHidden",
    "noticeCannotHide",
  ];
  return Object.fromEntries(keys.map((key) => [key, translate(`screenPen.${key}`)]));
}

export function trackScreenPenKeySet() {
  trackFeatureEvent(SCREEN_PEN_EVENTS.keySet, { feature: SCREEN_PEN_FEATURE });
}

/** Whether this person has the feature — the shortcuts modal's check. */
export function useScreenPenAvailable(track = false): boolean {
  const { enabled } = useFeature(SCREEN_PEN_FEATURE, { track });
  return enabled && Boolean(getDesktopBridge()?.screenPen);
}

/**
 * Turns the shell's pen on for as long as the room is open, and returns the
 * handlers for the three shortcuts (empty without the feature, so the keys do
 * nothing for somebody who left the experiment).
 */
export function useScreenPen(active: boolean) {
  const available = useScreenPenAvailable(false);
  const on = active && available;

  useEffect(() => {
    const pen = getDesktopBridge()?.screenPen;
    if (!pen || !on) return;
    pen.configure({ enabled: true, labels: labels() });
    const off = pen.onEvent((name, value) => {
      if (!KNOWN_EVENTS.has(name)) return;
      if (name === SCREEN_PEN_EVENTS.drawStart) markFeatureUsed(SCREEN_PEN_FEATURE);
      trackFeatureEvent(name, {
        feature: SCREEN_PEN_FEATURE,
        ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
      });
    });
    return () => {
      off();
      // Leaving the room takes the pen and its marks off the screen.
      pen.configure({ enabled: false, labels: {} });
    };
  }, [on]);

  return useMemo(() => {
    const pen = getDesktopBridge()?.screenPen;
    if (!on || !pen) return {};
    return {
      screenPenDraw: () => pen.action("screenPenDraw"),
      screenPenShow: () => pen.action("screenPenShow"),
      screenPenViewers: () => pen.action("screenPenViewers"),
    };
  }, [on]);
}
