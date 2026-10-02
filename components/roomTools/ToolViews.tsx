"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MdAdd, MdCheck, MdClose, MdDeleteSweep, MdEvent, MdFileDownload, MdSettings, MdTune, MdUndo } from "react-icons/md";
import {
  CODE_LANGUAGES,
  onRemoteTextOp,
  roomTools,
  useRoomTools,
  type DrawTool,
  type PollTool,
  DEFAULT_TASK_RULES,
  taskAllows,
  taskProgress,
  type TaskPriority,
  type TaskRules,
  type TasksTool,
  type TextTool,
} from "@/lib/roomTools";
import { transformIndex } from "@/lib/textSync";
import { highlightCode, type CodeTokenType } from "@/lib/codeHighlight";
import { useT } from "@/lib/useI18n";
import { DrawingSurface } from "./DrawingSurface";
import { PenToolbar } from "./PenToolbar";
import { drawStroke } from "./strokes";

export type ToolViewProps = { selfUserId: string | null; isManager: boolean; canUse: boolean };

const smallButton =
  "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Whiteboard ----------------------------------------------------------

export function WhiteboardView({ tool, selfUserId, isManager, canUse }: ToolViewProps & { tool: DrawTool }) {
  const t = useT();
  const { pen, optimistic } = useRoomTools();
  const strokes = useMemo(
    () => [...tool.strokes, ...Object.values(optimistic).filter((s) => s.toolId === tool.id)],
    [tool.strokes, optimistic, tool.id]
  );
  const mine = tool.strokes.filter((s) => s.by === selfUserId);

  function exportPng() {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of tool.strokes) drawStroke(ctx, stroke, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    canvas.toBlob((blob) => blob && download(`${tool.title || "lousa"}.png`, blob));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {canUse && (
        <PenToolbar
          trailing={
            <>
              <span className="mx-1 h-6 w-px bg-zinc-300 dark:bg-zinc-700" />
              <button
                type="button"
                className={smallButton}
                disabled={mine.length === 0}
                onClick={() => roomTools.removeStrokes(tool.id, [mine[mine.length - 1].id])}
                title={t("roomTools.undo")}
              >
                <MdUndo className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={smallButton}
                onClick={() => roomTools.clearStrokes(tool.id)}
                title={isManager ? t("roomTools.clearAll") : t("roomTools.clearMine")}
              >
                <MdDeleteSweep className="h-4 w-4" />
              </button>
            </>
          }
        />
      )}
      <div className="relative min-h-0 flex-1">
        {/* A 16:9 board as big as the panel allows, either way round. */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ containerType: "size" }}>
          <div style={{ width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }}>
            <DrawingSurface
              board
              strokes={strokes}
              canDraw={canUse}
              pen={pen}
              onStroke={(stroke) => roomTools.addStroke(tool.id, stroke, selfUserId)}
              onErase={(ids) => roomTools.removeStrokes(tool.id, ids)}
            />
          </div>
        </div>
      </div>
      <div className="hidden items-center justify-between text-xs text-zinc-500 sm:flex">
        <span>{canUse ? t("roomTools.whiteboardHint") : t("roomTools.viewOnly")}</span>
        <button type="button" className={smallButton} onClick={exportPng}>
          <MdFileDownload className="h-4 w-4" />
          PNG
        </button>
      </div>
    </div>
  );
}

// --- Notepad and code editor -----------------------------------------------

const TOKEN_CLASS: Record<CodeTokenType, string> = {
  comment: "italic text-zinc-500",
  string: "text-emerald-700 dark:text-emerald-400",
  number: "text-orange-700 dark:text-orange-300",
  keyword: "text-violet-700 dark:text-violet-400",
  literal: "text-orange-700 dark:text-orange-300",
  func: "text-blue-700 dark:text-sky-400",
  tag: "text-rose-700 dark:text-rose-400",
  attr: "text-amber-700 dark:text-amber-300",
  added: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  removed: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const EXTENSIONS: Record<string, string> = {
  plaintext: "txt",
  javascript: "js",
  typescript: "ts",
  python: "py",
  java: "java",
  csharp: "cs",
  cpp: "cpp",
  go: "go",
  rust: "rs",
  php: "php",
  ruby: "rb",
  sql: "sql",
  html: "html",
  css: "css",
  json: "json",
  bash: "sh",
  lua: "lua",
};

export function TextToolView({ tool, canUse }: ToolViewProps & { tool: TextTool }) {
  const t = useT();
  const code = tool.kind === "code";
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const caret = useRef<[number, number] | null>(null);

  // Somebody else typing before the caret moves it along with the text, not
  // out from under it.
  useEffect(
    () =>
      onRemoteTextOp(tool.id, (op) => {
        const area = areaRef.current;
        if (!area || document.activeElement !== area) return;
        caret.current = [transformIndex(op, area.selectionStart), transformIndex(op, area.selectionEnd)];
      }),
    [tool.id]
  );
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || !caret.current) return;
    area.setSelectionRange(caret.current[0], caret.current[1]);
    caret.current = null;
  });

  const tokens = useMemo(
    () => (code && tool.language !== "plaintext" ? highlightCode(tool.text + "\n", tool.language) : null),
    [code, tool.text, tool.language]
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Keys the room listens for (shortcuts) stay out of a text being written.
    event.stopPropagation();
    if (!code || event.key !== "Tab") return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const next = value.slice(0, start) + "  " + value.slice(end);
    roomTools.editText(tool.id, next);
    caret.current = [start + 2, start + 2];
  }

  // 16px below sm: iOS zooms the page into any field smaller than that.
  const textClass = code ? "font-mono text-base leading-relaxed sm:text-[13px]" : "text-base leading-relaxed sm:text-sm";
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        {code && (
          <select
            value={tool.language}
            disabled={!canUse}
            onChange={(e) => roomTools.setLanguage(tool.id, e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            aria-label={t("roomTools.language")}
          >
            {CODE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        )}
        <span className="flex-1 text-xs text-zinc-500">
          {canUse ? t("roomTools.textHint") : t("roomTools.viewOnly")} · {tool.text.length.toLocaleString()}/40.000
        </span>
        <button
          type="button"
          className={smallButton}
          onClick={() =>
            download(
              `${tool.title || "notas"}.${code ? EXTENSIONS[tool.language] ?? "txt" : "txt"}`,
              new Blob([tool.text], { type: "text/plain;charset=utf-8" })
            )
          }
        >
          <MdFileDownload className="h-4 w-4" />
          {t("roomTools.download")}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
        {tokens && (
          <pre
            ref={preRef}
            aria-hidden
            className={`pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words p-3 text-zinc-800 dark:text-zinc-200 ${textClass}`}
          >
            {tokens.map((token, index) =>
              token.type ? (
                <span key={index} className={TOKEN_CLASS[token.type]}>
                  {token.value}
                </span>
              ) : (
                <Fragment key={index}>{token.value}</Fragment>
              )
            )}
          </pre>
        )}
        <textarea
          ref={areaRef}
          value={tool.text}
          readOnly={!canUse}
          spellCheck={!code}
          maxLength={40_000}
          placeholder={canUse ? t(code ? "roomTools.codePlaceholder" : "roomTools.notePlaceholder") : ""}
          onChange={(e) => roomTools.editText(tool.id, e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className={`absolute inset-0 h-full w-full resize-none whitespace-pre-wrap break-words bg-transparent p-3 outline-none ${textClass} ${
            tokens ? "text-transparent caret-zinc-800 dark:caret-zinc-100" : "text-zinc-800 dark:text-zinc-200"
          }`}
        />
      </div>
    </div>
  );
}

// --- Poll ----------------------------------------------------------------

export function PollView({ tool, isManager, canUse, compact = false }: ToolViewProps & { tool: PollTool; compact?: boolean }) {
  const t = useT();
  const total = tool.counts.reduce((a, b) => a + b, 0);
  const canVote = canUse && !tool.closed;

  function pick(optionId: string) {
    if (!canVote) return;
    const mine = new Set(tool.mine);
    if (tool.multi) {
      if (mine.has(optionId)) mine.delete(optionId);
      else mine.add(optionId);
      roomTools.vote(tool.id, [...mine]);
    } else {
      roomTools.vote(tool.id, mine.has(optionId) ? [] : [optionId]);
    }
  }

  return (
    <div className={`flex flex-col overflow-y-auto ${compact ? "gap-2" : "gap-3"}`}>
      <div>
        {!compact && <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{tool.question}</p>}
        <p className="text-xs text-zinc-500">
          {[
            tool.multi ? t("roomTools.poll.multi") : t("roomTools.poll.single"),
            tool.anonymous ? t("roomTools.poll.anonymous") : t("roomTools.poll.public"),
            t("roomTools.poll.voters", { count: tool.totalVoters }),
            tool.closed ? t("roomTools.poll.closed") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {tool.options.map((option, index) => {
          const count = tool.counts[index] ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const chosen = tool.mine.includes(option.id);
          const names = tool.voters?.filter((v) => v.optionIds.includes(option.id)).map((v) => v.name) ?? [];
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={!canVote}
                onClick={() => pick(option.id)}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${
                  chosen
                    ? "border-emerald-500 ring-1 ring-emerald-500"
                    : "border-zinc-300 hover:border-emerald-400 dark:border-zinc-700"
                }`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-emerald-500/15 transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
                <span className="relative flex items-center gap-2">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center border ${tool.multi ? "rounded" : "rounded-full"} ${
                      chosen ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-400"
                    }`}
                  >
                    {chosen && <MdCheck className="h-3 w-3" />}
                  </span>
                  <span className="flex-1 font-medium text-zinc-800 dark:text-zinc-100">{option.text}</span>
                  <span className="tabular-nums text-xs text-zinc-500">
                    {count} · {percent}%
                  </span>
                </span>
                {names.length > 0 && (
                  <span className="relative mt-1 block truncate text-xs text-zinc-500">{names.join(", ")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {!canUse && <p className="text-xs text-zinc-500">{t("roomTools.viewOnly")}</p>}
      {isManager && !compact && !tool.closed && (
        <button
          type="button"
          onClick={() => roomTools.closePoll(tool.id)}
          className="self-start rounded-md bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {t("roomTools.poll.close")}
        </button>
      )}
    </div>
  );
}

// --- Tasks ---------------------------------------------------------------

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-400",
  normal: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  low: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

type TaskFilter = "all" | "open" | "done" | "mine";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function TasksView({
  tool,
  selfUserId,
  isManager,
  canUse,
  people = [],
}: ToolViewProps & { tool: TasksTool; people?: { userId: string; name: string }[] }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [draftAssignee, setDraftAssignee] = useState("");
  const [draftPriority, setDraftPriority] = useState<TaskPriority>("normal");
  const [draftDue, setDraftDue] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [rulesOpen, setRulesOpen] = useState(false);
  const rules = tool.rules ?? DEFAULT_TASK_RULES;
  const canAdd = canUse && taskAllows(tool, "add", selfUserId, isManager);
  const done = tool.items.filter((i) => i.done).length;
  const today = todayIso();
  // Everybody it can be handed to: the people here, and yourself.
  const assignable = selfUserId ? [{ userId: selfUserId, name: t("common.you") }, ...people] : people;

  const visible = tool.items
    .filter((item) =>
      filter === "open" ? !item.done : filter === "done" ? item.done : filter === "mine" ? item.assigneeId === selfUserId : true
    )
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        PRIORITY_ORDER[a.priority ?? "normal"] - PRIORITY_ORDER[b.priority ?? "normal"] ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        a.createdAt - b.createdAt
    );

  function add() {
    const text = draft.trim();
    if (!text) return;
    roomTools.addTask(tool.id, {
      text,
      assigneeId: draftAssignee || null,
      priority: draftPriority,
      due: draftDue || null,
    });
    setDraft("");
    setDraftDue("");
    setDraftPriority("normal");
  }

  const select =
    "rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {canAdd && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex gap-2">
            <input
              value={draft}
              maxLength={300}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={t("roomTools.tasks.placeholder")}
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-pressed={showMore}
              title={t("roomTools.tasks.details")}
              className={`rounded-md px-2 text-zinc-600 dark:text-zinc-300 ${showMore ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
              <MdTune className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || tool.items.length >= 200}
              className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </div>
          {showMore && (
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={draftAssignee} onChange={(e) => setDraftAssignee(e.target.value)} className={select} aria-label={t("roomTools.tasks.assignee")}>
                <option value="">{t("roomTools.tasks.nobody")}</option>
                {assignable.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={draftPriority}
                onChange={(e) => setDraftPriority(e.target.value as TaskPriority)}
                className={select}
                aria-label={t("roomTools.tasks.priority")}
              >
                {(["high", "normal", "low"] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {t(`roomTools.tasks.priority.${p}`)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={draftDue}
                onChange={(e) => setDraftDue(e.target.value)}
                className={select}
                aria-label={t("roomTools.tasks.due")}
              />
            </div>
          )}
        </form>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">
          {t("roomTools.tasks.progress", { done, total: tool.items.length })} · {taskProgress(tool)}%
        </span>
        <span className="flex-1" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as TaskFilter)} className={select} aria-label={t("roomTools.tasks.filter")}>
          {(["all", "open", "done", "mine"] as TaskFilter[]).map((f) => (
            <option key={f} value={f}>
              {t(`roomTools.tasks.filter.${f}`)}
            </option>
          ))}
        </select>
        {isManager && (
          <button
            type="button"
            onClick={() => setRulesOpen((v) => !v)}
            aria-pressed={rulesOpen}
            title={t("roomTools.tasks.rules")}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 ${rulesOpen ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            <MdSettings className="h-4 w-4" />
            {t("roomTools.tasks.rulesShort")}
          </button>
        )}
      </div>
      {tool.items.length > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${taskProgress(tool)}%` }} />
        </div>
      )}

      {isManager && rulesOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800">
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">{t("roomTools.tasks.rules")}</p>
          {(
            [
              ["add", ["everyone", "managers"]],
              ["complete", ["everyone", "managers", "assignee"]],
              ["edit", ["everyone", "managers"]],
            ] as [keyof TaskRules, string[]][]
          ).map(([action, choices]) => (
            <label key={action} className="flex items-center justify-between gap-2 text-zinc-700 dark:text-zinc-300">
              {t(`roomTools.tasks.rule.${action}`)}
              <select
                value={rules[action]}
                onChange={(e) => roomTools.setTaskRules(tool.id, { ...rules, [action]: e.target.value })}
                className={select}
              >
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`roomTools.tasks.who.${choice}`)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            disabled={done === 0}
            onClick={() => roomTools.clearDoneTasks(tool.id)}
            className="self-start rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950"
          >
            {t("roomTools.tasks.clearDone", { count: done })}
          </button>
        </div>
      )}

      {!canUse && <p className="text-xs text-zinc-500">{t("roomTools.viewOnly")}</p>}
      {canUse && !canAdd && tool.items.length === 0 && (
        <p className="text-xs text-zinc-500">{t("roomTools.tasks.managersAdd")}</p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {visible.map((item) => {
          const canTick = canUse && taskAllows(tool, "complete", selfUserId, isManager, item);
          const canEdit = canUse && taskAllows(tool, "edit", selfUserId, isManager, item);
          const late = !item.done && item.due !== null && item.due < today;
          return (
            <li key={item.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canTick}
                title={canTick ? undefined : t("roomTools.tasks.cannotTick")}
                onChange={() => roomTools.toggleTask(tool.id, item.id)}
                className="mt-0.5 h-4 w-4 accent-emerald-600 disabled:cursor-not-allowed"
              />
              <div className="min-w-0 flex-1">
                {editing?.id === item.id ? (
                  <input
                    autoFocus
                    value={editing.text}
                    maxLength={300}
                    onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        if (editing.text.trim()) roomTools.editTask(tool.id, item.id, { text: editing.text });
                        setEditing(null);
                      } else if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => setEditing(null)}
                    className="w-full rounded border border-zinc-300 bg-white px-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                ) : (
                  <p
                    onDoubleClick={() => canEdit && setEditing({ id: item.id, text: item.text })}
                    className={`break-words text-sm ${item.done ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"}`}
                  >
                    {item.text}
                  </p>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                  {item.priority && item.priority !== "normal" && (
                    <span className={`rounded px-1 font-semibold ${PRIORITY_CLASS[item.priority]}`}>
                      {t(`roomTools.tasks.priority.${item.priority}`)}
                    </span>
                  )}
                  {item.due && (
                    <span className={`flex items-center gap-0.5 ${late ? "font-semibold text-red-600" : ""}`}>
                      <MdEvent className="h-3 w-3" />
                      {formatDue(item.due)}
                    </span>
                  )}
                  {canEdit ? (
                    <select
                      value={item.assigneeId ?? ""}
                      onChange={(e) => roomTools.editTask(tool.id, item.id, { assigneeId: e.target.value || null })}
                      className="max-w-[9rem] truncate rounded border-none bg-transparent p-0 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      aria-label={t("roomTools.tasks.assignee")}
                    >
                      <option value="">{t("roomTools.tasks.nobody")}</option>
                      {item.assigneeId && !assignable.some((p) => p.userId === item.assigneeId) && (
                        <option value={item.assigneeId}>{item.assigneeName}</option>
                      )}
                      {assignable.map((p) => (
                        <option key={p.userId} value={p.userId}>
                          → {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    item.assigneeName && <span>→ {item.assigneeName}</span>
                  )}
                  <span>
                    ·{" "}
                    {item.done && item.doneByName
                      ? t("roomTools.tasks.doneBy", { name: item.doneByName })
                      : t("roomTools.tasks.addedBy", { name: item.byName })}
                  </span>
                </div>
              </div>
              {canEdit && (
                <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <select
                    value={item.priority ?? "normal"}
                    onChange={(e) => roomTools.editTask(tool.id, item.id, { priority: e.target.value as TaskPriority })}
                    className="rounded border-none bg-transparent p-0 text-[11px] text-zinc-500"
                    aria-label={t("roomTools.tasks.priority")}
                  >
                    {(["high", "normal", "low"] as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {t(`roomTools.tasks.priority.${p}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => roomTools.removeTask(tool.id, item.id)}
                    aria-label={t("roomTools.remove")}
                  >
                    <MdClose className="h-4 w-4 text-zinc-500 hover:text-red-500" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Annotations over a shared screen ---------------------------------------

export function AnnotateView({ tool, selfUserId, isManager, canUse }: ToolViewProps & { tool: DrawTool }) {
  const t = useT();
  const mine = tool.strokes.filter((s) => s.by === selfUserId);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("roomTools.annotate.hint")}</p>
      {canUse ? (
        <>
          <PenToolbar />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={smallButton}
              disabled={mine.length === 0}
              onClick={() => roomTools.removeStrokes(tool.id, [mine[mine.length - 1].id])}
            >
              <MdUndo className="h-4 w-4" />
              {t("roomTools.undo")}
            </button>
            <button type="button" className={smallButton} onClick={() => roomTools.clearStrokes(tool.id)}>
              <MdDeleteSweep className="h-4 w-4" />
              {isManager ? t("roomTools.clearAll") : t("roomTools.clearMine")}
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500">{t("roomTools.viewOnly")}</p>
      )}
      <p className="text-xs text-zinc-500">{t("roomTools.annotate.count", { count: tool.strokes.length })}</p>
    </div>
  );
}
