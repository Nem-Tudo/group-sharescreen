"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { MdAddReaction } from "react-icons/md";
import {
  canUseTool,
  roomTools,
  useRoomToolsSelector,
  type ReactionsTool,
  type RoomToolsState,
} from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";
import { RoomToolsViewer } from "./AnnotationLayer";

// Reactions over one of the room's media: a button on the tile that opens the
// row of emoji right there over the picture, and what everybody sends rising
// over that same tile for a few seconds. `mediaKey` is the same for everybody
// ("screen:<connection>", "video-source:<id>", "tool:<id>"…), which is what
// makes a heart sent at somebody's screen float over that screen on every
// screen in the room.

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "👏", "🔥", "🎉", "💯", "🤔", "👀", "🙏"];

const selectReactionsTool = (s: RoomToolsState) =>
  s.tools.find((t): t is ReactionsTool => t.kind === "reactions") ?? null;
const selectReactions = (s: RoomToolsState) => s.reactions;

/** The button, and the emoji row it opens over the media. Nothing when reactions are off for this viewer. */
export function ReactionButton({
  mediaKey,
  className = "",
  // Where the row opens relative to the button.
  align = "right",
  // Which way the row opens: down from a button at the top of a tile, up
  // from one in its bottom bar.
  direction = "down",
}: {
  mediaKey: string;
  className?: string;
  align?: "left" | "right";
  direction?: "up" | "down";
}) {
  const t = useT();
  const tool = useRoomToolsSelector(selectReactionsTool);
  const { selfUserId, isManager } = useContext(RoomToolsViewer);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!tool || !canUseTool(tool, selfUserId, isManager)) return null;
  return (
    <div
      ref={boxRef}
      className={`relative ${className}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("roomTools.kind.reactions")}
        aria-expanded={open}
        title={t("roomTools.kind.reactions")}
        className={`rounded-full p-1.5 text-white transition ${open ? "bg-emerald-600" : "bg-black/50 hover:bg-black/70"}`}
      >
        <MdAddReaction className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-40 grid ${direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"} w-max grid-cols-4 gap-0.5 rounded-2xl bg-zinc-900/90 p-1 sm:grid-cols-6 sm:p-1.5 shadow-xl backdrop-blur ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => roomTools.react(tool.id, emoji, mediaKey)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg sm:h-9 sm:w-9 sm:text-xl transition hover:scale-125 hover:bg-white/10 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What everybody sent at this media, rising over it. Goes inside a `relative` box. */
export function ReactionFloats({ mediaKey }: { mediaKey: string }) {
  const reactions = useRoomToolsSelector(selectReactions);
  const mine = reactions.filter((r) => r.target === mediaKey);
  if (mine.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[25] overflow-hidden">
      {mine.map((reaction) => (
        <div
          key={reaction.key}
          className="absolute flex flex-col items-center"
          style={{ left: `${reaction.x}%`, animation: "golive-reaction-rise 3.4s ease-out forwards" }}
        >
          <span className="text-3xl drop-shadow-lg sm:text-4xl">{reaction.emoji}</span>
          <span className="max-w-[7rem] truncate rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">
            {reaction.name}
          </span>
        </div>
      ))}
    </div>
  );
}
