"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import useNtPopups from "ntpopups";
import { MdAdd, MdCheck, MdFavorite, MdFavoriteBorder, MdPalette, MdPeople } from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { AccountModal, type AccountModalMode } from "@/components/AccountModal";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { useAuth } from "@/lib/AuthContext";
import { hasFeature, verifiedBadge } from "@/lib/entitlements";
import {
  applyTheme,
  buyTheme,
  fetchMyThemes,
  fetchWorkshop,
  gradientCss,
  isDarkTheme,
  likeTheme,
  type RoomTheme,
  type WorkshopSort,
} from "@/lib/roomThemes";

// The Workshop: everybody's themes, and yours.
//
// One page with two halves rather than two pages, because they are the same
// object seen from two sides — the thing you are browsing is the thing you
// could have made, and a creator checking on their own theme's numbers should
// not have to remember which URL those live at.
//
// What a card shows is decided by what somebody actually wants to know before
// wearing a look: what it looks like, who made it, how many people are wearing
// it, and how many liked it. The preview is the palette itself rather than a
// mock room — the same reasoning as the editor's, written up there.

const SORTS: { id: WorkshopSort; label: string }[] = [
  { id: "popular", label: "Mais usados" },
  { id: "liked", label: "Mais curtidos" },
  { id: "recent", label: "Recentes" },
];

/** The palette, as the swatch strip that stands in for the theme. */
function ThemePreview({ theme }: { theme: RoomTheme }) {
  const { palette, accent, background } = theme.spec;
  return (
    <div
      className="relative h-24 overflow-hidden rounded-lg border"
      style={{
        // The gradient when the theme has one, so a card cannot promise a flat
        // page the room will not deliver.
        background: gradientCss(theme.spec) ?? palette.page,
        borderColor: palette.border,
      }}
    >
      {background && (
        // The real picture, at the blur and dim it will actually be worn with,
        // so a card cannot promise a look the room does not deliver.
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
      <div className="relative flex h-full flex-col justify-between p-2.5">
        <div
          className="flex items-center gap-1.5 rounded-md px-2 py-1"
          style={{ background: palette.surface }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <span className="text-[11px] font-medium" style={{ color: palette.text }}>
            {theme.name}
          </span>
        </div>
        <div className="flex gap-1">
          {[palette.surface, palette.raised, palette.border, palette.input, accent].map(
            (colour, index) => (
              <span
                key={index}
                className="h-4 flex-1 rounded"
                style={{ background: colour }}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  worn,
  onWear,
  onBuy,
  onLike,
  onEdit,
  onOpenAuthor,
  busy,
}: {
  theme: RoomTheme;
  worn: boolean;
  onWear: () => void;
  onBuy: () => void;
  onLike: () => void;
  onEdit?: () => void;
  onOpenAuthor: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      {/* The heart sits on the artwork, which is where the eye already is and
          the largest target on the card. It used to be a grey text button in
          the last row, below the buttons — technically present, and in the one
          place nobody looks at on a card they are deciding about.
          Over the preview it also needs no colour of its own from the theme:
          a scrim and white, so it reads on a pale palette and a dark one. */}
      <div className="relative">
        <ThemePreview theme={theme} />
        <button
          type="button"
          onClick={onLike}
          disabled={busy || !theme.published}
          aria-label={theme.liked ? "Remover curtida" : "Curtir tema"}
          aria-pressed={theme.liked}
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {theme.liked ? (
            <MdFavorite className="h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <MdFavoriteBorder className="h-4 w-4 shrink-0" />
          )}
          {theme.likes}
        </button>
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {theme.name}
          </span>
          <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            {isDarkTheme(theme.spec) ? "escuro" : "claro"}
          </span>
          {theme.price > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <BsCoin className="h-2.5 w-2.5 shrink-0" />
              {theme.price.toLocaleString("pt-BR")}
            </span>
          )}
        </p>
        {theme.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
            {theme.description}
          </p>
        )}
      </div>

      {theme.author && (
        // A button, not a link, and for the same reason the room's participant
        // list uses one: this goes nowhere. Marking it up as navigation would
        // promise a middle-click and a "copiar endereço do link" that do not
        // exist — and the dialog itself still offers the page, through the
        // "abrir em nova aba" control in its corner.
        //
        // Leaving the grid was the wrong price for "who made this?": the
        // workshop is a place people scroll, and a full navigation threw the
        // scroll position away to answer a question a dialog answers in place.
        <button
          type="button"
          onClick={onOpenAuthor}
          aria-label={`Ver o perfil de ${theme.author.displayName}`}
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-xs text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <UserAvatar
            src={theme.author.avatarUrl}
            name={theme.author.displayName}
            size={20}
            className="shrink-0"
            userId={theme.author.id}
          />
          <DisplayUserName
            name={theme.author.displayName}
            verified={verifiedBadge(theme.author.flags)}
            color={theme.author.nameColor}
            className="truncate"
          />
        </button>
      )}

      <div className="flex items-center gap-2">
        {/* Which verb this is comes from the server's `owned`, not from the
            price: an author owns theirs by having written it, and a buyer owns
            it for good however the price moves afterwards. */}
        {theme.owned ? (
          <button
            type="button"
            onClick={onWear}
            disabled={busy}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
              worn
                ? "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            }`}
          >
            {worn ? "Em uso — remover" : "Usar tema"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onBuy}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
          >
            <BsCoin className="h-3.5 w-3.5 shrink-0" />
            Comprar por {theme.price.toLocaleString("pt-BR")}
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Editar
          </button>
        )}
      </div>

      {/* What is left here is a statistic rather than a control. The like moved
          onto the preview above; this line answers the other question — "how
          many people are actually wearing it" — which is use rather than
          taste, and which a theme can score high on while scoring low on the
          other. */}
      <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <MdPeople className="h-4 w-4 shrink-0" />
          {theme.uses}
        </span>
        {!theme.published && (
          <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            privado
          </span>
        )}
      </div>
    </li>
  );
}

export function WorkshopPanel() {
  const { account, refresh } = useAuth();
  const { openPopup } = useNtPopups();
  const [sort, setSort] = useState<WorkshopSort>("popular");
  const [themes, setThemes] = useState<RoomTheme[]>([]);
  const [mine, setMine] = useState<RoomTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accountModal, setAccountModal] = useState<AccountModalMode | null>(null);
  // Whose profile is open, if any. Held here rather than per card so there is
  // one dialog on the page instead of one per theme — the same arrangement the
  // friends panel and the room both use.
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // What a purchase refused, if it refused — "not enough points" is the one
  // failure here somebody can act on.
  const [error, setError] = useState<string | null>(null);
  // Bumped after anything that changes a theme, so both lists are re-read from
  // the server rather than patched here. A card carries counters other people
  // move; a local patch would slowly drift away from the truth.
  const [seq, setSeq] = useState(0);

  const worn = account?.roomThemeId ?? null;
  // Derived rather than cleared on sign-out, so the effect above never has to
  // write state synchronously — and so a stale list cannot outlive the account
  // it belonged to.
  const myThemes = account ? mine : [];
  const canCreate = hasFeature("room_theme", account?.features ?? []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchWorkshop(sort, controller.signal).then((loaded) => {
      if (controller.signal.aborted) return;
      setThemes(loaded);
      setLoading(false);
    });
    return () => controller.abort();
  }, [sort, seq]);

  useEffect(() => {
    // Nothing to read for a guest, and nothing to clear either: what is on
    // screen is `myThemes` below, which is empty whenever there is no account.
    if (!account) return;
    const controller = new AbortController();
    void fetchMyThemes(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setMine(loaded);
    });
    return () => controller.abort();
  }, [account, seq]);

  const openEditor = useCallback(
    (theme: RoomTheme | null) => {
      void openPopup("theme_editor", {
        data: { theme, onSaved: () => setSeq((n) => n + 1) },
      });
    },
    [openPopup]
  );

  async function buy(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    setBusyId(theme.id);
    const result = await buyTheme(theme.id);
    if (result.ok) {
      // The points moved and so did ownership, both on the server. Re-read
      // rather than patched — a card that guesses at a balance is a card that
      // will eventually be wrong about one.
      refresh();
      setSeq((n) => n + 1);
    } else {
      setError(result.error);
    }
    setBusyId(null);
  }

  async function wear(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    setBusyId(theme.id);
    // Taking off the one already on, when the button says "remover".
    await applyTheme(worn === theme.id ? null : theme.id);
    // The account is what holds the choice, and the counters moved on the
    // server — so both are re-read rather than guessed at.
    refresh();
    setSeq((n) => n + 1);
    setBusyId(null);
  }

  async function toggleLike(theme: RoomTheme) {
    if (!account) {
      setAccountModal("create");
      return;
    }
    setBusyId(theme.id);
    const result = await likeTheme(theme.id, !theme.liked);
    if (result) {
      // Patched in place rather than re-read: the card is under the cursor and
      // a refetch would reorder the grid beneath it when the sort is by likes.
      const patch = (list: RoomTheme[]) =>
        list.map((entry) =>
          entry.id === theme.id ? { ...entry, liked: result.liked, likes: result.likes } : entry
        );
      setThemes(patch);
      setMine(patch);
    }
    setBusyId(null);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            <MdPalette className="h-6 w-6 shrink-0 text-indigo-500" />
            Descobrir temas
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Temas feitos pela comunidade para deixar as salas com outra cara. Usar é grátis para
            qualquer conta.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <MdAdd className="h-4 w-4 shrink-0" />
            Criar tema
          </button>
        )}
      </div>

      {!canCreate && (
        <p className="mt-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          Criar seus próprios temas é do{" "}
          <Link href="/pro" className="font-medium underline underline-offset-2">
            Pro
          </Link>
          . Publicar no Descobrir, do Pro Max.
        </p>
      )}

      {myThemes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Seus temas</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                worn={worn === theme.id}
                busy={busyId === theme.id}
                onWear={() => void wear(theme)}
                onBuy={() => void buy(theme)}
                onLike={() => void toggleLike(theme)}
                onEdit={() => openEditor(theme)}
                onOpenAuthor={() => setProfileUserId(theme.authorId)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Da comunidade
          </h2>
          <div className="inline-flex rounded-xl border border-zinc-200 p-1 dark:border-zinc-800">
            {SORTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSort(entry.id)}
                aria-pressed={sort === entry.id}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  sort === entry.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Carregando…</p>
        ) : themes.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            Ainda não há temas publicados. {canCreate && "Seja o primeiro."}
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                worn={worn === theme.id}
                busy={busyId === theme.id}
                onWear={() => void wear(theme)}
                onBuy={() => void buy(theme)}
                onLike={() => void toggleLike(theme)}
                onEdit={
                  theme.authorId === account?.id ? () => openEditor(theme) : undefined
                }
                onOpenAuthor={() => setProfileUserId(theme.authorId)}
              />
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {worn && (
        <p className="mt-8 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <MdCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          Seu tema aparece nas salas que não têm um tema próprio definido.
        </p>
      )}

      <AccountModal mode={accountModal} onModeChange={setAccountModal} />
      {/* Portalled to the body by the dialog itself, so it is not clipped by
          the grid it was opened from. */}
      {profileUserId && (
        <UserProfileDialog userId={profileUserId} onClose={() => setProfileUserId(null)} />
      )}
    </div>
  );
}
