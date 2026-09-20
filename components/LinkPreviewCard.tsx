"use client";

import { useEffect, useState } from "react";
import { fetchLinkPreview, type LinkPreview } from "@/lib/dmApi";

// The card under a message that has a link in it — the page's title, the
// first line of it and its picture.
//
// Read from our own server (see the API's linkPreview.ts), because the pages
// people link to do not let a browser read them. One read per address for the
// whole page, cached below: a link pasted into three conversations, or read
// twice because the thread re-rendered, is still one request.
//
// A message with no link, or a link with no card, draws nothing at all —
// never a placeholder and never a spinner. A card is extra; a box that says
// "carregando…" under every line somebody pasted is the message being
// interrupted by its own footnote.

/** What the server answered per address, including "nothing" — see readLinkPreview. */
const cache = new Map<string, LinkPreview | null>();
/** Reads in flight, so two messages with the same link ask once. */
const inFlight = new Map<string, Promise<LinkPreview | null>>();

function load(url: string): Promise<LinkPreview | null> {
  const known = cache.get(url);
  if (known !== undefined) return Promise.resolve(known);
  const existing = inFlight.get(url);
  if (existing) return existing;
  const request = fetchLinkPreview(url)
    .then((preview) => {
      cache.set(url, preview);
      return preview;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, request);
  return request;
}

/** The first http(s) link in a message, or null — the API's own rule. */
export function firstLink(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)\]]+$/, "");
}

export function LinkPreviewCard({ text, className = "" }: { text: string; className?: string }) {
  const url = firstLink(text);
  // Tagged with the address it is about, so an edit that changes the link
  // does not draw the old card for a moment — and so nothing has to be reset
  // when the text changes. The cache is read straight during the render,
  // which is what stops a thread scrolling past a link it has already read
  // from flashing its card away and back.
  const [answered, setAnswered] = useState<{ url: string; preview: LinkPreview | null } | null>(null);
  const preview = url ? (answered?.url === url ? answered.preview : cache.get(url) ?? null) : null;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    void load(url).then((found) => {
      if (alive) setAnswered({ url, preview: found });
    });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!url || !preview || !preview.title) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      // Stops the message's own press handlers — a card is a way out of the
      // conversation, not a click on the message under it.
      onClick={(e) => e.stopPropagation()}
      className={`mt-1 flex max-w-sm overflow-hidden rounded-xl border border-zinc-200 bg-white text-left no-underline transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 ${className}`}
    >
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          // Hidden rather than broken: a picture that does not load leaves a
          // card with a grey hole in it.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="h-auto w-20 shrink-0 self-stretch object-cover"
        />
      )}
      <span className="min-w-0 flex-1 px-2.5 py-2">
        <span className="block truncate text-[11px] uppercase tracking-wide text-zinc-400">
          {preview.siteName}
        </span>
        <span className="mt-0.5 line-clamp-2 break-words text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {preview.title}
        </span>
        {preview.description && (
          <span className="mt-0.5 line-clamp-2 break-words text-[11px] text-zinc-500 dark:text-zinc-400">
            {preview.description}
          </span>
        )}
      </span>
    </a>
  );
}
