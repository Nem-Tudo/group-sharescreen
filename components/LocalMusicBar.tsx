"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { MdMusicNote, MdPlaylistPlay } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { VolumeSlider } from "@/components/VolumeSlider";
import { RemoteAudio } from "@/components/RemoteAudio";
import { LocalMediaControls, RemoteMediaControls } from "@/components/LocalMediaControls";
import { localMediaSources, type LocalMediaSlot } from "@/lib/localMediaSource";
import type { SharedFile } from "@/lib/signalingClient";
import { getStoredMusicVolume, setStoredMusicVolume } from "@/lib/mediaPreferences";

// A local file put on as the room's *music* rather than as something to watch
// (see LocalMediaPicker's mode). Same strip, and the same place, as a YouTube
// one: blue, under the header, above everything the room is actually looking
// at — because music is not something you watch, and it must not take a tile
// away from the people and screens that are.
//
// What differs from MusicBar is only where the sound comes from. A YouTube
// soundtrack is an embed every listener loads themselves; this one is a file
// on one person's disk, so it arrives as live audio on that person's file
// channel. Hence the two variants below: whoever is playing it hears their own
// element and drives it directly, and everybody else gets a <RemoteAudio> on
// the received stream plus, when it was opened up, the same transport relayed
// back to them.

// Yours. The audio is already coming out of your own speakers (see
// localMediaSource's monitor branch), so there is nothing to play here.
export function LocalMusicBar({
  slot,
  canRestrictControl,
  onStop,
}: {
  slot: LocalMediaSlot;
  // See LocalMediaControls' prop of the same name.
  canRestrictControl: boolean;
  onStop: () => void;
}) {
  const source = localMediaSources[slot];
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const current = snapshot.queue[snapshot.index] ?? null;

  return (
    <MusicStrip
      title={current ? (current.name.split("/").pop() ?? current.name) : "Música do computador"}
      byline="você colocou · do seu computador"
      hasQueue={snapshot.queue.length > 1}
      controls={
        <LocalMediaControls
          slot={slot}
          canRestrictControl={canRestrictControl}
          onStop={onStop}
        />
      }
    />
  );
}

// Somebody else's. The stream is the only way this audio reaches this
// browser, so the strip carries the element that plays it — and this
// listener's own volume dial, which is theirs alone and never touches what
// anyone else hears.
export function RemoteMusicBar({
  peerId,
  peerName,
  file,
  stream,
  isRoomManager,
}: {
  peerId: string;
  peerName: string;
  file: SharedFile;
  stream: MediaStream;
  // A soundtrack's restricted mode is the room's management, not one person —
  // same rule as a YouTube one (see LocalMediaControlMode). Checked again on
  // the machine that would act on it, which is the check that counts.
  isRoomManager: boolean;
}) {
  const [volume, setVolume] = useState(() => getStoredMusicVolume());

  return (
    <MusicStrip
      title={file.name}
      byline={`${peerName} colocou`}
      hasQueue={file.count > 1}
      // Always shown, and disabled when this file is not theirs to drive —
      // where the track is and how long it runs is worth knowing either way.
      controls={
        <RemoteMediaControls
          peerId={peerId}
          file={file}
          canControl={file.controlMode === "anyone" || isRoomManager}
        />
      }
      volume={
        <VolumeSlider
          value={volume}
          label="Volume da música"
          onChange={(next) => {
            setVolume(next);
            setStoredMusicVolume(next);
          }}
          className="hidden w-24 sm:flex"
        />
      }
    >
      <RemoteAudio stream={stream} volume={volume} />
    </MusicStrip>
  );
}

function MusicStrip({
  title,
  byline,
  hasQueue,
  controls,
  volume,
  children,
}: {
  title: string;
  byline: string;
  hasQueue: boolean;
  // The transport. Present for everybody; whether its buttons do anything is
  // the transport's own business (see its `disabled`).
  controls?: ReactNode;
  volume?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full shrink-0 flex-col border-b border-sky-700/40 bg-sky-600 text-white dark:bg-sky-700">
      {/* Barely any padding of its own: the transport inside already carries
          symmetric padding, and the strip's job is to be a thin line above the
          room rather than a second header. */}
      <div className="flex w-full flex-nowrap items-center gap-x-3 px-3 py-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MdMusicNote className="h-4 w-4 shrink-0 opacity-90" />
          <div className="min-w-0">
            <Tooltip content={title}>
              <p className="truncate text-xs font-semibold leading-tight">{title}</p>
            </Tooltip>
            <p className="truncate text-[11px] leading-tight opacity-80">
              {hasQueue && <MdPlaylistPlay className="mr-1 inline h-3 w-3 align-[-2px]" />}
              {byline}
            </p>
          </div>
        </div>
        {/* The transport is built for a dark tile overlay and lands on the
            same kind of surface here, so it needs no variant of its own. */}
        {controls && <div className="min-w-0 flex-[2]">{controls}</div>}
        {volume}
      </div>
      {children}
    </div>
  );
}
