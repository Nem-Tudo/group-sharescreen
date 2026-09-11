"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GroupJoinCard } from "@/components/groups/GroupJoinCard";
import { TextChannelView } from "@/components/groups/TextChannelView";
import { rememberedChannel } from "@/components/groups/lastChannel";
import { useAccountToken } from "@/lib/accountApi";
import { useGuestToken } from "@/lib/guestToken";
import { MdBlock } from "react-icons/md";
import { joinPublicGroup, leaveGroup } from "@/lib/groupsApi";
import { fetchPublicGroupPreview, groupPath, type PublicGroupPreview } from "@/lib/groupLinks";
import { forgetGroup, refreshGroup, refreshGroups, useGroupDetail, useMyGroups } from "@/lib/useGroups";

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

/**
 * A group the site's administrators suspended (see the API's GroupSuspension):
 * why, from the server's own message, and the one thing still possible —
 * leaving it. The owner cannot leave (they would have to hand it over, which
 * is itself out of use), so they are only told.
 */
function Suspended({ groupId, message }: { groupId: string; message: string }) {
  const router = useRouter();
  const { groups } = useMyGroups();
  const summary = groups?.find((g) => g.id === groupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setBusy(true);
    const result = await leaveGroup(groupId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    forgetGroup(groupId);
    router.replace("/groups");
  }

  return (
    <Panel>
      <MdBlock className="h-8 w-8 text-amber-500" aria-hidden />
      <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        {summary ? `${summary.name} está suspenso` : "Grupo suspenso"}
      </p>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      <p className="max-w-sm text-xs text-zinc-400 dark:text-zinc-500">
        Enquanto a suspensão durar, ninguém consegue usar o grupo.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Link
          href="/groups"
          className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Ver meus grupos
        </Link>
        {summary && summary.role !== "owner" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void leave()}
            className="cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {busy ? "Saindo…" : "Sair do grupo"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </Panel>
  );
}

/**
 * What stands in for a group somebody is not in. A public group lets them in
 * from right here — the same card an invite draws (see GroupJoinCard), which
 * is where its pin on the map leads. Anything else, a private group included,
 * is simply not found: the page must not say a private group exists.
 */
function GroupGate({ groupId, status }: { groupId: string; status: number }) {
  const accountToken = useAccountToken();
  const guestToken = useGuestToken();
  const token = accountToken ?? guestToken;
  // Whose answer this is, so a new identity asks again rather than trusting
  // what the last one was told.
  const [read, setRead] = useState<{ key: string; preview: PublicGroupPreview | null } | null>(null);
  const key = `${groupId}:${token ?? ""}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicGroupPreview(groupId, token, controller.signal).then((preview) => {
      if (!controller.signal.aborted) setRead({ key, preview });
    });
    return () => controller.abort();
  }, [groupId, token, key]);

  if (!read || read.key !== key) return <Loading />;
  if (!read.preview) return <NotFound status={status} />;
  return (
    <Panel>
      <div className="flex w-full max-w-md flex-col items-center gap-2">
        <GroupJoinCard
          group={read.preview.group}
          member={read.preview.member}
          headline="Grupo público — qualquer um pode entrar"
          acceptLabel="Entrar no grupo"
          onOpen={() => void refreshGroup(groupId)}
          join={async (name) => {
            const result = await joinPublicGroup(groupId, name);
            if (!result.ok) return { ok: false, error: result.error };
            // The group's page is already this one: once the store has the
            // group, GroupIndex/GroupRoom carry on as for any member.
            await Promise.all([refreshGroups(), refreshGroup(groupId)]);
            return { ok: true };
          }}
        />
      </div>
    </Panel>
  );
}

/** /groups/:id — straight on to the room this group was last left on, or its first text room. */
export function GroupIndex({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { detail, error } = useGroupDetail(groupId);

  // Only ever a text room: opening a voice room joins its call, and nobody
  // should find themselves in a call for having opened a group.
  const textRooms = detail?.channels.filter((c) => c.kind === "text") ?? [];
  useEffect(() => {
    if (!detail) return;
    const remembered = rememberedChannel(groupId);
    const rooms = detail.channels.filter((c) => c.kind === "text");
    const target = rooms.find((c) => c.id === remembered) ?? rooms[0];
    if (target) router.replace(groupPath(groupId, target.id));
  }, [detail, groupId, router]);

  if (error) {
    return error.status === 423 ? (
      <Suspended groupId={groupId} message={error.error} />
    ) : (
      <GroupGate groupId={groupId} status={error.status} />
    );
  }
  // Every text room hidden from this person (see lib/groupPermissions): the
  // voice rooms in the list are still theirs to walk into.
  if (detail && textRooms.length === 0) {
    return (
      <Panel>
        <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Nenhuma sala de texto para você</p>
        <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
          As salas de texto deste grupo não estão abertas para você. Entre numa sala de voz pela lista.
        </p>
      </Panel>
    );
  }
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

  if (error) {
    return error.status === 423 ? (
      <Suspended groupId={groupId} message={error.error} />
    ) : (
      <GroupGate groupId={groupId} status={error.status} />
    );
  }
  if (!detail || !channel) return <Loading />;
  if (channel.kind === "text") {
    return <TextChannelView key={channel.id} detail={detail} channelId={channel.id} />;
  }
  // The shell hides this the moment the call is up; until then, say what is happening.
  return <Loading label={`Entrando em ${channel.name}…`} />;
}
