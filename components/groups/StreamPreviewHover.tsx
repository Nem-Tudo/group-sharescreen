"use client";

import Tippy from "@tippyjs/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { STREAM_PREVIEW_EVENTS, STREAM_PREVIEW_FEATURE, useStreamPreviewImage } from "@/lib/streamPreview";
import type { GroupVoiceLivePerson } from "@/lib/groupVoiceSession";
import { useT } from "@/lib/useI18n";

// The card that pops out of a voice room in the group's rooms list while
// somebody in it is transmitting: a still of each transmission (see
// lib/streamPreview), the way Discord shows one when you hover a channel.

/** More than this in one room and the card would be taller than the column. */
const MAX_PREVIEWS = 3;

function PreviewTile({
  groupId,
  channelId,
  person,
  onWatch,
  onLoaded,
}: {
  groupId: string;
  channelId: string;
  person: GroupVoiceLivePerson;
  onWatch: ((person: GroupVoiceLivePerson) => void) | null;
  onLoaded: () => void;
}) {
  const t = useT();
  const url = useStreamPreviewImage(groupId, channelId, person.userId);
  useEffect(() => {
    if (url) onLoaded();
  }, [url, onLoaded]);
  const body = (
    <>
      <span className="relative block aspect-video w-full overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-800">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched blob
          <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : url === null ? (
          <span className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.groupSidebar.streamPreviewNone")}
          </span>
        ) : (
          <span className="block h-full w-full animate-pulse bg-zinc-300/60 dark:bg-zinc-700/60" />
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase text-white">
          {t("groups.groupSidebar.live")}
        </span>
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-200">
        <UserAvatar src={person.avatarUrl} name={person.name} size={16} />
        <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
        {onWatch && (
          <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("groups.groupSidebar.streamPreviewHint")}
          </span>
        )}
      </span>
    </>
  );
  return onWatch ? (
    <button
      type="button"
      onClick={() => onWatch(person)}
      title={t("groups.groupSidebar.watchLive", { name: person.name })}
      className="block w-full cursor-pointer rounded-lg p-1 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
    >
      {body}
    </button>
  ) : (
    <div className="p-1">{body}</div>
  );
}

function PreviewCard({
  groupId,
  channelId,
  sharers,
  onWatch,
}: {
  groupId: string;
  channelId: string;
  sharers: GroupVoiceLivePerson[];
  onWatch: ((person: GroupVoiceLivePerson) => void) | null;
}) {
  // Mounted only while the card is open — this is where the experiment is
  // actually seen.
  useFeature(STREAM_PREVIEW_FEATURE, { group: groupId, track: true });
  const viewed = useRef(false);
  const onLoaded = useCallback(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackFeatureEvent(STREAM_PREVIEW_EVENTS.view, { group: groupId, feature: STREAM_PREVIEW_FEATURE });
  }, [groupId]);
  return (
    <div className="flex w-64 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      {sharers.slice(0, MAX_PREVIEWS).map((person) => (
        <PreviewTile
          key={person.key ?? person.userId}
          groupId={groupId}
          channelId={channelId}
          person={person}
          onWatch={onWatch}
          onLoaded={onLoaded}
        />
      ))}
    </div>
  );
}

/**
 * Wraps a voice room's row. With nobody transmitting (or the experiment off
 * for the group) it is just the row; otherwise hovering it opens the card.
 * `onWatch` is null where the viewer may not walk in — the API would not hand
 * the pictures over then either, so the card is not offered at all.
 */
export function StreamPreviewHover({
  groupId,
  channelId,
  sharers,
  onWatch,
  children,
}: {
  groupId: string;
  channelId: string;
  sharers: GroupVoiceLivePerson[];
  onWatch: ((person: GroupVoiceLivePerson) => void) | null;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const disabled = sharers.length === 0 || !onWatch;
  return (
    <Tippy
      // Rendered only while open: otherwise every room with somebody live
      // would be fetching pictures nobody is looking at.
      content={
        shown && !disabled ? (
          <PreviewCard groupId={groupId} channelId={channelId} sharers={sharers} onWatch={onWatch} />
        ) : null
      }
      disabled={disabled}
      onShow={() => setShown(true)}
      onHidden={() => setShown(false)}
      placement="right-start"
      offset={[0, 10]}
      delay={[350, 80]}
      interactive
      interactiveBorder={12}
      appendTo={() => document.body}
      theme="golive-panel"
      animation="shift-away"
      duration={[150, 100]}
      maxWidth="none"
      touch={false}
      popperOptions={{
        modifiers: [
          { name: "preventOverflow", options: { padding: 8 } },
          { name: "flip", options: { fallbackPlacements: ["bottom", "top", "left"] } },
        ],
      }}
    >
      <div>{children}</div>
    </Tippy>
  );
}
