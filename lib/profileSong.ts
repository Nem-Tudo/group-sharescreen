"use client";

import { useSyncExternalStore } from "react";

// Which video a YouTube link points at.
//
// A mirror of the API's server/profileSong.ts, and deliberately the same
// rules: the client needs it to preview a song before it is saved and to say
// "that is not a YouTube link" beside the field instead of failing the whole
// profile save. The server still decides — this only decides what to show.

/** YouTube ids are exactly this: 11 chars of URL-safe base64. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube link, or null.
 *
 * Every shape they publish leads to the same id, so all of them are accepted:
 * a watch URL, a youtu.be short link, /embed/, /shorts/, and a bare id pasted
 * on its own. Refusing the ones somebody is likely to copy would look like a
 * broken field rather than a rule.
 */
export function parseYouTubeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    // Tolerates a link pasted without its scheme, which is most of them.
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  // /watch?v=<id>
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;
  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
    return VIDEO_ID_RE.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

// --- listener preference ---------------------------------------------------

const AUTOPLAY_KEY = "sharescreen:profileSongAutoplay";

/**
 * Whether a profile's song may start on its own when its page is opened.
 *
 * A setting about this browser, not about any account: it answers "do I want
 * other people's pages making noise at me", which is the listener's question
 * and nobody else's. On by default, because a song that never plays is a
 * feature that appears broken to the person who paid for it.
 */
export function getProfileSongAutoplay(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(AUTOPLAY_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setProfileSongAutoplay(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTOPLAY_KEY, String(value));
  } catch {
    // Private mode, or storage turned off. The setting simply does not stick.
  }
  autoplayListeners.forEach((listener) => listener());
}

const autoplayListeners = new Set<() => void>();

/**
 * The setting, as a hook that is safe to read during render.
 *
 * useSyncExternalStore rather than "false, then correct it in an effect":
 * localStorage does not exist on the server, and the effect version renders
 * once with the wrong answer and then sets state — which React 19 flags, and
 * which for this setting means a song can start before the answer is known.
 * The server snapshot is `false`, so the quiet answer is the one that
 * survives a mismatch.
 *
 * The subscription is to `storage`, so turning the setting off in the room
 * reaches a profile page already open in another tab, and to the setter, so it
 * reaches every other menu showing it in this one.
 */
export function useProfileSongAutoplay(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      autoplayListeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        autoplayListeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => getProfileSongAutoplay(),
    () => false
  );
}
