"use client";

import { useEffect, useState } from "react";
import useNtPopups from "ntpopups";
import { MdAdd, MdBlock, MdClose, MdPalette, MdPublic } from "react-icons/md";
import { planIcon } from "@/components/planIcons";
import { ThemeBrowser } from "@/components/ThemeBrowser";
import { ThemeMiniPreview } from "@/components/ThemeMiniPreview";
import { useAuth } from "@/lib/AuthContext";
import { useOpenPro } from "@/lib/proModal";
import {
  isThemeBanned,
  lockTier,
  THEME_BAN_MESSAGE,
  TIER_NAMES,
  type Feature,
  type FeatureTier, tierIconId } from "@/lib/entitlements";
import { fetchMyThemes, isDarkTheme, type RoomTheme } from "@/lib/roomThemes";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

// The theme button's home: three doors, all of them visible.
//
// Two of the three are paid, and they are shown to everybody anyway — a locked
// tab is the only way somebody finds out the thing exists. The same reasoning
// the quality pickers in a room already follow: an option nobody can see is a
// product people discover by accident on somebody else's screen.
//
// It opens from inside a room (see RoomAccountCard), which is why the workshop
// tab is the whole workshop here rather than a link to /workshop: leaving the
// page ends the call. See ThemeBrowser — searchable, paged, and every theme
// can be tried on the room behind before it is worn or bought.

type TabId = "workshop" | "create" | "publish";

const TABS: { id: TabId; label: string; feature?: Feature }[] = [
  // No feature at all: wearing a published theme is free to any account, and
  // that is the deal the workshop offers (see the API's entitlement list,
  // where it deliberately has no name).
  { id: "workshop", get label() { return translate("common.discover"); } },
  { id: "create", get label() { return translate("common.createTheme"); }, feature: "room_theme" },
  { id: "publish", get label() { return translate("themeHubDialog.publishTheme"); }, feature: "room_theme_publish" },
];

/**
 * What a locked tab says instead of its contents.
 *
 * The plan's own mark rather than a padlock: it is the mark this person will
 * wear beside their name if they buy it, and it is already what every other
 * locked thing on the site shows (see planIcons and the quality pickers).
 */
function LockedPanel({
  tier,
  what,
  onLeave,
}: {
  tier: FeatureTier;
  what: string;
  /** Closes this popup on the way to the plan. See the editor's leaveForPro. */
  onLeave: () => void;
}) {
  const t = useT();
  const mark = planIcon(tierIconId(tier));
  const openPro = useOpenPro();
  // The plan this rung names, so the panel opens on the card it is about
  // rather than on whichever one happens to be cheapest.
  const planId = tier === "pro_ultra" ? "pro_ultra" : tier === "premium_max" ? "premium_max" : "premium";
  // Closes before opening: somebody pressing this has stopped browsing themes,
  // and a popup left standing behind a pricing screen is two things asking for
  // attention when one of them has already lost it.
  const leave = () => {
    onLeave();
    openPro(planId);
  };
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
        <mark.Icon className={`h-6 w-6 ${mark.className}`} />
      </span>
      {/* The sentence itself is the way in. It is the line somebody reads and
          then looks around for a button, so it may as well be the button. */}
      <button
        type="button"
        onClick={leave}
        className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-zinc-900 underline-offset-4 transition hover:underline dark:text-zinc-100"
      >
        <mark.Icon className={`h-4 w-4 shrink-0 ${mark.className}`} />
        {t("themeHubDialog.availableOn")} {TIER_NAMES[tier]}
      </button>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{what}</p>
      {/* A button rather than a link to /pro, and that matters here: this opens
          from inside a room, where following a link tears down the call to read
          a price. useOpenPro is what knows the difference. */}
      <button
        type="button"
        onClick={leave}
        className="rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {t("themeHubDialog.findOutAbout")} {TIER_NAMES[tier]}
      </button>
    </div>
  );
}

export type ThemeHubPopupData = {
  /** Reopened from a preview: back to the same search and scroll. */
  resume?: boolean;
};

export function ThemeHubDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: ThemeHubPopupData;
}) {
  const t = useT();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();
  const [tab, setTab] = useState<TabId>("workshop");
  const [mine, setMine] = useState<RoomTheme[]>([]);

  const features = account?.features ?? [];

  // The ones this account wrote — for the "Publicar" tab's list of the ones
  // never published. The workshop tab reads its own (see ThemeBrowser).
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    void fetchMyThemes(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setMine(loaded);
    });
    return () => controller.abort();
  }, [account]);

  // Opens the editor and steps out of the way: two dialogs stacked on a room
  // is one too many, and the editor previews onto the room behind it — which
  // this popup would be sitting in front of.
  function openEditor(startPublished: boolean) {
    closePopup(true);
    void openPopup("theme_editor", { data: { startPublished } });
  }

  /** Editing one that already exists. Same door, different starting point. */
  function editTheme(theme: RoomTheme, startPublished = false) {
    closePopup(true);
    void openPopup("theme_editor", { data: { theme, startPublished } });
  }

  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const lockedAt = lockTier(active.feature, features);
  // Checked before the plan lock below, and shown instead of it. Selling the
  // Pro Max card to somebody a moderator has just stopped from making themes
  // is the one answer here that is worse than saying nothing.
  const banned = isThemeBanned(account?.flags) && active.id !== "workshop";
  // Derived rather than cleared on sign-out, so the effect above never writes
  // state synchronously — and a stale list cannot outlive the account it
  // belonged to.
  const myThemes = account ? mine : [];
  // Yours that nobody else can reach yet. The list the "Publicar" tab offers.
  const unpublished = myThemes.filter((theme) => !theme.published);

  return (
    <div className="flex h-[min(52rem,calc(100dvh-2.5rem))] w-[min(62rem,calc(100vw-2rem))] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3.5 sm:px-5 dark:border-zinc-800">
        <MdPalette className="h-5 w-5 shrink-0 text-indigo-500" />
        <h2 className="flex-1 text-base font-semibold tracking-tight">{t("common.themes")}</h2>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label={t("common.close")}
          className="-mr-1 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>

      {/* Every tab is selectable, including the ones this account cannot use.
          A disabled tab hides what is behind it, and what is behind it is the
          pitch — somebody has to be able to look at the thing before deciding
          whether it is worth paying for. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-3 dark:border-zinc-800">
        {TABS.map((entry) => {
          const locked = lockTier(entry.feature, features);
          const mark = planIcon(tierIconId(locked));
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "page" : undefined}
              className={`-mb-px flex items-center gap-1 border-b-2 px-2.5 py-2 text-xs font-medium whitespace-nowrap transition ${
                tab === entry.id
                  ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {entry.label}
              {locked && <mark.Icon className={`h-3 w-3 shrink-0 ${mark.className}`} />}
            </button>
          );
        })}
      </div>

      {/* The workshop scrolls inside itself, under its own search bar; the
          other tabs are short, and scroll here if a phone makes them long. */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${tab === "workshop" && !banned && !lockedAt ? "" : "overflow-y-auto"}`}
      >
        {banned ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <MdBlock className="h-6 w-6 text-red-500" />
            </span>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("themeHubDialog.themeCreationBlocked")}
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {THEME_BAN_MESSAGE}
            </p>
          </div>
        ) : lockedAt ? (
          <LockedPanel
            tier={lockedAt}
            onLeave={() => closePopup(false)}
            what={
              tab === "create"
                ? t("themeHubDialog.buildYourOwnPaletteTheColours")
                : t("themeHubDialog.publishYourThemesOnDiscoverAnd")
            }
          />
        ) : tab === "workshop" ? (
          <ThemeBrowser
            target={{ kind: "self" }}
            onClose={closePopup}
            resume={data?.resume}
            onEditTheme={(theme) => editTheme(theme)}
          />
        ) : (
          // Both unlocked tabs end in the same door: the editor is a screen of
          // its own, and stacking it inside this popup would be a dialog in a
          // dialog, over a room the editor needs to be able to repaint.
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-5 py-4">
            {/* The ones already made and never published — the shortest path
                to "publicar", and the one that was missing: everything here
                existed only as "make a new one", so a theme built last week
                could only be published by finding it, opening it, and hunting
                for the checkbox. */}
            {tab === "publish" && unpublished.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {t("themeHubDialog.publishOneYouAlreadyHave")}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {unpublished.map((theme) => (
                    <li
                      key={theme.id}
                      className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800"
                    >
                      <ThemeMiniPreview theme={theme} className="aspect-[16/10] w-16 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {theme.name}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {isDarkTheme(theme.spec) ? t("common.dark") : t("common.light")} · {t("common.privateAdj")}
                        </span>
                      </span>
                      {/* Opens the editor on that theme with "publicar"
                          already ticked, which is where the price is decided —
                          publishing is not a one-press action, it is a
                          question about money. */}
                      <button
                        type="button"
                        onClick={() => editTheme(theme, true)}
                        className="shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        {t("themeHubDialog.publish")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
                {tab === "create" ? (
                  <MdAdd className="h-6 w-6 text-zinc-500" />
                ) : (
                  <MdPublic className="h-6 w-6 text-zinc-500" />
                )}
              </span>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {tab === "create"
                  ? t("themeHubDialog.theColoursAreAppliedToThe")
                  : t("themeHubDialog.aPublishedThemeAppearsOnDiscover")}
              </p>
              <button
                type="button"
                onClick={() => openEditor(tab === "publish")}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {tab === "create" ? t("themeHubDialog.createATheme") : t("themeHubDialog.createAndPublishANewOne")}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
