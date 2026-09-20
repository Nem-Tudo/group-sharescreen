"use client";

import { MdReply } from "react-icons/md";

// The arrow a message slides out from under when it is dragged to the left.
//
// It does not move with the row: it is pinned to where the row's right edge
// started (hence `right` counting the pull back out), so the row travels and
// the arrow stays, which is what reads as "the arrow was behind it all
// along". It fills in as the drag approaches the point of no return and turns
// green once letting go would answer — the only feedback there is, since a
// finger is covering the message itself.
//
// Purely decorative: the gesture it describes is a shortcut for the "Responder"
// that the row's menu and its hover actions already offer, so a screen reader
// is better off not hearing about it.

export function SwipeReplyHint({ pull, progress, armed }: { pull: number; progress: number; armed: boolean }) {
  if (pull <= 0) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 flex items-center"
      style={{ right: 4 - pull, opacity: Math.min(1, progress * 1.4) }}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          armed
            ? "bg-emerald-500 text-white"
            : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
        style={{ transform: `scale(${0.72 + 0.28 * progress})` }}
      >
        <MdReply className="h-4 w-4" />
      </span>
    </span>
  );
}
