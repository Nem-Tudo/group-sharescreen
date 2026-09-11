"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdAdd, MdMenu } from "react-icons/md";
import { AccountMenu } from "@/components/AccountMenu";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { useGroupNav } from "@/components/groups/groupNav";
import { useAuth } from "@/lib/AuthContext";
import { groupPath, inviteCodeFromInput, invitePath } from "@/lib/groupLinks";
import { useMyGroups } from "@/lib/useGroups";

// /groups — every group this person is in, and the two ways to get another:
// create one, or follow an invite. Plain on purpose: it is a list with two
// buttons, and it looks like the rest of the site's lists.

const primaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function GroupsHome() {
  const { openNav } = useGroupNav();
  const { openPopup } = useNtPopups();
  const { account, loading } = useAuth();
  const { groups } = useMyGroups();
  const canCreate = Boolean(account);

  function createGroup() {
    if (canCreate) void openPopup("create_group", { data: {} });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/5 px-3 dark:border-white/5">
        <button
          type="button"
          onClick={openNav}
          aria-label="Menu"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          <MdMenu className="h-5 w-5" />
        </button>
        <h1 className="font-semibold text-zinc-950 dark:text-zinc-50">Seus grupos</h1>
        {groups && groups.length > 0 && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{groups.length}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {groups && groups.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void openPopup("join_group", { data: {} })}
                className={`${secondaryButton} hidden sm:inline-flex`}
              >
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
            </>
          )}
          <AccountMenu />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
          {!loading && !account && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Sem conta dá para participar de até 2 grupos, entrando por convite. Para criar grupos,{" "}
              <Link href="/" className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100">
                crie uma conta
              </Link>
              .
            </p>
          )}

          {groups === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                <div>
                  <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Criar um grupo</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Começa com uma sala de texto e uma de voz. Depois é só mandar o convite.
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
              <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                <div>
                  <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">Entrar em um grupo</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cole o link de convite que te mandaram.</p>
                </div>
                <JoinByInvite />
              </section>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={groupPath(group.id)}
                  className="group/card relative flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={48} className="rounded-xl" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{group.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {group.role === "owner" ? "Dono" : group.role === "admin" ? "Admin" : "Membro"}
                    </p>
                  </div>
                  {group.mentions > 0 ? (
                    <span className="absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                      {group.mentions}
                    </span>
                  ) : (
                    group.unread && (
                      <span
                        aria-label="Mensagens novas"
                        className="absolute right-3 top-3 h-2 w-2 rounded-full bg-zinc-950 dark:bg-zinc-50"
                      />
                    )
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
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
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button type="submit" disabled={!value.trim()} className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-40`}>
          Entrar
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </form>
  );
}
