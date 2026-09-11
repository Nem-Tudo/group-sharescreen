"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TextChannelView } from "@/components/groups/TextChannelView";
import { rememberedChannel } from "@/components/groups/lastChannel";
import { groupPath } from "@/lib/groupLinks";
import { useGroupDetail } from "@/lib/useGroups";

// The two pages inside a group. Both read the same store the shell does, so
// they never fetch the group twice.

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-white p-6 text-center lg:rounded-xl lg:border lg:border-zinc-200 dark:bg-zinc-950 lg:dark:border-zinc-800">
      {children}
    </div>
  );
}

function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <Panel>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400" role="status">
        {label}
      </p>
    </Panel>
  );
}

function NotFound({ status }: { status: number }) {
  return (
    <Panel>
      <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        {status === 401 ? "Entre para ver seus grupos" : "Grupo não encontrado"}
      </p>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {status === 401
          ? "Use sua conta, ou abra o link de convite que te mandaram."
          : "Ele não existe mais, ou você não faz parte dele. Para entrar, peça um convite a alguém do grupo."}
      </p>
      <Link
        href="/groups"
        className="mt-3 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Ver meus grupos
      </Link>
    </Panel>
  );
}

/** /groups/:id — straight on to the room this group was last left on, or its first text room. */
export function GroupIndex({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { detail, error } = useGroupDetail(groupId);

  useEffect(() => {
    if (!detail) return;
    const remembered = rememberedChannel(groupId);
    const textRooms = detail.channels.filter((c) => c.kind === "text");
    const target = textRooms.find((c) => c.id === remembered) ?? textRooms[0] ?? detail.channels[0];
    if (target) router.replace(groupPath(groupId, target.id));
  }, [detail, groupId, router]);

  if (error) return <NotFound status={error.status} />;
  return <Loading />;
}

/** /groups/:id/:room — a text room here; a voice room is drawn by the shell. */
export function GroupRoom({ groupId, roomId }: { groupId: string; roomId: string }) {
  const router = useRouter();
  const { detail, error } = useGroupDetail(groupId);
  const channel = detail?.channels.find((c) => c.id === roomId) ?? null;

  // A room that is gone (deleted while open, or a stale link) sends you to the group.
  useEffect(() => {
    if (detail && !channel) router.replace(groupPath(groupId));
  }, [detail, channel, groupId, router]);

  if (error) return <NotFound status={error.status} />;
  if (!detail || !channel) return <Loading />;
  if (channel.kind === "text") {
    return <TextChannelView key={channel.id} detail={detail} channelId={channel.id} />;
  }
  // The shell hides this the moment the call is up; until then, say what is happening.
  return <Loading label={`Entrando em ${channel.name}…`} />;
}
