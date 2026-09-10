"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import useNtPopups from "ntpopups";
import {
  MdAdd,
  MdCheck,
  MdFavorite,
  MdFavoriteBorder,
  MdPalette,
  MdPeople,
  MdPublic,
} from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { planIcon } from "@/components/planIcons";
import { useAuth } from "@/lib/AuthContext";
import { useOpenPro } from "@/lib/proModal";
import { lockTier, TIER_NAMES, type Feature, type FeatureTier } from "@/lib/entitlements";
import {
  applyTheme,
  buyTheme,
  fetchMyThemes,
  fetchWorkshop,
  isDarkTheme,
  likeTheme,
  setWornOverride,
  getWornOverride,
  getWornOverrideServer,
  subscribeWornOverride,
  type RoomTheme,
} from "@/lib/roomThemes";

// The theme button's home: three doors, all of them visible.
//
// Two of the three are paid, and they are shown to everybody anyway — a locked
// tab is the only way somebody finds out the thing exists. The same reasoning
// the quality pickers in a room already follow: an option nobody can see is a
// product people discover by accident on somebody else's screen.
//
// It opens from inside a room (see RoomAccountCard), which is why the workshop
// tab is a list here rather than a link to /workshop: leaving the page ends the
// call. The full page is still one click away for browsing properly.

type TabId = "workshop" | "create" | "publish";

const TABS: { id: TabId; label: string; feature?: Feature }[] = [
  // No feature at all: wearing a published theme is free to any account, and
  // that is the deal the workshop offers (see the API's entitlement list,
  // where it deliberately has no name).
  { id: "workshop", label: "Descobrir" },
  { id: "create", label: "Criar tema", feature: "room_theme" },
  { id: "publish", label: "Publicar tema", feature: "room_theme_publish" },
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
  const mark = planIcon(tier === "premium_max" ? "gold_verified" : "blue_verified");
  const openPro = useOpenPro();
  // The plan this rung names, so the panel opens on the card it is about
  // rather than on whichever one happens to be cheapest.
  const planId = tier === "premium_max" ? "premium_max" : "premium";
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
        Disponível no {TIER_NAMES[tier]}
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
        Conhecer o {TIER_NAMES[tier]}
      </button>
    </div>
  );
}

/** One theme in the browse list: the palette, the name, and one verb. */
function ThemeRow({
  theme,
  worn,
  busy,
  onWear,
  onEdit,
  onBuy,
  onLike,
}: {
  theme: RoomTheme;
  worn: boolean;
  busy: boolean;
  onWear: () => void;
  /** Only for a theme this account wrote. Absent for everybody else's. */
  onEdit?: () => void;
  onBuy: () => void;
  onLike: () => void;
}) {
  const { palette, accent } = theme.spec;
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
      {/* The palette as its own swatch — four colours in the order they sit on
          each other, which says more at this size than any name could. */}
      <span
        className="flex h-9 w-9 shrink-0 overflow-hidden rounded-md border"
        style={{ borderColor: palette.border }}
      >
        {[palette.page, palette.surface, palette.raised, accent].map((colour, index) => (
          <span key={index} className="h-full flex-1" style={{ background: colour }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {theme.name}
        </span>
        <span className="flex items-center gap-1.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {isDarkTheme(theme.spec) ? "escuro" : "claro"}
          {onEdit && !theme.published ? " · privado" : ""}
          {!onEdit && theme.author ? ` · ${theme.author.displayName}` : ""}
          <span className="flex items-center gap-0.5">
            <MdPeople className="h-3 w-3 shrink-0" />
            {theme.uses}
          </span>
          {theme.price > 0 && (
            <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
              <BsCoin className="h-3 w-3 shrink-0" />
              {theme.price.toLocaleString("pt-BR")}
            </span>
          )}
        </span>
      </span>
      {/* Beside the verb, not in the caption above it. This list is the one
          people scroll while actually in a room wearing these — the shortest
          path there is to a theme they like — and a heart three points of type
          smaller than the row is a heart nobody presses.
          Never on a private theme: liking something with an audience of one is
          a way of finding out it exists (the API refuses it too). */}
      {theme.published && (
        <button
          type="button"
          onClick={onLike}
          aria-label={theme.liked ? "Remover curtida" : "Curtir tema"}
          aria-pressed={theme.liked}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-rose-500 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          {theme.liked ? (
            <MdFavorite className="h-4 w-4 shrink-0 text-rose-500" />
          ) : (
            <MdFavoriteBorder className="h-4 w-4 shrink-0" />
          )}
          {theme.likes}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Editar
        </button>
      )}
      {/* One verb, and which one is a fact the server sends (`owned`): a price
          alone cannot tell "comprar" from "usar", because the author owns
          theirs by having written it and a buyer owns it for good. */}
      {theme.owned ? (
        <button
          type="button"
          onClick={onWear}
          disabled={busy}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            worn
              ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          }`}
        >
          {worn ? "Remover" : "Usar"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onBuy}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          <BsCoin className="h-3.5 w-3.5 shrink-0" />
          {theme.price.toLocaleString("pt-BR")}
        </button>
      )}
    </li>
  );
}

export function ThemeHubDialog({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const { account, refresh } = useAuth();
  const { openPopup } = useNtPopups();
  const [tab, setTab] = useState<TabId>("workshop");
  const [themes, setThemes] = useState<RoomTheme[]>([]);
  const [mine, setMine] = useState<RoomTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  // What a purchase refused, if it refused. Buying is the one action here that
  // can fail for a reason the person can do something about — not enough
  // points — and a button that silently does nothing is the worst way to say
  // so.
  const [error, setError] = useState<string | null>(null);

  const features = account?.features ?? [];
  // The override first, so the button's own label flips on the press rather
  // than when /auth/me answers. Same store the room reads (see useRoomTheme):
  // one answer to "what am I wearing", not two that can disagree.
  const pending = useSyncExternalStore(
    subscribeWornOverride,
    getWornOverride,
    getWornOverrideServer
  );
  const worn = pending !== undefined ? pending : account?.roomThemeId ?? null;

  useEffect(() => {
    const controller = new AbortController();
    void fetchWorkshop("popular", controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setThemes(loaded);
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  // The ones this account wrote — private ones included, which is the whole
  // reason this is a second request rather than a filter over the list above:
  // an unpublished theme is in nobody's browse list, not even its author's.
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

  async function buy(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    setBusyId(theme.id);
    const result = await buyTheme(theme.id);
    if (result.ok) {
      // Re-read rather than patched: the points on the account moved, and so
      // did ownership — both live on the server and both are on screen.
      refresh();
      const [fresh, own] = await Promise.all([fetchWorkshop("popular"), fetchMyThemes()]);
      setThemes(fresh);
      setMine(own);
    } else {
      setError(result.error);
    }
    setBusyId(null);
  }

  async function like(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    // Flipped now, confirmed after — the same reasoning as the workshop's.
    const liked = !theme.liked;
    const patch = (next: { liked: boolean; likes: number }) => (list: RoomTheme[]) =>
      list.map((entry) => (entry.id === theme.id ? { ...entry, ...next } : entry));

    const optimistic = { liked, likes: Math.max(0, theme.likes + (liked ? 1 : -1)) };
    setThemes(patch(optimistic));
    setMine(patch(optimistic));

    const result = await likeTheme(theme.id, liked);
    const settled = result ?? { liked: theme.liked, likes: theme.likes };
    setThemes(patch(settled));
    setMine(patch(settled));
  }

  async function wear(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    const next = worn === theme.id ? null : theme.id;
    // Painted first, asked second — see the same move in the workshop. It
    // matters more here than anywhere: this dialog is open *over* the room it
    // is repainting, so the wait was happening in full view of the thing that
    // was not changing.
    setWornOverride(next);
    const ok = await applyTheme(next);
    if (!ok) {
      setWornOverride(undefined);
      return;
    }
    await refresh();
    setWornOverride(undefined);
  }

  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const lockedAt = lockTier(active.feature, features);
  // Derived rather than cleared on sign-out, so the effect above never writes
  // state synchronously — and a stale list cannot outlive the account it
  // belonged to.
  const myThemes = account ? mine : [];
  // The community list minus anything already shown above it: a theme somebody
  // made *and* published would otherwise appear twice, once with an edit
  // button and once without.
  const others = themes.filter((theme) => !myThemes.some((own) => own.id === theme.id));
  // Yours that nobody else can reach yet. The list the "Publicar" tab offers.
  const unpublished = myThemes.filter((theme) => !theme.published);

  return (
    <div className="flex w-96 max-w-[calc(100vw-1rem)] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <MdPalette className="h-5 w-5 shrink-0 text-indigo-500" />
        <h2 className="flex-1 text-base font-semibold tracking-tight">Temas</h2>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      {/* Every tab is selectable, including the ones this account cannot use.
          A disabled tab hides what is behind it, and what is behind it is the
          pitch — somebody has to be able to look at the thing before deciding
          whether it is worth paying for. */}
      <div className="flex gap-1 border-b border-zinc-200 px-3 dark:border-zinc-800">
        {TABS.map((entry) => {
          const locked = lockTier(entry.feature, features);
          const mark = planIcon(locked === "premium_max" ? "gold_verified" : "blue_verified");
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

      <div className="flex max-h-[60vh] flex-col overflow-y-auto">
        {lockedAt ? (
          <LockedPanel
            tier={lockedAt}
            onLeave={() => closePopup(false)}
            what={
              tab === "create"
                ? "Monte a sua própria paleta — as cores da sala inteira, um destaque e até uma imagem de fundo. O tema fica só seu."
                : "Publique os seus temas no Descobrir e deixe qualquer pessoa usar o que você criou."
            }
          />
        ) : tab === "workshop" ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            {/* Yours first, and in a section of its own. Mixed into the
                community list they would be buried by whatever is popular this
                week — and these are the ones somebody came here to reach for. */}
            {myThemes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Seus temas
                </p>
                <ul className="flex flex-col gap-1.5">
                  {myThemes.map((theme) => (
                    <ThemeRow
                      key={theme.id}
                      theme={theme}
                      worn={worn === theme.id}
                      busy={busyId === theme.id}
                      onWear={() => void wear(theme)}
                      onBuy={() => void buy(theme)}
                      onLike={() => void like(theme)}
                      onEdit={() => editTheme(theme)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {myThemes.length > 0 && others.length > 0 && (
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Da comunidade
              </p>
            )}
            {loading ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Carregando…</p>
            ) : others.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Ainda não há temas publicados por outras pessoas.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {others.map((theme) => (
                  <ThemeRow
                    key={theme.id}
                    theme={theme}
                    worn={worn === theme.id}
                    busy={busyId === theme.id}
                    onWear={() => void wear(theme)}
                    onBuy={() => void buy(theme)}
                    onLike={() => void like(theme)}
                  />
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <MdCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                Vale nas salas sem tema próprio
              </span>
              <Link
                href="/workshop"
                target="_blank"
                className="shrink-0 text-xs font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Ver tudo
              </Link>
            </div>
          </div>
        ) : (
          // Both unlocked tabs end in the same door: the editor is a screen of
          // its own, and stacking it inside this popup would be a dialog in a
          // dialog, over a room the editor needs to be able to repaint.
          <div className="flex flex-col gap-4 px-5 py-4">
            {/* The ones already made and never published — the shortest path
                to "publicar", and the one that was missing: everything here
                existed only as "make a new one", so a theme built last week
                could only be published by finding it, opening it, and hunting
                for the checkbox. */}
            {tab === "publish" && unpublished.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Publicar um que você já tem
                </p>
                <ul className="flex flex-col gap-1.5">
                  {unpublished.map((theme) => (
                    <li
                      key={theme.id}
                      className="flex items-center gap-2.5 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 overflow-hidden rounded-md border"
                        style={{ borderColor: theme.spec.palette.border }}
                      >
                        {[
                          theme.spec.palette.page,
                          theme.spec.palette.surface,
                          theme.spec.palette.raised,
                          theme.spec.accent,
                        ].map((colour, index) => (
                          <span key={index} className="h-full flex-1" style={{ background: colour }} />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {theme.name}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {isDarkTheme(theme.spec) ? "escuro" : "claro"} · privado
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
                        Publicar
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
                  ? "As cores vão sendo aplicadas na sala enquanto você mexe. Cancelar volta tudo como estava."
                  : "Um tema publicado aparece no Descobrir com o seu nome, e qualquer pessoa pode usar."}
              </p>
              <button
                type="button"
                onClick={() => openEditor(tab === "publish")}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {tab === "create" ? "Criar um tema" : "Criar e publicar um novo"}
              </button>
            </div>
          </div>
        )}
      </div>

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
    </div>
  );
}
