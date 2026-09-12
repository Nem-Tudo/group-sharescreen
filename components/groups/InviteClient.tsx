"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GroupJoinCard } from "@/components/groups/GroupJoinCard";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { acceptInvite } from "@/lib/groupsApi";
import { fetchInvitePreview, groupPath, type InvitePreview } from "@/lib/groupLinks";
import { refreshGroups } from "@/lib/useGroups";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// The invite page: the join card (see GroupJoinCard), spending the invite.

const STATE_TEXT: Record<Exclude<InvitePreview["invite"]["state"], "ok">, string> = {
  get expired() { return translate("groups.inviteClient.thisInviteHasExpired"); },
  get revoked() { return translate("groups.inviteClient.thisInviteHasBeenRevoked"); },
  get exhausted() { return translate("groups.inviteClient.thisInviteHasAlreadyBeenUsed"); },
};

export function InviteClient({ code, initialPreview }: { code: string; initialPreview: InvitePreview | null }) {
  const t = useT();
  const router = useRouter();
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const token = accountToken ?? guestToken;
  const [preview, setPreview] = useState(initialPreview);

  // Re-read with whoever this is, to learn whether they are already in.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetchInvitePreview(code, token, controller.signal).then((next) => {
      if (next && !controller.signal.aborted) setPreview(next);
    });
    return () => controller.abort();
  }, [code, token]);

  let body: React.ReactNode;
  if (!preview) {
    body = (
      <>
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("common.invalidInvite")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("groups.inviteClient.thisLinkDoesNotLeadTo")}
        </p>
        <Link href="/" className="mt-2 text-sm font-medium underline underline-offset-4">
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
        onOpen={() => router.push(groupPath(group.id))}
        join={async (name) => {
          const result = await acceptInvite(code, name);
          if (!result.ok) return { ok: false, error: result.error };
          await refreshGroups();
          router.push(groupPath(result.groupId));
          return { ok: true };
        }}
      />
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
