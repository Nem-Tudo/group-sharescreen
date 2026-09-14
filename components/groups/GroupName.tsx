"use client";

import { MdLockOutline, MdPublic } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import type { GroupVisibility } from "@/lib/groupsApi";
import { useT } from "@/lib/useI18n";

// A group's name, and the verified badge beside it when the group carries the
// VERIFIED flag — the group's counterpart of DisplayUserName, and the one place
// that decides how a group's name is drawn, so the badge cannot be on the rail
// and missing from the invite page. The same badge component users get, so a
// verified group and a verified person read as the same kind of mark.
//
// Given the group's visibility, it also leads with what kind of group it is: a
// globe for a public one anybody can walk into, a lock for a private one that
// takes an invite — the same lock the settings use to say a group is private.
// Only where the visibility is actually known (a group's own detail): the
// lists of groups do not carry it, and a guess would be worse than no mark.

export function isVerifiedGroup(flags: readonly string[] | null | undefined): boolean {
  return Boolean(flags?.includes("VERIFIED"));
}

export function GroupName({
  name,
  flags,
  visibility,
  className = "",
  badgeClassName = "h-4 w-4",
}: {
  name: string;
  flags?: readonly string[] | null;
  /** Draws the globe or the lock ahead of the name. Left off, neither. */
  visibility?: GroupVisibility | null;
  /** On the whole — font, colour, flex sizing. The name inside truncates. */
  className?: string;
  /** The badge's size, which follows the text it sits beside. The visibility mark matches it. */
  badgeClassName?: string;
}) {
  const t = useT();
  const VisibilityIcon = visibility === "public" ? MdPublic : visibility === "private" ? MdLockOutline : null;
  // What the mark means, spelled out on hover (a long press on a phone): the
  // icon alone does not say what being public or private changes.
  const visibilityHint =
    visibility === "public" ? t("groups.groupName.publicHint") : t("groups.groupName.privateHint");
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      {VisibilityIcon && (
        // Wrapped: Tippy needs an element it can hold a ref to, which an
        // icon component is not.
        <Tooltip content={visibilityHint} wrapperClassName="inline-flex shrink-0">
          <VisibilityIcon role="img" aria-label={visibilityHint} className={`opacity-60 ${badgeClassName}`} />
        </Tooltip>
      )}
      <span className="truncate">{name}</span>
      {isVerifiedGroup(flags) && (
        <VerifiedBadge flags={["VERIFIED"]} className={`shrink-0 ${badgeClassName}`} />
      )}
    </span>
  );
}
