import { roomActivity, type PublicGroupRoom, type PublicRoom } from "@/lib/roomsApi";

// The public room directory as a list — shared by /rooms and by the rooms page
// inside the group shell (see components/groups/GroupsRoomsView), so the two
// never disagree on what comes first or what a search finds.

/**
 * One entry of the list: a public room, or a public group's call — the second
 * carries its group and room, and is opened through the group (see the
 * server's /rooms `groupRooms`). Both share every counter the list sorts on,
 * so they sort together rather than in two lists.
 */
export type ListedRoom = PublicRoom & {
  group?: PublicGroupRoom["group"];
  channel?: PublicGroupRoom["channel"];
};

export type RoomSort = "mic" | "people" | "screen";

/**
 * Every ordering falls back to people, then to the older room first — the same
 * last resort the server's own /rooms ordering uses, so a list of rooms sitting
 * at zero doesn't reshuffle itself on every poll.
 */
export function sortRooms(rooms: ListedRoom[], sort: RoomSort): ListedRoom[] {
  const primary = (room: ListedRoom): number => {
    if (sort === "mic") return roomActivity(room, "micCount");
    if (sort === "screen") return roomActivity(room, "screenCount");
    return room.peopleCount;
  };
  return [...rooms].sort(
    (a, b) => primary(b) - primary(a) || b.peopleCount - a.peopleCount || a.createdAt - b.createdAt
  );
}

/**
 * A group's call is found by its room's name or its group's, never by the
 * internal handle nobody sees.
 */
export function roomMatches(room: ListedRoom, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (room.group && room.channel) {
    return room.channel.name.toLowerCase().includes(needle) || room.group.name.toLowerCase().includes(needle);
  }
  return room.handle.toLowerCase().includes(needle);
}
