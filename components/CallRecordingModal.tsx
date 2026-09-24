"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdFiberManualRecord, MdMic, MdScreenShare, MdStop, MdVideocam } from "react-icons/md";
import { markFeatureUsed } from "@/components/NewBadge";
import { formatDuration } from "@/components/RecordingModal";
import type { CallExport, CallRecordingSettings, CallSource } from "@/lib/callRecording";
import { CALL_RECORDING_FEATURE, useCallRecording } from "@/lib/useCallRecording";
import { useT } from "@/lib/useI18n";

// "Gravar chamada" — the settings before it starts, and the recording itself
// once it has (timer, the volumes still adjustable, stop), then the export's
// progress. See lib/callRecording.ts for what each option produces.

const SETTINGS_KEY = "sharescreen:callRecordingSettings";
const DEFAULT_SETTINGS: CallRecordingSettings = {
  separateTracks: false,
  includeMyVoice: true,
  includeMyScreen: true,
  output: "video",
};

function readSettings(): CallRecordingSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<CallRecordingSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: CallRecordingSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage refused — the choices just won't be remembered.
  }
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-900"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-red-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[1.125rem]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

function VolumeRow({
  source,
  value,
  silent,
  onChange,
}: {
  source: CallSource;
  value: number;
  silent: boolean;
  onChange: (value: number) => void;
}) {
  const t = useT();
  const Icon = source.kind === "voice" ? MdMic : source.kind === "camera" ? MdVideocam : MdScreenShare;
  const label = source.self ? `${source.name} (${t("common.you")})` : source.name;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="w-28 shrink-0 truncate text-sm text-zinc-700 sm:w-36 dark:text-zinc-300" title={label}>
        {label}
      </span>
      {silent ? (
        <span className="flex-1 text-xs text-zinc-400">{t("callRecording.noSound")}</span>
      ) : (
        <>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={Math.round(value * 100)}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            aria-label={t("callRecording.volumeOf", { name: label })}
            className="min-w-0 flex-1 accent-red-600"
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500">{Math.round(value * 100)}%</span>
        </>
      )}
    </div>
  );
}

// The red button that opens it: beside "Modo Streamer" in the account card
// (desktop), and as a tile in the pull-up menu (phone). While recording it
// becomes the timer, and still opens the modal — that is where "parar" is.
export function CallRecordButton({
  variant,
  status,
  startedAt,
  onClick,
  badge,
}: {
  variant: "card" | "tile";
  status: ReturnType<typeof useCallRecording>["status"];
  startedAt: number | null;
  onClick: () => void;
  badge?: ReactNode;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const live = status === "recording" || status === "starting" || status === "finishing";
  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);
  const text =
    status === "finishing"
      ? t("callRecording.exporting")
      : status === "recording"
        ? formatDuration(startedAt ? now - startedAt : 0)
        : status === "starting"
          ? t("callRecording.starting")
          : t("callRecording.button");
  const dot = live ? (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
    </span>
  ) : null;

  if (variant === "tile") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={t("callRecording.title")}
        className={`flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 shadow-sm transition active:scale-95 ${
          live
            ? "border-red-500/60 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        }`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white">
          {live ? dot : <MdFiberManualRecord className="h-5 w-5" />}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-center text-[11px] font-semibold leading-tight tabular-nums">{text}</span>
          {!live && badge}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("callRecording.title")}
      className="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-red-600 bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-red-500/25 transition hover:bg-red-700 [@media(max-height:52rem)]:py-1.5"
    >
      {dot ?? <MdFiberManualRecord className="h-4 w-4 shrink-0" />}
      <span className="truncate tabular-nums">{text}</span>
      {!live && badge}
    </button>
  );
}

export function CallRecordingModal({
  open,
  onClose,
  sources,
  recording,
}: {
  open: boolean;
  onClose: () => void;
  sources: CallSource[];
  recording: ReturnType<typeof useCallRecording>;
}) {
  const t = useT();
  // Mounted with the room and closed, so reading storage here is client-only
  // in practice; nothing it holds is rendered until the modal opens.
  const [settings, setSettings] = useState<CallRecordingSettings>(() =>
    typeof window === "undefined" ? DEFAULT_SETTINGS : readSettings(),
  );
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { status, startedAt, progress, error, result } = recording;
  const busy = status === "recording" || status === "starting" || status === "finishing";

  useEffect(() => {
    if (!open || status !== "recording") return;
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

  if (!open) return null;

  const update = (patch: Partial<CallRecordingSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeSettings(next);
  };
  const setVolume = (id: string, value: number) => {
    setVolumes((prev) => ({ ...prev, [id]: value }));
    recording.setVolume(id, value);
  };

  const shown = sources.filter((s) =>
    !s.self ? true : s.kind === "voice" ? settings.includeMyVoice : settings.includeMyScreen,
  );
  const voices = shown.filter((s) => s.kind === "voice");
  const screens = shown.filter((s) => s.kind !== "voice");

  const outputs: { value: CallExport; title: string; text: string }[] = [
    { value: "video", title: t("callRecording.outputVideo"), text: t("callRecording.outputVideoText") },
    { value: "zip", title: t("callRecording.outputZip"), text: t("callRecording.outputZipText") },
    { value: "both", title: t("callRecording.outputBoth"), text: t("callRecording.outputBothText") },
  ];

  const start = () => {
    markFeatureUsed(CALL_RECORDING_FEATURE);
    setConfirmDiscard(false);
    void recording.start(settings, volumes);
  };

  const volumesBlock = (
    <>
      <h3 className="mb-1 mt-4 px-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
        {t("callRecording.voiceVolumes")}
      </h3>
      {voices.length ? (
        voices.map((s) => (
          <VolumeRow key={s.id} source={s} value={volumes[s.id] ?? 1} silent={false} onChange={(v) => setVolume(s.id, v)} />
        ))
      ) : (
        <p className="px-2 py-1.5 text-xs text-zinc-400">{t("callRecording.nobodyTalking")}</p>
      )}
      <h3 className="mb-1 mt-3 px-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
        {t("callRecording.screenVolumes")}
      </h3>
      {screens.length ? (
        screens.map((s) => (
          <VolumeRow
            key={s.id}
            source={s}
            value={volumes[s.id] ?? 1}
            silent={s.stream.getAudioTracks().length === 0}
            onChange={(v) => setVolume(s.id, v)}
          />
        ))
      ) : (
        <p className="px-2 py-1.5 text-xs text-zinc-400">{t("callRecording.noScreens")}</p>
      )}
      <p className="mt-2 px-2 text-xs text-zinc-400">{t("callRecording.latecomersHint")}</p>
    </>
  );

  let body;
  if (status === "finishing") {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t("callRecording.finishing")}</p>
        <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-red-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="text-xs text-zinc-500">{t("callRecording.finishingHint")}</p>
      </div>
    );
  } else if (status === "recording" || status === "starting") {
    body = (
      <>
        <div className="flex flex-col items-center gap-1 rounded-xl bg-red-50 py-5 dark:bg-red-950/40">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            {status === "starting" ? t("callRecording.starting") : t("callRecording.recording")}
          </span>
          <span className="text-3xl font-bold tabular-nums text-red-700 dark:text-red-300">
            {formatDuration(startedAt ? now - startedAt : 0)}
          </span>
        </div>
        {volumesBlock}
      </>
    );
  } else {
    body = (
      <>
        {result && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span>{t("callRecording.done", { name: result.fileName })}</span>
            <button type="button" onClick={recording.redownload} className="font-semibold hover:underline">
              {t("callRecording.downloadAgain")}
            </button>
          </div>
        )}
        {error && (
          <p className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error === "unsupported" ? t("callRecording.unsupported") : t("callRecording.failed")}
          </p>
        )}

        <h3 className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          {t("callRecording.exportAs")}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {outputs.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => update({ output: o.value })}
              aria-pressed={settings.output === o.value}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
                settings.output === o.value
                  ? "border-red-500 bg-red-50 dark:border-red-700 dark:bg-red-950/40"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
              }`}
            >
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{o.title}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{o.text}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col">
          <Switch
            label={t("callRecording.separateTracks")}
            hint={
              settings.separateTracks
                ? settings.output === "video"
                  ? t("callRecording.separateOnVideo")
                  : t("callRecording.separateOnZip")
                : t("callRecording.separateOff")
            }
            checked={settings.separateTracks}
            onChange={(v) => update({ separateTracks: v })}
          />
          <Switch
            label={t("callRecording.includeMyVoice")}
            checked={settings.includeMyVoice}
            onChange={(v) => update({ includeMyVoice: v })}
          />
          <Switch
            label={t("callRecording.includeMyScreen")}
            hint={t("callRecording.includeMyScreenHint")}
            checked={settings.includeMyScreen}
            onChange={(v) => update({ includeMyScreen: v })}
          />
        </div>

        {volumesBlock}
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
        aria-label={t("callRecording.title")}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white">
              <MdFiberManualRecord className="h-5 w-5" />
            </span>
            {t("callRecording.title")}
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

        {status !== "finishing" && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
            {!busy && <p className="text-xs text-zinc-500">{t("callRecording.everyoneIsTold")}</p>}
            {busy ? (
              <div className="flex gap-2">
                {confirmDiscard ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDiscard(false);
                        recording.discard();
                      }}
                      className="flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      {t("callRecording.discardConfirm")}
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
                      disabled={status !== "recording"}
                      className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      {t("callRecording.discard")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void recording.stop()}
                      disabled={status !== "recording"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                    >
                      <MdStop className="h-5 w-5" />
                      {t("callRecording.stop")}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={start}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <MdFiberManualRecord className="h-5 w-5" />
                {t("callRecording.start")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
