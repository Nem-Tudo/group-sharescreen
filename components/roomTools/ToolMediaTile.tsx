"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { MdClose, MdSettings } from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import { Tooltip } from "@/components/Tooltip";
import { EyeOffIcon, FocusIcon, FullscreenExitIcon, FullscreenIcon, HyperfocusIcon } from "@/components/icons";
import {
  MEDIA_KINDS,
  canUseTool,
  roomTools,
  toolMediaKey,
  useRoomToolsSelector,
  type DrawTool,
  type RoomToolsState,
  type TextTool,
} from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";
import { RoomToolsViewer } from "./AnnotationLayer";
import { ReactionButton, ReactionFloats } from "./ReactionLayer";
import { TOOL_ICONS } from "./toolIcons";
import { TextToolView, WhiteboardView } from "./ToolViews";

// The whiteboard, the notepad and the code editor as media: a tile in the
// room's grid like a shared screen or a YouTube video, with the same bar on
// top — focus, hyperfocus, fullscreen, reactions, and the × that ends it for
// the room (the managers) or the eye that steps out of it for yourself
// (everybody else). Same column layout as VideoSourceTile: our bar, then the
// tool, never one over the other.
export function ToolMediaTile({
  tool,
  selfUserId,
  isManager,
  fill = false,
  compact = false,
  onFocus,
  isSpotlighted = false,
  onHyperfocus,
  isHyperfocused = false,
  onLeave,
  interactive = true,
}: {
  tool: DrawTool | TextTool;
  selfUserId: string | null;
  isManager: boolean;
  fill?: boolean;
  compact?: boolean;
  onFocus?: () => void;
  isSpotlighted?: boolean;
  onHyperfocus?: () => void;
  isHyperfocused?: boolean;
  onLeave: () => void;
  // Whether the tool works here: always on a computer; on a phone only in
  // focus — a grid cell there is too small to draw or type in.
  interactive?: boolean;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const { canOpenTools } = useContext(RoomToolsViewer);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  // iOS Safari cannot put an arbitrary element in fullscreen — only a video —
  // so there the tile fills the window instead, which on a phone is the same thing.
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const isFullscreen = nativeFullscreen || pseudoFullscreen;
  const canUse = canUseTool(tool, selfUserId, isManager);
  // A manager closes any tool; anybody else only one they opened (the server
  // says the same — see its "tool-close").
  const canClose = canOpenTools && (isManager || (selfUserId !== null && tool.createdById === selfUserId));
  const mediaKey = toolMediaKey(tool.id);

  useEffect(() => {
    const onChange = () => setNativeFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (pseudoFullscreen) return setPseudoFullscreen(false);
    if (document.fullscreenElement === boxRef.current) return void document.exitFullscreen();
    const box = boxRef.current;
    if (box?.requestFullscreen) void box.requestFullscreen().catch(() => setPseudoFullscreen(true));
    else setPseudoFullscreen(true);
  }

  // Bigger on a phone: a finger, not a pointer.
  const button = "rounded-full p-2 text-white transition hover:bg-white/10 sm:p-1.5";
  const icon = <span className="text-base text-emerald-400">{TOOL_ICONS[tool.kind]}</span>;

  // Fullscreen counts as focus: whoever put it there is looking at it.
  if (compact || (!interactive && !isFullscreen)) {
    // A filmstrip thumbnail, or — on a phone — a tool that is not in focus:
    // what it is, not a second editor the size of a stamp. Two taps put it in
    // focus, where it works.
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${tool.title} — ${t("roomTools.tapTwiceToOpen")}`}
        onPointerUp={(e) => {
          if (compact || !onFocus) return;
          if (e.timeStamp - lastTap.current < 350) {
            lastTap.current = 0;
            onFocus();
          } else {
            lastTap.current = e.timeStamp;
          }
        }}
        onKeyDown={(e) => {
          if (!compact && onFocus && (e.key === "Enter" || e.key === " ")) onFocus();
        }}
        className={`flex select-none flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-zinc-900 p-2 ${fill ? "h-full w-full" : "aspect-video w-full"}`}
        style={{ touchAction: "manipulation" }}
      >
        <span className={`${compact ? "text-2xl" : "text-4xl"} text-emerald-400`}>{TOOL_ICONS[tool.kind]}</span>
        <span className={`max-w-full truncate font-medium text-white ${compact ? "text-xs" : "text-sm"}`}>{tool.title}</span>
        {!compact && onFocus && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFocus();
            }}
            className="mt-1 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white active:bg-emerald-700"
          >
            {t("roomTools.openTool")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`flex flex-col overflow-hidden bg-zinc-950 ${
        pseudoFullscreen
          ? "fixed inset-0 z-[90] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
          : fill || isFullscreen
            ? "h-full w-full rounded-xl"
            : // A phone's grid is one column, and a 16:9 strip there leaves an
              // editor two lines tall — so the tile is taller below sm.
              tool.kind === "whiteboard"
              ? "aspect-[4/3] w-full rounded-xl sm:aspect-video"
              : "aspect-square w-full rounded-xl sm:aspect-video"
      }`}
      // Keys typed into the tool are not the room's shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-1 bg-zinc-900 px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="hidden sm:inline">
            <BetaMark />
          </span>
          {icon}
          <span className="truncate text-sm font-medium text-white">{tool.title}</span>
          <span className="hidden shrink-0 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-white sm:inline">
            {t(`roomTools.kind.${tool.kind}`)}
          </span>
          {!canUse && (
            <span className="hidden shrink-0 text-[11px] text-zinc-400 sm:inline">{t("roomTools.viewOnlyShort")}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <ReactionButton mediaKey={mediaKey} />
          {isManager && (
            <Tooltip content={t("roomTools.settings")}>
              <button type="button" onClick={() => roomTools.show(tool.id)} aria-label={t("roomTools.settings")} className={button}>
                <MdSettings className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          {onFocus && (
            <Tooltip content={isSpotlighted ? t("common.removeHighlight") : t("roomTools.focus")}>
              <button
                type="button"
                onClick={onFocus}
                aria-pressed={isSpotlighted}
                aria-label={t("roomTools.focus")}
                className={`rounded-full p-1.5 text-white transition ${isSpotlighted ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-white/10"}`}
              >
                <FocusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          {onHyperfocus && (
            <Tooltip content={t("roomTools.hyperfocus")}>
              <button
                type="button"
                onClick={onHyperfocus}
                aria-pressed={isHyperfocused}
                aria-label={t("roomTools.hyperfocus")}
                className={`hidden rounded-full p-1.5 text-white transition sm:block ${isHyperfocused ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-white/10"}`}
              >
                <HyperfocusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={isFullscreen ? t("common.exitFullScreen") : t("common.fullScreen")}>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? t("common.exitFullScreen") : t("common.fullScreen")}
              className={button}
            >
              {isFullscreen ? <FullscreenExitIcon className="h-4 w-4" /> : <FullscreenIcon className="h-4 w-4" />}
            </button>
          </Tooltip>
          {canClose && confirmClose ? (
            // Closing it ends it for everybody, and what was drawn or written
            // goes with it — so it asks first.
            <span className="flex items-center gap-1 pl-1">
              <span className="hidden text-[11px] text-zinc-300 sm:inline">{t("roomTools.closeToolQuestion")}</span>
              <button
                type="button"
                onClick={() => roomTools.close(tool.id)}
                className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
              >
                {t("roomTools.confirmClose")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10"
              >
                {t("roomTools.cancel")}
              </button>
            </span>
          ) : canClose ? (
            <Tooltip content={t("roomTools.closeTool")}>
              <button type="button" onClick={() => setConfirmClose(true)} aria-label={t("roomTools.closeTool")} className={button}>
                <MdClose className="h-4 w-4" style={{ color: "red" }} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t("roomTools.leaveTool")}>
              <button type="button" onClick={onLeave} aria-label={t("roomTools.leaveTool")} className={button}>
                <EyeOffIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 bg-white p-1.5 sm:p-2 dark:bg-zinc-900">
        {tool.kind === "notepad" || tool.kind === "code" ? (
          <TextToolView tool={tool as TextTool} selfUserId={selfUserId} isManager={isManager} canUse={canUse} />
        ) : (
          <WhiteboardView tool={tool as DrawTool} selfUserId={selfUserId} isManager={isManager} canUse={canUse} />
        )}
        <ReactionFloats mediaKey={mediaKey} />
      </div>
    </div>
  );
}

/**
 * The tile for one tool, by id — subscribed to that tool alone, so what is
 * drawn on one whiteboard redraws that tile and nothing else in the room.
 */
export function ToolMediaTileById({
  toolId,
  ...props
}: Omit<Parameters<typeof ToolMediaTile>[0], "tool"> & { toolId: string }) {
  const select = useCallback(
    (s: RoomToolsState) =>
      s.tools.find((t): t is DrawTool | TextTool => t.id === toolId && MEDIA_KINDS.includes(t.kind)) ?? null,
    [toolId]
  );
  const tool = useRoomToolsSelector(select);
  if (!tool) return null;
  return <ToolMediaTile tool={tool} {...props} />;
}
