"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { MdVolumeOff } from "react-icons/md";
import {
  audioPlaybackBlockedSince,
  isAudioPlaybackBlocked,
  isAudioPlaybackBlockedServer,
  subscribeAudioPlaybackBlocked,
  unlockAudioNow,
} from "@/lib/audioContext";
import { useFeature, trackFeatureEvent } from "@/lib/features";
import { AUDIO_UNBLOCK_EVENTS, AUDIO_UNBLOCK_FEATURE } from "@/lib/micReliability";
import { useT } from "@/lib/useI18n";

/**
 * "O navegador bloqueou o som" — experiment "audio-unblock".
 *
 * A room opened without a click (a link from Discord or WhatsApp, a
 * notification, a restored tab) joins on its own and turns the mic on from
 * the stored preference: capturing needs no click, playing sound does. Until
 * the first click or key press, the person is heard by everyone and hears
 * nobody — while the speaking rings, which come from the audio levels the
 * network carries, light up as if everything were fine. Nothing said why.
 *
 * Any click anywhere already unlocks it (lib/audioContext's gesture
 * listeners); this says so, with a button that is that click. Shown only while
 * playback is actually being refused and there is someone to hear.
 *
 * The measurement runs for both sides of the experiment: how often a room's
 * audio is held back, and for how long — which is exactly what the notice is
 * meant to shorten.
 */
export function AudioUnblockBanner({ hasAudio }: { hasAudio: boolean }) {
  const t = useT();
  const blocked = useSyncExternalStore(
    subscribeAudioPlaybackBlocked,
    isAudioPlaybackBlocked,
    isAudioPlaybackBlockedServer
  );
  const relevant = blocked && hasAudio;
  const feature = useFeature(AUDIO_UNBLOCK_FEATURE, { track: relevant });

  // One "blocked" per stretch, and its length once it ends.
  const episodeStart = useRef<number | null>(null);
  useEffect(() => {
    if (relevant && episodeStart.current === null) {
      episodeStart.current = audioPlaybackBlockedSince() ?? Date.now();
      trackFeatureEvent(AUDIO_UNBLOCK_EVENTS.blocked, { feature: AUDIO_UNBLOCK_FEATURE });
      return;
    }
    if (!blocked && episodeStart.current !== null) {
      trackFeatureEvent(AUDIO_UNBLOCK_EVENTS.unblocked, {
        feature: AUDIO_UNBLOCK_FEATURE,
        value: Math.max(1, Date.now() - episodeStart.current),
      });
      episodeStart.current = null;
    }
  }, [relevant, blocked]);

  if (!relevant || !feature.enabled) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-blue-50 px-4 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
      <p className="flex min-w-0 items-center gap-2">
        <MdVolumeOff className="h-4 w-4 shrink-0" />
        <span className="min-w-0">{t("watch.watchRoom.audioBlockedNotice")}</span>
      </p>
      <button
        type="button"
        onClick={() => {
          trackFeatureEvent(AUDIO_UNBLOCK_EVENTS.click, { feature: AUDIO_UNBLOCK_FEATURE });
          unlockAudioNow();
        }}
        className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700"
      >
        {t("watch.watchRoom.audioBlockedButton")}
      </button>
    </div>
  );
}
