"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BsCoin } from "react-icons/bs";
import {
  MdFavorite,
  MdFavoriteBorder,
  MdOutlinePeopleAlt,
  MdOutlineShowChart,
  MdPalette,
  MdVisibility,
} from "react-icons/md";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { CopyButton } from "@/components/CopyButton";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { useAuth } from "@/lib/AuthContext";
import { verifiedBadge } from "@/lib/entitlements";
import {
  applyTheme,
  buyTheme,
  fetchTheme,
  gradientCss,
  getWornOverride,
  getWornOverrideServer,
  isDarkTheme,
  likeTheme,
  setWornOverride,
  subscribeWornOverride,
  themeLink,
  themeViewRoomLink,
  type RoomTheme,
} from "@/lib/roomThemes";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// One theme, on a page of its own — the thing a shared link opens.
//
// It exists because a theme had no address. Everything about it lived inside a
// grid or a dialog, so "look at this one" meant "open the workshop and scroll
// until you find it", and a link pasted into a conversation could only ever
// point at the whole shop.
//
// The page is mostly the theme at a size worth looking at. Everything else on
// it — the author, the two figures, the one button — is what somebody needs to
// answer "do I want this", and nothing else is offered: the workshop is one
// click away for browsing, and this page is not a browsing page.

export function ThemePageClient({ id }: { id: string }) {
  const t = useT();
  const { account, refresh } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useState<RoomTheme | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const pending = useSyncExternalStore(
    subscribeWornOverride,
    getWornOverride,
    getWornOverrideServer
  );
  const worn = pending !== undefined ? pending : account?.roomThemeId ?? null;
  const wearing = Boolean(theme && worn === theme.id);

  useEffect(() => {
    const controller = new AbortController();
    void fetchTheme(id, controller.signal).then((found) => {
      if (!controller.signal.aborted) setTheme(found);
    });
    return () => controller.abort();
  }, [id]);

  const wear = useCallback(async () => {
    if (!theme) return;
    if (!account) {
      setAccountModal("create");
      return;
    }
    const next = wearing ? null : theme.id;
    // Optimistic, the same as the workshop's: the palette is already here, so
    // the choice can land before the round trip does.
    setWornOverride(next);
    const ok = await applyTheme(next);
    if (!ok) {
      setWornOverride(undefined);
      setError(t("theme.themePageClient.couldNotApplyTheTheme"));
      return;
    }
    await refresh();
    setWornOverride(undefined);
  }, [theme, account, wearing, refresh, t]);

  async function buy() {
    if (!theme || busy) return;
    if (!account) {
      setAccountModal("create");
      return;
    }
    setBusy(true);
    const result = await buyTheme(theme.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    const fresh = await fetchTheme(theme.id);
    if (fresh) setTheme(fresh);
  }

  async function toggleLike() {
    if (!theme) return;
    if (!account) {
      setAccountModal("create");
      return;
    }
    const liked = !theme.liked;
    setTheme({ ...theme, liked, likes: Math.max(0, theme.likes + (liked ? 1 : -1)) });
    const result = await likeTheme(theme.id, liked);
    if (result) setTheme((current) => (current ? { ...current, ...result } : current));
  }

  if (theme === undefined) {
    return (
      <main className="mx-auto w-full max-w-3xl grow px-4 py-16">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("common.loading")}</p>
      </main>
    );
  }

  if (theme === null) {
    return (
      <main className="mx-auto w-full max-w-md grow px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          {t("theme.themePageClient.themeNotFound")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("theme.themePageClient.itMayHaveBeenDeletedOr")}
        </p>
        <Link
          href="/workshop"
          className="mt-4 inline-block rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
        >
          {t("common.seeDiscover")}
        </Link>
      </main>
    );
  }

  const { palette, accent, background } = theme.spec;
  const mine = theme.authorId === account?.id;

  return (
    <main className="mx-auto w-full max-w-3xl grow px-4 py-8">
      {/* The theme, at a size worth judging. Everything on this page is in
          service of this rectangle. */}
      <div
        className="relative h-56 overflow-hidden rounded-2xl border sm:h-72"
        style={{
          borderColor: palette.border,
          background: gradientCss(theme.spec) ?? palette.page,
        }}
      >
        {background && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={background.url}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover"
              style={{ filter: `blur(${background.blur}px)` }}
            />
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ background: palette.page, opacity: background.dim }}
            />
          </>
        )}
        <div className="relative flex h-full flex-col justify-between p-5">
          <div
            className="flex w-fit items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: palette.surface }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
            <span className="text-sm font-medium" style={{ color: palette.text }}>
              {theme.name}
            </span>
            <span className="text-xs" style={{ color: palette.muted }}>
              exemplo de painel
            </span>
          </div>
          <div className="flex gap-1.5">
            {[palette.surface, palette.raised, palette.border, palette.input, accent].map(
              (colour, index) => (
                <span
                  key={index}
                  className="h-6 flex-1 rounded-md"
                  style={{ background: colour }}
                />
              )
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {theme.name}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {isDarkTheme(theme.spec) ? t("common.dark") : t("common.light")}
            </span>
            {theme.price > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                <BsCoin className="h-3 w-3 shrink-0" />
                {theme.price.toLocaleString(formatLocale())}
              </span>
            )}
          </h1>
          {theme.description && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{theme.description}</p>
          )}
          {theme.author && (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <UserAvatar
                src={theme.author.avatarUrl}
                name={theme.author.displayName}
                size={22}
                className="shrink-0"
                userId={theme.author.id}
              />
              por{" "}
              <DisplayUserName
                name={theme.author.displayName}
                verified={verifiedBadge(theme.author.flags)}
                bot={theme.author.bot}
                color={theme.author.nameColor}
                className="truncate font-medium"
              />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <button
            type="button"
            onClick={() => void toggleLike()}
            aria-pressed={theme.liked}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100 hover:text-rose-500 dark:hover:bg-zinc-900"
          >
            {theme.liked ? (
              <MdFavorite className="h-5 w-5 shrink-0 text-rose-500" />
            ) : (
              <MdFavoriteBorder className="h-5 w-5 shrink-0" />
            )}
            {theme.likes}
          </button>
          <span className="flex items-center gap-1.5">
            <MdOutlinePeopleAlt className="h-5 w-5 shrink-0" />
            {theme.uses}
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {theme.owned ? (
          <button
            type="button"
            onClick={() => void wear()}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              wearing
                ? "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            }`}
          >
            <MdPalette className="h-4 w-4 shrink-0" />
            {wearing ? t("common.inUseRemove") : t("common.useTheme")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void buy()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
          >
            <BsCoin className="h-4 w-4 shrink-0" />
            {busy ? t("theme.themePageClient.buying") : t("theme.themePageClient.buyForValue", { value: theme.price.toLocaleString(formatLocale()) })}
          </button>
        )}

        {/* Before deciding, the way to decide: the theme on an actual room.
            The rectangle above is a palette; this is the chat, the tiles and
            the dock wearing it. Free for everybody, paid themes included —
            looking is not wearing, and nothing is written anywhere (see
            useRoomTheme's viewThemeId).
            A button rather than a Link because the room's six-digit code is
            minted on the press: a new room each time, not one address baked
            into the page that everybody opening it would land in together. */}
        <button
          type="button"
          onClick={() => router.push(themeViewRoomLink(theme.id))}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          <MdVisibility className="h-4 w-4 shrink-0" />
          {t("common.previewTheme")}
        </button>

        {/* The point of the page. Sits with the actions rather than in a corner:
            somebody who just decided they like a theme is the person most
            likely to send it to somebody else. */}
        <CopyButton value={themeLink(theme.id)} label={t("common.copyLink")} />

        {mine && (
          <Link
            href={`/theme/${theme.id}/panel`}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MdOutlineShowChart className="h-4 w-4 shrink-0" />
            {t("theme.themePageClient.seeTheNumbers")}
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
        {t("theme.themePageClient.aThemeChangesTheColoursOf")}{" "}
        <Link href="/workshop" className="underline underline-offset-2">
          {t("theme.themePageClient.seeOtherThemes")}
        </Link>
        .
      </p>

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
      {profileOpen && theme.author && (
        <UserProfileDialog userId={theme.author.id} onClose={() => setProfileOpen(false)} />
      )}
    </main>
  );
}
