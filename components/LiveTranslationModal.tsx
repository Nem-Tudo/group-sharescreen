"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdLock, MdStop, MdTranslate, MdVolumeUp } from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import { Switch } from "@/components/CallRecordingModal";
import { markFeatureUsed } from "@/components/NewBadge";
import { formatDuration } from "@/components/RecordingModal";
import { ProMaxChip, Section, Select, languageName } from "@/components/TranscriptModal";
import type { CallSource } from "@/lib/callRecording";
import { TRANSCRIPT_LANGUAGES } from "@/lib/callTranscript";
import { openProModal } from "@/lib/proModal";
import { speechSupported, useBrowserVoices, voicesFor } from "@/lib/speechQueue";
import {
  LIVE_TRANSLATION_EVENTS,
  LIVE_TRANSLATION_FEATURE,
  trackTranslation,
  type LiveTranslationState,
  type TranslatedLine,
} from "@/lib/useLiveTranslation";
import { useT } from "@/lib/useI18n";

// "Tradução ao vivo" — its settings, and while it runs the conversation in
// your language. See lib/useLiveTranslation.ts.

// Said in the language being translated into — the point is to hear that
// language's voice, whatever the site's own language is.
const TEST_SENTENCES: Record<string, string> = {
  pt: "Olá! É assim que a tradução vai soar.",
  en: "Hi! This is how the translation will sound.",
  es: "¡Hola! Así es como sonará la traducción.",
  fr: "Bonjour ! Voici comment la traduction va sonner.",
  de: "Hallo! So wird die Übersetzung klingen.",
  it: "Ciao! Ecco come suonerà la traduzione.",
  nl: "Hallo! Zo gaat de vertaling klinken.",
  pl: "Cześć! Tak będzie brzmiało tłumaczenie.",
  ru: "Привет! Так будет звучать перевод.",
  uk: "Привіт! Ось так звучатиме переклад.",
  tr: "Merhaba! Çeviri böyle duyulacak.",
  ar: "مرحبًا! هكذا ستبدو الترجمة.",
  hi: "नमस्ते! अनुवाद ऐसा सुनाई देगा।",
  ja: "こんにちは！翻訳はこのように聞こえます。",
  ko: "안녕하세요! 번역은 이렇게 들립니다.",
  zh: "你好！翻译听起来会是这样。",
  id: "Halo! Beginilah terjemahannya akan terdengar.",
  vi: "Xin chào! Bản dịch sẽ nghe như thế này.",
  sv: "Hej! Så här kommer översättningen att låta.",
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-2 py-1.5">
      <span className="w-40 shrink-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-sky-600"
      />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">{format(value)}</span>
    </label>
  );
}

export function LiveTranslationModal({
  open,
  onClose,
  sources,
  translation,
  allowed,
  free = false,
}: {
  open: boolean;
  onClose: () => void;
  sources: CallSource[];
  translation: LiveTranslationState;
  // Pro Max ("live_translation"), or the free experiment.
  allowed: boolean;
  free?: boolean;
}) {
  const t = useT();
  const voices = useBrowserVoices();
  const [now, setNow] = useState(() => Date.now());
  const { settings, setSettings, status, lines, error, startedAt, ignored } = translation;
  const running = status === "running";

  useEffect(() => {
    if (!open || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [open, running]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const people = useMemo(() => {
    const byOwner = new Map<string, { ownerId: string; name: string }>();
    for (const s of sources) {
      if (s.self || (s.kind !== "voice" && !settings.includeScreenAudio)) continue;
      if (!byOwner.has(s.ownerId)) byOwner.set(s.ownerId, { ownerId: s.ownerId, name: s.name });
    }
    return [...byOwner.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [sources, settings.includeScreenAudio]);

  if (!open) return null;

  const languages = TRANSCRIPT_LANGUAGES.map((code) => ({ value: code, label: languageName(code) }));
  const targetVoices = voicesFor(voices, settings.target);
  const canSpeak = speechSupported();

  const voiceBlock = (
    <Section title={t("liveTranslation.voiceSection")}>
      <Switch
        label={t("liveTranslation.speak")}
        hint={canSpeak ? t("liveTranslation.speakHint") : t("liveTranslation.speakUnsupported")}
        checked={settings.speak && canSpeak}
        disabled={!canSpeak}
        onChange={(speak) => setSettings({ speak })}
        onColor="bg-sky-600"
      />
      {settings.speak && canSpeak && (
        <>
          <div className="px-2 py-1.5">
            <p className="mb-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">{t("liveTranslation.voiceKind")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={settings.voiceKind === "browser"}
                onClick={() => setSettings({ voiceKind: "browser" })}
                className={`flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition ${
                  settings.voiceKind === "browser"
                    ? "border-sky-500 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"
                }`}
              >
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("liveTranslation.voiceBrowser")}</span>
                <span className="text-xs text-zinc-500">{t("liveTranslation.voiceBrowserHint")}</span>
              </button>
              {/* The natural voice is the next step (Pro Ultra); shown now so
                  the choice is visible, but it cannot be picked yet. */}
              <div
                aria-disabled="true"
                className="flex cursor-not-allowed flex-col gap-0.5 rounded-xl border border-zinc-200 p-2.5 text-left opacity-60 dark:border-zinc-800"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("liveTranslation.voiceNatural")}
                  <span className="rounded bg-gradient-to-r from-rose-500 to-fuchsia-600 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
                    Pro Ultra
                  </span>
                </span>
                <span className="text-xs text-zinc-500">{t("callTranscript.comingSoon")}</span>
              </div>
            </div>
          </div>
          <Select
            label={t("liveTranslation.voice")}
            value={settings.voiceURI}
            options={[
              { value: "", label: t("liveTranslation.voiceAuto") },
              ...targetVoices.map((v) => ({ value: v.voiceURI, label: `${v.name}` })),
            ]}
            onChange={(voiceURI) => setSettings({ voiceURI })}
          />
          {!targetVoices.length && (
            <p className="px-2 text-xs text-amber-600">{t("liveTranslation.noVoice")}</p>
          )}
          <Slider
            label={t("liveTranslation.rate")}
            value={settings.rate}
            min={0.7}
            max={1.8}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(rate) => setSettings({ rate })}
          />
          <Slider
            label={t("liveTranslation.duck")}
            value={settings.duck}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(duck) => setSettings({ duck })}
          />
          <p className="px-2 text-xs text-zinc-400">{t("liveTranslation.duckHint")}</p>
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={() => translation.testVoice(TEST_SENTENCES[settings.target] ?? TEST_SENTENCES.en)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <MdVolumeUp className="h-4 w-4" />
              {t("liveTranslation.testVoice")}
            </button>
          </div>
        </>
      )}
    </Section>
  );

  const peopleBlock = (
    <Section title={t("callTranscript.people")}>
      {people.length ? (
        people.map((p) => (
          <Switch
            key={p.ownerId}
            label={p.name}
            checked={!ignored.has(p.ownerId)}
            onChange={() => translation.toggleIgnored(p.ownerId)}
            onColor="bg-sky-600"
          />
        ))
      ) : (
        <p className="px-2 py-1.5 text-xs text-zinc-400">{t("callRecording.nobodyTalking")}</p>
      )}
      <p className="mt-1 px-2 text-xs text-zinc-400">{t("liveTranslation.peopleHint")}</p>
    </Section>
  );

  const settingsBlock = (
    <>
      <Section title={t("callTranscript.language")}>
        <Select
          label={t("liveTranslation.target")}
          value={settings.target}
          options={languages}
          onChange={(target) => setSettings({ target, voiceURI: "" })}
        />
        <p className="px-2 text-xs text-zinc-400">{t("liveTranslation.targetHint")}</p>
      </Section>
      {voiceBlock}
      <Section title={t("liveTranslation.captionsSection")}>
        <Switch
          label={t("liveTranslation.captions")}
          checked={settings.captions}
          onChange={(captions) => setSettings({ captions })}
          onColor="bg-sky-600"
        />
        <Switch
          label={t("liveTranslation.showOriginal")}
          hint={t("liveTranslation.showOriginalHint")}
          checked={settings.showOriginal}
          onChange={(showOriginal) => setSettings({ showOriginal })}
          onColor="bg-sky-600"
        />
        <Switch
          label={t("callTranscript.includeScreenAudio")}
          hint={t("liveTranslation.includeScreenAudioHint")}
          checked={settings.includeScreenAudio}
          onChange={(includeScreenAudio) => setSettings({ includeScreenAudio })}
          onColor="bg-sky-600"
        />
      </Section>
      {peopleBlock}
    </>
  );

  let body;
  if (!allowed && free) {
    body = (
      <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
        <MdLock className="h-8 w-8 text-zinc-400" />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("liveTranslation.errorAccount")}</p>
      </div>
    );
  } else if (!allowed) {
    body = (
      <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
          <MdLock className="h-6 w-6" />
        </span>
        <p className="text-base font-semibold text-zinc-900 dark:text-white">{t("liveTranslation.upsellTitle")}</p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{t("liveTranslation.upsellText")}</p>
        <button
          type="button"
          onClick={() => {
            trackTranslation(LIVE_TRANSLATION_EVENTS.upsellClick);
            onClose();
            openProModal("premium_max");
          }}
          className="mt-2 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-5 py-2.5 text-sm font-bold text-amber-950 shadow transition hover:brightness-105"
        >
          {t("callTranscript.upsellButton")}
        </button>
      </div>
    );
  } else if (running) {
    body = (
      <>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2.5 dark:bg-sky-950/40">
          <span className="flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-600" />
            {t("liveTranslation.running", { language: languageName(settings.target) })}
          </span>
          <span className="text-sm tabular-nums text-sky-700 dark:text-sky-300">
            {formatDuration(startedAt ? now - startedAt : 0)}
          </span>
        </div>
        {error && <TranslationError error={error} />}
        <TranslatedLines lines={lines} showOriginal={settings.showOriginal} />
        <div className="mt-4">{settingsBlock}</div>
      </>
    );
  } else {
    body = (
      <>
        {error && <TranslationError error={error} />}
        {settingsBlock}
      </>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("liveTranslation.title")}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              <MdTranslate className="h-5 w-5" />
            </span>
            {t("liveTranslation.title")}
            <span className="text-[10px] font-bold leading-none">
              <BetaMark />
            </span>
            {!free && <ProMaxChip />}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{body}</div>

        {allowed && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
            {!running && <p className="text-xs text-zinc-500">{t("liveTranslation.everyoneIsTold")}</p>}
            {running ? (
              <button
                type="button"
                onClick={translation.stop}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                <MdStop className="h-5 w-5" />
                {t("liveTranslation.stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  markFeatureUsed(LIVE_TRANSLATION_FEATURE);
                  translation.start();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                <MdTranslate className="h-5 w-5" />
                {t("liveTranslation.start")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function TranslationError({ error }: { error: NonNullable<LiveTranslationState["error"]> }) {
  const t = useT();
  const key =
    error === "daily-limit"
      ? "liveTranslation.errorDailyLimit"
      : error === "pro-max-required"
        ? "callTranscript.errorProMax"
        : error === "account-required"
          ? "liveTranslation.errorAccount"
          : error === "not-configured"
            ? "callTranscript.errorUnavailable"
            : error === "unsupported"
              ? "callRecording.unsupported"
              : "callTranscript.errorFailed";
  return <p className="mb-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{t(key)}</p>;
}

function TranslatedLines({ lines, showOriginal }: { lines: TranslatedLine[]; showOriginal: boolean }) {
  const t = useT();
  if (!lines.length) {
    return <p className="px-2 py-6 text-center text-sm text-zinc-400">{t("callTranscript.waitingForSpeech")}</p>;
  }
  return (
    <div className="flex max-h-64 flex-col-reverse overflow-y-auto rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900/60">
      <div>
        {lines.slice(-100).map((line) => (
          <p key={line.id} className="mb-1.5 leading-snug text-zinc-800 dark:text-zinc-200">
            <span className="font-semibold">{line.name}:</span>{" "}
            {line.translated ?? <span className="text-zinc-400">{line.original}</span>}
            {showOriginal && line.translated && line.translated !== line.original && (
              <span className="block pl-4 text-xs text-zinc-500 dark:text-zinc-400">{line.original}</span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The last translated lines over the room, like subtitles. Never takes a click. */
export function TranslationCaptions({ lines, showOriginal }: { lines: TranslatedLine[]; showOriginal: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const recent = lines.filter((l) => l.translated && l.shownAt && now - l.shownAt < 9_000).slice(-2);
  if (!recent.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 lg:bottom-8">
      <div className="max-w-3xl space-y-1.5 rounded-xl bg-black/80 px-4 py-2.5 text-center text-white shadow-lg backdrop-blur-sm">
        {recent.map((l) => (
          <p key={l.id} className="text-base leading-snug sm:text-lg">
            <span className="font-semibold text-sky-300">{l.name}:</span> {l.translated}
            {showOriginal && l.translated !== l.original && (
              <span className="block text-xs text-white/60 sm:text-sm">{l.original}</span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}
