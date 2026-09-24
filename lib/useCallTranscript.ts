"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallSource } from "./callRecording";
import {
  CallTranscriber,
  DEFAULT_TRANSCRIPT_SETTINGS,
  type TranscriberError,
  type TranscriptEntry,
  type TranscriptSettings,
} from "./callTranscript";
import { trackFeatureEvent } from "./features";
import { getLocale } from "./i18n";
import { announceRecording } from "./recordingNotice";
import { summarizeTranscript } from "./transcriptApi";
import { buildTranscriptFiles, transcriptText, type TranscriptFile } from "./transcriptExport";
import { downloadBlob } from "./useCallRecording";

// "Transcrição" (see lib/callTranscript.ts), as the room uses it: one session
// at a time, started on its own from the "⋯" menu or together with "Gravar
// chamada" — in which case it ends with the recording and its files go into
// that recording's zip, under transcripts/.

export const CALL_TRANSCRIPT_FEATURE = "room-call-transcript";
// Transcription without Pro Max, for whoever is in this one: the button shows
// up for them (even outside the experiment above), nothing says "Pro Max",
// and the /pro page stops listing it. The API decides it from the same
// rollout (see its transcribeRoutes.ts), with a smaller daily budget.
export const CALL_TRANSCRIPT_FREE_FEATURE = "room-call-transcript-free";

// Every name has to be listed in the feature's "site events" to count.
export const CALL_TRANSCRIPT_EVENTS = {
  open: "transcript_open", // the settings were opened
  upsell: "transcript_upsell", // opened without Pro Max
  upsellClick: "transcript_upsell_click", // went to the Pro page from it
  start: "transcript_start", // started on its own
  startWithRecording: "transcript_start_with_recording",
  stop: "transcript_stop", // value: minutes transcribed
  download: "transcript_download", // value: lines in it
  translate: "transcript_translate", // started with translation on
  summary: "transcript_summary", // a summary was made
  separateFiles: "transcript_separate_files",
  liveCaptions: "transcript_live_captions",
  ignorePerson: "transcript_ignore_person",
  dailyLimit: "transcript_daily_limit",
  failed: "transcript_failed",
} as const;

export function trackTranscript(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: CALL_TRANSCRIPT_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

const SETTINGS_KEY = "sharescreen:transcriptSettings";
const MAX_NOTIFIED = 25;

function readSettings(): TranscriptSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TRANSCRIPT_SETTINGS, language: getLocale() };
    const saved = JSON.parse(raw) as Partial<TranscriptSettings>;
    return {
      ...DEFAULT_TRANSCRIPT_SETTINGS,
      ...saved,
      formats: { ...DEFAULT_TRANSCRIPT_SETTINGS.formats, ...saved.formats },
    };
  } catch {
    return DEFAULT_TRANSCRIPT_SETTINGS;
  }
}

export type TranscriptStatus = "idle" | "starting" | "running" | "finishing";
export type TranscriptOwner = "manual" | "recording";
export type TranscriptError = TranscriberError | "failed" | null;

function summaryLanguage(settings: TranscriptSettings): string {
  if (settings.translateTo !== "none") return settings.translateTo;
  if (settings.language !== "auto") return settings.language;
  return getLocale();
}

async function makeSummary(
  entries: TranscriptEntry[],
  settings: TranscriptSettings,
  origin: number,
  end: number,
): Promise<string | null> {
  if (!settings.summary || !entries.length) return null;
  const result = await summarizeTranscript(transcriptText(entries, settings, origin, end), summaryLanguage(settings));
  if (!result.ok) return null;
  trackTranscript(CALL_TRANSCRIPT_EVENTS.summary);
  return result.value.summary || null;
}

export function useCallTranscript(sources: CallSource[]) {
  const transcriberRef = useRef<CallTranscriber | null>(null);
  const sourcesRef = useRef(sources);
  const [settings, setSettingsState] = useState<TranscriptSettings>(() =>
    typeof window === "undefined" ? DEFAULT_TRANSCRIPT_SETTINGS : readSettings(),
  );
  const [status, setStatus] = useState<TranscriptStatus>("idle");
  const [owner, setOwner] = useState<TranscriptOwner | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [pending, setPending] = useState(0);
  const [lost, setLost] = useState(0);
  const [error, setError] = useState<TranscriptError>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const ignoredRef = useRef(ignored);
  const [lastFiles, setLastFiles] = useState<{ files: TranscriptFile[]; origin: number } | null>(null);
  // The settings the running session was started with: what its files are
  // written with, even if the form is changed meanwhile.
  const sessionSettingsRef = useRef<TranscriptSettings>(settings);

  useEffect(() => {
    sourcesRef.current = sources;
    transcriberRef.current?.update(sources);
  }, [sources]);

  const setSettings = useCallback((patch: Partial<TranscriptSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch, formats: { ...prev.formats, ...patch.formats } };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, that's all.
      }
      return next;
    });
  }, []);

  const toggleIgnored = useCallback((ownerId: string) => {
    const next = new Set(ignoredRef.current);
    if (next.has(ownerId)) next.delete(ownerId);
    else {
      next.add(ownerId);
      trackTranscript(CALL_TRANSCRIPT_EVENTS.ignorePerson);
    }
    ignoredRef.current = next;
    transcriberRef.current?.setIgnored(next);
    setIgnored(next);
  }, []);

  // Everybody whose voice is being turned into text is told, like a recording.
  const active = status === "running" || status === "starting";
  const owners = active
    ? [
        ...new Set(
          sources
            .filter((s) => !s.self && !ignored.has(s.ownerId) && (s.kind === "voice" || settings.includeScreenAudio))
            .map((s) => s.ownerId),
        ),
      ]
        .sort()
        .slice(0, MAX_NOTIFIED)
        .join(",")
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
    for (const id of wanted) if (!notices.has(id)) notices.set(id, announceRecording(id, "transcript"));
  }, [owners]);

  const start = useCallback(
    async (by: TranscriptOwner) => {
      if (transcriberRef.current) return;
      const session = settings;
      sessionSettingsRef.current = session;
      const transcriber = new CallTranscriber(session, {
        onEntries: (list) => {
          if (transcriberRef.current === transcriber) setEntries(list);
        },
        onPending: (n) => {
          if (transcriberRef.current === transcriber) setPending(n);
        },
        onLost: (n) => setLost(n),
        onFatal: (reason) => {
          setError(reason);
          if (reason === "daily-limit") trackTranscript(CALL_TRANSCRIPT_EVENTS.dailyLimit);
          else trackTranscript(CALL_TRANSCRIPT_EVENTS.failed);
        },
      });
      transcriberRef.current = transcriber;
      setOwner(by);
      setStatus("starting");
      setError(null);
      setEntries([]);
      setPending(0);
      setLost(0);
      setLastFiles(null);
      try {
        await transcriber.start(sourcesRef.current, ignoredRef.current);
        if (transcriberRef.current !== transcriber) return;
        setStartedAt(transcriber.startedAtWall);
        setStatus("running");
        trackTranscript(by === "recording" ? CALL_TRANSCRIPT_EVENTS.startWithRecording : CALL_TRANSCRIPT_EVENTS.start);
        if (session.translateTo !== "none") trackTranscript(CALL_TRANSCRIPT_EVENTS.translate);
        if (session.separateFiles) trackTranscript(CALL_TRANSCRIPT_EVENTS.separateFiles);
        if (session.liveCaptions) trackTranscript(CALL_TRANSCRIPT_EVENTS.liveCaptions);
      } catch {
        transcriber.cancel();
        if (transcriberRef.current === transcriber) transcriberRef.current = null;
        setStatus("idle");
        setOwner(null);
        setError("unsupported");
        trackTranscript(CALL_TRANSCRIPT_EVENTS.failed);
      }
    },
    [settings],
  );

  const finish = useCallback(async (): Promise<{ entries: TranscriptEntry[]; origin: number; end: number } | null> => {
    const transcriber = transcriberRef.current;
    if (!transcriber) return null;
    const end = Date.now();
    const origin = transcriber.startedAtWall || end;
    setStatus("finishing");
    trackTranscript(CALL_TRANSCRIPT_EVENTS.stop, (end - origin) / 60_000);
    const list = await transcriber.stop();
    transcriberRef.current = null;
    setEntries(list);
    setPending(0);
    setStatus("idle");
    setOwner(null);
    setStartedAt(null);
    return { entries: list, origin, end };
  }, []);

  /** Stops a session started on its own and downloads its files. */
  const stop = useCallback(async () => {
    const done = await finish();
    if (!done) return;
    const session = sessionSettingsRef.current;
    const summary = await makeSummary(done.entries, session, done.origin, done.end);
    const files = buildTranscriptFiles(done.entries, session, { origin: done.origin, end: done.end, summary });
    setLastFiles({ files, origin: done.origin });
    await downloadTranscriptFiles(files, done.origin);
    trackTranscript(CALL_TRANSCRIPT_EVENTS.download, done.entries.length);
  }, [finish]);

  /**
   * The transcript's files for a recording that ran from `origin` to `end`,
   * under transcripts/. A session started with the recording ends here; one
   * started on its own keeps going and only lends what it has so far.
   */
  const filesForRecording = useCallback(
    async (origin: number, end: number): Promise<TranscriptFile[]> => {
      const transcriber = transcriberRef.current;
      if (!transcriber) return [];
      const session = sessionSettingsRef.current;
      let list: TranscriptEntry[];
      if (owner === "recording") {
        const done = await finish();
        list = done?.entries ?? [];
      } else {
        list = transcriber.entriesSoFar();
      }
      if (!list.length) return [];
      const summary = await makeSummary(list, session, origin, end);
      trackTranscript(CALL_TRANSCRIPT_EVENTS.download, list.length);
      return buildTranscriptFiles(list, session, { origin, end, summary, folder: "transcripts" });
    },
    [finish, owner],
  );

  const discard = useCallback(() => {
    const transcriber = transcriberRef.current;
    if (!transcriber) return;
    transcriberRef.current = null;
    transcriber.cancel();
    setStatus("idle");
    setOwner(null);
    setStartedAt(null);
    setPending(0);
  }, []);

  // Closing the tab mid-transcript loses it: the browser asks first.
  useEffect(() => {
    if (status !== "running" && status !== "finishing") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  // Leaving the room mid-transcript: what there is gets downloaded.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(
    () => () => {
      for (const stopNotice of noticesRef.current.values()) stopNotice();
      noticesRef.current.clear();
      if (transcriberRef.current) void stopRef.current();
    },
    [],
  );

  return {
    settings,
    setSettings,
    status,
    owner,
    entries,
    pending,
    lost,
    error,
    startedAt,
    ignored,
    toggleIgnored,
    start,
    stop,
    discard,
    filesForRecording,
    redownload: () => {
      if (lastFiles) void downloadTranscriptFiles(lastFiles.files, lastFiles.origin);
    },
    hasLastFiles: Boolean(lastFiles),
    clearError: () => setError(null),
  };
}

export type CallTranscriptState = ReturnType<typeof useCallTranscript>;

/** One file as itself; several in a zip, under transcripts/. */
export async function downloadTranscriptFiles(files: TranscriptFile[], origin: number) {
  if (!files.length) return;
  const stamp = new Date(origin).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  if (files.length === 1) {
    downloadBlob(files[0].blob, files[0].name.replace(/(\.\w+)$/, ` ${stamp}$1`));
    return;
  }
  const { buildZip } = await import("./zipStore");
  const zip = await buildZip(files.map((f) => ({ name: `transcripts/${f.name}`, blob: f.blob })));
  downloadBlob(zip, `${files[0].name.replace(/\.txt$/, "")} ${stamp}.zip`);
}
