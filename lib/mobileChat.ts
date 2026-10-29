// The room chat's phone layout, part of the room redesign (experiment
// room-redesign, lib/roomRedesign): no per-message
// buttons (drag a message to answer it, hold it for its actions — see
// lib/messageGestures), a pill composer, and a sheet with two heights that
// goes full while the keyboard is up and hides the bottom bar behind it.
// Desktop is untouched either way.
import { trackFeatureEvent } from "./features";
import { ROOM_REDESIGN_FEATURE } from "./roomRedesign";

export const MOBILE_CHAT_FEATURE = ROOM_REDESIGN_FEATURE;

export const MOBILE_CHAT_EVENTS = {
  /** The chat sheet opened (both sides). */
  open: "mchat_open",
  /** A message sent from the phone's chat sheet (both sides). */
  send: "mchat_send",
  /** An answer started by dragging a message. */
  swipeReply: "mchat_swipe_reply",
  /** A message's actions opened by holding it. */
  holdMenu: "mchat_hold_menu",
  /** The sheet taken to full height. */
  expand: "mchat_expand",
} as const;

export function trackMobileChatEvent(
  name: (typeof MOBILE_CHAT_EVENTS)[keyof typeof MOBILE_CHAT_EVENTS]
) {
  trackFeatureEvent(name, { feature: MOBILE_CHAT_FEATURE });
}
