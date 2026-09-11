"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MdMenu } from "react-icons/md";
import { TextChannelView } from "@/components/groups/TextChannelView";
import { useGroupNav } from "@/components/groups/groupNav";
import { rememberedChannel } from "@/components/groups/lastChannel";
import { groupPath } from "@/lib/groupLinks";
import { useGroupDetail } from "@/lib/useGroups";

// The two pages inside a group. Both read the same store the shell does, so
// they never fetch the group twice.

function Centered({ children }: { children: React.ReactNode }) {
  const { openNav } = useGroupNav();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-black/5 px-3 lg:hidden dark:border-white/5">
        <button
          type="button"
          onClick={openNav}
          aria-label="Menu"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdMenu className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>
    </div>
  );
}

function Loading() {
  return (
    <Centered>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      <span className="sr-only" role="status">
        Carregando…
      </span>
    </Centered>
  );
}

function NotFound({ status }: { status: number }) {
  return (
    <Centered>
      <p className="text-4xl">🔒</p>
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
        className="mt-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Ver meus grupos
      </Link>
    </Centered>
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
  return (
    <Centered>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-600" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Entrando em {channel.name}…</p>
    </Centered>
  );
}
