"use client";

import { useState } from "react";
import { groupInitials } from "@/lib/groupLinks";

/**
 * A group's face: its picture, or its initials on a colour picked from its
 * name — the same group is always the same colour, which is what lets somebody
 * find it on the rail at a glance before an icon has ever been uploaded.
 */
const PALETTE = [
  "bg-rose-600",
  "bg-orange-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-teal-600",
  "bg-sky-600",
  "bg-indigo-600",
  "bg-violet-600",
  "bg-fuchsia-600",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function GroupIcon({
  name,
  iconUrl,
  seed,
  size = 48,
  className = "",
}: {
  name: string;
  iconUrl: string | null;
  /** What picks the colour — the group id, so a rename does not recolour it. */
  seed?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) };
  if (iconUrl && failed !== iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt={name}
        style={style}
        onError={() => setFailed(iconUrl)}
        className={`shrink-0 object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-label={name}
      style={style}
      className={`flex shrink-0 select-none items-center justify-center font-semibold text-white ${colorFor(seed ?? name)} ${className}`}
    >
      {groupInitials(name)}
    </span>
  );
}
