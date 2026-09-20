"use client";

import { useEffect, useState } from "react";
import { MdAutoAwesome, MdCheck, MdChatBubbleOutline, MdLockOutline } from "react-icons/md";
import { UserAvatar } from "@/components/UserAvatar";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { markFeatureUsed } from "@/components/NewBadge";
import { primaryButton, secondaryButton } from "@/components/groups/dialogKit";
import {
  fetchGroupAura,
  giveGroupAura,
  removeGroupAura,
  setGroupAuraChannel,
  type GroupAuraState,
} from "@/lib/groupsApi";
import {
  DEFAULT_AURA_LEVELS,
  GROUP_AURA_BADGE,
  GROUP_AURA_EVENTS,
  GROUP_AURA_FEATURE,
  auraPerkLabel,
  auraProgress,
} from "@/lib/groupAura";
import { trackFeatureEvent } from "@/lib/features";
import { openProModal } from "@/lib/proModal";
import { refreshGroup, useGroupDetail } from "@/lib/useGroups";
import { formatLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/useI18n";

// The group settings' "Aura" tab: where the group stands (its level, the bar
// to the next one, what each level brings, who is lifting it), and where the
// person looking stands — how many auras their plan gives, and a button to
// give this group one, or take one back from here or from anywhere else.
//
// It is also where the group picks the text room its auras are announced in
// (Discord's boost messages, see the API's postAuraMessage) — for whoever runs
// the group; everybody else is only told where they go.

const auraGradient = "bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500";

/** When an aura may be taken back, as a date somebody reads — "12 de out., 14:30". */
function whenLabel(at: number): string {
  return new Date(at).toLocaleString(formatLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The moment an aura may be taken back, or 0 when it already may — an aura has
 * to stay on the group a few days (see the API's AURA_MIN_STAY_MS). Read from
 * the placement, so an older API (no `removableAt`) holds nothing back.
 */
function heldUntil(placement: { removableAt?: number } | undefined): number {
  const at = placement?.removableAt ?? 0;
  return Date.now() < at ? at : 0;
}

export function AuraTab({ groupId }: { groupId: string }) {
  const { t, tc } = useI18n();
  const { detail } = useGroupDetail(groupId);
  const [state, setState] = useState<GroupAuraState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  // Read again whenever the group's count moves — somebody else's aura, or a
  // plan lapsing, arrives as a "group-updated" that refreshes the detail.
  const liveCount = detail?.group.aura?.count;

  useEffect(() => {
    trackFeatureEvent(GROUP_AURA_EVENTS.open, { group: groupId, feature: GROUP_AURA_FEATURE });
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    void fetchGroupAura(groupId).then((result) => {
      if (cancelled) return;
      if (result.ok) setState(result);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, liveCount]);

  async function give() {
    setBusy(true);
    setError(null);
    const result = await giveGroupAura(groupId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState(result);
    markFeatureUsed(GROUP_AURA_BADGE);
    trackFeatureEvent(GROUP_AURA_EVENTS.give, { group: groupId, feature: GROUP_AURA_FEATURE });
    void refreshGroup(groupId);
  }

  async function remove(fromGroupId: string) {
    setBusy(true);
    setError(null);
    const result = await removeGroupAura(fromGroupId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    trackFeatureEvent(GROUP_AURA_EVENTS.remove, { group: fromGroupId, feature: GROUP_AURA_FEATURE });
    // Taken off another group: this one's numbers (and the list of where
    // this person's auras are) are read again.
    const fresh = await fetchGroupAura(groupId);
    if (fresh.ok) setState(fresh);
    void refreshGroup(groupId);
    if (fromGroupId !== groupId) void refreshGroup(fromGroupId);
  }

  /** Points the aura lines at a room, or at nowhere with null. */
  async function pickChannel(channelId: string | null) {
    setSavingChannel(true);
    setError(null);
    const result = await setGroupAuraChannel(groupId, channelId);
    setSavingChannel(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState(result);
  }

  if (!state) {
    return error ? (
      <p className="text-sm text-red-500">{error}</p>
    ) : (
      <p className="text-sm text-zinc-500">{t("common.loading")}</p>
    );
  }

  const levels = state.levels.length > 0 ? state.levels : DEFAULT_AURA_LEVELS;
  const { next, fraction, missing } = auraProgress(state.count, levels);
  const top = levels[levels.length - 1]?.auras ?? 1;
  const mine = state.mine;
  const here = mine.placements.filter((p) => p.groupId === groupId);
  const elsewhere = mine.placements.filter((p) => p.groupId !== groupId);
  const free = Math.max(0, mine.total - mine.used);
  const textChannels = (detail?.channels ?? []).filter((c) => c.kind === "text");
  const canGive = state.available && free > 0 && here.length < mine.perGroup && !detail?.me.guest;

  return (
    <div className="flex flex-col gap-4">
      {/* Where the group stands. */}
      <section className={`${auraGradient} relative overflow-hidden rounded-2xl p-4 text-white shadow-sm`}>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur">
            <MdAutoAwesome className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-tight">
              {state.level > 0 ? t("groups.aura.levelN", { level: state.level }) : t("groups.aura.noLevel")}
            </p>
            <p className="text-sm text-white/85">{tc("groups.aura.auraCount", state.count)}</p>
          </div>
        </div>
        {/* The whole ladder on one bar, with a mark at each level. */}
        <div className="relative mt-4 h-2.5 rounded-full bg-white/25">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-500"
            style={{ width: `${Math.min(100, (state.count / top) * 100)}%` }}
          />
          {levels.map((l) => (
            <span
              key={l.level}
              className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-white/70"
              style={{ left: `calc(${(l.auras / top) * 100}% - 1px)` }}
            />
          ))}
        </div>
        <div className="relative mt-1 h-4 text-[10px] font-semibold text-white/85">
          {levels.map((l) => (
            <span
              key={l.level}
              className="absolute -translate-x-full whitespace-nowrap"
              style={{ left: `${(l.auras / top) * 100}%` }}
            >
              {t("groups.aura.levelShort", { level: l.level })}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/90">
          {next
            ? tc("groups.aura.missingForLevel", missing, { level: next.level })
            : t("groups.aura.maxLevel")}
        </p>
        {/* Keeps the progress readable for a screen reader. */}
        <span className="sr-only">{Math.round(fraction * 100)}%</span>
      </section>

      {/* What each level brings. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t("groups.aura.perksTitle")}</h3>
        <ul className="flex flex-col gap-1.5">
          {levels.map((l) => {
            const reached = state.level >= l.level;
            return (
              <li
                key={l.level}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                  reached
                    ? "border-violet-300 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    reached ? `${auraGradient} text-white` : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {reached ? <MdCheck className="h-3.5 w-3.5" /> : <MdLockOutline className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    {t("groups.aura.levelN", { level: l.level })}{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      · {tc("groups.aura.auraCount", l.auras)}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {[
                      ...(l.emojiSlots ? [t("groups.aura.perkEmojiSlots", { n: l.emojiSlots })] : []),
                      ...l.perks.map(auraPerkLabel),
                    ].join(", ") || t("groups.aura.morePerksSoon")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Where the person looking stands. */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t("groups.aura.yourAuras")}</h3>
        {mine.total === 0 ? (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{t("groups.aura.whoHasAuras")}</p>
            <button
              type="button"
              onClick={() => {
                trackFeatureEvent(GROUP_AURA_EVENTS.upgrade, { group: groupId, feature: GROUP_AURA_FEATURE });
                openProModal("premium_max");
              }}
              className={`${primaryButton} self-start`}
            >
              {t("groups.aura.getAuras")}
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {t("groups.aura.freeOfTotal", { free, total: mine.total })}
              {mine.perGroup > 1 && <> {t("groups.aura.perGroupHint", { n: mine.perGroup })}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !canGive} onClick={() => void give()} className={primaryButton}>
                <span className="flex items-center gap-1.5">
                  <MdAutoAwesome className="h-4 w-4" />
                  {t("groups.aura.give")}
                </span>
              </button>
              {here.length > 0 && (
                <button
                  type="button"
                  disabled={busy || heldUntil(here[here.length - 1]) > 0}
                  onClick={() => void remove(groupId)}
                  title={
                    heldUntil(here[here.length - 1])
                      ? t("groups.aura.lockedUntil", { when: whenLabel(heldUntil(here[here.length - 1])) })
                      : undefined
                  }
                  className={secondaryButton}
                >
                  {t("groups.aura.removeHere")}
                </button>
              )}
            </div>
            {here.length > 0 && (
              <p className="text-xs text-violet-600 dark:text-violet-400">
                {tc("groups.aura.youGaveHere", here.length)}
              </p>
            )}
            {heldUntil(here[here.length - 1]) > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("groups.aura.stayHint", { days: Math.round((mine.minStayMs ?? 0) / 86400000) })}{" "}
                {t("groups.aura.lockedUntil", { when: whenLabel(heldUntil(here[here.length - 1])) })}
              </p>
            )}
            {!canGive && free === 0 && here.length === 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.aura.noFreeAura")}</p>
            )}
          </>
        )}
        {mine.placements.some((p) => !p.counting) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("groups.aura.someNotCounting")}</p>
        )}
        {elsewhere.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1">
            {elsewhere.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800"
              >
                <GroupIcon name={p.groupName ?? "?"} iconUrl={p.groupIconUrl} seed={p.groupId} size={22} />
                <span className="min-w-0 flex-1 truncate">{p.groupName ?? t("groups.aura.unknownGroup")}</span>
                {!p.counting && (
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                    {t("groups.aura.notCounting")}
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy || heldUntil(p) > 0}
                  onClick={() => void remove(p.groupId)}
                  title={heldUntil(p) ? t("groups.aura.lockedUntil", { when: whenLabel(heldUntil(p)) }) : undefined}
                  className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("groups.aura.takeBack")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </section>

      {/* Where an aura is announced. */}
      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          <MdChatBubbleOutline className="h-4 w-4 text-zinc-500" />
          {t("groups.aura.channelTitle")}
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{t("groups.aura.channelHint")}</p>
        {state.canSetChannel ? (
          <>
            <select
              value={state.channel?.id ?? ""}
              disabled={savingChannel}
              onChange={(e) => void pickChannel(e.target.value || null)}
              aria-label={t("groups.aura.channelTitle")}
              className="max-w-xs cursor-pointer rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">{t("groups.aura.channelNone")}</option>
              {textChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
            {/* A room this person cannot see is never named back by the API, so
                a saved one that has vanished from the list reads as "nowhere".
                Said plainly rather than silently resetting it. */}
            {state.channel && !textChannels.some((c) => c.id === state.channel?.id) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("groups.aura.channelUnknown")}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            {state.channel ? `#${state.channel.name}` : t("groups.aura.channelNone")}
          </p>
        )}
      </section>

      {/* Who is lifting the group. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t("groups.aura.givers")}</h3>
        {state.givers.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.aura.noGivers")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {state.givers.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <UserAvatar src={g.avatarUrl} name={g.name} size={24} />
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <span className="flex items-center gap-0.5 text-xs font-semibold text-violet-600 dark:text-violet-400">
                  <MdAutoAwesome className="h-3.5 w-3.5" />×{g.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
