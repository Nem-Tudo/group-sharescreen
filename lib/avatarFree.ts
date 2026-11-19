import { useFeature } from "@/lib/features";

// The `avatar-free` experiment: custom avatars without a plan.
//
//   gallery  the Pro gallery free; uploading stays Pro Max.
//   upload   the gallery and uploading your own picture, free.
//
// The API decides who has it, on every avatar gate (the API's
// server/avatarFreeExperiment.ts): what the picker offers comes back from
// /account/avatars already unlocked, with `freeGallery` / `freeUpload` saying
// it was the experiment rather than a plan. The exposure is counted there too,
// when the profile editor loads the picker's list. The site only reads the
// variant here to stop *selling* what this person already has for free — the
// /pro perk lists (ProPanel, lib/planPerks) — the same way the transcript and
// translation experiments do.
//
// Site events (register in the feature's "site events"):
//   avatar_picker_open        opened the avatar picker (every group)
//   avatar_lock_click.gallery the "Disponível no Pro" link on the gallery row
//   avatar_lock_click.upload  the "Disponível no Pro Max" link by "Enviar"
// The API counts the rest (avatar_set.*, avatar_buyer.*, and every purchase
// and cancellation event).

export const AVATAR_FREE_FEATURE = "avatar-free";
/** NewBadge id on the rows the experiment unlocked. */
export const AVATAR_FREE_BADGE = "avatar-free";

export const AVATAR_FREE_EVENTS = {
  pickerOpen: "avatar_picker_open",
  lockGallery: "avatar_lock_click.gallery",
  lockUpload: "avatar_lock_click.upload",
} as const;

export type AvatarFreeGrant = { gallery: boolean; upload: boolean };

/** What the experiment gives this person, for the perk lists. Never counts an exposure. */
export function useAvatarFree(): AvatarFreeGrant {
  const { variant } = useFeature(AVATAR_FREE_FEATURE, { track: false });
  return { gallery: variant === "gallery" || variant === "upload", upload: variant === "upload" };
}
