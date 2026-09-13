"use client";

import { useState } from "react";
import { twemojiUrl } from "@/lib/emoji";

/**
 * One emoji, drawn as Twemoji.
 *
 * The alt text is the emoji itself, so copying a selection that runs through
 * one still copies the character, and a screen reader reads it as it would
 * the text. If the picture does not load — offline, a blocked CDN, an emoji
 * newer than the pinned set — the character is drawn instead, in whatever
 * font the system has: an emoji that looks different is better than a hole.
 */
export function Twemoji({
  emoji,
  size = 20,
  className = "",
  title,
}: {
  emoji: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  // Keyed by the emoji rather than a plain flag, so one that failed does not
  // leave the next one drawn as text when the same element is reused for it.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  if (failedFor === emoji) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.85) }}
        title={title}
      >
        {emoji}
      </span>
    );
  }
  return (
    // A CDN SVG, which next/image has no business optimising.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={twemojiUrl(emoji)}
      alt={emoji}
      title={title}
      draggable={false}
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      onError={() => setFailedFor(emoji)}
      className={`inline-block shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
