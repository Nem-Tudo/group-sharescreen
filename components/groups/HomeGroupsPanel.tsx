"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useNtPopups from "ntpopups";
import { MdAdd, MdLink } from "react-icons/md";
import { BetaMark } from "@/components/BetaMark";
import { Popover, Tooltip } from "@/components/Tooltip";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { OFFICIAL_GROUP_ID, fetchPublicGroupPreview, groupPath, type PublicGroupPreview } from "@/lib/groupLinks";
import { joinPublicGroup } from "@/lib/groupsApi";
import { useGuestToken } from "@/lib/guestToken";
import { refreshGroup, refreshGroups, syncGroupsIdentity, useMyGroups } from "@/lib/useGroups";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { selectName } from "@/lib/signalingSelectors";

// The groups list beside the home page's room form — the counterpart of the
// friends list on the other side of it (see HomeFriendsPanel), drawn the same
// way so the two read as one family: bordered rows, a face, a name, and on the
// right the one number worth being told about (mentions).
//
// Shown to an account always (with a way in when there is nothing yet), and to
// a guest only once they are in a group — a guest can belong to a couple, and
// the home page is where they come back to. Nothing at all, and no request, for
// somebody with no identity yet: the form next to this is still asking for one.

const ROLE_LABEL = { owner: "Dono", admin: "Admin", member: "Membro" } as const;

/** "4 membros · 1 online" — the line a group's card carries. Empty from an API that does not say. */
function describeCounts(memberCount: number | undefined, onlineCount: number | undefined): string {
  if (memberCount === undefined) return "";
  const members = `${memberCount} ${memberCount === 1 ? "membro" : "membros"}`;
  return onlineCount ? `${members} · ${onlineCount} online` : members;
}

// The card's own button, drawn on the row. The groups you are in open, the one
// you are not in joins (see OfficialGroupCard) — same size, different colour.
const CARD_ACTION = "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition";

const ICON_BUTTON =
  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900";

const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900";

// The official group's public face, read once per page load and shared by
// every opening of the "+" menu — it is the same group for everybody, and the
// menu should not flash a skeleton each time it opens.
let officialPreview: Promise<PublicGroupPreview | null> | null = null;

/**
 * GoLive's own group, as a card in the "+" menu — drawn like the group rows
 * below it (its face, its name with the badge), with its own way in: one
 * click joins it and opens it. Only offered to somebody not in it yet (see
 * offerOfficial); a guest who has no name yet is sent to the group's page
 * instead, whose join card is where a name is asked for.
 */
function OfficialGroupCard({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { account } = useAuth();
  const registeredName = useSignalingSelector(selectName);
  const [preview, setPreview] = useState<PublicGroupPreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    officialPreview ??= fetchPublicGroupPreview(OFFICIAL_GROUP_ID).then((result) => {
      // A failed read is not kept, so the next opening tries again.
      if (!result) officialPreview = null;
      return result;
    });
    void officialPreview.then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (preview === null) return null;
  const path = groupPath(OFFICIAL_GROUP_ID);

  async function join() {
    if (!account && !registeredName) {
      onDone();
      router.push(path);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await joinPublicGroup(OFFICIAL_GROUP_ID, account ? null : registeredName);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    await Promise.all([refreshGroups(), refreshGroup(OFFICIAL_GROUP_ID)]);
    onDone();
    router.push(path);
  }

  return (
    <div className="mt-1 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
      <p className="px-2 pb-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Grupo oficial</p>
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        {preview === undefined ? (
          <>
            <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
            <span className="h-3 flex-1 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          </>
        ) : (
          <>
            <GroupIcon
              name={preview.group.name}
              iconUrl={preview.group.iconUrl}
              seed={preview.group.id}
              size={32}
              className="rounded-lg"
            />
            <span className="min-w-0 flex-1">
              <GroupName
                name={preview.group.name}
                flags={preview.group.flags}
                className="flex w-full text-sm font-medium text-zinc-900 dark:text-zinc-100"
              />
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {describeCounts(preview.group.memberCount, preview.group.onlineCount)}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void join()}
              className={`${CARD_ACTION} cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </>
        )}
      </div>
      {error && <p className="px-2 pt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

export function HomeGroupsPanel({ className = "" }: { className?: string }) {
  const { account, loading } = useAuth();
  const guestToken = useGuestToken();
  // Same reason as the friends panel: appearing a beat after the page settled
  // would shove the form sideways under somebody's cursor.
  if (loading) return null;
  const identity = account?.id ?? guestToken;
  if (!identity) return null;
  return <GroupsPanelBody className={className} identity={identity} isAccount={Boolean(account)} />;
}

function GroupsPanelBody({
  className,
  identity,
  isAccount,
}: {
  className: string;
  identity: string;
  isAccount: boolean;
}) {
  const { openPopup } = useNtPopups();
  const [addOpen, setAddOpen] = useState(false);
  // Somebody logging in on this page must not keep the guest's list on screen.
  useEffect(() => {
    syncGroupsIdentity(identity);
  }, [identity]);
  const { groups } = useMyGroups();

  // A guest with no groups sees the page they always saw — see the header.
  if (!isAccount && (!groups || groups.length === 0)) return null;

  const mentions = (groups ?? []).reduce((n, g) => n + g.mentions, 0);
  // Only once the list has answered, so it never flashes up for somebody who
  // turns out to be in it already.
  const offerOfficial = groups !== null && !groups.some((g) => g.id === OFFICIAL_GROUP_ID);

  return (
    <aside
      className={`w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-sm lg:w-88 dark:border-white/10 dark:bg-zinc-950 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {/* The site's own beta tag (see BetaMark), at the size it has in a
              room's account card. */}
          <span className="mr-2 text-[10px] font-bold">
            <BetaMark />
          </span>
          Grupos
          {groups && groups.length > 0 && (
            <span className="ml-1.5 font-normal text-zinc-400">{groups.length}</span>
          )}
        </h2>
        <span className="flex shrink-0 items-center gap-2">
          {/* One "+" for both ways of getting another group — joining one
              somebody invited you to, or making your own — rather than two
              look-alike icons whose difference you have to hover to learn. */}
          <Popover
            open={addOpen}
            onClose={() => setAddOpen(false)}
            placement="bottom-end"
            tooltip="Adicionar grupo"
            content={
              <div className="flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                <button
                  type="button"
                  disabled={!isAccount}
                  onClick={() => {
                    setAddOpen(false);
                    void openPopup("create_group", { data: {} });
                  }}
                  className={MENU_ITEM}
                >
                  <MdAdd className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0">
                    <span className="block font-medium">Criar um grupo</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      {isAccount ? "Com salas de voz e de texto" : "Precisa de uma conta"}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    void openPopup("join_group", { data: {} });
                  }}
                  className={MENU_ITEM}
                >
                  <MdLink className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0">
                    <span className="block font-medium">Entrar em um grupo</span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Com o link de convite
                    </span>
                  </span>
                </button>
                {offerOfficial && <OfficialGroupCard onDone={() => setAddOpen(false)} />}
              </div>
            }
          >
            <button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              aria-label="Adicionar grupo"
              aria-expanded={addOpen}
              className={ICON_BUTTON}
            >
              <MdAdd className="h-4 w-4" />
            </button>
          </Popover>
          <Link
            href="/groups"
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Ver todos
          </Link>
        </span>
      </div>

      {/* Mentions anywhere, said once up top — the per-group numbers below say
          where, this says that there is something to go and read. */}
      {/* {mentions > 0 && (
        <p className="mt-3 rounded-lg border border-red-600/25 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-400">
          {mentions === 1 ? "Você foi mencionado 1 vez" : `Você foi mencionado ${mentions} vezes`}
        </p>
      )} */}

      {groups === null ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Carregando…</p>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Você ainda não está em nenhum grupo.{" "}
          <button
            type="button"
            onClick={() => void openPopup("create_group", { data: {} })}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Criar um grupo
          </button>{" "}
          ou{" "}
          <button
            type="button"
            onClick={() => void openPopup("join_group", { data: {} })}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            entrar com um convite
          </button>
          .
        </p>
      ) : (
        // Capped and scrolled, like the friends list, so a long list does not
        // decide how tall the page is.
        // Each group as a card — the same one the official group has in the
        // "+" menu: its face, its name, who and how many, and a button. The
        // whole card is the link; "Abrir" is drawn on it, not a second target.
        <ul className="mt-3 flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={groupPath(group.id)}
                className={`group/card flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 ${
                  group.suspended ? "opacity-60" : ""
                }`}
              >
                <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={32} className="rounded-lg" />
                <span className="min-w-0 flex-1">
                  <GroupName
                    name={group.name}
                    flags={group.flags}
                    className={`flex w-full text-sm ${
                      group.unread
                        ? "font-semibold text-zinc-950 dark:text-zinc-50"
                        : "font-medium text-zinc-900 dark:text-zinc-100"
                    }`}
                  />
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {group.suspended ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">Suspenso</span>
                    ) : (
                      [
                        ROLE_LABEL[group.role],
                        describeCounts(group.memberCount, group.onlineCount),
                        group.unread ? "mensagens novas" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    )}
                  </span>
                </span>
                {group.suspended ? null : group.mentions > 0 ? (
                  <Tooltip content={group.mentions === 1 ? "1 menção" : `${group.mentions} menções`}>
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">
                      {group.mentions > 99 ? "99+" : group.mentions}
                    </span>
                  </Tooltip>
                ) : group.unread ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-950 dark:bg-zinc-50" aria-label="Mensagens novas" />
                ) : null}
                <span
                  aria-hidden
                  className={`${CARD_ACTION} bg-zinc-950 text-white group-hover/card:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:group-hover/card:bg-zinc-200`}
                >
                  Abrir
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
