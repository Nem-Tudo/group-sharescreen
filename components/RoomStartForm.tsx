"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MdLock } from "react-icons/md";
import { GlobeIcon } from "@/components/icons";
import { ButtonSpinner } from "@/components/ButtonSpinner";
import { RecentRooms } from "@/components/RecentRooms";
import { trackEvent } from "@/lib/analytics";
import { ROOM_HANDLE_RE, roomTarget, type RoomMode } from "@/lib/roomForm";
import {
  ENFORCE_NEW_ROOM_CODE_SYSTEM,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  roomExists,
} from "@/lib/roomsApi";
import { useT } from "@/lib/useI18n";

// Starting a room, or walking into one — the home page's form, for the home
// inside the groups layout (experiment groups-hub, see GroupsHubHome). Same
// three modes and the same answers (lib/roomForm), drawn the groups' way: a
// card among cards, nothing about identity — inside the groups layout somebody
// already is someone, and a room with no name yet asks for one itself.

const ROOM_CHECK_DEBOUNCE_MS = 450;

function tabClass(selected: boolean): string {
  return `flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
    selected
      ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
      : "cursor-pointer border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
  }`;
}

function segmentClass(selected: boolean): string {
  return `inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
    selected
      ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
      : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
  }`;
}

export function RoomStartForm({
  onStart,
  autoFocus = false,
  layout = "stack",
}: {
  /** Told which kind of room is being opened, before the navigation. */
  onStart?: (mode: RoomMode) => void;
  autoFocus?: boolean;
  /**
   * `bar`: one line — public/private, the name, the button — with the recent
   * rooms as chips under it, for a page where the form is always on screen
   * but must not be the biggest thing on it (the groups home's central, see
   * components/groups/HubCentral). Same modes, same answers.
   */
  layout?: "stack" | "bar";
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<RoomMode>("public");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [navigating, setNavigating] = useState(false);
  // Every "does this public room exist?" answered this visit — see the home
  // page's roomExistsAnswers, which this mirrors.
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const trimmed = input.trim();
  const publicToCheck = mode === "public" && trimmed && ROOM_HANDLE_RE.test(trimmed) ? trimmed : null;
  const publicExists = publicToCheck ? answers[publicToCheck] ?? null : null;

  useEffect(() => {
    if (!publicToCheck || publicToCheck in answersRef.current) return;
    const handle = publicToCheck;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const exists = await roomExists(handle, controller.signal);
        setAnswers((prev) => ({ ...prev, [handle]: exists }));
      } catch {
        // Left unanswered: the button reads "Criar sala", and the click does the right thing either way.
      }
    }, ROOM_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [publicToCheck]);

  function switchMode(next: RoomMode) {
    setMode(next);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const target = roomTarget(mode, input);
    if (!target.ok) {
      setError(target.error);
      return;
    }
    if (target.needsCheck) {
      setChecking(true);
      try {
        if (!(await roomExists(target.handle))) {
          setError(t("page.roomNotFoundCheckTheName"));
          return;
        }
      } catch {
        setError(t("page.couldNotCheckTheRoomTry"));
        return;
      } finally {
        setChecking(false);
      }
    }
    if (mode === "private-create") trackEvent("room_create", { visibility: "private" });
    onStart?.(mode);
    setNavigating(true);
    router.push(`/watch/${target.handle}`);
  }

  const hint =
    mode === "public"
      ? t("page.itAppearsInThePublicRoom")
      : mode === "private-create"
        ? `${t("page.weGenerateACodeOf")} ${ROOM_CODE_LENGTH} ${t("page.digitsAndItBecomesPartOf")}`
        : ENFORCE_NEW_ROOM_CODE_SYSTEM
          ? t("page.pasteTheNameWithTheCode")
          : t("page.pasteTheRoomNameWithThe");
  const submitLabel =
    mode === "private-create"
      ? t("page.createPrivateRoom")
      : mode === "private-join"
        ? checking
          ? t("common.checking")
          : t("common.joinTheRoom")
        : publicExists === true
          ? t("common.joinTheRoom")
          : t("page.createRoom");

  if (layout === "bar") {
    return (
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800/70">
            <button type="button" onClick={() => switchMode("public")} aria-pressed={mode === "public"} className={segmentClass(mode === "public")}>
              <GlobeIcon className="h-4 w-4 shrink-0" />
              {t("page.public")}
            </button>
            <button
              type="button"
              onClick={() => switchMode("private-join")}
              aria-pressed={mode !== "public"}
              className={segmentClass(mode !== "public")}
            >
              <MdLock className="h-4 w-4 shrink-0" />
              {t("page.private")}
            </button>
          </div>
          <label htmlFor="hub-room" className="sr-only">
            {t("common.roomName")}
          </label>
          <input
            id="hub-room"
            autoFocus={autoFocus}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={mode === "private-create" ? MAX_PRIVATE_ROOM_NAME_LENGTH : 200}
            placeholder={mode === "private-join" ? t("page.exFamily123456OrLink") : t("page.exTeamMeetingOrLink")}
            className="min-w-48 flex-1 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={!trimmed || checking || navigating}
            className="flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {(checking || navigating) && <ButtonSpinner />}
            {submitLabel}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {mode !== "public" && (
            <div className="inline-flex shrink-0 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800/70">
              <button
                type="button"
                onClick={() => switchMode("private-join")}
                aria-pressed={mode === "private-join"}
                className={`${segmentClass(mode === "private-join")} !py-1 text-xs`}
              >
                {t("page.joinARoom")}
              </button>
              <button
                type="button"
                onClick={() => switchMode("private-create")}
                aria-pressed={mode === "private-create"}
                className={`${segmentClass(mode === "private-create")} !py-1 text-xs`}
              >
                {t("page.createRoom")}
              </button>
            </div>
          )}
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
          )}
        </div>
        <RecentRooms layout="chips" />
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <RecentRooms />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => switchMode("public")} aria-pressed={mode === "public"} className={tabClass(mode === "public")}>
          <GlobeIcon className="h-4 w-4 shrink-0" />
          {t("page.public")}
        </button>
        <button
          type="button"
          onClick={() => switchMode("private-join")}
          aria-pressed={mode !== "public"}
          className={tabClass(mode !== "public")}
        >
          <MdLock className="h-4 w-4 shrink-0" />
          {t("page.private")}
        </button>
      </div>
      {mode !== "public" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchMode("private-join")}
            aria-pressed={mode === "private-join"}
            className={tabClass(mode === "private-join")}
          >
            {t("page.joinARoom")}
          </button>
          <button
            type="button"
            onClick={() => switchMode("private-create")}
            aria-pressed={mode === "private-create"}
            className={tabClass(mode === "private-create")}
          >
            {t("page.createRoom")}
          </button>
        </div>
      )}
      <label htmlFor="hub-room" className="sr-only">
        {t("common.roomName")}
      </label>
      <input
        id="hub-room"
        autoFocus={autoFocus}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={mode === "private-create" ? MAX_PRIVATE_ROOM_NAME_LENGTH : 200}
        placeholder={mode === "private-join" ? t("page.exFamily123456OrLink") : t("page.exTeamMeetingOrLink")}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={!trimmed || checking || navigating}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {(checking || navigating) && <ButtonSpinner />}
        {submitLabel}
      </button>
    </form>
  );
}
