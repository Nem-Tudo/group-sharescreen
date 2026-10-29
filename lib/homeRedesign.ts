// The home page redesign (experiment "home-redesign"): darker canvas, flat
// 28px cards, Plus Jakarta, a bigger type scale, a live-count card and an
// accent "Explorar" card where the public rooms/map links used to sit inside
// the form. Both sides send the events below, so the comparison is whether
// the new layout gets more people into a room.
import { trackFeatureEvent } from "./features";

export const HOME_REDESIGN_FEATURE = "home-redesign";

export const HOME_REDESIGN_EVENTS = {
  /** A room form submit that actually navigates into a room. */
  roomSubmit: "home_room_submit",
  /** A guest picked a name on the landing form. */
  guestRegister: "home_guest_register",
  /** "Ver salas públicas" or "Ver mapa de salas". */
  exploreClick: "home_explore_click",
} as const;

export function trackHomeEvent(name: (typeof HOME_REDESIGN_EVENTS)[keyof typeof HOME_REDESIGN_EVENTS]) {
  trackFeatureEvent(name, { feature: HOME_REDESIGN_FEATURE });
}
