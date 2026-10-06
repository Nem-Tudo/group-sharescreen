"use client";

import { useState, type ReactNode } from "react";
import {
  MdAdd,
  MdArrowBack,
  MdClose,
  MdCloseFullscreen,
  MdLock,
  MdOpenInFull,
  MdSettings,
} from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import {
  CODE_LANGUAGES,
  DEFAULT_TASK_RULES,
  MEDIA_KINDS,
  OFFICE_KINDS,
  PANEL_KINDS,
  ROOM_TOOLS_OFFICE_FEATURE,
  SINGLE_KINDS,
  canOpenKind,
  canUseTool,
  planForKind,
  roomTools,
  useRoomTools,
  type RoomTool,
  type TaskRules,
  type ToolAccess,
  type ToolKind,
  ROOM_TOOLS_EVENTS,
  trackRoomToolsEvent,
} from "@/lib/roomTools";
import { openProModal } from "@/lib/proModal";
import { useFeature } from "@/lib/features";
import { signalingClient } from "@/lib/signalingClient";
import { useT } from "@/lib/useI18n";
import { TOOL_ICONS } from "./toolIcons";
import { AnnotateView, PollView, TasksView } from "./ToolViews";

export { TOOL_ICONS };

export type ToolPerson = { userId: string; name: string };

const PLAN_NAMES = { premium: "Pro", premium_max: "Pro Max", pro_ultra: "Pro Ultra" } as const;

// The "Ferramentas" panel: every tool open in the room, and — for the room's
// managers — opening new ones (each kind on its plan) and deciding who may use
// each. The whiteboard, notepad and code editor are tiles in the room's grid
// (see ToolMediaTile): picking one here takes you to its tile, and its
// settings are what the panel shows for it. Polls open from the chat's "+"
// and live in the chat, like the task list's progress.
export function RoomToolsPanel({
  selfUserId,
  isManager,
  canOpenTools,
  features,
  toolsFree = false,
  people,
  onShowTile,
}: {
  selfUserId: string | null;
  isManager: boolean;
  canOpenTools: boolean;
  // The account's plan features — what opening each kind takes (the server
  // checks it again).
  features: readonly string[];
  // The "room-tools-free" experiment: every kind opens without a plan, and
  // none shows one (see lib/roomTools's ROOM_TOOLS_FREE_FEATURE).
  toolsFree?: boolean;
  // Everybody else in the room, for "pessoas escolhidas".
  people: ToolPerson[];
  // Puts a media tool's tile in the spotlight.
  onShowTile: (toolId: string) => void;
}) {
  const t = useT();
  const { tools, panelOpen, activeToolId } = useRoomTools();
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState<ToolKind | null>(null);

  if (!panelOpen) return null;
  const listed = tools.filter((tool) => tool.kind !== "reactions");
  const active = listed.find((tool) => tool.id === activeToolId) ?? null;

  let body: ReactNode;
  if (creating) {
    body = (
      <CreateToolForm
        kind={creating}
        people={people}
        onCancel={() => setCreating(null)}
        onCreate={(options) => {
          roomTools.create(creating, options);
          setCreating(null);
        }}
      />
    );
  } else if (active) {
    const props = { selfUserId, isManager, canUse: canUseTool(active, selfUserId, isManager) };
    if (MEDIA_KINDS.includes(active.kind)) {
      body = isManager ? (
        <ToolSettings key={active.id} tool={active} people={people} onDone={() => roomTools.select(null)} />
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("roomTools.mediaHint")}</p>
      );
    } else {
      switch (active.kind) {
        case "annotate":
          body = <AnnotateView tool={active} {...props} />;
          break;
        case "poll":
          body = <PollView tool={active} {...props} />;
          break;
        case "tasks":
          body = <TasksView tool={active} {...props} people={people} />;
          break;
      }
    }
  } else {
    body = (
      <ToolsHome
        tools={listed}
        allTools={tools}
        isManager={isManager}
        canOpenTools={canOpenTools}
        features={features}
        toolsFree={toolsFree}
        selfUserId={selfUserId}
        onPick={(kind) => setCreating(kind)}
        onOpen={(tool) => {
          if (MEDIA_KINDS.includes(tool.kind)) {
            onShowTile(tool.id);
            roomTools.openPanel(false);
          } else {
            roomTools.select(tool.id);
          }
        }}
      />
    );
  }

  const nonMediaSettings = active && isManager && !MEDIA_KINDS.includes(active.kind);
  return (
    <section
      aria-label={t("roomTools.title")}
      // Keys typed here are not the room's shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
      // Laid on the stage (it is rendered inside the room's <main>), never
      // over the chat or the participants: a sheet up from the bottom on a
      // phone, a column on the stage's right edge from sm up. Expanded, it
      // takes the stage and nothing more.
      className={`absolute z-30 flex flex-col overflow-hidden border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900 ${
        expanded
          ? "inset-0 rounded-xl"
          : "inset-x-0 bottom-0 max-h-[70%] rounded-t-2xl sm:inset-x-auto sm:bottom-2 sm:right-2 sm:top-2 sm:max-h-none sm:w-[min(24rem,45%)] sm:rounded-xl"
      }`}
    >
      <span aria-hidden className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-zinc-300 sm:hidden dark:bg-zinc-700" />
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {(active || creating) && (
          <button
            type="button"
            onClick={() => {
              setCreating(null);
              roomTools.select(null);
            }}
            aria-label={t("roomTools.back")}
            className="rounded-md p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <MdArrowBack className="h-5 w-5" />
          </button>
        )}
        <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {active && !creating ? (
            <>
              <span className="text-lg text-emerald-600">{TOOL_ICONS[active.kind]}</span>
              <span className="truncate">{active.title}</span>
            </>
          ) : (
            <>
              {t("roomTools.title")} <span className="text-[10px]"><BetaMark /></span>
            </>
          )}
        </h2>
        {nonMediaSettings && <ToolSettingsButton tool={active} people={people} />}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? t("roomTools.shrink") : t("roomTools.expand")}
          aria-label={expanded ? t("roomTools.shrink") : t("roomTools.expand")}
          className="hidden rounded-md p-1 text-zinc-600 hover:bg-zinc-100 sm:block dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {expanded ? <MdCloseFullscreen className="h-5 w-5" /> : <MdOpenInFull className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => roomTools.openPanel(false)}
          aria-label={t("roomTools.closePanel")}
          className="rounded-md p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
    </section>
  );
}

/** The gear for a tool that is not a tile: its name, who may use it, closing it — in a popover over the panel. */
function ToolSettingsButton({ tool, people }: { tool: RoomTool; people: ToolPerson[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("roomTools.settings")}
        aria-label={t("roomTools.settings")}
        className="rounded-md p-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <MdSettings className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute inset-0 z-10 overflow-y-auto bg-white p-3 dark:bg-zinc-900">
          <ToolSettings tool={tool} people={people} onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

function ToolsHome({
  tools,
  allTools,
  isManager,
  canOpenTools,
  features,
  toolsFree,
  selfUserId,
  onPick,
  onOpen,
}: {
  tools: RoomTool[];
  allTools: RoomTool[];
  isManager: boolean;
  canOpenTools: boolean;
  features: readonly string[];
  toolsFree: boolean;
  selfUserId: string | null;
  onPick: (kind: ToolKind) => void;
  onOpen: (tool: RoomTool) => void;
}) {
  const t = useT();
  // The spreadsheet and the document are offered only inside their experiment.
  const office = useFeature(ROOM_TOOLS_OFFICE_FEATURE, {
    room: signalingClient.getSnapshot().room ?? undefined,
    track: canOpenTools,
  }).enabled;
  const panelKinds = office ? PANEL_KINDS : PANEL_KINDS.filter((kind) => !OFFICE_KINDS.includes(kind));
  const taken = new Set(allTools.filter((tool) => SINGLE_KINDS.includes(tool.kind)).map((tool) => tool.kind));
  const reactions = allTools.find((tool) => tool.kind === "reactions");
  return (
    <div className="flex flex-col gap-4">
      {tools.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {canOpenTools ? t("roomTools.emptyManager") : t("roomTools.emptyMember")}
        </p>
      )}
      {tools.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {tools.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                onClick={() => onOpen(tool)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-left transition hover:border-emerald-500 dark:border-zinc-800"
              >
                <span className="text-xl text-emerald-600">{TOOL_ICONS[tool.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{tool.title}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {MEDIA_KINDS.includes(tool.kind) ? `${t("roomTools.inTheGrid")} · ` : ""}
                    {t(`roomTools.access.${tool.access}`)} · {t("roomTools.openedBy", { name: tool.createdByName })}
                  </span>
                </span>
                {!canUseTool(tool, selfUserId, isManager) && <MdLock className="h-4 w-4 text-zinc-400" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canOpenTools && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("roomTools.new")}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {panelKinds.map((kind) => {
              const allowed = toolsFree || canOpenKind(kind, features);
              const plan = planForKind(kind);
              const isTaken = taken.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={isTaken}
                  onClick={() => {
                    if (allowed) {
                      onPick(kind);
                      return;
                    }
                    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.lockedClick);
                    trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.lockedClick}.${kind}`);
                    openProModal(plan);
                  }}
                  title={isTaken ? t("roomTools.alreadyOpen") : undefined}
                  className="flex flex-col items-start gap-1 rounded-lg border border-zinc-200 p-2.5 text-left transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800"
                >
                  <span className="flex w-full items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-lg text-emerald-600">{TOOL_ICONS[kind]}</span>
                    <span className="flex-1 truncate">{t(`roomTools.kind.${kind}`)}</span>
                    {!allowed && <MdLock className="h-3.5 w-3.5 text-zinc-400" />}
                  </span>
                  <span className="text-[11px] leading-snug text-zinc-500">{t(`roomTools.kindHint.${kind}`)}</span>
                  {plan && !toolsFree && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        allowed ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" : "bg-rose-600/10 text-rose-600"
                      }`}
                    >
                      {PLAN_NAMES[plan]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Reactions are on in every room; this is the room saying "not here". */}
          <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
            <span className="flex items-center gap-2">
              <span className="text-lg text-emerald-600">{TOOL_ICONS.reactions}</span>
              {t("roomTools.reactionsOnMedia")}
            </span>
            <input
              type="checkbox"
              checked={Boolean(reactions)}
              // Turning them off is the room's managers' — nobody opened them.
              disabled={Boolean(reactions) && !isManager}
              onChange={() => (reactions ? roomTools.close(reactions.id) : roomTools.create("reactions"))}
              className="h-4 w-4 accent-emerald-600"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// --- Who may use it --------------------------------------------------------

function AccessEditor({
  access,
  allowed,
  people,
  onChange,
}: {
  access: ToolAccess;
  allowed: string[];
  people: ToolPerson[];
  onChange: (access: ToolAccess, allowed: string[]) => void;
}) {
  const t = useT();
  const picked = new Set(allowed);
  // Somebody picked who has since left still counts — show them too.
  const known = new Set(people.map((p) => p.userId));
  const absent = allowed.filter((id) => !known.has(id));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("roomTools.whoCanUse")}</legend>
      {(["everyone", "managers", "selected"] as ToolAccess[]).map((value) => (
        <label key={value} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input
            type="radio"
            name="tool-access"
            checked={access === value}
            onChange={() => onChange(value, allowed)}
            className="accent-emerald-600"
          />
          {t(`roomTools.access.${value}`)}
        </label>
      ))}
      {access === "selected" && (
        <div className="ml-6 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
          {people.length === 0 && absent.length === 0 && (
            <p className="text-xs text-zinc-500">{t("roomTools.nobodyElse")}</p>
          )}
          {people.map((person) => (
            <label key={person.userId} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={picked.has(person.userId)}
                onChange={(e) =>
                  onChange(
                    "selected",
                    e.target.checked ? [...allowed, person.userId] : allowed.filter((id) => id !== person.userId)
                  )
                }
                className="accent-emerald-600"
              />
              <span className="truncate">{person.name}</span>
            </label>
          ))}
          {absent.length > 0 && (
            <button
              type="button"
              onClick={() => onChange("selected", allowed.filter((id) => known.has(id)))}
              className="self-start text-xs text-zinc-500 underline"
            >
              {t("roomTools.forgetAbsent", { count: absent.length })}
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function CreateToolForm({
  kind,
  people,
  onCancel,
  onCreate,
}: {
  kind: ToolKind;
  people: ToolPerson[];
  onCancel: () => void;
  onCreate: (options: Parameters<typeof roomTools.create>[1]) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [access, setAccess] = useState<ToolAccess>("everyone");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [language, setLanguage] = useState("javascript");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const [rules, setRules] = useState<TaskRules>(DEFAULT_TASK_RULES);

  const pollReady = question.trim() && options.filter((o) => o.trim()).length >= 2;
  const ready = kind !== "poll" || pollReady;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onCreate({
          title: title.trim() || undefined,
          access,
          allowed,
          ...(kind === "code" ? { language } : {}),
          ...(kind === "tasks" ? { rules } : {}),
          ...(kind === "poll"
            ? { poll: { question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), multi, anonymous, announce, durationMinutes: duration } }
            : {}),
        });
      }}
    >
      <div className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        <span className="text-xl text-emerald-600">{TOOL_ICONS[kind]}</span>
        {t(`roomTools.kind.${kind}`)}
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {t("roomTools.name")}
        <input
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(`roomTools.kind.${kind}`)}
          className={inputClass}
        />
      </label>
      {kind === "code" && (
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {t("roomTools.language")}
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
            {CODE_LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "poll" && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {t("roomTools.poll.question")}
            <input value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} className={inputClass} />
          </label>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("roomTools.poll.options")}</span>
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={option}
                maxLength={100}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
                placeholder={t("roomTools.poll.option", { n: index + 1 })}
                className={inputClass}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                  aria-label={t("roomTools.remove")}
                  className="rounded-md px-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <MdClose className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              type="button"
              onClick={() => setOptions([...options, ""])}
              className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              <MdAdd className="h-4 w-4" />
              {t("roomTools.poll.addOption")}
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-emerald-600" />
            {t("roomTools.poll.allowMulti")}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="accent-emerald-600"
            />
            {t("roomTools.poll.anonymousVote")}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="accent-emerald-600" />
            {t("roomTools.poll.announce")}
          </label>
          <label className="flex items-center justify-between gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            {t("roomTools.poll.duration")}
            <select
              value={duration ?? ""}
              onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">{t("roomTools.poll.noLimit")}</option>
              {[1, 2, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {t("roomTools.poll.minutes", { count: m })}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {kind === "tasks" && (
        <TaskRulesFields rules={rules} setRules={setRules} />
      )}
      <AccessEditor
        access={access}
        allowed={allowed}
        people={people}
        onChange={(nextAccess, nextAllowed) => {
          setAccess(nextAccess);
          setAllowed(nextAllowed);
        }}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {t("roomTools.cancel")}
        </button>
        <button
          type="submit"
          disabled={!ready}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {t("roomTools.open")}
        </button>
      </div>
    </form>
  );
}

function ToolSettings({ tool, people, onDone }: { tool: RoomTool; people: ToolPerson[]; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(tool.title);
  const [access, setAccess] = useState(tool.access);
  const [allowed, setAllowed] = useState(tool.allowed);
  const [rules, setRules] = useState<TaskRules>(tool.kind === "tasks" ? (tool.rules ?? DEFAULT_TASK_RULES) : DEFAULT_TASK_RULES);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        roomTools.setAccess(tool.id, access, allowed, title.trim());
        if (tool.kind === "tasks") roomTools.setTaskRules(tool.id, rules);
        onDone();
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {t("roomTools.name")}
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </label>
      {tool.kind === "tasks" && <TaskRulesFields rules={rules} setRules={setRules} />}
      <AccessEditor
        access={access}
        allowed={allowed}
        people={people}
        onChange={(nextAccess, nextAllowed) => {
          setAccess(nextAccess);
          setAllowed(nextAllowed);
        }}
      />
      <div className="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            // Ends it for everybody, with what was drawn or written in it.
            if (!window.confirm(t("roomTools.closeToolQuestion"))) return;
            roomTools.close(tool.id);
            onDone();
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
        >
          {t("roomTools.closeTool")}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("roomTools.cancel")}
          </button>
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            {t("roomTools.save")}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Who may create, complete and edit the list's tasks — when opening it, and any time after. */
function TaskRulesFields({ rules, setRules }: { rules: TaskRules; setRules: (rules: TaskRules) => void }) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("roomTools.tasks.rules")}</legend>
      {(
        [
          ["add", ["everyone", "managers"]],
          ["complete", ["everyone", "managers", "assignee"]],
          ["edit", ["everyone", "managers"]],
        ] as [keyof TaskRules, string[]][]
      ).map(([action, choices]) => (
        <label key={action} className="flex items-center justify-between gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          {t(`roomTools.tasks.rule.${action}`)}
          <select
            value={rules[action]}
            onChange={(e) => setRules({ ...rules, [action]: e.target.value })}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {t(`roomTools.tasks.who.${choice}`)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
