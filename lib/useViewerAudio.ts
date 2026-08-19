"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const VIEWER_VOLUME_STORAGE_KEY = "sharescreen-viewer-volume";
const DEFAULT_VOLUME = 100;
export const MAX_VIEWER_VOLUME = 300;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(MAX_VIEWER_VOLUME, Math.max(0, Math.round(value)));
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const stored = window.localStorage.getItem(VIEWER_VOLUME_STORAGE_KEY);
    return stored === null ? DEFAULT_VOLUME : clampVolume(Number(stored));
  } catch {
    return DEFAULT_VOLUME;
  }
}

function storeVolume(value: number) {
  try {
    window.localStorage.setItem(VIEWER_VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Local playback must keep working when storage is unavailable.
  }
}

type AudioPipeline = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
};

export function useViewerAudio(stream: MediaStream, enabled: boolean) {
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [muted, setMuted] = useState(false);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const pipelineRef = useRef<AudioPipeline | null>(null);
  const ensurePipelineRef = useRef<() => void>(() => {});

  const applyGain = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const gain = mutedRef.current ? 0 : volumeRef.current / 100;
    pipeline.gain.gain.setValueAtTime(gain, pipeline.context.currentTime);
  }, []);

  const resumeAudio = useCallback(() => {
    ensurePipelineRef.current();
    const context = pipelineRef.current?.context;
    if (context?.state === "suspended") {
      context.resume().catch(() => {});
    }
  }, []);

  const setVolume = useCallback(
    (nextVolume: number) => {
      const next = clampVolume(nextVolume);
      volumeRef.current = next;
      setVolumeState(next);
      storeVolume(next);
      applyGain();
      resumeAudio();
    },
    [applyGain, resumeAudio]
  );

  const toggleMuted = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    applyGain();
    resumeAudio();
  }, [applyGain, resumeAudio]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    const watchedTracks = new Set<MediaStreamTrack>();

    function disposePipeline() {
      const pipeline = pipelineRef.current;
      if (!pipeline) return;
      pipelineRef.current = null;
      pipeline.source.disconnect();
      pipeline.gain.disconnect();
      pipeline.context.close().catch(() => {});
    }

    function hasLiveAudio() {
      return stream.getAudioTracks().some((track) => track.readyState === "live");
    }

    function ensurePipeline() {
      if (disposed || pipelineRef.current || !hasLiveAudio()) return;
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      let context: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let gain: GainNode | null = null;
      try {
        context = new AudioContextCtor();
        source = context.createMediaStreamSource(stream);
        gain = context.createGain();
        source.connect(gain);
        gain.connect(context.destination);
        pipelineRef.current = { context, source, gain };
        applyGain();
      } catch {
        source?.disconnect();
        gain?.disconnect();
        context?.close().catch(() => {});
      }
    }

    function rebuildPipeline() {
      disposePipeline();
      ensurePipeline();
    }

    function onTrackEnded() {
      rebuildPipeline();
    }

    function watchTrack(track: MediaStreamTrack) {
      if (track.kind !== "audio" || watchedTracks.has(track)) return;
      watchedTracks.add(track);
      track.addEventListener("ended", onTrackEnded);
    }

    function unwatchTrack(track: MediaStreamTrack) {
      if (!watchedTracks.delete(track)) return;
      track.removeEventListener("ended", onTrackEnded);
    }

    function onAddTrack(event: MediaStreamTrackEvent) {
      if (event.track.kind !== "audio") return;
      watchTrack(event.track);
      rebuildPipeline();
    }

    function onRemoveTrack(event: MediaStreamTrackEvent) {
      if (event.track.kind !== "audio") return;
      unwatchTrack(event.track);
      rebuildPipeline();
    }

    stream.getAudioTracks().forEach(watchTrack);
    stream.addEventListener("addtrack", onAddTrack);
    stream.addEventListener("removetrack", onRemoveTrack);
    ensurePipelineRef.current = ensurePipeline;
    ensurePipeline();

    return () => {
      disposed = true;
      ensurePipelineRef.current = () => {};
      stream.removeEventListener("addtrack", onAddTrack);
      stream.removeEventListener("removetrack", onRemoveTrack);
      watchedTracks.forEach(unwatchTrack);
      disposePipeline();
    };
  }, [applyGain, enabled, stream]);

  return {
    volume,
    muted,
    setVolume,
    toggleMuted,
    resumeAudio,
  };
}
