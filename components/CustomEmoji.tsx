"use client";

import { useEffect, useRef, useState } from "react";
import { customEmojiUrl } from "@/lib/customEmoji";

/**
 * One custom emoji, drawn from its id (see lib/customEmoji). Its `:name:` is
 * the alt text and the hover title, so copying a line through one copies the
 * name, and one whose picture is gone — deleted, or offline — reads as the
 * name instead of a hole.
 */
export function CustomEmoji({
  id,
  name,
  size = 22,
  className = "",
  src,
}: {
  id: string;
  name: string;
  size?: number;
  className?: string;
  /** The picture's own address when it is at hand (the picker) — saves the API's redirect. */
  src?: string;
}) {
  const address = src ?? customEmojiUrl(id);
  // One retry before giving up: an emoji asked for in the seconds after it was
  // uploaded can miss (the picture is still on its way to the CDN), and a hole
  // that stayed a hole until the page reloaded looked like every custom emoji
  // had stopped working.
  // Kept with the address it is about, so a new picture starts over without an
  // effect to reset it.
  const [state, setState] = useState({ address, tries: 0, failed: false });
  const { tries, failed } = state.address === address ? state : { tries: 0, failed: false };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  if (failed) {
    return <span className={className}>{`:${name}:`}</span>;
  }
  return (
    // An emoji on the CDN (or the API's redirect to it) — next/image has no
    // business optimising it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tries === 0 ? address : `${address}${address.includes("?") ? "&" : "?"}retry=${tries}`}
      alt={`:${name}:`}
      title={`:${name}:`}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (tries > 0) {
          setState({ address, tries, failed: true });
          return;
        }
        timer.current = setTimeout(() => setState({ address, tries: 1, failed: false }), 2000);
      }}
      className={`inline-block shrink-0 select-none object-contain align-[-0.3em] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
