"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MdAdd, MdArrowBack, MdContentCopy, MdCheck } from "react-icons/md";
import { createBot, fetchMyBots, regenerateBotToken, type Account } from "@/lib/accountApi";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { BotTag } from "@/components/BotTag";

// The bots this account created, from the header's account menu (see
// AccountMenu). A bot is an ordinary account that logs in with a token instead
// of a password — `Authorization: Bot <token>` over HTTP, or the same string as
// the `token` of the WS "register" message — so all there is to manage here is
// making one and handing out its token.
//
// The token is shown exactly once, when it is made: the API keeps only a hash
// of it. Losing it means asking for a new one, which also switches the old one
// off — the same button is how a leaked token is revoked.

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

// Every bot's username ends in this — the API appends it (see its
// accountStore's botUsernameFor), and the form shows it fixed after the field
// so what you type is only the part before it. 16 because usernames cap at 20.
const BOT_USERNAME_SUFFIX = "_bot";
const BOT_USERNAME_BASE_MAX = 20 - BOT_USERNAME_SUFFIX.length;

// The whole credential, prefix included — that string is exactly what goes in
// the Authorization header, so copying anything less would only invite a
// "401" from somebody who pasted the bare token.
function credentialFor(token: string): string {
  return `Bot ${token}`;
}

export function BotsPanel({ onBack }: { onBack: () => void }) {
  const [bots, setBots] = useState<Account[] | null>(null);
  const [max, setMax] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The token on screen right now, and whose it is. Cleared by "Pronto", after
  // which it exists nowhere but wherever it was pasted.
  const [revealed, setRevealed] = useState<{ bot: Account; token: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyBots()
      .then((data) => {
        if (cancelled) return;
        setBots(data.bots);
        setMax(data.max);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const header = (
    <div className="flex items-center gap-1 pb-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar"
        className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <MdArrowBack className="h-4 w-4" />
      </button>
      <p className="flex-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">Meus bots</p>
      {bots && (
        <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
          {bots.length}/{max}
        </span>
      )}
    </div>
  );

  if (revealed) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <TokenReveal bot={revealed.bot} token={revealed.token} onDone={() => setRevealed(null)} />
      </div>
    );
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <CreateBotForm
          onCancel={() => setCreating(false)}
          onCreated={(bot, token) => {
            setBots((prev) => [bot, ...(prev ?? [])]);
            setCreating(false);
            setRevealed({ bot, token });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {header}
      {loadError ? (
        <p className="text-xs text-red-500">{loadError}</p>
      ) : !bots ? (
        <p className="py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">Carregando…</p>
      ) : bots.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Um bot é uma conta que entra no GoLive por código, com um token em vez de senha.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {bots.map((bot) => (
            <BotRow key={bot.id} bot={bot} onToken={(token) => setRevealed({ bot, token })} />
          ))}
        </ul>
      )}
      {bots && bots.length < max && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={`flex items-center justify-center gap-1.5 ${primaryButtonClass}`}
        >
          <MdAdd className="h-4 w-4" />
          Criar bot
        </button>
      )}
    </div>
  );
}

function BotRow({ bot, onToken }: { bot: Account; onToken: (token: string) => void }) {
  // Two presses, because the first one is not what it looks like: a new token
  // is also the end of the old one, and whatever is running on it stops.
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      onToken(await regenerateBotToken(bot.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar um novo token.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <img
          src={bot.avatarUrl ?? DEFAULT_AVATAR_PATH}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <span className="truncate">{bot.displayName}</span>
            <BotTag />
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{bot.username}</p>
        </div>
      </div>
      {confirming ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            O token atual para de funcionar na hora. Continuar?
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={regenerate}
              className={`flex-1 !py-1 !text-xs ${primaryButtonClass}`}
            >
              {busy ? "Gerando…" : "Gerar novo token"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className={`!py-1 !text-xs ${secondaryButtonClass}`}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`mt-2 w-full !py-1 !text-xs ${secondaryButtonClass}`}
        >
          Gerar novo token
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </li>
  );
}

function CreateBotForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (bot: Account, token: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let trimmed = username.trim().toLowerCase();
    // Somebody typing the suffix themselves gets it once, not twice — the API
    // does the same.
    if (trimmed.endsWith(BOT_USERNAME_SUFFIX)) trimmed = trimmed.slice(0, -BOT_USERNAME_SUFFIX.length);
    if (!new RegExp(`^[a-z0-9_]{1,${BOT_USERNAME_BASE_MAX}}$`).test(trimmed)) {
      setError(`Use até ${BOT_USERNAME_BASE_MAX} letras, números ou _.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { bot, token } = await createBot(trimmed, displayName.trim());
      onCreated(bot, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o bot.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="bot-username" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        Usuário do bot
      </label>
      <div className="flex items-stretch">
        <input
          id="bot-username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={BOT_USERNAME_BASE_MAX}
          placeholder="meu"
          autoComplete="off"
          className={`min-w-0 flex-1 !rounded-r-none ${inputClass}`}
        />
        <span className="flex shrink-0 items-center rounded-r-lg border border-l-0 border-zinc-300 bg-zinc-100 px-2.5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {BOT_USERNAME_SUFFIX}
        </span>
      </div>
      <label htmlFor="bot-display-name" className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        Nome de exibição
      </label>
      <input
        id="bot-display-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={24}
        placeholder={username.trim() || "Meu"}
        autoComplete="off"
        className={inputClass}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="mt-1 flex gap-2">
        <button type="submit" disabled={busy || !username.trim()} className={`flex-1 ${primaryButtonClass}`}>
          {busy ? "Criando…" : "Criar bot"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryButtonClass}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function TokenReveal({ bot, token, onDone }: { bot: Account; token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const credential = credentialFor(token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions, an insecure origin): the field below is
      // selectable, so copying by hand still works.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Token de <span className="font-semibold">@{bot.username}</span>. Guarde agora — ele não
        aparece de novo.
      </p>
      <div className="flex items-stretch gap-1.5">
        <input
          readOnly
          value={credential}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 font-mono !text-xs ${inputClass}`}
        />
        <button
          type="button"
          onClick={copy}
          aria-label="Copiar token"
          className={`flex shrink-0 items-center !px-2 ${secondaryButtonClass}`}
        >
          {copied ? <MdCheck className="h-4 w-4 text-emerald-500" /> : <MdContentCopy className="h-4 w-4" />}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Envie no cabeçalho <code className="font-mono">Authorization</code>, ou como{" "}
        <code className="font-mono">token</code> no <code className="font-mono">register</code> do
        WebSocket.
      </p>
      <button type="button" onClick={onDone} className={primaryButtonClass}>
        Pronto
      </button>
    </div>
  );
}
