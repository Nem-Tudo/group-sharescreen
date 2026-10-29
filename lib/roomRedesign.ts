// The room's half of the redesign that home-redesign (lib/homeRedesign) did
// for the home page: darker canvas, flat borderless cards with bigger radii,
// Plus Jakarta, pill-shaped dock buttons and a frosted bottom bar. Done as a
// scoped layer in globals.css (see `[data-room-redesign]` there) the way room
// themes are, rather than as a second copy of WatchRoom's markup.
import { trackFeatureEvent } from "./features";

export const ROOM_REDESIGN_FEATURE = "room-redesign";

export const ROOM_REDESIGN_EVENTS = {
  /** A chat message sent from the room. */
  chatSend: "room_redesign_chat_send",
  /** The room link copied or handed to the share sheet. */
  linkShare: "room_redesign_link_share",
  /** A side column (people or chat) collapsed or reopened. */
  sidebarToggle: "room_redesign_sidebar_toggle",
  /** A tap on a tile's picture that brought its controls up (touch). */
  tileTap: "room_redesign_tile_tap",
} as const;

export function trackRoomRedesignEvent(
  name: (typeof ROOM_REDESIGN_EVENTS)[keyof typeof ROOM_REDESIGN_EVENTS]
) {
  trackFeatureEvent(name, { feature: ROOM_REDESIGN_FEATURE });
}
