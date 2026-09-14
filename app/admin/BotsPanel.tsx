"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BotTag } from "@/components/BotTag";
import { UserAvatar } from "@/components/UserAvatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { GroupIcon } from "@/components/groups/GroupIcon";
import {
  deleteAdminBot,
  fetchAdminBot,
  removeAdminBotFromGroups,
  revokeAdminBotToken,
  searchAdminBots,
  setAccountFlags,
  setAdminBotPublic,
  suspendAdminBot,
  unsuspendAdminBot,
  type AdminBotFilter,
  type AdminBotGroup,
  type AdminBotHit,
  type AdminBotList,
} from "@/lib/adminApi";
import { groupPath } from "@/lib/groupLinks";
import { useI18n } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// The site's hand on a bot: finding one — public or private, which the /bots
// directory never shows — and suspending it, taking it out of its groups,
// killing a leaked token, switching it private, editing its flags, or deleting
// it for good.
//
// Suspending is an account ban underneath (see the API's adminBotRoutes): the
// bot is disconnected at once, its token is refused everywhere, and it cannot
// be added to a group; lifting it brings the bot back as it was. Its flags are
// an account's flags, saved through the same route as the accounts panel.
//
// Every one of these goes through /admin, so the log records who did it (see
// the "Registros" tab).

const KNOWN_FLAGS = ["VERIFIED"];

const FILTERS: AdminBotFilter[] = ["all", "public", "private", "suspended", "online"];

/** How long a suspension lasts, in minutes — null is until lifted. */
const DURATIONS: { minutes: number | null; key: string }[] = [
  { minutes: null, key: "admin.botsPanel.untilLifted" },
  { minutes: 60, key: "admin.botsPanel.oneHour" },
  { minutes: 60 * 24, key: "admin.botsPanel.oneDay" },
  { minutes: 60 * 24 * 7, key: "admin.botsPanel.sevenDays" },
  { minutes: 60 * 24 * 30, key: "admin.botsPanel.thirtyDays" },
];

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButton =
  "rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButton =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const dangerOutline =
  "rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(formatLocale(), { dateStyle: "short", timeStyle: "short" });
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function BotsPanel() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AdminBotFilter>("all");
  const [list, setList] = useState<AdminBotList | null>(null);
  const [selected, setSelected] = useState<AdminBotHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to read the list again after something changed a bot in it.
  const [seq, setSeq] = useState(0);

  // The newest bots with nothing typed; a search once there is.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        searchAdminBots(query, filter)
          .then((next) => {
            if (!cancelled) {
              setList(next);
              setError(null);
            }
          })
          .catch((err: Error) => {
            if (!cancelled) setError(err.message);
          });
      },
      query.trim() ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, filter, seq]);

  function replace(bot: AdminBotHit) {
    setSelected((current) => (current?.id === bot.id ? bot : current));
    setList((current) =>
      current ? { ...current, bots: current.bots.map((hit) => (hit.id === bot.id ? bot : hit)) } : current
    );
  }

  const filterCount = (entry: AdminBotFilter): number | null => {
    if (!list) return null;
    const { counts } = list;
    if (entry === "all") return counts.all;
    if (entry === "public") return counts.public;
    if (entry === "private") return counts.all - counts.public;
    if (entry === "suspended") return counts.suspended;
    return counts.online;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className={card}>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.botsPanel.title")}</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.searchHint")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => {
            const count = filterCount(entry);
            return (
              <button
                key={entry}
                type="button"
                onClick={() => setFilter(entry)}
                aria-pressed={filter === entry}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  filter === entry
                    ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                {t(`admin.botsPanel.filter.${entry}`)}
                {count !== null && <span className="ml-1 opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.botsPanel.searchPlaceholder")}
          className={`${inputClass} mt-3`}
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {list === null ? (
          <p className="mt-3 text-xs text-zinc-500">{t("common.loading")}</p>
        ) : list.bots.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.noBotFound")}</p>
        ) : (
          <>
            <ul className="mt-3 flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
              {list.bots.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(hit)}
                    aria-current={selected?.id === hit.id ? "true" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                      selected?.id === hit.id ? "bg-zinc-100 dark:bg-zinc-900" : ""
                    }`}
                  >
                    <span className="relative shrink-0">
                      <UserAvatar src={hit.avatarUrl} name={hit.displayName} size={32} userId={hit.id} />
                      {hit.online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-900 dark:text-zinc-100">
                        <span className="truncate">{hit.displayName}</span>
                        <VerifiedBadge flags={hit.flags} className="h-3.5 w-3.5 shrink-0" />
                        <BotTag className="shrink-0" />
                        {hit.suspension && <StatusTag tone="amber">{t("common.suspended")}</StatusTag>}
                        {!hit.public && <StatusTag tone="zinc">{t("common.private")}</StatusTag>}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        @{hit.username} · {t("admin.botsPanel.ownerShort")}{" "}
                        {hit.owner?.username ? `@${hit.owner.username}` : (hit.owner?.id ?? "—")} ·{" "}
                        {t("admin.botsPanel.groupsShort", { count: hit.groupCount })}
                        {hit.flags.length > 0 && ` · ${hit.flags.join(", ")}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.total > list.bots.length && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {t("admin.botsPanel.showingOf", { shown: list.bots.length, total: list.total })}
              </p>
            )}
          </>
        )}
      </div>

      {selected && (
        <BotDetail
          key={selected.id}
          bot={selected}
          onChange={replace}
          onDeleted={() => {
            setSelected(null);
            // Read again rather than filtered here: the counts on the filters
            // moved too.
            setSeq((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function StatusTag({ tone, children }: { tone: "amber" | "zinc" | "emerald"; children: React.ReactNode }) {
  const colours = {
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  };
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colours[tone]}`}>
      {children}
    </span>
  );
}

function BotDetail({
  bot,
  onChange,
  onDeleted,
}: {
  bot: AdminBotHit;
  onChange: (bot: AdminBotHit) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  // The groups it is in — read when a bot is picked, not in the list.
  const [groups, setGroups] = useState<AdminBotGroup[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBot(bot.id)
      .then((data) => {
        if (cancelled) return;
        setGroups(data.groups);
        onChange(data.bot);
      })
      .catch((err: Error) => {
        if (!cancelled) setGroupsError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // Once per bot: onChange is a fresh function every render of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="flex items-start gap-3">
          <UserAvatar src={bot.avatarUrl} name={bot.displayName} size={56} userId={bot.id} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
              <span className="truncate">{bot.displayName}</span>
              <VerifiedBadge flags={bot.flags} className="h-4 w-4 shrink-0" />
              <BotTag />
              {bot.suspension && <StatusTag tone="amber">{t("common.suspended")}</StatusTag>}
              <StatusTag tone="zinc">{bot.public ? t("common.public") : t("common.private")}</StatusTag>
              {bot.online && <StatusTag tone="emerald">{t("admin.botsPanel.online")}</StatusTag>}
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">@{bot.username}</p>
            {bot.bio && <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">{bot.bio}</p>}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <dt>ID</dt>
              <dd className="break-all font-mono text-zinc-700 dark:text-zinc-300">{bot.id}</dd>
              <dt>{t("common.owner")}</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">
                {bot.owner ? (
                  <Link href={`/user/${bot.owner.username ?? bot.owner.id}`} target="_blank" className="underline underline-offset-2">
                    {bot.owner.displayName ?? bot.owner.id}
                    {bot.owner.username && ` (@${bot.owner.username})`}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt>{t("common.groups")}</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{bot.groupCount}</dd>
              <dt>{t("admin.groupsPanel.created")}</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{formatDate(bot.createdAt)}</dd>
            </dl>
            <Link
              href={`/user/${bot.username}`}
              target="_blank"
              className="mt-2 inline-block text-xs font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {t("admin.botsPanel.openProfile")}
            </Link>
          </div>
        </div>
      </div>

      <SuspensionCard bot={bot} onChange={onChange} />
      <VisibilityCard bot={bot} onChange={onChange} />
      <FlagsCard bot={bot} onChange={onChange} />
      <GroupsCard
        bot={bot}
        groups={groups}
        error={groupsError}
        onCleared={(next, nextGroups) => {
          onChange(next);
          setGroups(nextGroups);
        }}
      />
      <TokenCard bot={bot} />
      <DeleteCard bot={bot} onDeleted={onDeleted} />
    </div>
  );
}

function SuspensionCard({ bot, onChange }: { bot: AdminBotHit; onChange: (bot: AdminBotHit) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<AdminBotHit>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      setReason("");
    } catch (err) {
      setError(errorText(err, t("admin.groupsPanel.itFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.groupsPanel.suspension")}</h3>
      {bot.suspension ? (
        <>
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">
              {t("admin.groupsPanel.suspendedSince")} {formatDate(bot.suspension.at)}
            </p>
            <p className="mt-0.5 text-xs">
              {bot.suspension.expiresAt
                ? t("admin.botsPanel.until", { date: formatDate(bot.suspension.expiresAt) })
                : t("admin.botsPanel.untilLifted")}
              {" · "}
              {bot.suspension.reason
                ? t("admin.groupsPanel.reasonReason", { reason: bot.suspension.reason })
                : t("admin.groupsPanel.noReasonGiven")}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void run(() => unsuspendAdminBot(bot.id))} className={primaryButton}>
              {busy ? t("common.removing") : t("admin.groupsPanel.removeSuspension")}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.suspendExplain")}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder={t("admin.botsPanel.reasonPlaceholder")}
            className={`${inputClass} mt-3 resize-none`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={duration === null ? "" : String(duration)}
              onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
              aria-label={t("admin.botsPanel.duration")}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {DURATIONS.map((entry) => (
                <option key={entry.key} value={entry.minutes === null ? "" : String(entry.minutes)}>
                  {t(entry.key)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => suspendAdminBot(bot.id, reason.trim(), duration))}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t("admin.groupsPanel.suspending") : t("admin.botsPanel.suspendBot")}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function VisibilityCard({ bot, onChange }: { bot: AdminBotHit; onChange: (bot: AdminBotHit) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      onChange(await setAdminBotPublic(bot.id, !bot.public));
    } catch (err) {
      setError(errorText(err, t("common.couldNotSave")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.botsPanel.visibility")}</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {bot.public ? t("admin.botsPanel.publicExplain") : t("admin.botsPanel.privateExplain")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void toggle()} className={secondaryButton}>
          {busy ? t("common.saving") : bot.public ? t("admin.botsPanel.makePrivate") : t("admin.botsPanel.makePublic")}
        </button>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    </div>
  );
}

function FlagsCard({ bot, onChange }: { bot: AdminBotHit; onChange: (bot: AdminBotHit) => void }) {
  const { t } = useI18n();
  // Exactly what is stored, in its order — saving it unchanged is a no-op.
  const [draft, setDraft] = useState(bot.flags.join(","));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const unchanged = draft === bot.flags.join(",");

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const flags = draft
        .split(",")
        .map((flag) => flag.trim().toUpperCase())
        .filter(Boolean);
      const saved = await setAccountFlags(bot.id, flags);
      onChange({ ...bot, flags: saved });
      setDraft(saved.join(","));
      setMessage({ ok: true, text: t("common.flagsSaved") });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t("common.couldNotSave")) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.botsPanel.flags")}</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t("admin.botsPanel.flagsHint", { known: KNOWN_FLAGS.join(", ") })}
      </p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="VERIFIED"
        spellCheck={false}
        autoCapitalize="characters"
        className={`${inputClass} mt-3 font-mono`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || unchanged} className={primaryButton}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" onClick={() => setDraft(bot.flags.join(","))} disabled={busy || unchanged} className={secondaryButton}>
          {t("common.undo")}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function GroupsCard({
  bot,
  groups,
  error,
  onCleared,
}: {
  bot: AdminBotHit;
  groups: AdminBotGroup[] | null;
  error: string | null;
  onCleared: (bot: AdminBotHit, groups: AdminBotGroup[]) => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function clear() {
    setBusy(true);
    setActionError(null);
    try {
      const data = await removeAdminBotFromGroups(bot.id);
      onCleared(data.bot, data.groups);
      setConfirming(false);
    } catch (err) {
      setActionError(errorText(err, t("admin.groupsPanel.itFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {t("common.groups")} {groups && <span className="font-normal text-zinc-400">({groups.length})</span>}
      </h3>
      {error ? (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      ) : groups === null ? (
        <p className="mt-2 text-xs text-zinc-500">{t("common.loading")}</p>
      ) : groups.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.inNoGroup")}</p>
      ) : (
        <ul className="mt-2 flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={groupPath(group.id)}
                target="_blank"
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-zinc-800 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={24} className="shrink-0 rounded-md" />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {group.suspended && <StatusTag tone="amber">{t("common.suspended")}</StatusTag>}
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{group.memberCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {groups && groups.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {confirming ? (
            <>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {t("admin.botsPanel.removeFromGroupsConfirm", { count: groups.length })}
              </span>
              <button type="button" disabled={busy} onClick={() => void clear()} className={dangerOutline}>
                {busy ? t("common.removing") : t("admin.botsPanel.confirm")}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={dangerOutline}>
              {t("admin.botsPanel.removeFromAllGroups")}
            </button>
          )}
          {actionError && <span className="text-sm text-red-500">{actionError}</span>}
        </div>
      )}
    </div>
  );
}

function TokenCard({ bot }: { bot: AdminBotHit }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function revoke() {
    setBusy(true);
    setMessage(null);
    try {
      await revokeAdminBotToken(bot.id);
      setMessage({ ok: true, text: t("admin.botsPanel.tokenRevoked") });
      setConfirming(false);
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t("admin.groupsPanel.itFailed")) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.botsPanel.token")}</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.tokenExplain")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <button type="button" disabled={busy} onClick={() => void revoke()} className={dangerOutline}>
              {busy ? t("admin.botsPanel.revoking") : t("admin.botsPanel.confirmRevoke")}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={dangerOutline}>
            {t("admin.botsPanel.revokeToken")}
          </button>
        )}
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function DeleteCard({ bot, onDeleted }: { bot: AdminBotHit; onDeleted: () => void }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAdminBot(bot.id);
      onDeleted();
    } catch (err) {
      setError(errorText(err, t("common.couldNotDelete")));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-white p-4 dark:border-red-900/60 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">{t("admin.botsPanel.deleteBot")}</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.botsPanel.deleteExplain")}</p>
      {confirming ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs text-zinc-600 dark:text-zinc-400">
            {t("admin.botsPanel.typeToConfirm", { username: bot.username })}
          </label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} font-mono`} autoFocus />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || typed.trim().replace(/^@/, "") !== bot.username}
              onClick={() => void remove()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t("common.deleting") : t("admin.groupsPanel.deleteForever")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
              className={secondaryButton}
            >
              {t("common.cancel")}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${dangerOutline} mt-3`}>
          {t("admin.botsPanel.deleteBot")}
        </button>
      )}
    </div>
  );
}
