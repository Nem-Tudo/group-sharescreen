"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CallRecorder,
  CallRecordingUnsupportedError,
  type CallRecordingLabels,
  type CallRecordingResult,
  type CallRecordingSettings,
  type CallSource,
} from "./callRecording";
import { trackFeatureEvent } from "./features";
import { announceRecording } from "./recordingNotice";

// "Gravar chamada" (see lib/callRecording.ts), as the room uses it: one
// recorder at a time, fed the room's transmissions on every change, with
// everybody being recorded told so (the same red bar "Gravação" raises — see
// lib/recordingNotice).

export const CALL_RECORDING_FEATURE = "room-call-recording";

// Every name has to be listed in the feature's "site events" to count.
export const CALL_RECORDING_EVENTS = {
  open: "call_recording_open", // the settings were opened
  start: "call_recording_start", // value: transmissions in the call at the start
  exportVideo: "call_recording_export_video",
  exportZip: "call_recording_export_zip",
  exportBoth: "call_recording_export_both",
  separateTracks: "call_recording_separate_tracks", // started with one track per voice
  stop: "call_recording_stop", // value: seconds recorded
  download: "call_recording_download", // value: seconds in the file
  discard: "call_recording_discard", // thrown away instead of exported
  failed: "call_recording_failed",
} as const;

function track(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: CALL_RECORDING_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

// More than this and the notices alone would eat the socket's toggle budget
// (60 per 10s on the API, shared with the mic button).
const MAX_NOTIFIED = 25;

export type CallRecordingStatus = "idle" | "starting" | "recording" | "finishing";
export type CallRecordingError = "unsupported" | "failed" | null;

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

function downloadResult(result: CallRecordingResult) {
  downloadBlob(result.blob, result.fileName);
  // Past what a zip holds: the rest one by one (the browser may ask once
  // whether this page can download several files).
  result.looseFiles?.forEach((file, i) => setTimeout(() => downloadBlob(file.blob, file.name), (i + 1) * 400));
  track(CALL_RECORDING_EVENTS.download, result.durationMs / 1000);
}

export function useCallRecording(sources: CallSource[], labels: CallRecordingLabels) {
  const recorderRef = useRef<CallRecorder | null>(null);
  const sourcesRef = useRef(sources);
  const [status, setStatus] = useState<CallRecordingStatus>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<CallRecordingError>(null);
  const [result, setResult] = useState<CallRecordingResult | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
    recorderRef.current?.update(sources);
  }, [sources]);

  // Everybody whose voice or screen is going into the file hears about it,
  // for as long as it lasts — including whoever starts talking halfway.
  const owners =
    status === "recording"
      ? [...new Set(sources.filter((s) => !s.self).map((s) => s.ownerId))].sort().slice(0, MAX_NOTIFIED).join(",")
      : "";
  const noticesRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const wanted = new Set(owners ? owners.split(",") : []);
    const notices = noticesRef.current;
    for (const [id, stop] of notices) {
      if (!wanted.has(id)) {
        stop();
        notices.delete(id);
      }
    }
    for (const id of wanted) if (!notices.has(id)) notices.set(id, announceRecording(id, "call"));
  }, [owners]);

  const start = useCallback(
    async (settings: CallRecordingSettings, volumes: Record<string, number>) => {
      if (recorderRef.current) return;
      const recorder = new CallRecorder(settings, volumes, labels);
      recorderRef.current = recorder;
      setStatus("starting");
      setError(null);
      setResult(null);
      try {
        await recorder.start(sourcesRef.current);
        if (recorderRef.current !== recorder) return;
        setStartedAt(Date.now());
        setStatus("recording");
        track(CALL_RECORDING_EVENTS.start, sourcesRef.current.length);
        track(
          settings.output === "video"
            ? CALL_RECORDING_EVENTS.exportVideo
            : settings.output === "zip"
              ? CALL_RECORDING_EVENTS.exportZip
              : CALL_RECORDING_EVENTS.exportBoth,
        );
        if (settings.separateTracks) track(CALL_RECORDING_EVENTS.separateTracks);
      } catch (err) {
        recorder.cancel();
        if (recorderRef.current === recorder) recorderRef.current = null;
        setStatus("idle");
        setError(err instanceof CallRecordingUnsupportedError ? "unsupported" : "failed");
        track(CALL_RECORDING_EVENTS.failed);
      }
    },
    [labels],
  );

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setStatus("finishing");
    setProgress(0);
    track(CALL_RECORDING_EVENTS.stop, recorder.elapsedMs() / 1000);
    try {
      const done = await recorder.stop(setProgress);
      if (done) {
        setResult(done);
        downloadResult(done);
      } else {
        setError("failed");
        track(CALL_RECORDING_EVENTS.failed);
      }
    } catch {
      setError("failed");
      track(CALL_RECORDING_EVENTS.failed);
    } finally {
      recorderRef.current = null;
      setStartedAt(null);
      setStatus("idle");
    }
  }, []);

  const discard = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    recorder.cancel();
    setStartedAt(null);
    setStatus("idle");
    track(CALL_RECORDING_EVENTS.discard);
  }, []);

  const setVolume = useCallback((id: string, volume: number) => {
    recorderRef.current?.setVolume(id, volume);
  }, []);

  // Closing the tab mid-recording loses it: the browser asks first.
  useEffect(() => {
    if (status !== "recording" && status !== "finishing") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  // Leaving the room (not the page) mid-recording finishes it on the way out
  // and downloads it, rather than throwing an hour away without a word.
  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      for (const stopNotice of noticesRef.current.values()) stopNotice();
      noticesRef.current.clear();
      if (!recorder) return;
      void recorder
        .stop()
        .then((done) => {
          if (done) downloadResult(done);
        })
        .catch(() => {});
    },
    [],
  );

  return {
    status,
    startedAt,
    progress,
    error,
    result,
    start,
    stop,
    discard,
    setVolume,
    redownload: () => result && downloadResult(result),
    clearError: () => setError(null),
  };
}

export function trackCallRecordingOpen() {
  track(CALL_RECORDING_EVENTS.open);
}
