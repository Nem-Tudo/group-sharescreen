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

// The invite page: the join card (see GroupJoinCard), spending the invite.

const STATE_TEXT: Record<Exclude<InvitePreview["invite"]["state"], "ok">, string> = {
  expired: "Este convite expirou.",
  revoked: "Este convite foi revogado.",
  exhausted: "Este convite já foi usado o máximo de vezes.",
};

export function InviteClient({ code, initialPreview }: { code: string; initialPreview: InvitePreview | null }) {
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
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Convite inválido</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Esse link não leva a nenhum grupo. Confira se foi copiado inteiro, ou peça um novo.
        </p>
        <Link href="/" className="mt-2 text-sm font-medium underline underline-offset-4">
          Ir para o início
        </Link>
      </>
    );
  } else {
    const { group, invite, member } = preview;
    body = (
      <GroupJoinCard
        group={group}
        member={member}
        headline="Você foi convidado para entrar em"
        acceptLabel="Aceitar convite"
        blocked={invite.state !== "ok" ? `${STATE_TEXT[invite.state]} Peça um novo convite a alguém do grupo.` : null}
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
