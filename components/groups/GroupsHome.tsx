"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdAdd, MdChevronRight } from "react-icons/md";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { useAuth } from "@/lib/AuthContext";
import { groupPath, inviteCodeFromInput, invitePath } from "@/lib/groupLinks";
import { useMyGroups } from "@/lib/useGroups";

// /groups — every group this person is in, and the two ways to get another.
// Laid out like the site's other list pages (see /amigos): a title, a line
// under it, and rows in bordered cards.

const primaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

const ROLE_LABEL = { owner: "Dono", admin: "Admin", member: "Membro" } as const;

export function GroupsHome() {
  const { openPopup } = useNtPopups();
  const { account, loading } = useAuth();
  const { groups } = useMyGroups();
  const canCreate = Boolean(account);
  const hasGroups = Boolean(groups && groups.length > 0);

  function createGroup() {
    if (canCreate) void openPopup("create_group", { data: {} });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Seus grupos</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {hasGroups
                ? `${groups!.length} ${groups!.length === 1 ? "grupo" : "grupos"}`
                : "Várias salas de voz e de texto num lugar só, com as mesmas pessoas."}
            </p>
          </div>
          {hasGroups && (
            <div className="flex gap-2">
              <button type="button" onClick={() => void openPopup("join_group", { data: {} })} className={secondaryButton}>
                Entrar com convite
              </button>
              <button
                type="button"
                onClick={createGroup}
                disabled={!canCreate}
                title={canCreate ? undefined : "Crie uma conta para criar grupos"}
                className={primaryButton}
              >
                <MdAdd className="h-4 w-4" />
                Novo grupo
              </button>
            </div>
          )}
        </div>

        {!loading && !account && (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            Para criar grupos,{" "}
            <Link href="/" className="font-medium underline underline-offset-2">
              crie uma conta
            </Link>
            .
          </p>
        )}

        {groups === null ? (
          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
        ) : hasGroups ? (
          <ul className="mt-6 flex flex-col gap-2">
            {groups!.map((group) => (
              <li key={group.id}>
                <Link
                  href={groupPath(group.id)}
                  className={`flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 ${
                    group.suspended ? "opacity-60" : ""
                  }`}
                >
                  <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={40} className="rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <GroupName
                      name={group.name}
                      flags={group.flags}
                      className={`flex w-full text-sm ${group.unread ? "font-semibold text-zinc-950 dark:text-zinc-50" : "font-medium text-zinc-900 dark:text-zinc-100"}`}
                    />
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {group.suspended ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">Suspenso</span>
                      ) : (
                        <>
                          {ROLE_LABEL[group.role]}
                          {group.unread && " · mensagens novas"}
                        </>
                      )}
                    </span>
                  </span>
                  {!group.suspended && group.mentions > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                      {group.mentions}
                    </span>
                  )}
                  <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Criar um grupo</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Começa com uma sala de voz e uma de texto. Depois é só mandar o convite.
                </p>
              </div>
              <button
                type="button"
                onClick={createGroup}
                disabled={!canCreate}
                title={canCreate ? undefined : "Crie uma conta para criar grupos"}
                className={`${primaryButton} mt-auto self-start`}
              >
                <MdAdd className="h-4 w-4" />
                Novo grupo
              </button>
            </section>
            <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Entrar em um grupo</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cole o link de convite que te mandaram.</p>
              </div>
              <JoinByInvite />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** The invite field, inline — pasting a link here beats opening a popup to paste it into. */
function JoinByInvite() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = inviteCodeFromInput(value);
    if (!code) {
      setError("Isso não parece um link de convite.");
      return;
    }
    router.push(invitePath(code));
  }

  return (
    <form onSubmit={submit} className="mt-auto flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="golive.nemtudo.me/invite/…"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button type="submit" disabled={!value.trim()} className={secondaryButton}>
          Entrar
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
