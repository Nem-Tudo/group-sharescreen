"use client";

import { useEffect, useRef } from "react";
import { useGainedAudio } from "@/lib/useGainedAudio";
import { setElementSinkId } from "@/lib/useMediaDevices";

export function RemoteAudio({
  stream,
  muted = false,
  volume = 1,
  sinkId,
}: {
  stream: MediaStream;
  muted?: boolean;
  // Up to audioGain.ts's MAX_GAIN (300%) — see useGainedAudio.
  volume?: number;
  // Chosen output device id, from the speaker picker. Undefined/null keeps
  // the browser's system-default output — setSinkId is skipped entirely in
  // that case, since browsers without it (Firefox/Safari) still need this
  // component to work.
  sinkId?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
    const audio = audioRef.current;
    return () => {
      if (audio) audio.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (audioRef.current && sinkId) {
      setElementSinkId(audioRef.current, sinkId).catch(() => {
        // ignored - the chosen output device may have been unplugged since
        // it was picked; audio keeps playing on whatever sink is still active
      });
    }
  }, [sinkId]);

  useGainedAudio(audioRef, stream, volume, muted);

  return <audio ref={audioRef} autoPlay className="sr-only" />;
}
