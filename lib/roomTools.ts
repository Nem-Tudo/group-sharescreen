"use client";

import { useSyncExternalStore } from "react";
import { FEATURE_TIERS, hasFeature, type Feature } from "./entitlements";
import { trackFeatureEvent } from "./features";
import { signalingClient } from "./signalingClient";
import type { TextOp } from "./textOt";
import { TextSyncClient } from "./textSync";
import { applySheetChange, changeIsIdempotent, type SheetChange, type SheetData } from "./sheet";

// The room's "Ferramentas" — the client's half of the API's roomTools.ts,
// which explains the model: one shared record per room, managers open and
// close tools (each kind on its own plan), each tool says who may use it, and
// everybody in the room sees every one. Plus raised hands, which are
// everybody's.
//
// Where each kind lives on screen:
//   - the whiteboard, notepad, code editor, spreadsheet and document are
//     media: a tile in the room's grid, like a shared screen (see ToolMediaTile);
//   - polls and the task list live in the chat (see ChatToolsStrip);
//   - reactions are a button on every media tile (see ReactionLayer);
//   - screen notes are drawn over the shared screens themselves.
//
// A store of its own rather than more fields on SignalingState: a whiteboard
// stroke or a keystroke in the notepad arrives many times a second, and none
// of that is any business of the sixty other things that state carries.

export type ToolKind = "whiteboard" | "notepad" | "annotate" | "poll" | "reactions" | "code" | "tasks" | "sheet" | "doc";
export type ToolAccess = "everyone" | "managers" | "selected";
export type StrokeShape = "pen" | "highlighter" | "line" | "arrow" | "rect" | "ellipse" | "text" | "image";

// The experiments (admin panel, "Features"): `room-tools` shows the ways in —
// the "Ferramentas" button, raising a hand, "Nova enquete" in the chat's "+",
// the room's "everyone may open tools" switch. What somebody else already
// opened shows up for everybody either way, so a room where only some are in
// the experiment still works. `room-tools-free` opens every kind without a
// plan (the API checks the same rollout — see its roomToolAllowed), and shows
// the ways in too; the /pro page keeps listing them as perks.
export const ROOM_TOOLS_FEATURE = "room-tools";
export const ROOM_TOOLS_FREE_FEATURE = "room-tools-free";
// The spreadsheet and the document: in the tools panel only for whoever is in
// this experiment. One somebody else opened shows up for everybody.
export const ROOM_TOOLS_OFFICE_FEATURE = "room-tools-office";

// Usage stats — each name counts only where it is in the feature's "site
// events". The per-kind ones are `${name}.${kind}`.
export const ROOM_TOOLS_EVENTS = {
  panelOpen: "room_tools_panel_open",
  create: "room_tools_create",
  lockedClick: "room_tools_locked_click",
  // Once per tool per page: somebody drew on it / typed in it.
  draw: "room_tools_draw",
  type: "room_tools_type",
  pollVote: "room_tools_poll_vote",
  taskAdd: "room_tools_task_add",
  taskDone: "room_tools_task_done",
  reaction: "room_tools_reaction",
  handRaise: "room_tools_hand_raise",
  handGrant: "room_tools_hand_grant",
  // A picture pasted on a whiteboard, and a spreadsheet or document taken out
  // of the room as a file.
  imagePaste: "room_tools_image_paste",
  export: "room_tools_export",
} as const;

export function trackRoomToolsEvent(name: string) {
  trackFeatureEvent(name, { room: signalingClient.getSnapshot().room });
}

const usedToolIds = new Set<string>();
function trackFirstUse(toolId: string, name: string) {
  if (usedToolIds.has(toolId)) return;
  usedToolIds.add(toolId);
  const kind = state.tools.find((t) => t.id === toolId)?.kind;
  trackRoomToolsEvent(name);
  if (kind) trackRoomToolsEvent(`${name}.${kind}`);
}

/** What the tools panel offers to open, in order. Polls open from the chat's "+". */
export const PANEL_KINDS: ToolKind[] = ["whiteboard", "notepad", "code", "sheet", "doc", "tasks", "annotate"];
/** The panel's kinds that only the office experiment shows (see ROOM_TOOLS_OFFICE_FEATURE). */
export const OFFICE_KINDS: ToolKind[] = ["sheet", "doc"];
/** The kinds that are a tile in the room's grid. */
export const MEDIA_KINDS: ToolKind[] = ["whiteboard", "notepad", "code", "sheet", "doc"];
/** The kinds edited as one shared text (see lib/textSync.ts). A document's text is its HTML. */
export const TEXT_KINDS: ToolKind[] = ["notepad", "code", "doc"];
function isTextTool(tool: RoomTool): tool is TextTool {
  return TEXT_KINDS.includes(tool.kind);
}
/** Kinds a room has at most one of (the server enforces it too). */
export const SINGLE_KINDS: ToolKind[] = ["reactions", "annotate", "tasks"];

/** The plan feature opening each kind takes — the mirror of the API's TOOL_FEATURES. */
export const TOOL_FEATURES: Record<ToolKind, Feature> = {
  poll: "room_tools_basic",
  reactions: "room_tools_basic",
  tasks: "room_tools_tasks",
  notepad: "room_tools_basic",
  code: "room_tools_text",
  whiteboard: "room_tools_draw",
  annotate: "room_tools_draw",
  sheet: "room_tools_text",
  doc: "room_tools_text",
};

/** Whether an account with `features` may open a tool of this kind. The free kinds need nothing. */
export function canOpenKind(kind: ToolKind, features: readonly string[]): boolean {
  const feature = TOOL_FEATURES[kind];
  return FEATURE_TIERS[feature] === "free" || hasFeature(feature, features);
}

/** The plan to show next to a kind somebody cannot open yet. */
export function planForKind(kind: ToolKind): "premium" | "premium_max" | "pro_ultra" | null {
  const tier = FEATURE_TIERS[TOOL_FEATURES[kind]];
  return tier === "premium" || tier === "premium_max" || tier === "pro_ultra" ? tier : null;
}

/** The id a tool's tile has in the room's grid, and the media key its reactions are aimed at. */
export function toolMediaKey(toolId: string): string {
  return `tool:${toolId}`;
}

export const CODE_LANGUAGES = [
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "java",
  "csharp",
  "cpp",
  "go",
  "rust",
  "php",
  "ruby",
  "sql",
  "html",
  "css",
  "json",
  "bash",
  "lua",
] as const;

export type Stroke = {
  id: string;
  by: string;
  shape: StrokeShape;
  color: string;
  width: number;
  points: number[];
  text?: string;
  // A pasted picture: its data URL, between the two corners in `points`.
  src?: string;
  target?: string;
};

type ToolBase = {
  id: string;
  title: string;
  createdById: string;
  createdByName: string;
  createdAt: number;
  access: ToolAccess;
  allowed: string[];
};

export type DrawTool = ToolBase & { kind: "whiteboard" | "annotate"; strokes: Stroke[] };
export type TextTool = ToolBase & { kind: "notepad" | "code" | "doc"; text: string; version: number; language: string };
export type SheetTool = ToolBase & SheetData & { kind: "sheet" };
export type PollTool = ToolBase & {
  kind: "poll";
  question: string;
  options: { id: string; text: string }[];
  multi: boolean;
  anonymous: boolean;
  closed: boolean;
  announce: boolean;
  endsAt: number | null;
  counts: number[];
  totalVoters: number;
  voters?: { name: string; optionIds: string[] }[];
  mine: string[];
};
export type TaskPriority = "low" | "normal" | "high";
export type TaskItem = {
  id: string;
  text: string;
  done: boolean;
  byName: string;
  doneByName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: TaskPriority;
  due: string | null;
  createdAt: number;
};
export type TaskRules = {
  add: "everyone" | "managers";
  complete: "everyone" | "managers" | "assignee";
  edit: "everyone" | "managers";
};
export const DEFAULT_TASK_RULES: TaskRules = { add: "managers", complete: "everyone", edit: "managers" };
export type TasksTool = ToolBase & { kind: "tasks"; items: TaskItem[]; rules: TaskRules };

/** The mirror of the API's taskAllows: whether this viewer may do `action`. */
export function taskAllows(
  tool: TasksTool,
  action: keyof TaskRules,
  userId: string | null,
  isManager: boolean,
  item?: TaskItem
): boolean {
  if (isManager) return true;
  const rule = (tool.rules ?? DEFAULT_TASK_RULES)[action];
  if (rule === "everyone") return true;
  if (rule === "assignee") return Boolean(userId && item && item.assigneeId === userId);
  return false;
}

/** How far along the list is, 0–100. */
export function taskProgress(tool: TasksTool): number {
  if (tool.items.length === 0) return 0;
  return Math.round((tool.items.filter((i) => i.done).length / tool.items.length) * 100);
}
export type ReactionsTool = ToolBase & { kind: "reactions" };
export type RoomTool = DrawTool | TextTool | PollTool | TasksTool | ReactionsTool | SheetTool;

export type RaisedHand = { id: string; name: string; at: number };
/** Somebody else's stroke while they are still drawing it (see "tool-stroke-live"). */
export type LiveStroke = Omit<Stroke, "id" | "by"> & { toolId: string; by: string; at: number };
export type FloatingReaction = { key: string; emoji: string; name: string; x: number; target: string };

export type RoomToolsState = {
  tools: RoomTool[];
  hands: RaisedHand[];
  speakers: string[];
  reactions: FloatingReaction[];
  // Strokes this client drew and sent, shown until the server's copy comes
  // back (matched on clientId) — so a line appears under the pen, not a
  // round trip later.
  optimistic: Record<string, Stroke & { toolId: string }>;
  // Strokes other people are drawing right now, by `${by}:${liveId}` — gone
  // when the finished stroke arrives (its clientId is the liveId), when they
  // lift the pen without one, or after a few quiet seconds.
  live: Record<string, LiveStroke>;
  // The stroke this viewer is drawing right now, by tool — for what shows the
  // board somewhere else at the same time (the picture-in-pictures), which
  // would otherwise only see it once the pen comes up.
  ownLive: Record<string, LiveStroke>;
  // Local view state — nobody else's business.
  panelOpen: boolean;
  activeToolId: string | null;
  // Screen notes: the pen is down on every shared media from the moment the
  // tool opens; these are the ones this viewer turned it off on (by media
  // key — see AnnotateButton). Local: nobody else's business.
  annotateOff: string[];
  // Whether a media is in focus or hyperfocus on the stage — on a phone the
  // screen notes only work there (see AnnotateDock). Set by the room.
  stageFocused: boolean;
  // The "Nova enquete" dialog, opened from the chat's "+".
  pollDialogOpen: boolean;
  pen: { color: string; width: number; tool: StrokeShape | "eraser" };
};

const EMPTY: RoomToolsState = {
  tools: [],
  hands: [],
  speakers: [],
  reactions: [],
  optimistic: {},
  live: {},
  ownLive: {},
  panelOpen: false,
  activeToolId: null,
  annotateOff: [],
  stageFocused: false,
  pollDialogOpen: false,
  pen: { color: "#ef4444", width: 4, tool: "pen" },
};

let state: RoomToolsState = EMPTY;
const listeners = new Set<() => void>();

function setState(patch: Partial<RoomToolsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

export function useRoomTools(): RoomToolsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * One slice of the store, re-rendering only when it changes — for the room
 * itself, which must not redraw on every stroke somebody draws. `selector`
 * must be stable (module-level), and return something that keeps its
 * identity while unchanged (a field of the state, not a new array).
 */
export function useRoomToolsSelector<T>(selector: (state: RoomToolsState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(EMPTY)
  );
}

export function getRoomToolsState(): RoomToolsState {
  return state;
}

function replaceTool(tool: RoomTool) {
  const index = state.tools.findIndex((t) => t.id === tool.id);
  const tools = [...state.tools];
  if (index >= 0) tools[index] = tool;
  else tools.push(tool);
  setState({ tools });
}

function updateTool<K extends RoomTool["kind"]>(
  id: string,
  kinds: K[],
  fn: (tool: Extract<RoomTool, { kind: K }>) => RoomTool
) {
  const tool = state.tools.find((t) => t.id === id);
  if (!tool || !(kinds as string[]).includes(tool.kind)) return;
  replaceTool(fn(tool as Extract<RoomTool, { kind: K }>));
}

// --- Text sync ---------------------------------------------------------------
//
// One TextSyncClient per notepad/code editor/document (see lib/textSync.ts). The tool's
// `text` in this store is always that client's local text.

const textSync = new Map<string, TextSyncClient>();

function startSync(tool: TextTool): void {
  textSync.set(
    tool.id,
    new TextSyncClient(tool.text, tool.version, (msg) =>
      signalingClient.sendMessage({ type: "tool-text-op", id: tool.id, ...msg })
    )
  );
}

let strokeCounter = 0;

// Listeners for remote edits, by tool — how an open editor learns to move
// its caret (see TextToolEditor).
const remoteTextListeners = new Map<string, Set<(op: TextOp) => void>>();

export function onRemoteTextOp(toolId: string, cb: (op: TextOp) => void) {
  let set = remoteTextListeners.get(toolId);
  if (!set) {
    set = new Set();
    remoteTextListeners.set(toolId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

// --- Strokes being drawn ----------------------------------------------------

function dropLive(key: string) {
  if (!state.live[key]) return;
  const live = { ...state.live };
  delete live[key];
  setState({ live });
}

// Somebody whose connection dropped mid-stroke never sends the end of it.
const LIVE_STALE_MS = 4_000;
let liveSweep: ReturnType<typeof setTimeout> | null = null;
function scheduleLiveSweep() {
  if (liveSweep) return;
  liveSweep = setTimeout(() => {
    liveSweep = null;
    const now = Date.now();
    const entries = Object.entries(state.live);
    const fresh = entries.filter(([, l]) => now - l.at < LIVE_STALE_MS);
    if (fresh.length !== entries.length) setState({ live: Object.fromEntries(fresh) });
    if (fresh.length > 0) scheduleLiveSweep();
  }, LIVE_STALE_MS / 2);
}

// Ours, going out: at most one message per LIVE_SEND_MS per tool, a freehand
// line only the points drawn since the last one.
const LIVE_SEND_MS = 60;
const LIVE_MAX_VALUES = 600;
type OutgoingLive = {
  liveId: string;
  stroke: Omit<Stroke, "id" | "by">;
  sent: number;
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const outgoingLive = new Map<string, OutgoingLive>();

function flushLive(toolId: string) {
  const entry = outgoingLive.get(toolId);
  if (!entry) return;
  entry.timer = null;
  entry.lastAt = Date.now();
  const { stroke } = entry;
  const freehand = stroke.shape === "pen" || stroke.shape === "highlighter";
  const offset = freehand && entry.sent <= stroke.points.length ? entry.sent : 0;
  const points = stroke.points.slice(offset, offset + LIVE_MAX_VALUES);
  if (freehand && points.length === 0) return;
  entry.sent = offset + points.length;
  send({
    type: "tool-stroke-live",
    id: toolId,
    liveId: entry.liveId,
    shape: stroke.shape,
    color: stroke.color,
    width: stroke.width,
    offset,
    points,
    ...(stroke.target ? { target: stroke.target } : {}),
  });
  // More drawn than one message carries: the rest goes next time.
  if (freehand && entry.sent < stroke.points.length) entry.timer = setTimeout(() => flushLive(toolId), LIVE_SEND_MS);
}

function setOwnLive(toolId: string, stroke: Omit<Stroke, "id" | "by"> | null) {
  if (!stroke) {
    if (!state.ownLive[toolId]) return;
    const ownLive = { ...state.ownLive };
    delete ownLive[toolId];
    setState({ ownLive });
    return;
  }
  setState({ ownLive: { ...state.ownLive, [toolId]: { ...stroke, toolId, by: "", at: Date.now() } } });
}

// --- Incoming --------------------------------------------------------------

let reactionCounter = 0;
let awaitingCreate: ToolKind | null = null;
let joinedRoom: string | null = null;

function handleMessage(msg: Record<string, unknown>) {
  switch (msg.type) {
    case "room-state": {
      // A new room (or the same one, rejoined): its snapshot follows right
      // behind as "room-tools", and nothing from the last one carries over —
      // except, after a reconnect to the same room, the panel being open.
      const sameRoom = msg.room === joinedRoom;
      joinedRoom = typeof msg.room === "string" ? msg.room : null;
      textSync.clear();
      setState({
        ...EMPTY,
        pen: state.pen,
        panelOpen: sameRoom && state.panelOpen,
        activeToolId: sameRoom ? state.activeToolId : null,
      });
      break;
    }
    case "room-tools": {
      const tools = Array.isArray(msg.tools) ? (msg.tools as RoomTool[]) : [];
      textSync.clear();
      for (const tool of tools) {
        if (isTextTool(tool)) startSync(tool);
      }
      setState({
        tools,
        hands: Array.isArray(msg.hands) ? (msg.hands as RaisedHand[]) : [],
        speakers: Array.isArray(msg.speakers) ? (msg.speakers as string[]) : [],
        optimistic: {},
        activeToolId: state.activeToolId && tools.some((t) => t.id === state.activeToolId) ? state.activeToolId : null,
      });
      break;
    }
    case "tool-upsert": {
      const tool = msg.tool as RoomTool | undefined;
      if (!tool?.id) break;
      const isNew = !state.tools.some((t) => t.id === tool.id);
      if (isTextTool(tool)) {
        const sync = textSync.get(tool.id);
        if (!sync) {
          startSync(tool);
        } else if (msg.rejectedOpId || msg.resync || !sync.dirty) {
          sync.reset(tool.text, tool.version);
        } else {
          // Edits of ours still on their way: keep the text this client is
          // showing, take everything else (title, access, language).
          const current = state.tools.find((t) => t.id === tool.id) as TextTool | undefined;
          replaceTool({ ...tool, text: current?.text ?? tool.text, version: sync.version });
          break;
        }
      }
      replaceTool(tool);
      // The tool this client just asked to open is what its panel shows next.
      // A media tool is a tile in the grid now, which is where to look; a
      // poll is in the chat it was opened from.
      if (isNew && awaitingCreate === tool.kind && tool.createdById === signalingClient.getSnapshot().selfUserId) {
        awaitingCreate = null;
        trackRoomToolsEvent(ROOM_TOOLS_EVENTS.create);
        trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.create}.${tool.kind}`);
        if (MEDIA_KINDS.includes(tool.kind)) setState({ panelOpen: false, activeToolId: null });
        else if (tool.kind !== "poll" && tool.kind !== "reactions") setState({ activeToolId: tool.id });
      }
      break;
    }
    case "tool-removed": {
      const id = msg.id as string;
      textSync.delete(id);
      setState({
        live: Object.fromEntries(Object.entries(state.live).filter(([, l]) => l.toolId !== id)),
        tools: state.tools.filter((t) => t.id !== id),
        activeToolId: state.activeToolId === id ? null : state.activeToolId,
        annotateOff: state.tools.some((t) => t.kind === "annotate" && t.id !== id) ? state.annotateOff : [],
      });
      break;
    }
    case "tool-meta": {
      // Who may use a tool, its name, a code editor's language — the rest of
      // the tool (a whiteboard's strokes, a notepad's text) stays as it is.
      const id = msg.id as string;
      const tool = state.tools.find((t) => t.id === id);
      if (!tool) break;
      const next = { ...tool } as RoomTool;
      if (typeof msg.title === "string") next.title = msg.title;
      if (msg.access === "everyone" || msg.access === "managers" || msg.access === "selected") next.access = msg.access;
      if (Array.isArray(msg.allowed)) next.allowed = msg.allowed as string[];
      if (typeof msg.language === "string" && next.kind === "code") next.language = msg.language;
      replaceTool(next);
      break;
    }
    case "tool-stroke": {
      const stroke = msg.stroke as Stroke | undefined;
      if (!stroke) break;
      const clientId = typeof msg.clientId === "string" ? msg.clientId : null;
      if (clientId && state.optimistic[clientId]) {
        const optimistic = { ...state.optimistic };
        delete optimistic[clientId];
        setState({ optimistic });
      }
      if (clientId) dropLive(`${stroke.by}:${clientId}`);
      // How many of the oldest made room for it on the server (see its
      // addStroke): the same ones go here.
      const trimmed = typeof msg.trimmed === "number" && msg.trimmed > 0 ? msg.trimmed : 0;
      updateTool(msg.id as string, ["whiteboard", "annotate"], (tool) =>
        tool.strokes.some((s) => s.id === stroke.id)
          ? tool
          : { ...tool, strokes: [...tool.strokes, stroke].slice(trimmed).slice(-3000) }
      );
      break;
    }
    case "tool-stroke-live": {
      const by = typeof msg.by === "string" ? msg.by : "";
      const liveId = typeof msg.liveId === "string" ? msg.liveId : "";
      const toolId = msg.id as string;
      if (!by || !liveId || !state.tools.some((t) => t.id === toolId)) break;
      const key = `${by}:${liveId}`;
      if (msg.end === true) {
        dropLive(key);
        break;
      }
      const points = Array.isArray(msg.points) ? (msg.points as number[]) : [];
      const offset = typeof msg.offset === "number" ? msg.offset : 0;
      const previous = state.live[key];
      // A freehand line arrives a piece at a time; a piece that does not
      // follow on from what is here waits for the next whole one rather than
      // drawing a jump.
      let merged: number[];
      if (offset === 0) merged = points;
      else if (previous && previous.points.length === offset) merged = [...previous.points, ...points];
      else break;
      setState({
        live: {
          ...state.live,
          [key]: {
            toolId,
            by,
            shape: msg.shape as StrokeShape,
            color: typeof msg.color === "string" ? msg.color : "#ef4444",
            width: typeof msg.width === "number" ? msg.width : 3,
            points: merged,
            ...(typeof msg.target === "string" ? { target: msg.target } : {}),
            at: Date.now(),
          },
        },
      });
      scheduleLiveSweep();
      break;
    }
    case "tool-stroke-moved": {
      const strokeId = msg.strokeId as string;
      const points = Array.isArray(msg.points) ? (msg.points as number[]) : null;
      if (!points) break;
      updateTool(msg.id as string, ["whiteboard", "annotate"], (tool) => ({
        ...tool,
        strokes: tool.strokes.map((s) => (s.id === strokeId ? { ...s, points } : s)),
      }));
      break;
    }
    case "tool-strokes-removed": {
      const ids = new Set(Array.isArray(msg.strokeIds) ? (msg.strokeIds as string[]) : []);
      updateTool(msg.id as string, ["whiteboard", "annotate"], (tool) => ({
        ...tool,
        strokes: tool.strokes.filter((s) => !ids.has(s.id)),
      }));
      break;
    }
    case "tool-text-op": {
      const id = msg.id as string;
      const sync = textSync.get(id);
      const tool = state.tools.find((t) => t.id === id);
      if (!sync || !tool || !isTextTool(tool)) break;
      const result = sync.receive(msg.op as TextOp, msg.version as number, typeof msg.opId === "string" ? msg.opId : null);
      if (result === "out of step") {
        // Missed one — start over from the server's text.
        signalingClient.sendMessage({ type: "tool-sync", id });
        break;
      }
      replaceTool({ ...tool, text: sync.text, version: sync.version });
      if (result) for (const listener of remoteTextListeners.get(id) ?? []) listener(result);
      break;
    }
    case "tool-sheet": {
      const change = msg.change as SheetChange | undefined;
      if (!change) break;
      updateTool(msg.id as string, ["sheet"], (tool) => applySheetChange(tool, change));
      break;
    }
    case "tool-reaction": {
      const emoji = typeof msg.emoji === "string" ? msg.emoji : "";
      if (!emoji) break;
      const key = `r${++reactionCounter}`;
      const reaction: FloatingReaction = {
        key,
        emoji,
        name: typeof msg.name === "string" ? msg.name : "",
        x: 10 + Math.random() * 80,
        target: typeof msg.target === "string" ? msg.target : "",
      };
      // A burst of a hundred hearts is a party; a thousand is a slideshow.
      if (!reaction.target) break;
      setState({ reactions: [...state.reactions, reaction].slice(-60) });
      setTimeout(() => setState({ reactions: state.reactions.filter((r) => r.key !== key) }), 3600);
      break;
    }
    case "room-hands":
      setState({
        hands: Array.isArray(msg.hands) ? (msg.hands as RaisedHand[]) : [],
        speakers: Array.isArray(msg.speakers) ? (msg.speakers as string[]) : [],
      });
      break;
  }
}

if (typeof window !== "undefined") {
  signalingClient.onMessage(handleMessage);
  // Leaving the room leaves its tools.
  let lastRoom = signalingClient.getSnapshot().room;
  signalingClient.subscribe(() => {
    const room = signalingClient.getSnapshot().room;
    if (room === lastRoom) return;
    lastRoom = room;
    if (!room) {
      joinedRoom = null;
      textSync.clear();
      setState({ ...EMPTY, pen: state.pen });
    }
  });
}

// --- Outgoing --------------------------------------------------------------

function send(msg: Record<string, unknown>) {
  signalingClient.sendMessage(msg);
}

export const roomTools = {
  openPanel(open = true) {
    if (open && !state.panelOpen) trackRoomToolsEvent(ROOM_TOOLS_EVENTS.panelOpen);
    setState({ panelOpen: open });
  },
  togglePanel() {
    if (!state.panelOpen) trackRoomToolsEvent(ROOM_TOOLS_EVENTS.panelOpen);
    setState({ panelOpen: !state.panelOpen });
  },
  select(id: string | null) {
    setState({ activeToolId: id });
  },
  setStageFocused(focused: boolean) {
    if (state.stageFocused !== focused) setState({ stageFocused: focused });
  },
  openPollDialog(open = true) {
    setState({ pollDialogOpen: open });
  },
  /** Pen down (or up) on one media. */
  setAnnotating(mediaKey: string, on: boolean) {
    const off = state.annotateOff.filter((key) => key !== mediaKey);
    setState({ annotateOff: on ? off : [...off, mediaKey] });
  },
  setPen(pen: Partial<RoomToolsState["pen"]>) {
    setState({ pen: { ...state.pen, ...pen } });
  },

  create(
    kind: ToolKind,
    options: {
      title?: string;
      access?: ToolAccess;
      allowed?: string[];
      language?: string;
      poll?: {
        question: string;
        options: string[];
        multi: boolean;
        anonymous: boolean;
        announce: boolean;
        durationMinutes: number | null;
      };
      rules?: TaskRules;
      // A poll while another runs: end that one (result posted) and open this.
      replace?: boolean;
    } = {}
  ) {
    awaitingCreate = kind;
    send({ type: "tool-create", kind, ...options });
  },
  close(id: string) {
    send({ type: "tool-close", id });
  },
  setAccess(id: string, access: ToolAccess, allowed: string[], title?: string) {
    send({ type: "tool-access", id, access, allowed, ...(title !== undefined ? { title } : {}) });
  },

  /**
   * The stroke being drawn right now, as it grows — or null when the pen came
   * up without one. The finished stroke (addStroke) carries the same id, which
   * is what takes this one off everybody else's screen.
   */
  drawLive(toolId: string, stroke: Omit<Stroke, "id" | "by"> | null) {
    const entry = outgoingLive.get(toolId);
    setOwnLive(toolId, stroke);
    if (!stroke) {
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      outgoingLive.delete(toolId);
      if (entry.lastAt > 0) send({ type: "tool-stroke-live", id: toolId, liveId: entry.liveId, end: true });
      return;
    }
    const current: OutgoingLive =
      entry ?? { liveId: `s${Date.now().toString(36)}${++strokeCounter}`, stroke, sent: 0, lastAt: 0, timer: null };
    current.stroke = stroke;
    outgoingLive.set(toolId, current);
    if (current.timer) return;
    const wait = LIVE_SEND_MS - (Date.now() - current.lastAt);
    if (wait <= 0) flushLive(toolId);
    else current.timer = setTimeout(() => flushLive(toolId), wait);
  },

  addStroke(toolId: string, stroke: Omit<Stroke, "id" | "by">, selfUserId: string | null) {
    // The id the live copy went out under, when there was one.
    const live = outgoingLive.get(toolId);
    if (live?.timer) clearTimeout(live.timer);
    outgoingLive.delete(toolId);
    setOwnLive(toolId, null);
    const clientId = live?.liveId ?? `s${Date.now().toString(36)}${++strokeCounter}`;
    setState({
      optimistic: { ...state.optimistic, [clientId]: { ...stroke, id: clientId, by: selfUserId ?? "", toolId } },
    });
    // A stroke the server refused (no access any more, say) would otherwise
    // hang there forever.
    setTimeout(() => {
      if (!state.optimistic[clientId]) return;
      const optimistic = { ...state.optimistic };
      delete optimistic[clientId];
      setState({ optimistic });
    }, 8000);
    send({ type: "tool-stroke", id: toolId, stroke, clientId });
    trackFirstUse(toolId, ROOM_TOOLS_EVENTS.draw);
  },
  /**
   * A pasted picture or text put somewhere else (or a picture resized), in
   * place — it keeps its order among the strokes. Shown at once.
   */
  moveStroke(toolId: string, strokeId: string, points: number[]) {
    updateTool(toolId, ["whiteboard", "annotate"], (tool) => ({
      ...tool,
      strokes: tool.strokes.map((s) => (s.id === strokeId ? { ...s, points } : s)),
    }));
    send({ type: "tool-stroke-move", id: toolId, strokeId, points });
  },
  removeStrokes(toolId: string, strokeIds: string[]) {
    if (strokeIds.length > 0) send({ type: "tool-strokes-remove", id: toolId, strokeIds });
  },
  clearStrokes(toolId: string, target?: string) {
    send({ type: "tool-strokes-remove", id: toolId, all: true, ...(target ? { target } : {}) });
  },

  /** The editor's text is now `next`: shown at once, sent as an operation. */
  editText(toolId: string, next: string) {
    const tool = state.tools.find((t) => t.id === toolId);
    const sync = textSync.get(toolId);
    if (!tool || !sync || !isTextTool(tool)) return;
    sync.edit(next);
    replaceTool({ ...tool, text: sync.text });
    trackFirstUse(toolId, ROOM_TOOLS_EVENTS.type);
  },
  /**
   * A change to a spreadsheet. Shown at once when applying it again changes
   * nothing (a value, a style); a row or column in or out waits for the
   * server, which puts everybody's in the same order.
   */
  editSheet(toolId: string, change: SheetChange) {
    if (changeIsIdempotent(change)) updateTool(toolId, ["sheet"], (tool) => applySheetChange(tool, change));
    send({ type: "tool-sheet", id: toolId, change });
    trackFirstUse(toolId, ROOM_TOOLS_EVENTS.type);
  },
  setLanguage(toolId: string, language: string) {
    send({ type: "tool-code-language", id: toolId, language });
  },

  vote(toolId: string, optionIds: string[]) {
    send({ type: "tool-poll-vote", id: toolId, optionIds });
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.pollVote);
  },
  // Ends it for good: it leaves the chat, its result posted there if asked.
  closePoll(toolId: string) {
    send({ type: "tool-poll-close", id: toolId });
    // Out of the chat's header at once — the server's "tool-removed" follows.
    setState({ tools: state.tools.filter((t) => t.id !== toolId) });
  },

  addTask(toolId: string, task: { text: string; assigneeId?: string | null; priority?: TaskPriority; due?: string | null }) {
    send({ type: "tool-task", id: toolId, action: "add", ...task });
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.taskAdd);
  },
  toggleTask(toolId: string, itemId: string) {
    // Only ticking it counts, not unticking.
    const tool = state.tools.find((t): t is TasksTool => t.id === toolId && t.kind === "tasks");
    if (tool?.items.some((item) => item.id === itemId && !item.done)) trackRoomToolsEvent(ROOM_TOOLS_EVENTS.taskDone);
    send({ type: "tool-task", id: toolId, action: "toggle", itemId });
  },
  editTask(
    toolId: string,
    itemId: string,
    changes: { text?: string; assigneeId?: string | null; priority?: TaskPriority; due?: string | null }
  ) {
    send({ type: "tool-task", id: toolId, action: "edit", itemId, ...changes });
  },
  removeTask(toolId: string, itemId: string) {
    send({ type: "tool-task", id: toolId, action: "remove", itemId });
  },
  clearDoneTasks(toolId: string) {
    send({ type: "tool-task", id: toolId, action: "clear-done" });
  },
  setTaskRules(toolId: string, rules: TaskRules) {
    send({ type: "tool-task", id: toolId, action: "rules", rules });
  },

  /** A reaction over one of the room's media (`target` — see toolMediaKey and the tiles' mediaKey). */
  react(toolId: string, emoji: string, target: string) {
    send({ type: "tool-reaction", id: toolId, emoji, target });
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.reaction);
  },

  /** Opens the panel on one tool — what the chat's task bubble does. */
  show(toolId: string) {
    setState({ panelOpen: true, activeToolId: toolId });
  },
  raiseHand(raised: boolean) {
    send({ type: "hand-raise", raised });
    if (raised) trackRoomToolsEvent(ROOM_TOOLS_EVENTS.handRaise);
  },
  grantSpeaker(userId: string) {
    send({ type: "hand-grant", userId });
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.handGrant);
  },
  revokeSpeaker(userId: string) {
    send({ type: "hand-revoke", userId });
  },
  dismissHand(userId: string) {
    send({ type: "hand-dismiss", userId });
  },
};

/** Whether `userId` may use `tool` — the mirror of the server's canUseTool, for what to render. */
export function canUseTool(tool: RoomTool, userId: string | null, isManager: boolean): boolean {
  if (isManager) return true;
  if (tool.access === "everyone") return true;
  if (tool.access === "selected") return Boolean(userId && tool.allowed.includes(userId));
  return false;
}
