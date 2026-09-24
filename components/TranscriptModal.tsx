"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Tippy from "@tippyjs/react";
import { MdClose, MdContentCopy, MdLock, MdStop, MdSubtitles } from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import { Switch } from "@/components/CallRecordingModal";
import { markFeatureUsed } from "@/components/NewBadge";
import { formatDuration } from "@/components/RecordingModal";
import type { CallSource } from "@/lib/callRecording";
import { TRANSCRIPT_LANGUAGES, type TranscriptEntry, type TranscriptSettings } from "@/lib/callTranscript";
import { useFeature } from "@/lib/features";
import { formatLocale } from "@/lib/i18n";
import { openProModal } from "@/lib/proModal";
import { transcriptText } from "@/lib/transcriptExport";
import {
  CALL_TRANSCRIPT_CAPTIONS_FEATURE,
  CALL_TRANSCRIPT_EVENTS,
  CALL_TRANSCRIPT_FEATURE,
  trackTranscript,
  type CallTranscriptState,
} from "@/lib/useCallTranscript";
import { useT } from "@/lib/useI18n";

// "Transcrição" — its settings before it starts, and the conversation as it
// is written while it runs (with who to leave out still adjustable), then the
// download. See lib/callTranscript.ts for how the text is made.

function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames([formatLocale()], { type: "language" });
    const name = names.of(code) ?? code;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
}

export function ProMaxChip() {
  return (
    <span className="rounded bg-gradient-to-r from-amber-400 to-yellow-500 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-amber-950">
      Pro Max
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="mb-1.5 px-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-1.5">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[55%] rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Lines({ entries, settings }: { entries: TranscriptEntry[]; settings: TranscriptSettings }) {
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = entries.slice(-300);
  const origin = entries[0]?.at ?? 0;
  // Follows new lines only while the reader is already at the bottom.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);
  if (!entries.length) {
    return <p className="px-2 py-6 text-center text-sm text-zinc-400">{t("callTranscript.waitingForSpeech")}</p>;
  }
  return (
    <div ref={boxRef} className="max-h-64 overflow-y-auto rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900/60">
      {shown.map((e) => (
        <p key={e.id} className="mb-1.5 leading-snug text-zinc-800 dark:text-zinc-200">
          <span className="mr-1.5 text-xs tabular-nums text-zinc-400">{formatDuration(e.at - origin)}</span>
          <span className="font-semibold">{e.self ? `${e.name} (${t("common.you")})` : e.name}:</span> {e.text}
          {settings.translateTo !== "none" && e.translation && (
            <span className="block pl-4 text-zinc-500 dark:text-zinc-400">→ {e.translation}</span>
          )}
        </p>
      ))}
      <div ref={endRef} />
    </div>
  );
}

export function TranscriptModal({
  open,
  onClose,
  sources,
  transcript,
  allowed,
  free = false,
}: {
  open: boolean;
  onClose: () => void;
  sources: CallSource[];
  transcript: CallTranscriptState;
  // Pro Max (the "call_transcript" entitlement), or the free experiment.
  allowed: boolean;
  // Through the free experiment: nothing says "Pro Max".
  free?: boolean;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [copied, setCopied] = useState(false);
  const { settings, setSettings, status, entries, pending, lost, error, startedAt, ignored } = transcript;
  const busy = status !== "idle";

  useEffect(() => {
    if (!open || status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [open, status]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Everybody with a voice in the room, once each, for "ignorar".
  const people = useMemo(() => {
    const byOwner = new Map<string, { ownerId: string; name: string; self: boolean }>();
    for (const s of sources) {
      if (s.kind !== "voice" && !settings.includeScreenAudio) continue;
      if (!byOwner.has(s.ownerId)) byOwner.set(s.ownerId, { ownerId: s.ownerId, name: s.name, self: s.self });
    }
    return [...byOwner.values()].sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  }, [sources, settings.includeScreenAudio]);

  if (!open) return null;

  const languages = TRANSCRIPT_LANGUAGES.map((code) => ({ value: code, label: languageName(code) }));

  const start = () => {
    markFeatureUsed(CALL_TRANSCRIPT_FEATURE);
    setConfirmDiscard(false);
    void transcript.start("manual");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText(entries, settings, entries[0]?.at ?? Date.now(), Date.now()));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused; nothing to say.
    }
  };

  const peopleBlock = (
    <Section title={t("callTranscript.people")}>
      {people.length ? (
        people.map((p) => {
          const mine = p.self && !settings.includeMyVoice;
          return (
            <Switch
              key={p.ownerId}
              label={p.self ? `${p.name} (${t("common.you")})` : p.name}
              hint={mine ? t("callTranscript.myVoiceOff") : undefined}
              checked={!ignored.has(p.ownerId) && !mine}
              disabled={mine}
              onChange={() => transcript.toggleIgnored(p.ownerId)}
              onColor="bg-violet-600"
            />
          );
        })
      ) : (
        <p className="px-2 py-1.5 text-xs text-zinc-400">{t("callRecording.nobodyTalking")}</p>
      )}
      <p className="mt-1 px-2 text-xs text-zinc-400">{t("callTranscript.peopleHint")}</p>
    </Section>
  );

  let body: ReactNode;
  if (!allowed && free) {
    // Free for them, but it still needs an account (the API's budget is per
    // account) — a guest is told that, not sold a plan.
    body = (
      <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
        <MdLock className="h-8 w-8 text-zinc-400" />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{t("callTranscript.errorAccount")}</p>
      </div>
    );
  } else if (!allowed) {
    body = (
      <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
          <MdLock className="h-6 w-6" />
        </span>
        <p className="text-base font-semibold text-zinc-900 dark:text-white">{t("callTranscript.upsellTitle")}</p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{t("callTranscript.upsellText")}</p>
        <ul className="max-w-sm space-y-1 text-left text-sm text-zinc-700 dark:text-zinc-300">
          <li>• {t("callTranscript.upsellItem1")}</li>
          <li>• {t("callTranscript.upsellItem2")}</li>
          <li>• {t("callTranscript.upsellItem3")}</li>
          <li>• {t("callTranscript.upsellItem4")}</li>
        </ul>
        {/* The room's Pro popup, on the Pro Max card: a link would leave the
            call to read a price (see lib/proModal). */}
        <button
          type="button"
          onClick={() => {
            trackTranscript(CALL_TRANSCRIPT_EVENTS.upsellClick);
            onClose();
            openProModal("premium_max");
          }}
          className="mt-2 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-5 py-2.5 text-sm font-bold text-amber-950 shadow transition hover:brightness-105"
        >
          {t("callTranscript.upsellButton")}
        </button>
      </div>
    );
  } else if (status === "finishing") {
    body = (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t("callTranscript.finishing")}</p>
        <p className="text-xs text-zinc-500">{t("callTranscript.finishingHint")}</p>
      </div>
    );
  } else if (busy) {
    body = (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-50 px-3 py-2.5 dark:bg-violet-950/40">
          <span className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-violet-600" />
            {status === "starting" ? t("callRecording.starting") : t("callTranscript.running")}
            <span className="tabular-nums">{formatDuration(startedAt ? now - startedAt : 0)}</span>
          </span>
          <span className="text-xs text-violet-700/80 dark:text-violet-300/80">
            {pending > 0 ? t("callTranscript.pending", { count: pending }) : t("callTranscript.linesCount", { count: entries.length })}
          </span>
        </div>
        {transcript.owner === "recording" && (
          <p className="mb-3 px-2 text-xs text-zinc-500">{t("callTranscript.withRecording")}</p>
        )}
        {error && <ErrorBox error={error} />}
        {lost > 0 && <p className="mb-2 px-2 text-xs text-amber-600">{t("callTranscript.lost", { count: lost })}</p>}
        <div className="mb-1 flex items-center justify-between px-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">{t("callTranscript.conversation")}</h3>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <MdContentCopy className="h-3.5 w-3.5" />
              {copied ? t("callTranscript.copied") : t("callTranscript.copy")}
            </button>
          )}
        </div>
        <Lines entries={entries} settings={settings} />
        <div className="mt-4">{peopleBlock}</div>
      </>
    );
  } else {
    const translating = settings.translateTo !== "none";
    body = (
      <>
        {transcript.hasLastFiles && !error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span>{t("callTranscript.done")}</span>
            <button type="button" onClick={transcript.redownload} className="font-semibold hover:underline">
              {t("callRecording.downloadAgain")}
            </button>
          </div>
        )}
        {error && <ErrorBox error={error} />}

        <Section title={t("callTranscript.language")}>
          <Select
            label={t("callTranscript.spokenLanguage")}
            value={settings.language}
            options={[{ value: "auto", label: t("callTranscript.autoDetect") }, ...languages]}
            onChange={(language) => setSettings({ language })}
          />
          {settings.language === "auto" && (
            <p className="px-2 text-xs text-zinc-400">{t("callTranscript.autoDetectHint")}</p>
          )}
          <Select
            label={t("callTranscript.translateTo")}
            value={settings.translateTo}
            options={[{ value: "none", label: t("callTranscript.noTranslation") }, ...languages]}
            onChange={(translateTo) => setSettings({ translateTo })}
          />
          {translating && (
            <Switch
              label={t("callTranscript.keepOriginal")}
              hint={t("callTranscript.keepOriginalHint")}
              checked={settings.keepOriginal}
              onChange={(keepOriginal) => setSettings({ keepOriginal })}
              onColor="bg-violet-600"
            />
          )}
        </Section>

        <Section title={t("callTranscript.whatToTranscribe")}>
          <Switch
            label={t("callRecording.includeMyVoice")}
            checked={settings.includeMyVoice}
            onChange={(includeMyVoice) => setSettings({ includeMyVoice })}
            onColor="bg-violet-600"
          />
          <Switch
            label={t("callTranscript.includeScreenAudio")}
            hint={t("callTranscript.includeScreenAudioHint")}
            checked={settings.includeScreenAudio}
            onChange={(includeScreenAudio) => setSettings({ includeScreenAudio })}
            onColor="bg-violet-600"
          />
        </Section>

        {peopleBlock}

        <Section title={t("callTranscript.textSection")}>
          <Select
            label={t("callTranscript.timestamps")}
            value={settings.timestamps}
            options={[
              { value: "relative", label: t("callTranscript.timestampsRelative") },
              { value: "clock", label: t("callTranscript.timestampsClock") },
              { value: "none", label: t("callTranscript.timestampsNone") },
            ]}
            onChange={(timestamps) => setSettings({ timestamps: timestamps as TranscriptSettings["timestamps"] })}
          />
          <Switch
            label={t("callTranscript.mergeLines")}
            hint={t("callTranscript.mergeLinesHint")}
            checked={settings.mergeLines}
            onChange={(mergeLines) => setSettings({ mergeLines })}
            onColor="bg-violet-600"
          />
          <Switch
            label={t("callTranscript.separateFiles")}
            hint={t("callTranscript.separateFilesHint")}
            checked={settings.separateFiles}
            onChange={(separateFiles) => setSettings({ separateFiles })}
            onColor="bg-violet-600"
          />
          <Switch
            label={t("callTranscript.summary")}
            hint={t("callTranscript.summaryHint")}
            checked={settings.summary}
            onChange={(summary) => setSettings({ summary })}
            onColor="bg-violet-600"
          />
          <CaptionsSwitch
            checked={settings.liveCaptions}
            onChange={(liveCaptions) => setSettings({ liveCaptions })}
          />
          <div className="px-2 py-2">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200" htmlFor="transcript-vocabulary">
              {t("callTranscript.vocabulary")}
            </label>
            <input
              id="transcript-vocabulary"
              type="text"
              value={settings.vocabulary}
              maxLength={400}
              onChange={(e) => setSettings({ vocabulary: e.target.value })}
              placeholder={t("callTranscript.vocabularyPlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
            <p className="mt-1 text-xs text-zinc-400">{t("callTranscript.vocabularyHint")}</p>
          </div>
        </Section>

        <Section title={t("callTranscript.files")}>
          <p className="px-2 pb-1 text-xs text-zinc-500">{t("callTranscript.filesHint")}</p>
          <div className="flex flex-wrap gap-2 px-2">
            {(
              [
                ["srt", "SRT"],
                ["vtt", "VTT"],
                ["md", "Markdown"],
                ["json", "JSON"],
              ] as const
            ).map(([key, label]) => {
              const on = settings.formats[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSettings({ formats: { ...settings.formats, [key]: !on } })}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    on
                      ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Section>
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
        aria-label={t("callTranscript.title")}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
              <MdSubtitles className="h-5 w-5" />
            </span>
            {t("callTranscript.title")}
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

        {allowed && status !== "finishing" && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
            {!busy && <p className="text-xs text-zinc-500">{t("callTranscript.everyoneIsTold")}</p>}
            {busy ? (
              transcript.owner === "recording" ? (
                <p className="text-center text-xs text-zinc-500">{t("callTranscript.stopsWithRecording")}</p>
              ) : (
                <div className="flex gap-2">
                  {confirmDiscard ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDiscard(false);
                          transcript.discard();
                        }}
                        className="flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        {t("callTranscript.discardConfirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        {t("recording.cancel")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(true)}
                        disabled={status !== "running"}
                        className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        {t("callRecording.discard")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void transcript.stop()}
                        disabled={status !== "running"}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                      >
                        <MdStop className="h-5 w-5" />
                        {t("callRecording.stop")}
                      </button>
                    </>
                  )}
                </div>
              )
            ) : (
              <button
                type="button"
                onClick={start}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
              >
                <MdSubtitles className="h-5 w-5" />
                {t("callTranscript.start")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// "Legendas ao vivo", behind its own experiment. Its own component so the
// exposure is counted when the switch is actually on screen.
function CaptionsSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const t = useT();
  const available = useFeature(CALL_TRANSCRIPT_CAPTIONS_FEATURE, { track: true }).enabled;
  if (!available) {
    return (
      <Switch
        label={t("callTranscript.liveCaptions")}
        hint={t("callTranscript.liveCaptionsHint")}
        extra={
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {t("callTranscript.comingSoon")}
          </span>
        }
        checked={false}
        disabled
        onChange={() => {}}
        onColor="bg-violet-600"
      />
    );
  }
  return (
    <Switch
      label={t("callTranscript.liveCaptions")}
      hint={t("callTranscript.liveCaptionsHint")}
      checked={checked}
      onChange={onChange}
      onColor="bg-violet-600"
    />
  );
}

function ErrorBox({ error }: { error: NonNullable<CallTranscriptState["error"]> }) {
  const t = useT();
  const key =
    error === "daily-limit"
      ? "callTranscript.errorDailyLimit"
      : error === "pro-max-required"
        ? "callTranscript.errorProMax"
        : error === "account-required"
          ? "callTranscript.errorAccount"
          : error === "not-configured"
            ? "callTranscript.errorUnavailable"
            : error === "unsupported"
              ? "callRecording.unsupported"
              : "callTranscript.errorFailed";
  return (
    <p className="mb-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{t(key)}</p>
  );
}

/**
 * The last things said, over the room like subtitles, while a transcript
 * with "legendas ao vivo" runs. Never takes a click.
 */
export function LiveCaptions({ entries, translated }: { entries: TranscriptEntry[]; translated: boolean }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Lines arrive a few seconds after they were said; what counts is when
  // they came in, which the list's order reflects well enough.
  const recent = entries.filter((e) => now - e.end < 20_000).slice(-3);
  if (!recent.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 lg:bottom-8">
      <div className="max-w-3xl space-y-1 rounded-xl bg-black/75 px-4 py-2.5 text-center text-sm text-white shadow-lg backdrop-blur-sm sm:text-base">
        {recent.map((e) => (
          <p key={e.id} className="leading-snug">
            <span className="font-semibold text-violet-300">{e.self ? t("common.you") : e.name}:</span>{" "}
            {translated && e.translation ? e.translation : e.text}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * "Transcrição" in the account card (desktop), beside "Gravar chamada" —
 * quiet while idle, solid violet while it runs. Below lg it is a row in the
 * room's "⋯" menu instead.
 */
export function TranscriptButton({
  status,
  startedAt,
  onClick,
  badge,
  tip,
}: {
  status: CallTranscriptState["status"];
  startedAt: number | null;
  onClick: () => void;
  badge?: ReactNode;
  // The blue "novo" tip (see useTileExperimentTip), pinned over this button.
  tip?: { show: boolean; dismiss: () => void; clicked: () => void };
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const live = status !== "idle";
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);
  const text =
    status === "running"
      ? formatDuration(startedAt ? now - startedAt : 0)
      : status === "finishing"
        ? t("callRecording.exporting")
        : status === "starting"
          ? t("callRecording.starting")
          : t("callTranscript.title");
  return (
    <Tippy
      visible={Boolean(tip?.show)}
      placement="top"
      interactive
      theme="golive-panel"
      appendTo={() => document.body}
      content={
        <span
          role="status"
          className="relative block w-60 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
        >
          <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-blue-600" />
          <span className="flex items-start gap-2">
            <span className="flex-1">{t("watch.watchRoom.callTranscriptTip")}</span>
            <button
              type="button"
              onClick={tip?.dismiss}
              aria-label={t("watch.watchRoom.clipsModeTipDismiss")}
              className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
            >
              ✕
            </button>
          </span>
        </span>
      }
    >
      <span className="flex w-full min-w-0">
        <button
          type="button"
          onClick={() => {
            if (tip?.show) tip.clicked();
            onClick();
          }}
          aria-label={t("callTranscript.title")}
          className={`flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition [@media(max-height:52rem)]:py-1.5 ${
            live
              ? "border-violet-600 bg-violet-600 text-white shadow-sm shadow-violet-500/25 hover:bg-violet-700"
              : "border-zinc-200 bg-zinc-50 text-violet-600 hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-violet-400 dark:hover:border-violet-800 dark:hover:bg-violet-950/40"
          }`}
        >
          {live ? (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
          ) : (
            <MdSubtitles className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate tabular-nums">{text}</span>
          {!live && badge}
        </button>
      </span>
    </Tippy>
  );
}
