"use client";

import { useRef, useState } from "react";
import { MdPause, MdPlayArrow } from "react-icons/md";
import type { ProfileThemeStyle } from "@/lib/profileTheme";
import { useT } from "@/lib/useI18n";

// The song on somebody's profile: a name and a play control, never a video.
//
// The embed is still YouTube's — it is the only way to play a YouTube video —
// but it is kept out of sight and out of the layout's way, one pixel of it
// parked behind the row. A profile song is something you hear while reading a
// page, and a video player sitting in the middle of a profile is a different,
// louder thing than what was asked for.
//
// Hidden with size and opacity rather than `display: none` or
// `visibility: hidden`: those two suspend media in several browsers, which
// would make the audio stop the moment it was hidden.
//
// Two behaviours, one component, because they are the same player with a
// different starting state:
//
//   - on the profile page (/user/...), it starts on its own;
//   - in the room's profile popup, it waits for a press. Somebody clicking a
//     name mid-call to check who they are must not have music start over the
//     call they are in.
//
// What the browser does about autoplay is not ours to decide: an embed that
// has never been interacted with is usually blocked from starting with sound.
// The control is always there, so a blocked start is one press away from
// playing rather than a dead silent page.

export interface ProfileSong {
  videoId: string;
  title: string;
  /** 0-100, set by the profile's owner. Absent on an older API. */
  volume?: number;
}

/** Matches the API's DEFAULT_SONG_VOLUME. */
export const DEFAULT_SONG_VOLUME = 20;

export function ProfileSongPlayer({
  song,
  autoPlay = false,
  theme,
  className = "",
}: {
  song: ProfileSong;
  autoPlay?: boolean;
  /** The profile's palette, when it has one — see lib/profileTheme. */
  theme?: ProfileThemeStyle | null;
  className?: string;
}) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Two states, not one. `started` is whether the embed exists; `playing` is
  // whether it is running. They were the same flag, and that is what made
  // pausing lose the position: pausing unmounted the player, so resuming was
  // a new one starting at zero.
  //
  // Now the embed is mounted on the first press and stays. Pause and resume
  // are commands sent to it — see toggle — so it keeps its place.
  const [started, setStarted] = useState(autoPlay);
  const [playing, setPlaying] = useState(autoPlay);
  const title = song.title || t("profileSongPlayer.profileSong");
  const Icon = playing ? MdPause : MdPlayArrow;

  /**
   * The owner's volume, sent to the player.
   *
   * Has to be a command: the embed takes no volume in its URL, and it starts
   * at full. Sent on load and again with every play, because the player
   * ignores commands until its own API is ready and "ready" is not something
   * the iframe's load event actually tells us.
   */
  function applyVolume() {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func: "setVolume",
        args: [song.volume ?? DEFAULT_SONG_VOLUME],
      }),
      "https://www.youtube-nocookie.com"
    );
  }

  function toggle() {
    if (!started) {
      setStarted(true);
      setPlaying(true);
      return;
    }
    // The IFrame API's postMessage protocol, which is what `enablejsapi=1` in
    // the src below turns on. Addressed to YouTube's own origin rather than
    // "*": there is exactly one window this is meant for, and naming it keeps
    // the message out of anything else that might be listening.
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: playing ? "pauseVideo" : "playVideo", args: [] }),
      "https://www.youtube-nocookie.com"
    );
    if (!playing) applyVolume();
    setPlaying((current) => !current);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("profileSongPlayer.stopTitle", { title }) : t("profileSongPlayer.playTitle", { title })}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
          theme
            ? ""
            : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        }`}
        style={
          theme
            ? {
                borderColor: theme.border,
                background: theme.surface,
                color: theme.text,
                textShadow: theme.textShadow,
              }
            : undefined
        }
      >
        <Icon
          className={`h-5 w-5 shrink-0 ${theme ? "" : "text-emerald-600 dark:text-emerald-500"}`}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {/* Far right, and only while running: the row already says what the
            song is, and this says that it is playing right now — which the
            pause icon on the left implies but does not show. */}
        {playing && (
          <span aria-hidden className="flex h-4 shrink-0 items-end gap-0.5">
            {[0, 0.15, 0.3].map((delay) => (
              <span
                key={delay}
                className="golive-eq-bar w-0.5 rounded-full bg-current"
                style={{ height: "100%", animationDelay: `${delay}s` }}
              />
            ))}
          </span>
        )}
      </button>

      {started && (
        <iframe
          ref={frameRef}
          // youtube-nocookie, and only ever an id this app parsed out of a
          // link (see lib/profileSong.ts) — never a URL somebody stored.
          src={`https://www.youtube-nocookie.com/embed/${song.videoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`}
          title={title}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          aria-hidden
          tabIndex={-1}
          // Twice, a moment apart: the frame's load event fires before the
          // player's own API is listening, so the first one is often lost.
          onLoad={() => {
            applyVolume();
            setTimeout(applyVolume, 700);
          }}
          className="pointer-events-none absolute bottom-0 left-0 h-px w-px border-0 opacity-0"
        />
      )}
    </div>
  );
}
