"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CallSource } from "./callRecording";
import type { TranscriberError } from "./callTranscript";
import { trackFeatureEvent } from "./features";
import { getLocale } from "./i18n";
import { LineTranslator } from "./lineTranslator";
import { liveTranscriptHub, type ConsumerSubject } from "./liveTranscriptShare";
import { announceRecording } from "./recordingNotice";
import { SpeechQueue } from "./speechQueue";

// "Tradução ao vivo": what the others say, in your language, as captions and
// read aloud while their own voice is turned down. The lines come from the
// room's shared transcript (lib/liveTranscriptShare) in real-time mode; this
// only translates them (the API's /transcribe/translate) and reads them with
// the browser's voices (lib/speechQueue).
//
// Pro Max, or the free experiment; the API is what enforces it.

export const LIVE_TRANSLATION_FEATURE = "room-live-translation";
export const LIVE_TRANSLATION_FREE_FEATURE = "room-live-translation-free";

// Every name has to be listed in the feature's "site events" to count.
export const LIVE_TRANSLATION_EVENTS = {
  open: "translation_open",
  upsell: "translation_upsell",
  upsellClick: "translation_upsell_click",
  start: "translation_start", // value: 1 when read aloud
  stop: "translation_stop", // value: minutes
  lines: "translation_lines", // value: lines translated in the session
  voiceTest: "translation_voice_test",
  ignorePerson: "translation_ignore_person",
  dailyLimit: "translation_daily_limit",
  failed: "translation_failed",
} as const;

export function trackTranslation(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: LIVE_TRANSLATION_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

export type LiveTranslationSettings = {
  // The language everything is translated into.
  target: string;
  // Read aloud, not only captions.
  speak: boolean;
  // "browser" now; "natural" (Pro Ultra) later.
  voiceKind: "browser" | "natural";
  // A browser voice's voiceURI, or "" for the best one.
  voiceURI: string;
  rate: number;
  // The speaker's own voice while their translation is read: 0–1.
  duck: number;
  captions: boolean;
  // The original line under the translation.
  showOriginal: boolean;
  // Also what plays in screens and videos.
  includeScreenAudio: boolean;
};

export const DEFAULT_TRANSLATION_SETTINGS: LiveTranslationSettings = {
  target: "pt",
  speak: true,
  voiceKind: "browser",
  voiceURI: "",
  rate: 1.1,
  duck: 0.25,
  captions: true,
  showOriginal: false,
  includeScreenAudio: false,
};

const SETTINGS_KEY = "sharescreen:liveTranslationSettings";
const MAX_NOTIFIED = 25;
const KEEP_LINES = 200;

function readSettings(): LiveTranslationSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TRANSLATION_SETTINGS, target: getLocale() };
    return { ...DEFAULT_TRANSLATION_SETTINGS, ...(JSON.parse(raw) as Partial<LiveTranslationSettings>) };
  } catch {
    return DEFAULT_TRANSLATION_SETTINGS;
  }
}

export type TranslatedLine = {
  id: number;
  ownerId: string;
  name: string;
  original: string;
  // null while on its way; the original itself when it was already in the
  // target language.
  translated: string | null;
  at: number;
  // Arrived as a finished line (translated or not needed) at this moment.
  shownAt: number | null;
};

export type LiveTranslationStatus = "idle" | "running";
export type LiveTranslationError = TranscriberError | "failed" | null;

export function useLiveTranslation(options: { roomPeerIds: string[]; sources: CallSource[] }) {
  const [settings, setSettingsState] = useState<LiveTranslationSettings>(() =>
    typeof window === "undefined" ? DEFAULT_TRANSLATION_SETTINGS : readSettings(),
  );
  const settingsRef = useRef(settings);
  const [status, setStatus] = useState<LiveTranslationStatus>("idle");
  const [lines, setLines] = useState<TranslatedLine[]>([]);
  const [error, setError] = useState<LiveTranslationError>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Whose voice is being read right now (their ownerId), for ducking.
  const [speakingOwner, setSpeakingOwner] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const ignoredRef = useRef(ignored);
  const sessionRef = useRef<{
    handle: ReturnType<typeof liveTranscriptHub.register>;
    translator: LineTranslator;
    speech: SpeechQueue;
    lines: TranslatedLine[];
    count: number;
  } | null>(null);

  const setSettings = useCallback((patch: Partial<LiveTranslationSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, that's all.
      }
      return next;
    });
  }, []);

  // Voice, speed and what is wanted apply at once to a running session.
  useEffect(() => {
    settingsRef.current = settings;
    const session = sessionRef.current;
    if (!session) return;
    session.speech.configure({ lang: settings.target, voiceURI: settings.voiceURI, rate: settings.rate });
    // "Ler em voz alta" turned off mid-sentence: quiet at once, captions go on.
    if (!settings.speak) session.speech.clear();
    session.translator.setTarget(settings.target);
    session.handle.update({});
  }, [settings]);

  const toggleIgnored = useCallback((ownerId: string) => {
    const next = new Set(ignoredRef.current);
    if (next.has(ownerId)) next.delete(ownerId);
    else {
      next.add(ownerId);
      trackTranslation(LIVE_TRANSLATION_EVENTS.ignorePerson);
    }
    ignoredRef.current = next;
    sessionRef.current?.handle.update({});
    setIgnored(next);
  }, []);

  const start = useCallback(() => {
    if (sessionRef.current) return;
    const initial = settingsRef.current;
    const list: TranslatedLine[] = [];
    let emitQueued = false;
    const emit = () => {
      if (emitQueued) return;
      emitQueued = true;
      queueMicrotask(() => {
        emitQueued = false;
        if (sessionRef.current?.lines === list) setLines([...list]);
      });
    };
    const speech = new SpeechQueue({
      lang: initial.target,
      voiceURI: initial.voiceURI,
      rate: initial.rate,
      onSpeaking: (owner) => setSpeakingOwner(owner),
    });
    const finished = (line: TranslatedLine, text: string) => {
      line.translated = text;
      line.shownAt = Date.now();
      if (sessionRef.current) sessionRef.current.count++;
      const current = settingsRef.current;
      if (current.speak && !ignoredRef.current.has(line.ownerId)) speech.say(text, line.ownerId);
      emit();
    };
    const translator = new LineTranslator(
      initial.target,
      (id, text) => {
        const line = list.find((l) => l.id === id);
        if (line && line.translated === null) finished(line, text);
      },
      // Real time: a line goes almost alone.
      80,
      () => {
        setError("daily-limit");
        trackTranslation(LIVE_TRANSLATION_EVENTS.dailyLimit);
      },
    );
    const wants = (subject: ConsumerSubject) => {
      if (subject.self || ignoredRef.current.has(subject.ownerId)) return false;
      return subject.kind === "voice" || settingsRef.current.includeScreenAudio;
    };
    const handle = liveTranscriptHub.register({
      wants,
      live: true,
      language: "auto",
      vocabulary: "",
      onLine: (shared) => {
        const line: TranslatedLine = {
          id: shared.id,
          ownerId: shared.ownerId,
          name: shared.name,
          original: shared.text,
          translated: null,
          at: shared.at,
          shownAt: null,
        };
        list.push(line);
        if (list.length > KEEP_LINES) list.splice(0, list.length - KEEP_LINES);
        // Already in the language wanted: nothing to translate or read.
        if (shared.language && shared.language === settingsRef.current.target) {
          line.translated = shared.text;
          line.shownAt = Date.now();
          emit();
          return;
        }
        translator.add(line.id, line.original);
        emit();
      },
      onFatal: (reason) => {
        setError(reason);
        if (reason === "daily-limit") trackTranslation(LIVE_TRANSLATION_EVENTS.dailyLimit);
        else trackTranslation(LIVE_TRANSLATION_EVENTS.failed);
      },
    });
    sessionRef.current = { handle, translator, speech, lines: list, count: 0 };
    setLines([]);
    setError(null);
    setStartedAt(Date.now());
    setStatus("running");
    trackTranslation(LIVE_TRANSLATION_EVENTS.start, initial.speak ? 1 : undefined);
  }, []);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    session.translator.stop();
    session.speech.stop();
    void session.handle.unregister();
    if (startedAt) trackTranslation(LIVE_TRANSLATION_EVENTS.stop, (Date.now() - startedAt) / 60_000);
    if (session.count) trackTranslation(LIVE_TRANSLATION_EVENTS.lines, session.count);
    setStatus("idle");
    setStartedAt(null);
    setSpeakingOwner(null);
  }, [startedAt]);

  const testVoice = useCallback((text: string) => {
    const current = settingsRef.current;
    const speech = sessionRef.current?.speech ?? new SpeechQueue({ ...current, lang: current.target, onSpeaking: () => {} });
    speech.configure({ lang: current.target, voiceURI: current.voiceURI, rate: current.rate });
    speech.test(text);
    trackTranslation(LIVE_TRANSLATION_EVENTS.voiceTest);
  }, []);

  // Everybody whose voice is being translated is told, like a recording.
  const owners =
    status === "running"
      ? [
          ...new Set([
            ...options.sources
              .filter((s) => !s.self && !ignored.has(s.ownerId) && (s.kind === "voice" || settings.includeScreenAudio))
              .map((s) => s.ownerId)
              .sort(),
            ...[...options.roomPeerIds].sort(),
          ]),
        ]
          .slice(0, MAX_NOTIFIED)
          .join(",")
      : "";
  const noticesRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const wanted = new Set(owners ? owners.split(",") : []);
    const notices = noticesRef.current;
    for (const [id, stopNotice] of notices) {
      if (!wanted.has(id)) {
        stopNotice();
        notices.delete(id);
      }
    }
    for (const id of wanted) if (!notices.has(id)) notices.set(id, announceRecording(id, "translation"));
  }, [owners]);

  // Leaving the room stops it.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(
    () => () => {
      for (const stopNotice of noticesRef.current.values()) stopNotice();
      noticesRef.current.clear();
      stopRef.current();
    },
    [],
  );

  return {
    settings,
    setSettings,
    status,
    lines,
    error,
    startedAt,
    ignored,
    toggleIgnored,
    // Whose own voice to turn down now, and by how much.
    duck: speakingOwner && settings.speak ? { ownerId: speakingOwner, volume: settings.duck } : null,
    start,
    stop,
    testVoice,
    clearError: () => setError(null),
  };
}

export type LiveTranslationState = ReturnType<typeof useLiveTranslation>;
