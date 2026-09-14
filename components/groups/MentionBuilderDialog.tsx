"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MdAdd, MdClose, MdDeleteOutline, MdGroups, MdHelpOutline, MdLock, MdSearch } from "react-icons/md";
import { normalizeSearch } from "@/lib/chatMentions";
import { fetchMentionAudience } from "@/lib/groupsApi";
import {
  MAX_EXPR_ATOMS,
  isWritableRole,
  mayMention,
  mentionEntryOf,
  normalizeMentionExpr,
  typedMention,
  type MentionAtom,
  type MentionExpr,
} from "@/lib/mentionExpr";
import { useT, useTCount } from "@/lib/useI18n";

// "@mention": a mention put together by ticking boxes instead of typing the
// braces — which roles, online or offline, joined with E (all of them) or OU
// (any of them), in groups inside groups. What comes out is the same text a
// person could have typed ("{@Admin&{@Mod|@online}}", see lib/mentionExpr),
// inserted into the message where "@mention" was; nothing about it is special
// once it is there.
//
// Below the boxes: that text, the same thing in words, and how many people it
// would alert in this room right now (asked of the API as the boxes change).
// Whether it may be sent is worked out here by the same rule the API applies,
// so a mention the author may not send is said so before it is inserted.

type Translate = ReturnType<typeof useT>;

/** A role as the editor needs it — highest first, the group's own order. */
export interface BuilderRole {
  id: string;
  name: string;
  color: string | null;
  mentionable: boolean;
}

type Pick = "in" | "not";

/** One box of the editor: its ticked options and the groups inside it, joined by `op`. */
interface GroupNode {
  key: number;
  op: "and" | "or";
  /** "Não": the whole group turned around. Never on the outermost one. */
  negate: boolean;
  /** Option key -> whether it is in as itself or as its opposite. */
  picks: Record<string, Pick>;
  groups: GroupNode[];
}

interface Option {
  key: string;
  atom: MentionAtom;
  label: string;
  /** Whether "não" is offered — only for roles; "não online" is just offline. */
  negatable: boolean;
  color?: string | null;
  /** A role this person may not mention on its own (it can still narrow one they may). */
  locked?: boolean;
}

/** How deep groups may go — the grammar allows more, a screen does not. */
const MAX_NESTING = 3;
const PREVIEW_DEBOUNCE_MS = 250;
/** More roles than this, and a filter appears above them. */
const FILTER_FROM = 12;

let nextKey = 1;
function newGroup(op: "and" | "or"): GroupNode {
  nextKey += 1;
  return { key: nextKey, op, negate: false, picks: {}, groups: [] };
}

/** The group, as an expression — null while nothing in it is ticked. */
function groupExpr(node: GroupNode, options: Option[]): MentionExpr | null {
  const args: MentionExpr[] = [];
  for (const option of options) {
    const pick = node.picks[option.key];
    if (!pick) continue;
    args.push(pick === "not" ? { kind: "not", arg: option.atom } : option.atom);
  }
  for (const child of node.groups) {
    const expr = groupExpr(child, options);
    if (expr) args.push(expr);
  }
  if (args.length === 0) return null;
  const joined: MentionExpr = args.length === 1 ? args[0] : { kind: node.op, args };
  return node.negate ? { kind: "not", arg: joined } : joined;
}

/** The tree with the group `key` replaced by what `change` makes of it (null removes it). */
function withGroup(node: GroupNode, key: number, change: (group: GroupNode) => GroupNode | null): GroupNode | null {
  if (node.key === key) return change(node);
  let changed = false;
  const groups: GroupNode[] = [];
  for (const child of node.groups) {
    const next = withGroup(child, key, change);
    if (next !== child) changed = true;
    if (next) groups.push(next);
  }
  return changed ? { ...node, groups } : node;
}

function countAtoms(expr: MentionExpr): number {
  if (expr.kind === "not") return countAtoms(expr.arg);
  if (expr.kind === "and" || expr.kind === "or") return expr.args.reduce((n, arg) => n + countAtoms(arg), 0);
  return 1;
}

/**
 * An expression in words — "Quem tem o cargo Admin e está online" — for the
 * editor's preview and the tooltip on a mention in a message.
 */
export function describeMention(expr: MentionExpr, roleName: (id: string) => string, t: Translate): string {
  const k = (key: string, vars?: Record<string, string>) => t(`groups.mentionBuilder.describe.${key}`, vars);
  if (expr.kind === "everyone") return k("everyone");
  const nested = (e: MentionExpr, parent: "and" | "or") =>
    (e.kind === "and" || e.kind === "or") && e.kind !== parent ? `(${clause(e)})` : clause(e);
  function clause(e: MentionExpr): string {
    switch (e.kind) {
      case "everyone":
        return k("inGroup");
      case "online":
        return k("online");
      case "offline":
        return k("offline");
      case "role":
        return k("role", { name: roleName(e.id) });
      case "not":
        if (e.arg.kind === "role") return k("notRole", { name: roleName(e.arg.id) });
        if (e.arg.kind === "online") return k("notOnline");
        if (e.arg.kind === "offline") return k("notOffline");
        if (e.arg.kind === "everyone") return k("notInGroup");
        return k("not", { rest: clause(e.arg) });
      case "and":
        return e.args.map((arg) => nested(arg, "and")).join(k("and"));
      case "or":
        return e.args.map((arg) => nested(arg, "or")).join(k("or"));
    }
  }
  return k("who", { rest: clause(expr) });
}

const subscribeNothing = () => () => {};

export function MentionBuilderDialog({
  groupId,
  channelId,
  roles,
  canMentionEveryone,
  onInsert,
  onClose,
}: {
  groupId: string;
  channelId: string;
  roles: BuilderRole[];
  /** "Mencionar @everyone" here — see lib/mentionExpr's mayMention. */
  canMentionEveryone: boolean;
  /** The mention as text, to go into the message — closing the editor is the caller’s part. */
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tc = useTCount();
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [root, setRoot] = useState<GroupNode>(() => newGroup("and"));
  const [filter, setFilter] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  // Only roles whose name can be written into an expression and read back as
  // themselves (see isWritableRole) — anything else would insert a mention
  // that silently means something else.
  const writable = useMemo(() => roles.filter((role) => isWritableRole(role, roles)), [roles]);
  const hiddenRoles = roles.length - writable.length;

  const statusOptions = useMemo<Option[]>(
    () => [
      { key: "everyone", atom: { kind: "everyone" }, label: "@everyone", negatable: false },
      { key: "online", atom: { kind: "online" }, label: "@online", negatable: false },
      { key: "offline", atom: { kind: "offline" }, label: "@offline", negatable: false },
    ],
    []
  );
  const roleOptions = useMemo<Option[]>(
    () =>
      writable.map((role) => ({
        key: `role:${role.id}`,
        atom: { kind: "role", id: role.id },
        label: `@${role.name.trim()}`,
        negatable: true,
        color: role.color,
        locked: !role.mentionable && !canMentionEveryone,
      })),
    [writable, canMentionEveryone]
  );
  const options = useMemo(() => [...statusOptions, ...roleOptions], [statusOptions, roleOptions]);
  const wanted = normalizeSearch(filter.trim());
  const shownRoles = wanted
    ? roleOptions.filter((option) => normalizeSearch(option.label).includes(wanted))
    : roleOptions;

  const raw = groupExpr(root, options);
  const expr = raw ? normalizeMentionExpr(raw) : null;
  const typed = expr ? typedMention(expr, roles) : null;
  const entry = expr ? mentionEntryOf(expr) : null;
  const tooMany = expr ? countAtoms(expr) > MAX_EXPR_ATOMS : false;
  const allowed = expr
    ? mayMention(expr, {
        everyone: canMentionEveryone,
        role: (id) => canMentionEveryone || Boolean(roles.find((r) => r.id === id)?.mentionable),
      })
    : false;
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name.trim() ?? "?";

  // Who it would reach, once the ticking pauses. Tagged with the entry it is
  // for, so an answer for an earlier state of the boxes is never shown.
  const [audience, setAudience] = useState<
    { entry: string; allowed: boolean; count: number; online: number } | { entry: string; failed: true } | null
  >(null);
  useEffect(() => {
    if (!entry || tooMany) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchMentionAudience(groupId, channelId, entry, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setAudience(
            result.ok
              ? { entry, allowed: result.allowed, count: result.count, online: result.online }
              : { entry, failed: true }
          );
        })
        .catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [groupId, channelId, entry, tooMany]);
  const preview = audience && audience.entry === entry ? audience : null;
  const refused = preview && "allowed" in preview && !preview.allowed;
  const canInsert = Boolean(expr && typed && allowed && !tooMany && !refused);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelectorAll(".golive-dialog-backdrop").length > 1) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function change(key: number, fn: (group: GroupNode) => GroupNode | null) {
    setRoot((current) => withGroup(current, key, fn) ?? current);
  }

  function insert() {
    if (!canInsert || !typed) return;
    onInsert(typed);
  }

  if (!onClient) return null;

  function renderChip(group: GroupNode, option: Option) {
    const pick = group.picks[option.key];
    const setPick = (next: Pick | null) =>
      change(group.key, (g) => {
        const picks = { ...g.picks };
        if (next) picks[option.key] = next;
        else delete picks[option.key];
        return { ...g, picks };
      });
    return (
      <span
        key={option.key}
        className={`inline-flex max-w-full items-center rounded-lg border text-xs transition ${
          pick === "not"
            ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
            : pick
              ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10"
              : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
        }`}
      >
        <label className="flex min-w-0 cursor-pointer items-center gap-1.5 py-1 pl-2 pr-2">
          <input
            type="checkbox"
            checked={Boolean(pick)}
            onChange={(e) => setPick(e.target.checked ? "in" : null)}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
          />
          {option.key === "online" && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
          {option.key === "offline" && <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-400" />}
          {option.key === "everyone" && <MdGroups className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />}
          {option.atom.kind === "role" && (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color ?? "#5865f2" }} />
          )}
          <span
            className="truncate font-medium text-zinc-800 dark:text-zinc-200"
            style={option.color ? { color: option.color } : undefined}
          >
            {option.label}
          </span>
          {option.locked && (
            <span title={t("groups.mentionBuilder.lockedRole")} className="shrink-0 text-zinc-400">
              <MdLock className="h-3 w-3" />
            </span>
          )}
        </label>
        {pick && option.negatable && (
          <button
            type="button"
            onClick={() => setPick(pick === "not" ? "in" : "not")}
            aria-pressed={pick === "not"}
            title={t("groups.mentionBuilder.notHint")}
            className={`mr-1 shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition ${
              pick === "not"
                ? "bg-red-600 text-white"
                : "text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t("groups.mentionBuilder.not")}
          </button>
        )}
      </span>
    );
  }

  function renderGroup(group: GroupNode, depth: number) {
    const accent = group.op === "and" ? "border-l-blue-500" : "border-l-amber-500";
    return (
      <div
        key={group.key}
        className={`rounded-xl border border-l-4 border-zinc-200 p-3 dark:border-zinc-800 ${accent} ${
          depth % 2 === 0 ? "bg-zinc-50 dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-950"
        }`}
      >
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("groups.mentionBuilder.joinWith")} className="flex rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
            {(["and", "or"] as const).map((op) => (
              <button
                key={op}
                type="button"
                role="radio"
                aria-checked={group.op === op}
                onClick={() => change(group.key, (g) => ({ ...g, op }))}
                className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  group.op === op
                    ? op === "and"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-amber-500 text-white shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {op === "and" ? t("groups.mentionBuilder.and") : t("groups.mentionBuilder.or")}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {group.op === "and" ? t("groups.mentionBuilder.andHint") : t("groups.mentionBuilder.orHint")}
          </span>
          {depth > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={group.negate}
                  onChange={(e) => change(group.key, (g) => ({ ...g, negate: e.target.checked }))}
                  className="h-3.5 w-3.5 cursor-pointer accent-red-600"
                />
                {t("groups.mentionBuilder.negateGroup")}
              </label>
              <button
                type="button"
                onClick={() => change(group.key, () => null)}
                aria-label={t("groups.mentionBuilder.removeGroup")}
                title={t("groups.mentionBuilder.removeGroup")}
                className="cursor-pointer rounded-md p-1 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-600"
              >
                <MdDeleteOutline className="h-4 w-4" />
              </button>
            </span>
          )}
        </div>

        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {t("groups.mentionBuilder.status")}
        </p>
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {statusOptions.map((option) => (
            renderChip(group, option)
          ))}
        </div>

        {roleOptions.length > 0 && (
          <>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {t("groups.mentionBuilder.roles")}
            </p>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {shownRoles.map((option) => (
                renderChip(group, option)
              ))}
              {shownRoles.length === 0 && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.mentionBuilder.noRoleMatch")}</span>
              )}
            </div>
          </>
        )}

        {group.groups.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-2">
            {group.groups.map((child) => (
              renderGroup(child, depth + 1)
            ))}
          </div>
        )}

        {depth < MAX_NESTING - 1 && (
          <button
            type="button"
            // The other operator by default: a group joined the same way as
            // the one it sits in would just be more of the same.
            onClick={() =>
              change(group.key, (g) => ({ ...g, groups: [...g.groups, newGroup(g.op === "and" ? "or" : "and")] }))
            }
            className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <MdAdd className="h-4 w-4" />
            {t("groups.mentionBuilder.addGroup")}
          </button>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      className="golive-dialog-backdrop fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("groups.mentionBuilder.title")}
    >
      <div className="golive-dialog-card flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-black/10 dark:bg-zinc-950 sm:dark:border-white/10">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{t("groups.mentionBuilder.title")}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.mentionBuilder.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setHelpOpen((open) => !open)}
              aria-expanded={helpOpen}
              aria-label={t("groups.mentionBuilder.syntaxTitle")}
              title={t("groups.mentionBuilder.syntaxTitle")}
              className={`cursor-pointer rounded-full p-1.5 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 ${
                helpOpen ? "text-blue-600 dark:text-blue-400" : "text-zinc-500"
              }`}
            >
              <MdHelpOutline className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="cursor-pointer rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <MdClose className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {helpOpen && (
            <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-zinc-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-zinc-300">
              <p className="mb-2">{t("groups.mentionBuilder.syntaxIntro")}</p>
              <ul className="flex flex-col gap-1">
                {[
                  ["@online", "syntaxOnline"],
                  ["@offline", "syntaxOffline"],
                  ["{@Cargo&@online}", "syntaxAnd"],
                  ["{@Cargo1|@Cargo2}", "syntaxOr"],
                  ["{@Cargo1&{@Cargo2|@online}}", "syntaxNested"],
                  ["{@Cargo1&!@Cargo2}", "syntaxNot"],
                ].map(([code, key]) => (
                  <li key={code} className="flex flex-wrap items-baseline gap-x-2">
                    <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-blue-700 dark:bg-zinc-900 dark:text-blue-300">
                      {code}
                    </code>
                    <span>{t(`groups.mentionBuilder.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {roleOptions.length > FILTER_FROM && (
            <label className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              <MdSearch className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("groups.mentionBuilder.filterRoles")}
                aria-label={t("groups.mentionBuilder.filterRoles")}
                maxLength={64}
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-950 outline-none dark:text-zinc-50"
              />
            </label>
          )}

          {renderGroup(root, 0)}

          {hiddenRoles > 0 && (
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {tc("groups.mentionBuilder.hiddenRoles", hiddenRoles)}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
            {expr && typed ? (
              <>
                <p className="break-words font-mono text-sm font-semibold text-blue-700 dark:text-blue-300">{typed}</p>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{describeMention(expr, roleName, t)}</p>
              </>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.mentionBuilder.empty")}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-h-4 text-xs">
              {!expr ? null : tooMany ? (
                <span className="text-red-600 dark:text-red-400">
                  {t("groups.mentionBuilder.tooMany", { max: String(MAX_EXPR_ATOMS) })}
                </span>
              ) : !allowed || refused ? (
                <span className="text-red-600 dark:text-red-400">{t("groups.mentionBuilder.notAllowed")}</span>
              ) : !preview ? (
                <span className="text-zinc-400">{t("groups.mentionBuilder.counting")}</span>
              ) : "failed" in preview ? (
                <span className="text-zinc-400">{t("groups.mentionBuilder.countFailed")}</span>
              ) : (
                <span className="text-zinc-600 dark:text-zinc-300">
                  {tc("groups.mentionBuilder.willAlert", preview.count)}
                  {preview.count > 0 && (
                    <span className="text-zinc-400"> · {tc("groups.mentionBuilder.onlineNow", preview.online)}</span>
                  )}
                </span>
              )}
            </p>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={insert}
                disabled={!canInsert}
                className="cursor-pointer rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {t("groups.mentionBuilder.insert")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
