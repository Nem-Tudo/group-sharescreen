"use client";

import { VerifiedBadge } from "@/components/VerifiedBadge";

// A group's name, and the verified badge beside it when the group carries the
// VERIFIED flag — the group's counterpart of DisplayUserName, and the one place
// that decides how a group's name is drawn, so the badge cannot be on the rail
// and missing from the invite page. The same badge component users get, so a
// verified group and a verified person read as the same kind of mark.

export function isVerifiedGroup(flags: readonly string[] | null | undefined): boolean {
  return Boolean(flags?.includes("VERIFIED"));
}

export function GroupName({
  name,
  flags,
  className = "",
  badgeClassName = "h-4 w-4",
}: {
  name: string;
  flags?: readonly string[] | null;
  /** On the whole — font, colour, flex sizing. The name inside truncates. */
  className?: string;
  /** The badge's size, which follows the text it sits beside. */
  badgeClassName?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate">{name}</span>
      {isVerifiedGroup(flags) && (
        <VerifiedBadge flags={["VERIFIED"]} className={`shrink-0 ${badgeClassName}`} />
      )}
    </span>
  );
}
