"use client";

import { memo, useEffect, useState } from "react";
import useNtPopups from "ntpopups";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { acceptInvite } from "@/lib/groupsApi";
import { fetchInvitePreview, groupPath, inviteCodeFromInput, type InvitePreview } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { selectName } from "@/lib/signalingSelectors";
import { refreshGroups } from "@/lib/useGroups";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { useI18n } from "@/lib/useI18n";

// A group invite pasted into a chat, drawn under the message as a small card:
// which group, how many people, and "Entrar" — which joins on the spot rather
// than opening the invite page first. Used by every chat that shows links: a
// room's, a group's text rooms, and private messages.
//
// Somebody with no identity yet (no account, no guest name) gets the invite
// dialog instead, which is where a name is chosen or an account signed into
// (see InviteDialog).

/** More than this many invites in one message is a list, not a message worth a card each. */
const MAX_EMBEDS = 3;
/** How long one read of an invite is reused — every copy of the same link in a chat asks once. */
const PREVIEW_TTL_MS = 30_000;

/** The invite codes a message links to, in order, each once. */
export function inviteCodesIn(text: string): string[] {
  if (!text.includes("/invite/")) return [];
  const codes: string[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw.includes("/invite/")) continue;
    // A sentence's punctuation after the link is not part of it.
    const code = inviteCodeFromInput(raw.replace(/[)\].,!?;:'"]+$/, ""));
    if (code && !codes.includes(code)) codes.push(code);
    if (codes.length >= MAX_EMBEDS) break;
  }
  return codes;
}

const previewCache = new Map<string, { at: number; promise: Promise<InvitePreview | null> }>();

function readPreview(code: string, token: string | null): Promise<InvitePreview | null> {
  const key = `${token ?? ""}|${code}`;
  const held = previewCache.get(key);
  if (held && Date.now() - held.at < PREVIEW_TTL_MS) return held.promise;
  const promise = fetchInvitePreview(code, token);
  previewCache.set(key, { at: Date.now(), promise });
  return promise;
}

/** The cards for every invite a message links to — nothing at all when it links to none. */
export const InviteEmbeds = memo(function InviteEmbeds({ text }: { text: string }) {
  const codes = inviteCodesIn(text);
  if (codes.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {codes.map((code) => (
        <InviteEmbed key={code} code={code} />
      ))}
    </div>
  );
});

function InviteEmbed({ code }: { code: string }) {
  const { t, tc } = useI18n();
  const { openPopup } = useNtPopups();
  const navigation = useGroupNavigation();
  const { account, loading } = useAuth();
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const registeredName = useSignalingSelector(selectName);
  const token = accountToken ?? guestToken;
  const key = `${token ?? ""}|${code}`;
  // Tagged with what it answers, so a different identity reads again.
  const [read, setRead] = useState<{ key: string; preview: InvitePreview | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPreview(code, token).then((preview) => {
      if (!cancelled) setRead({ key, preview });
    });
    return () => {
      cancelled = true;
    };
  }, [code, token, key]);

  const frame =
    "flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5 text-left text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";

  if (!read || read.key !== key) {
    return (
      <div className={frame} aria-busy="true">
        <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="h-2.5 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          <span className="h-3 w-36 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        </span>
      </div>
    );
  }

  const preview = read.preview;
  if (!preview) {
    return (
      <div className={frame}>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.inviteEmbed.invalid")}</span>
      </div>
    );
  }

  const { group, invite } = preview;
  const member = preview.member || joined;
  const blocked = group.suspended
    ? t("common.suspended")
    : invite.state === "expired"
      ? t("groups.inviteEmbed.expired")
      : invite.state === "revoked"
        ? t("groups.inviteEmbed.revoked")
        : invite.state === "exhausted"
          ? t("groups.inviteEmbed.exhausted")
          : null;
  const hasIdentity = Boolean(account) || Boolean(guestToken && registeredName);

  async function join() {
    // Nobody to join as yet: the dialog is where a name is picked.
    if (!hasIdentity) {
      void openPopup("join_invite", { data: { code } });
      return;
    }
    setBusy(true);
    setError(null);
    const result = await acceptInvite(code, account ? null : registeredName);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setJoined(true);
    await refreshGroups();
    navigation.push(groupPath(result.groupId));
  }

  const button =
    "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className={frame}>
      <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={40} className="shrink-0 rounded-xl" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("groups.inviteEmbed.label")}
        </span>
        <GroupName name={group.name} flags={group.flags} className="min-w-0 text-sm font-semibold" badgeClassName="h-3.5 w-3.5" />
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          {group.onlineCount} online · {tc("common.memberCount", group.memberCount)}
        </span>
        {error && <span className="mt-0.5 text-[11px] text-red-500">{error}</span>}
      </span>
      {member ? (
        <button
          type="button"
          onClick={() => navigation.push(groupPath(group.id))}
          className={`${button} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
        >
          {t("groups.homeGroupsPanel.open")}
        </button>
      ) : blocked ? (
        <span className="shrink-0 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          {blocked}
        </span>
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
