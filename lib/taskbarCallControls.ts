"use client";

import { useEffect, useRef } from "react";
import { getDesktopBridge } from "./desktop";
import { trackFeatureEvent, useFeature } from "./features";
import { translate } from "@/lib/i18n";

export const TASKBAR_CALL_CONTROLS_FEATURE = "taskbar-call-controls";

export const TASKBAR_CALL_CONTROLS_EVENTS = {
  mic: "taskbar_call_mic",
  deafen: "taskbar_call_deafen",
  leave: "taskbar_call_leave",
} as const;

/**
 * Mic, deafen and leave in the Windows taskbar's window preview, for as long as
 * there is a call. The shell draws the buttons and reports the presses; what
 * they do is the room's own handlers, the same ones its buttons call.
 */
export function useTaskbarCallControls({
  active,
  micOn,
  deafened,
  onToggleMic,
  onToggleDeafen,
  onLeave,
}: {
  active: boolean;
  micOn: boolean;
  deafened: boolean;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
}) {
  const bridge = getDesktopBridge();
  const supported = Boolean(bridge?.setCallControls);
  // Exposure only where the buttons can exist: a browser or another system
  // would count people who could never see them.
  const enabled = useFeature(TASKBAR_CALL_CONTROLS_FEATURE, { track: supported && active }).enabled;
  const show = supported && active && enabled;

  const handlers = useRef({ onToggleMic, onToggleDeafen, onLeave });
  useEffect(() => {
    handlers.current = { onToggleMic, onToggleDeafen, onLeave };
  });

  useEffect(() => {
    if (!show) return;
    return getDesktopBridge()?.onCallControl?.((action) => {
      if (action === "mic") {
        trackFeatureEvent(TASKBAR_CALL_CONTROLS_EVENTS.mic);
        handlers.current.onToggleMic();
      } else if (action === "deafen") {
        trackFeatureEvent(TASKBAR_CALL_CONTROLS_EVENTS.deafen);
        handlers.current.onToggleDeafen();
      } else if (action === "leave") {
        trackFeatureEvent(TASKBAR_CALL_CONTROLS_EVENTS.leave);
        handlers.current.onLeave();
      }
    });
  }, [show]);

  useEffect(() => {
    if (!show) return;
    getDesktopBridge()?.setCallControls?.({
      micOn,
      deafened,
      micLabel: translate(micOn ? "watch.watchRoom.taskbarMuteMic" : "watch.watchRoom.taskbarUnmuteMic"),
      deafenLabel: translate(deafened ? "watch.watchRoom.taskbarUndeafen" : "watch.watchRoom.taskbarDeafen"),
      leaveLabel: translate("watch.watchRoom.taskbarLeaveCall"),
    });
  }, [show, micOn, deafened]);

  useEffect(() => {
    if (!show) return;
    return () => getDesktopBridge()?.setCallControls?.(null);
  }, [show]);
}
