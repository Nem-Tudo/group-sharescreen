"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";
import { GroupJoinCard } from "@/components/groups/GroupJoinCard";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { acceptInvite } from "@/lib/groupsApi";
import { fetchInvitePreview, groupPath, type InvitePreview } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { refreshGroups } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// The invite page: the join card (see GroupJoinCard), spending the invite —
// and the same card as a dialog, for an invite link clicked anywhere on the
// site (see InviteDialog), which then has no preview from the server and
// reads it here.

const STATE_TEXT: Record<Exclude<InvitePreview["invite"]["state"], "ok">, string> = {
  get expired() { return translate("groups.inviteClient.thisInviteHasExpired"); },
  get revoked() { return translate("groups.inviteClient.thisInviteHasBeenRevoked"); },
  get exhausted() { return translate("groups.inviteClient.thisInviteHasAlreadyBeenUsed"); },
};

export function InviteClient({
  code,
  initialPreview,
  variant = "page",
  onClose,
}: {
  code: string;
  /** Read by the page on the server. Undefined in the dialog, which reads it here. */
  initialPreview?: InvitePreview | null;
  variant?: "page" | "dialog";
  /** Closes the dialog. */
  onClose?: () => void;
}) {
  const t = useT();
  // Shallow inside the groups pages, where an invite is most often clicked.
  const navigation = useGroupNavigation();
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const token = accountToken ?? guestToken;
  const [preview, setPreview] = useState(initialPreview);

  // Re-read with whoever this is, to learn whether they are already in — or,
  // with no preview from the server (the dialog), read for the first time.
  const needsFirstRead = initialPreview === undefined;
  useEffect(() => {
    if (!token && !needsFirstRead) return;
    const controller = new AbortController();
    void fetchInvitePreview(code, token, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (next) setPreview(next);
      else if (needsFirstRead) setPreview((current) => (current === undefined ? null : current));
    });
    return () => controller.abort();
  }, [code, token, needsFirstRead]);

  function openGroup(groupId: string) {
    onClose?.();
    navigation.push(groupPath(groupId));
  }

  let body: React.ReactNode;
  if (preview === undefined) {
    body = <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>;
  } else if (!preview) {
    body = (
      <>
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("common.invalidInvite")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("groups.inviteClient.thisLinkDoesNotLeadTo")}
        </p>
        <Link href="/" onClick={onClose} className="mt-2 text-sm font-medium underline underline-offset-4">
          {t("groups.inviteClient.goToHome")}
        </Link>
      </>
    );
  } else {
    const { group, invite, member } = preview;
    body = (
      <GroupJoinCard
        group={group}
        member={member}
        headline={t("groups.inviteClient.youHaveBeenInvitedToJoin")}
        acceptLabel={t("groups.inviteClient.acceptInvite")}
        blocked={
          group.suspended
            ? t("groups.inviteClient.thisGroupHasBeenSuspendedBy")
            : invite.state !== "ok"
              ? t("groups.inviteClient.valueAskSomeoneInTheGroup", { value: STATE_TEXT[invite.state] })
              : null
        }
        onOpen={() => openGroup(group.id)}
        join={async (name) => {
          const result = await acceptInvite(code, name);
          if (!result.ok) return { ok: false, error: result.error };
          await refreshGroups();
          openGroup(result.groupId);
          return { ok: true };
        }}
      />
    );
  }

  if (variant === "dialog") {
    return (
      <main className="relative flex max-h-[calc(100dvh-2.5rem)] w-[min(28rem,calc(100vw-2rem))] flex-col items-center gap-2 overflow-y-auto bg-white p-8 text-center dark:bg-zinc-950">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-5 w-5" />
        </button>
        {body}
      </main>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <main className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950">
        {body}
      </main>
    </div>
  );
}
