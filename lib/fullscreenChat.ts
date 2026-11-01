"use client";

import { createContext } from "react";

// "Chat na tela cheia" (experiment `fullscreen-chat`, see lib/clipsMode): a
// tile in fullscreen can keep the room's chat open in a column on its right.
//
// The Fullscreen API only shows the element put on screen and what is inside
// it, and the chat lives in the room's own column, far from any tile. Rather
// than a second ChatPanel per tile (two copies of the log, two drafts, two
// scroll positions), the fullscreen tile draws an empty slot and hands it to
// the room through this setter; the room then portals its one chat into that
// slot and leaves its own column without it until the slot goes away.
//
// Null outside a room, or for somebody not in the experiment: the tile then
// goes fullscreen exactly as it always did.
export const FullscreenChatSlotContext = createContext<((slot: HTMLElement | null) => void) | null>(null);
