"use client";

import { useState } from "react";
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
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={className}>{`:${name}:`}</span>;
  }
  return (
    // An emoji on the CDN (or the API's redirect to it) — next/image has no
    // business optimising it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src ?? customEmojiUrl(id)}
      alt={`:${name}:`}
      title={`:${name}:`}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`inline-block shrink-0 select-none object-contain align-[-0.3em] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
