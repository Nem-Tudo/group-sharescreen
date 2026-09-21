"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MdClose } from "react-icons/md";
import { useFeature } from "@/lib/features";
import {
  GPU_SURVEY_FEATURE,
  dismissGpuShareSurvey,
  gpuShareSurveyStore,
  markGpuSurveyShown,
  submitGpuShareSurvey,
} from "@/lib/gpuShareSurvey";
import { useT } from "@/lib/useI18n";

// The questionnaire after a long GPU-captured share. When it appears, and why
// only once, is in lib/gpuShareSurvey.ts; this is only the asking.
//
// Everything is optional, including all of it. That is the opposite of the
// cancellation survey next door, and deliberately: that one is asked of
// somebody who is leaving anyway and its friction buys the answer. This one
// is asked of somebody who just finished doing something else and is probably
// mid-conversation with the room. The alternative to a skippable question
// here is not a better answer — it is a dialog people learn to close.
//
// So it is one screen, not four: the two questions that matter are one click
// each, the rest is there for whoever wants to say more, and "Enviar" only
// wakes up once something has been filled in.

/** "Melhor ou pior que a normal?" — the one answer worth having. */
const VERDICTS = ["much_better", "better", "same", "worse", "much_worse"] as const;
/** "Usaria de novo?" */
const AGAIN = ["yes", "unsure", "no"] as const;
/** "O que te fez ativar?" — more than one may be true. */
const REASONS = [
  "stutter",
  "quality",
  "performance",
  "recommended",
  "curious",
  "default_on",
  "other",
] as const;

const MAX_COMMENT = 1500;

export function GpuShareSurveyModal() {
  // track: false — the exposure belongs to useRoomMedia, where it counts
  // people who were actually capturing on the GPU rather than everybody who
  // opened a room.
  const feature = useFeature(GPU_SURVEY_FEATURE, { track: false });
  const survey = useSyncExternalStore(
    gpuShareSurveyStore.subscribe,
    gpuShareSurveyStore.get,
    () => null
  );
  const open = feature.enabled && survey !== null;
  if (!open) return null;
  // Keyed on the share it is about, so a second one starts blank rather than
  // reopening with somebody else's half-finished answers.
  return <SurveyForm key={`${survey.minutes}:${survey.encoder}`} minutes={survey.minutes} />;
}

function SurveyForm({ minutes }: { minutes: number }) {
  const t = useT();
  const [verdict, setVerdict] = useState<string | null>(null);
  const [again, setAgain] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  // One of the two chances this person gets, spent the moment it is on
  // screen — not on an answer. Somebody who saw it and closed it has been
  // asked, and asking again is exactly what this counts to avoid.
  useEffect(() => {
    markGpuSurveyShown();
  }, []);

  const answered = verdict !== null || again !== null || reasons.length > 0 || comment.trim().length > 0;

  function toggleReason(key: string) {
    setReasons((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
  }

  function send() {
    submitGpuShareSurvey({
      verdict: verdict ?? undefined,
      again: again ?? undefined,
      reasons: reasons.length > 0 ? reasons : undefined,
      comment: comment.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              {t("gpuShareSurvey.title")}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {t("gpuShareSurvey.subtitle", { minutes: String(minutes) })}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissGpuShareSurvey}
            aria-label={t("common.close")}
            className="-mr-1 shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <Question label={t("gpuShareSurvey.verdictQuestion")}>
            {VERDICTS.map((key) => (
              <Chip
                key={key}
                selected={verdict === key}
                // Clicking the chosen one again clears it: every question here
                // is skippable, and a radio group with no way back would make
                // the first stray click permanent.
                onClick={() => setVerdict((current) => (current === key ? null : key))}
              >
                {t(`gpuShareSurvey.verdict.${key}`)}
              </Chip>
            ))}
          </Question>

          <Question label={t("gpuShareSurvey.reasonsQuestion")}>
            {REASONS.map((key) => (
              <Chip key={key} selected={reasons.includes(key)} onClick={() => toggleReason(key)}>
                {t(`gpuShareSurvey.reason.${key}`)}
              </Chip>
            ))}
          </Question>

          <Question label={t("gpuShareSurvey.againQuestion")}>
            {AGAIN.map((key) => (
              <Chip
                key={key}
                selected={again === key}
                onClick={() => setAgain((current) => (current === key ? null : key))}
              >
                {t(`gpuShareSurvey.again.${key}`)}
              </Chip>
            ))}
          </Question>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {t("gpuShareSurvey.commentQuestion")}
            </span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, MAX_COMMENT))}
              rows={3}
              placeholder={t("gpuShareSurvey.commentPlaceholder")}
              className="mt-2 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
            />
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-500">{t("gpuShareSurvey.allOptional")}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={dismissGpuShareSurvey}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              {t("common.notNow")}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!answered}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
            >
              {t("gpuShareSurvey.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        selected
          ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}
