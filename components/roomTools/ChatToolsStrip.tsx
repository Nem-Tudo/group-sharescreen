"use client";

import { useContext, useEffect, useState } from "react";
import { MdChecklist, MdExpandLess, MdExpandMore, MdPoll } from "react-icons/md";
import {
  canUseTool,
  roomTools,
  taskProgress,
  useRoomTools,
  type PollTool,
  type TasksTool,
} from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";
import { RoomToolsViewer } from "./AnnotationLayer";
import { CreateToolForm, type ToolPerson } from "./RoomToolsPanel";
import { PollView } from "./ToolViews";

// What of the room's tools lives in the chat: the task list's progress as a
// balloon on top (tapping it opens the list), and the room's polls, voted on
// right there. Polls are opened from the chat's "+" (see PollCreateDialog).
export function ChatToolsStrip() {
  const { tools } = useRoomTools();
  const { selfUserId, isManager } = useContext(RoomToolsViewer);
  const tasks = tools.find((tool): tool is TasksTool => tool.kind === "tasks");
  const polls = tools.filter((tool): tool is PollTool => tool.kind === "poll" && !tool.closed);
  if (!tasks && polls.length === 0) return null;

  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
      {tasks && <TasksBalloon tool={tasks} />}
      {polls.map((poll) => (
        <PollCard key={poll.id} tool={poll} selfUserId={selfUserId} isManager={isManager} />
      ))}
    </div>
  );
}

function TasksBalloon({ tool }: { tool: TasksTool }) {
  const t = useT();
  const progress = taskProgress(tool);
  // The chat's whole width: the icon, a progress bar, and the percentage.
  return (
    <button
      type="button"
      onClick={() => roomTools.show(tool.id)}
      title={t("roomTools.tasks.open")}
      aria-label={`${t("roomTools.tasks.open")} — ${progress}%`}
      className="flex w-full shrink-0 items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950"
    >
      <MdChecklist className="h-5 w-5 shrink-0" />
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-emerald-500/20"
      >
        <span
          className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right tabular-nums">{progress}%</span>
    </button>
  );
}

function PollCard({ tool, selfUserId, isManager }: { tool: PollTool; selfUserId: string | null; isManager: boolean }) {
  const t = useT();
  // Open until you have voted — then folded to the question, out of the
  // conversation's way, one tap from the results.
  const [open, setOpen] = useState<boolean | null>(null);
  const { canOpenTools: canEnd } = useContext(RoomToolsViewer);
  const expanded = open ?? (tool.mine.length === 0 && !tool.closed);
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <MdPoll className="h-4 w-4 shrink-0 text-emerald-600" />
        <button type="button" onClick={() => setOpen(!expanded)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-zinc-800 dark:text-zinc-100">
          {tool.question}
          <span className="ml-1 font-normal text-zinc-500">
            · {t("roomTools.poll.voters", { count: tool.totalVoters })}
            {tool.closed ? ` · ${t("roomTools.poll.closed")}` : ""}
            {!tool.closed && tool.endsAt ? <PollCountdown endsAt={tool.endsAt} /> : null}
          </span>
        </button>
        {/* Ending it — whoever may open and close tools. It then leaves the
            chat; with "avisar no chat" on, its result is posted there. */}
        {canEnd && !tool.closed && (
          <button
            type="button"
            onClick={() => roomTools.closePoll(tool.id)}
            className="shrink-0 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-red-700"
          >
            {t("roomTools.poll.end")}
          </button>
        )}
        <button type="button" onClick={() => setOpen(!expanded)} aria-label={expanded ? t("roomTools.shrink") : t("roomTools.expand")} className="text-zinc-500">
          {expanded ? <MdExpandLess className="h-4 w-4" /> : <MdExpandMore className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <PollView tool={tool} selfUserId={selfUserId} isManager={isManager} canUse={canUseTool(tool, selfUserId, isManager)} compact />
        </div>
      )}
    </div>
  );
}

/** " · ⏱ 2:41" — the time left on a poll that ends by itself. */
function PollCountdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <span className="tabular-nums">
      {" · ⏱ "}
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

/** "Nova enquete", opened from the chat's "+" — the room's managers only. */
export function PollCreateDialog({ people }: { people: ToolPerson[] }) {
  const t = useT();
  const { pollDialogOpen, tools } = useRoomTools();
  // An ended one does not count: it is on its way out, nothing to replace.
  const running = tools.some((tool) => tool.kind === "poll" && !tool.closed);
  if (!pollDialogOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={() => roomTools.openPollDialog(false)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") roomTools.openPollDialog(false);
      }}
    >
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <CreateToolForm
          kind="poll"
          people={people}
          onCancel={() => roomTools.openPollDialog(false)}
          onCreate={(options) => {
            // One poll at a time: a new one replaces the running one, which
            // ends as usual (result in the chat, if it was asked for).
            if (running && !window.confirm(t("roomTools.poll.replaceQuestion"))) return;
            roomTools.create("poll", { ...options, replace: running });
            roomTools.openPollDialog(false);
          }}
        />
      </div>
    </div>
  );
}
