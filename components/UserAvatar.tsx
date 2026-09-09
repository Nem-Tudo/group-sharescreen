"use client";

import { useState, type ReactNode } from "react";
import { PresenceDot, type PresenceSurface } from "@/components/PresenceDot";
import { usePresence } from "@/lib/presence";
import type { PresenceInfo } from "@/lib/signalingClient";

// One face, drawn the same way everywhere it appears.
//
// Nobody is ever faceless: an avatar is `null` for a guest, for an account
// that never picked one, and for a Pro avatar whose subscription has lapsed
// (the API hides those on the way out rather than deleting them), and all
// three fall back to the first free default here.
//
// Resolved when drawing rather than stored on the account, deliberately.
// Writing it into the database would make "never chose" and "chose 01"
// indistinguishable, which the profile picker needs to tell apart — and it
// would leave guests, who have no account to write it to, as the one group
// still without a face.
//
// The initials remain underneath, for the case the file itself does not
// load: a preset can 404 while images are still being added, and a CDN can
// be having a bad minute. That has to look deliberate rather than broken, so
// it becomes the person's initial on a colour derived from their name —
// stable per person, so the same face keeps the same colour in the
// participant list and in the chat.

/** The first free default (see the API's avatarCatalog). */
export const DEFAULT_AVATAR_PATH = "/assets/default_avatars/01.png";

/** Muted enough to sit behind white text without competing with the UI. */
const COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initialOf(name: string): string {
  // Codepoint-aware: [...name][0] keeps an emoji or an accented letter whole
  // where name[0] would slice a surrogate pair into a replacement character.
  return ([...name.trim()][0] ?? "?").toUpperCase();
}

export function UserAvatar({
  src,
  name,
  size = 24,
  className = "",
  userId,
  isGuest,
  presence,
  presenceSurface,
}: {
  src?: string | null;
  name: string;
  /** Rendered size in pixels — the circle is always square. */
  size?: number;
  className?: string;
  /** Whose face this is (see the server's stableUserId). Passing it is what
   *  puts the presence dot on the avatar — every face that names its person
   *  gets one, which is why this lives here rather than at each call site. */
  userId?: string | null;
  /** Guests have no account and therefore no presence to ask about. */
  isGuest?: boolean;
  /** An already-known presence, for a caller that has it without asking — a
   *  room's participant list, where being listed *is* being connected (see
   *  lib/presence.ts's peerPresence). Takes precedence over `userId`. */
  presence?: PresenceInfo | null;
  /** What is behind the avatar, so the indicator's outline matches it (see
   *  PresenceDot's SURFACES). */
  presenceSurface?: PresenceSurface;
}) {
  const shown = src || DEFAULT_AVATAR_PATH;
  const [failed, setFailed] = useState(false);
  // Keyed on the source so a person changing their picture mid-call gets a
  // fresh attempt instead of inheriting the previous one's failure.
  const [loadedSrc, setLoadedSrc] = useState(shown);
  if (loadedSrc !== shown) {
    setLoadedSrc(shown);
    setFailed(false);
  }

  // Called unconditionally, as every hook must be — it no-ops for a guest and
  // for a caller that passed no id (see usePresence).
  const watched = usePresence(userId, isGuest);
  const shownPresence = presence !== undefined ? presence : watched;

  const style = { width: size, height: size };
  const shared = `shrink-0 rounded-full object-cover ${className}`;

  // Wrapped only when there is actually a dot to place: an avatar with nobody
  // online behind it stays the single element every layout here was built
  // around.
  const withDot = (face: ReactNode) =>
    !shownPresence || shownPresence.state === "offline" ? (
      face
    ) : (
      <span className="relative inline-flex shrink-0" style={style}>
        {face}
        <PresenceDot
          presence={shownPresence}
          size={Math.max(8, Math.round(size * 0.32))}
          surface={presenceSurface}
          className="absolute right-0 bottom-0"
        />
      </span>
    );

  if (failed) {
    return withDot(
      <span
        aria-hidden
        style={style}
        className={`flex items-center justify-center font-semibold text-white ${colorFor(name)} ${shared}`}
      >
        <span style={{ fontSize: Math.round(size * 0.45), lineHeight: 1 }}>{initialOf(name)}</span>
      </span>
    );
  }

  return withDot(
    // The source is a user-chosen CDN URL or a static preset, neither of which
    // next/image can optimise without a remote-pattern list that changes with
    // the CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt=""
      style={style}
      onError={() => setFailed(true)}
      className={`bg-zinc-200 dark:bg-zinc-800 ${shared}`}
    />
  );
}
