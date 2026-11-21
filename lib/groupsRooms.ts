// Experiment "groups-rooms": every public room open right now, as one more
// page of the group shell — a tile on the groups rail (lg and up), a row on
// /groups (phones), and the list itself at /groups/rooms (see
// components/groups/GroupsRoomsView). Target "user".
//
// Every name below has to be in the feature's "site events" in the admin, and
// stay under 40 characters.

export const GROUPS_ROOMS_FEATURE = "groups-rooms";

export const GROUPS_ROOMS_EVENTS = {
  /** The list opened. value = 1 from the rail, 2 from the /groups row, 3 by address. */
  open: "grp_rooms_open",
  /** An ordinary room opened from the list. value = its position (1-based). */
  join: "grp_rooms_join",
  /** A public group's call opened from the list. value = its position (1-based). */
  joinGroup: "grp_rooms_join_group",
  /** Something typed into the search, once per visit. */
  search: "grp_rooms_search",
  /** The order changed. value = 1 microphones, 2 people, 3 screens. */
  sort: "grp_rooms_sort",
  /** The map opened from the list. */
  map: "grp_rooms_map",
} as const;

/** Where the list was opened from — the `open` event's value. */
/** "hub": the home inside the groups layout (experiment groups-hub). */
export type GroupsRoomsSource = "rail" | "home" | "address" | "hub";
const SOURCE_VALUE: Record<GroupsRoomsSource, number> = { rail: 1, home: 2, address: 3, hub: 4 };

let pendingSource: GroupsRoomsSource | null = null;

/** Called by the link that is about to open the list, so the list can say where it came from. */
export function noteGroupsRoomsSource(source: GroupsRoomsSource) {
  pendingSource = source;
}

/** The `open` event's value for this visit: whatever link led here, or the address itself. */
export function takeGroupsRoomsSource(): number {
  const source = pendingSource ?? "address";
  pendingSource = null;
  return SOURCE_VALUE[source];
}
