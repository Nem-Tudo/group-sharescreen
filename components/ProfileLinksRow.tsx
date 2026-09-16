"use client";

import { handleFromUrl, networkMeta, type ProfileLink } from "@/lib/profileLinks";
import type { ProfileThemeStyle } from "@/lib/profileTheme";

// The row of social links under somebody's name — the read-only half of the
// Pro Ultra perk (see lib/profileLinks.ts).
//
// Icon plus handle rather than icon alone: a wall of small logos is a puzzle,
// and the handle is usually the thing a visitor actually wanted to read. When
// the URL has nothing handle-shaped in it the network's name takes that place,
// so a chip is never just a picture.
//
// `rel="me noopener noreferrer nofollow"` on every one. `noopener` because
// these go to arbitrary sites; `nofollow` because they are self-declared and
// this page must not lend them ranking; `me` because that is what a
// self-claimed identity link means, and it costs nothing to say so correctly.

export function ProfileLinksRow({
  links,
  theme,
}: {
  links: ProfileLink[];
  /** The profile's gradient, so the chips sit on it instead of on top of it. */
  theme?: ProfileThemeStyle | null;
}) {
  if (links.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link, index) => {
        const meta = networkMeta(link.network);
        const handle = handleFromUrl(link.url);
        return (
          <a
            // Duplicates of one network are allowed (two channels, two sites),
            // so the index is part of what makes a row distinct.
            key={`${link.network}-${index}`}
            href={link.url}
            target="_blank"
            rel="me noopener noreferrer nofollow"
            title={`${meta.label} — ${link.url}`}
            className="themed-field flex max-w-full items-center gap-1.5 rounded-full border border-zinc-300 bg-white/70 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-900"
            style={
              theme
                ? { background: theme.surface, borderColor: theme.border, color: theme.text }
                : undefined
            }
          >
            <meta.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
            <span className="truncate">{handle ?? meta.label}</span>
          </a>
        );
      })}
    </div>
  );
}
