"use client";

import { useState } from "react";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { useGuestToken } from "@/lib/guestToken";
import { joinProfileGroup } from "@/lib/groupsApi";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { selectName } from "@/lib/signalingSelectors";
import { refreshGroups } from "@/lib/useGroups";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { useI18n } from "@/lib/useI18n";
import type { ProfileGroup } from "@/lib/userProfile";

// The group somebody on Pro Ultra shows on their profile, as a card anybody
// looking can join from — private groups included. Joining goes through the
// profile (POST /users/:id/profile-group/join), not an invite, so the API
// checks the owner can still hand this group out at the moment of joining.

export function ProfileGroupCard({
  ownerId,
  group,
  onNavigate,
  theme,
}: {
  ownerId: string;
  group: ProfileGroup;
  /** Closes whatever the profile is shown in, before leaving for the group. */
  onNavigate?: () => void;
  theme?: { text: string; muted: string; surface: string; border: string } | null;
}) {
  const { t, tc } = useI18n();
  const navigation = useGroupNavigation();
  const { account, loading } = useAuth();
  const guestToken = useGuestToken();
  const registeredName = useSignalingSelector(selectName);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const member = group.member || joined;
  const hasIdentity = Boolean(account) || Boolean(guestToken && registeredName);

  function open(groupId: string) {
    onNavigate?.();
    navigation.push(groupPath(groupId));
  }

  async function join() {
    if (!hasIdentity) {
      setError(t("profileGroup.signInToJoin"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await joinProfileGroup(ownerId, account ? null : registeredName);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setJoined(true);
    await refreshGroups();
    open(result.groupId);
  }

  const button =
    "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div
      className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
      style={theme ? { background: theme.surface, borderColor: theme.border, color: theme.text } : undefined}
    >
      <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={48} className="shrink-0 rounded-xl" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          style={theme ? { color: theme.muted } : undefined}
        >
          {t("profileGroup.label")}
        </span>
        <GroupName name={group.name} flags={group.flags} className="min-w-0 text-sm font-semibold" badgeClassName="h-3.5 w-3.5" />
        {group.description && (
          <span
            className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400"
            style={theme ? { color: theme.muted } : undefined}
          >
            {group.description}
          </span>
        )}
        <span
          className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
          style={theme ? { color: theme.muted } : undefined}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          {group.onlineCount} online · {tc("common.memberCount", group.memberCount)}
        </span>
        {error && <span className="mt-0.5 text-[11px] text-red-500">{error}</span>}
      </span>
      {member ? (
        <button
          type="button"
          onClick={() => open(group.id)}
          className={`${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
          style={theme ? { borderColor: theme.border, color: theme.text } : undefined}
        >
          {t("groups.homeGroupsPanel.open")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void join()}
          disabled={busy || loading}
          className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          {busy ? t("common.joining2") : t("groups.inviteEmbed.join")}
        </button>
      )}
    </div>
  );
}
