"use client";

import { useCallback, useEffect, useState } from "react";
import { MdBlock, MdDelete, MdLockOpen, MdOpenInNew } from "react-icons/md";
import {
  deleteAdminTheme,
  fetchAdminThemesByAuthor,
  searchAdminThemes,
  setThemeBan,
  type AdminThemeHit,
} from "@/lib/adminApi";

// Taking a theme down, and taking away the right to make more.
//
// Two actions that are usually one decision, so they sit on the same row: a
// moderator looking at a theme has the person who made it right there, and
// splitting "delete this" from "and stop them" across two panels is how the
// second half gets forgotten.
//
// The list shows private themes as well as published ones. "Private" is a
// promise made to other users, not to moderation — and the theme somebody is
// reported for is often the one they unpublished the moment they were noticed.
//
// Every row draws its own palette. A theme is judged by looking at it, and a
// moderator who has to open another tab to see what they are deleting will
// eventually delete the wrong one.

/** The swatch, from whatever the row happens to carry. */
function Swatch({ spec }: { spec: AdminThemeHit["spec"] }) {
  const palette = spec?.palette ?? {};
  const colours = [
    palette.page,
    palette.surface,
    palette.raised,
    spec?.accent,
  ].filter((colour): colour is string => typeof colour === "string" && colour.length > 0);
  if (colours.length === 0) {
    return (
      <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700" />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
      {colours.map((colour, index) => (
        <span key={index} className="h-full flex-1" style={{ background: colour }} />
      ))}
    </span>
  );
}

function ThemeRow({
  theme,
  onDeleted,
  onBanChanged,
}: {
  theme: AdminThemeHit;
  onDeleted: () => void;
  onBanChanged: (authorId: string, banned: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which destructive press is waiting for its second one. Held per row, so
  // arming one does not arm the others.
  const [confirm, setConfirm] = useState<"delete" | "deleteBan" | null>(null);

  async function remove(banAuthor: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAdminTheme(theme.id, banAuthor);
      if (result.banned) onBanChanged(theme.authorId, true);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
      setBusy(false);
      setConfirm(null);
    }
  }

  async function toggleBan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const banned = await setThemeBan(theme.authorId, !theme.authorBanned);
      onBanChanged(theme.authorId, banned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const danger =
    "flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";
  const quiet =
    "flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-start gap-2.5">
        <Swatch spec={theme.spec} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {theme.name}
            </span>
            {!theme.published && (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                privado
              </span>
            )}
            {theme.price > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {theme.price.toLocaleString("pt-BR")} pts
              </span>
            )}
            {theme.authorBanned && (
              <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                autor banido
              </span>
            )}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {theme.authorName ?? "conta apagada"}
            {theme.authorUsername && ` (@${theme.authorUsername})`} · {theme.uses} usos ·{" "}
            {theme.likes} curtidas
          </p>
          {theme.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400 dark:text-zinc-500">
              {theme.description}
            </p>
          )}
        </div>
        {/* Only published themes have a page to open; a private one 404s for
            everybody but its author, this panel included. */}
        {theme.published && (
          <a
            href={`/tema/${theme.id}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir a página do tema"
            title="Abrir a página do tema"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <MdOpenInNew className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Two presses, and the second one says what it will do. A delete on a
            list somebody is skimming is one mis-aimed click away at all times,
            and this one cannot be undone — the row is gone and so is whatever
            anybody was wearing. */}
        {confirm ? (
          <>
            <button type="button" onClick={() => void remove(confirm === "deleteBan")} disabled={busy} className={danger}>
              {busy
                ? "Excluindo..."
                : confirm === "deleteBan"
                  ? "Confirmar: excluir e banir"
                  : "Confirmar exclusão"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={busy}
              className={quiet}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirm("delete")} className={danger}>
              <MdDelete className="h-4 w-4 shrink-0" />
              Excluir
            </button>
            {!theme.authorBanned && (
              <button type="button" onClick={() => setConfirm("deleteBan")} className={danger}>
                <MdBlock className="h-4 w-4 shrink-0" />
                Excluir e banir o autor
              </button>
            )}
            {/* The ban on its own, both ways. Lifting one is the reason this
                button is not folded into the delete: an appeal arrives about a
                person, not about a theme that no longer exists. */}
            <button type="button" onClick={() => void toggleBan()} disabled={busy} className={quiet}>
              {theme.authorBanned ? (
                <>
                  <MdLockOpen className="h-4 w-4 shrink-0" />
                  Liberar o autor
                </>
              ) : (
                <>
                  <MdBlock className="h-4 w-4 shrink-0" />
                  Banir o autor
                </>
              )}
            </button>
          </>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}

export function ThemeModerationPanel() {
  const [query, setQuery] = useState("");
  const [themes, setThemes] = useState<AdminThemeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whose catalogue is being shown instead of the search, if any. Reached from
  // a row, because "what else has this person made" is the question a ban is
  // actually decided on.
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      // Inside the timer rather than beside it: the spinner belongs to the
      // request, and raising it on every keystroke would flash it through the
      // whole debounce without anything having been asked yet.
      setLoading(true);
      const load = author
        ? fetchAdminThemesByAuthor(author.id)
        : searchAdminThemes(query);
      load
        .then((rows) => {
          if (cancelled) return;
          setThemes(rows);
          setError(null);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      // Debounced, like the account search next door: this hits the database
      // on every keystroke otherwise.
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, author, seq]);

  // A ban is a fact about a person, not about the row it was pressed from —
  // so it lands on every theme by that author currently on screen.
  const markBan = useCallback((authorId: string, banned: boolean) => {
    setThemes((current) =>
      current.map((theme) =>
        theme.authorId === authorId ? { ...theme, authorBanned: banned } : theme
      )
    );
  }, []);

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Temas</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Procure por nome do tema, @usuário do autor, ou cole o id que aparece em /tema/&lt;id&gt;.
        Temas privados também aparecem. Banir usa a flag <code>THEME_BANNED</code>: a pessoa
        mantém o plano e os temas que já tem, mas não cria, publica nem edita nada publicado.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {author ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-900">
            <span className="text-zinc-600 dark:text-zinc-400">
              Mostrando tudo de <strong className="font-medium">{author.name}</strong>.
            </span>
            <button
              type="button"
              onClick={() => setAuthor(null)}
              className="rounded-md px-2 py-1 font-medium text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
            >
              Voltar à busca
            </button>
          </div>
        ) : (
          <div>
            <label
              htmlFor="theme-mod-search"
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Busca
            </label>
            <input
              id="theme-mod-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome, @usuário ou id"
              spellCheck={false}
              className={inputClass}
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        {loading && themes.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Carregando…</p>
        )}
        {!loading && themes.length === 0 && !error && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Nenhum tema encontrado.</p>
        )}

        {themes.length > 0 && (
          <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
            {themes.map((theme) => (
              <li key={theme.id} className="flex flex-col gap-1">
                <ThemeRow
                  theme={theme}
                  onDeleted={() => setSeq((n) => n + 1)}
                  onBanChanged={markBan}
                />
                {!author && theme.authorName && (
                  <button
                    type="button"
                    onClick={() =>
                      setAuthor({ id: theme.authorId, name: theme.authorName ?? "essa conta" })
                    }
                    className="self-start px-1 text-[11px] text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Ver todos os temas de {theme.authorName}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
