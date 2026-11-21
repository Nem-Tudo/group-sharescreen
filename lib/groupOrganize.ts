"use client";

import { trackFeatureEvent, useFeature } from "./features";

// Experiment "group-organize": somebody's own list of groups made theirs to
// arrange — folders on the rail (and on the phone's list), a shelf for groups
// they want out of the way ("Arquivar"), and rearranging from the home page's
// panel too, not only the rail.
//
// Archiving is the one part with consequences outside the list: an archived
// group stops notifying, except for a message that names the person (see the
// API's GroupMemberDoc.archived). The rest is how the list is drawn.

export const GROUP_ORGANIZE_FEATURE = "group-organize";

export const GROUP_ORGANIZE_EVENTS = {
  folderCreate: "folder_create",
  folderAdd: "folder_add",
  folderUngroup: "folder_ungroup",
  archive: "group_archive",
  unarchive: "group_unarchive",
  /** The shelf opened, to see what is on it. */
  archiveOpen: "archive_open",
  /** A group dragged to another place on the home page's panel. */
  homeReorder: "home_reorder",
} as const;

export function trackGroupOrganize(event: (typeof GROUP_ORGANIZE_EVENTS)[keyof typeof GROUP_ORGANIZE_EVENTS]): void {
  trackFeatureEvent(event, { feature: GROUP_ORGANIZE_FEATURE });
}

/** Whether this person has folders and the shelf. `track` only where the list is drawn. */
export function useGroupOrganize({ track }: { track: boolean }): boolean {
  return useFeature(GROUP_ORGANIZE_FEATURE, { track }).enabled;
}
