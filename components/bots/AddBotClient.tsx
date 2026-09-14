"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MdCheckCircle, MdClose } from "react-icons/md";
import { BotTag } from "@/components/BotTag";
import { LoginForm } from "@/components/LoginForm";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { useAuth } from "@/lib/AuthContext";
import { useAccountToken } from "@/lib/accountApi";
import { addBotToGroup, fetchBotInstall, type BotInstallInfo } from "@/lib/botsApi";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { refreshGroups } from "@/lib/useGroups";
import { useI18n } from "@/lib/useI18n";

// The "add this bot to a group" card: the bot, the groups this person runs,
// one button. The API decides everything that matters — whether the bot is
// public, whether this person may manage each group — and this only draws the
// answer; a group it lists as addable can still be refused by the time the
// button is pressed (somebody took the permission away), and that refusal is
// shown as it comes.

const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

export function AddBotClient({
  botId,
  variant = "page",
  onClose,
}: {
  botId: string;
  /** The /bots/:id/add page, or the same card as a dialog (see AddBotDialog). */
  variant?: "page" | "dialog";
  /** Closes the dialog. */
  onClose?: () => void;
}) {
  const { t, tc } = useI18n();
  const router = useRouter();
  // Shallow inside the groups pages, where the dialog is most often opened.
  const navigation = useGroupNavigation();
  const { account, loading } = useAuth();
  const token = useAccountToken();
  // undefined while loading, null for "no such bot".
  const [info, setInfo] = useState<BotInstallInfo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ groupId: string; name: string } | null>(null);

  // Read again whenever the signed-in account changes: signing in on this
  // very page is what turns "sign in to continue" into a list of groups.
  useEffect(() => {
    const controller = new AbortController();
    fetchBotInstall(botId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setLoadError(null);
        setInfo(next);
        // Preselect when there is exactly one place it could go.
        const open = next?.groups.filter((g) => !g.member && !g.suspended) ?? [];
        setSelected(open.length === 1 ? open[0].id : null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError" || controller.signal.aborted) return;
        setLoadError(err.message);
      });
    return () => controller.abort();
  }, [botId, token]);

  async function add() {
    if (!info || !selected) return;
    const group = info.groups.find((g) => g.id === selected);
    setBusy(true);
    setError(null);
    const result = await addBotToGroup(selected, info.bot.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdded({ groupId: selected, name: group?.name ?? "" });
    void refreshGroups();
  }

  let body: React.ReactNode;
  if (loadError) {
    body = <p className="text-sm text-red-500">{loadError}</p>;
  } else if (info === undefined || loading) {
    body = <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>;
  } else if (info === null) {
    body = (
      <>
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{t("addBot.botNotFound")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("addBot.thisLinkDoesNotLeadToABot")}</p>
        <Link href="/" className="mt-2 text-sm font-medium underline underline-offset-4">
          {t("groups.inviteClient.goToHome")}
        </Link>
      </>
    );
  } else {
    const { bot } = info;
    const header = (
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- an avatar from any host */}
        <img
          src={bot.avatarUrl ?? DEFAULT_AVATAR_PATH}
          alt=""
          className="h-20 w-20 rounded-full object-cover ring-4 ring-white dark:ring-zinc-950"
        />
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{bot.displayName}</h1>
          <BotTag />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">@{bot.username}</p>
        {bot.bio && (
          <p className="max-w-sm text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-300">{bot.bio}</p>
        )}
      </div>
    );

    let action: React.ReactNode;
    if (added) {
      action = (
        <div className="flex w-full flex-col items-center gap-3">
          <MdCheckCircle className="h-10 w-10 text-emerald-500" />
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {t("addBot.botAddedTo", { bot: bot.displayName, group: added.name })}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("addBot.giveItARoleToModerate")}</p>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              navigation.push(groupPath(added.groupId));
            }}
            className={primaryButtonClass}
          >
            {t("addBot.openTheGroup")}
          </button>
        </div>
      );
    } else if (!account) {
      action = (
        <div className="flex w-full flex-col gap-3 text-left">
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">{t("addBot.signInToAddIt")}</p>
          <LoginForm onCancel={() => (onClose ? onClose() : router.push("/"))} />
        </div>
      );
    } else if (!info.canInstall) {
      action = (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t("addBot.thisBotIsPrivate")}
        </p>
      );
    } else if (info.groups.length === 0) {
      action = (
        <p className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {t("addBot.youDoNotManageAnyGroup")}
        </p>
      );
    } else {
      action = (
        <div className="flex w-full flex-col gap-3 text-left">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("addBot.chooseAGroup")}</p>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {info.groups.map((group) => {
              const disabled = group.member || Boolean(group.suspended);
              const checked = selected === group.id;
              return (
                <li key={group.id}>
                  <label
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      checked
                        ? "border-zinc-950 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                        : "border-zinc-200 dark:border-zinc-800"
                    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
                  >
                    <input
                      type="radio"
                      name="group"
                      className="sr-only"
                      disabled={disabled}
                      checked={checked}
                      onChange={() => setSelected(group.id)}
                    />
                    <GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {group.name}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {group.member
                          ? t("addBot.alreadyInThisGroup")
                          : group.suspended
                            ? t("addBot.groupSuspended")
                            : tc("common.memberCount", group.memberCount)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("addBot.itJoinsWithEveryonePermissions")}</p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="button" disabled={!selected || busy} onClick={add} className={primaryButtonClass}>
            {busy ? t("addBot.adding") : t("addBot.addToGroup")}
          </button>
        </div>
      );
    }

    body = (
      <>
        {header}
        <div className="mt-4 w-full">{action}</div>
      </>
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
