"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signalingClient } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { trackEvent } from "@/lib/analytics";
import { toRoomHandle, fetchPeopleOnline } from "@/lib/roomsApi";
import { useAuth } from "@/lib/AuthContext";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PEOPLE_COUNT_POLL_MS = 8000;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const linkButtonClass =
  "self-start text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// Pre-registration identity choice — "landing" is the two-button choice
// itself, the other three are the forms each choice opens.
type IdentityMode = "landing" | "create" | "login";

export default function Home() {
  const state = useSignaling();
  const router = useRouter();
  const { loading: resolvingAccount, login, register, logout } = useAuth();

  const [peopleOnline, setPeopleOnline] = useState<number | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomIsPrivate, setRoomIsPrivate] = useState(false);

  const [mode, setMode] = useState<IdentityMode>("landing");
  const [nameInput, setNameInput] = useState("");
  const [changingName, setChangingName] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasStoredName = useHasStoredName();

  // useAccountToken()/useHasStoredName() briefly report empty/false on the
  // very first client paint (their useSyncExternalStore server snapshot),
  // before correcting to the real localStorage-backed value — without this
  // gate that one frame renders `restoring` as false for a logged-in
  // account, flashing the "choose name" popups before flipping back.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const registered = Boolean(state.name);
  const isAccount = Boolean(state.account);
  const restoring =
    !mounted || (!registered && (resolvingAccount || (hasStoredName && !state.nameError)));
  const previousNameRef = useRef(state.name);

  // Closes the rename form once the name actually changes (success or a
  // plain reconnect landing on the same name), without guessing at timing.
  useEffect(() => {
    if (changingName && state.name !== previousNameRef.current) {
      setChangingName(false);
      setNameInput("");
    }
    previousNameRef.current = state.name;
  }, [state.name, changingName]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const count = await fetchPeopleOnline(controller.signal);
        if (cancelled) return;
        setPeopleOnline(count);
      } catch {
        // Directory unreachable — leave the last known count in place
        // rather than flashing an error over a non-essential counter.
      }
    }

    load();
    const interval = setInterval(load, PEOPLE_COUNT_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  function resetIdentityForm() {
    setMode("landing");
    setFormError(null);
    setUsername("");
    setDisplayName("");
    setPassword("");
  }

  function openCreateMode() {
    setMode("create");
    setFormError(null);
    setDisplayName(state.name ?? "");
  }

  function handleGuestSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === state.name) return;
    trackEvent("name_change");
    signalingClient.register(trimmed);
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmedUser = username.trim();
    const trimmedDisplay = displayName.trim();
    if (!USERNAME_RE.test(trimmedUser)) {
      setFormError("Usuário deve ter 3 a 20 letras, números ou _.");
      return;
    }
    if (!trimmedDisplay) {
      setFormError("Escolha um nome de exibição.");
      return;
    }
    if (password.length < 6) {
      setFormError("Senha deve ter ao menos 6 caracteres.");
      return;
    }
    setSubmitting(true);
    try {
      await register(trimmedUser, trimmedDisplay, password);
      trackEvent("account_created");
      // register() stores the new token, which the effect above picks up
      // and turns into a signaling registration — nothing more to do.
      resetIdentityForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao criar conta.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!username.trim() || !password) return;
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      trackEvent("account_login");
      resetIdentityForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Usuário ou senha inválidos.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    logout();
    resetIdentityForm();
  }

  function handleRoomSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = roomInput.trim();
    const fullHandle = toRoomHandle(trimmed, roomIsPrivate);
    if (!HANDLE_RE.test(fullHandle)) {
      setRoomError("Use de 1 a 32 letras, números, - e _.");
      return;
    }
    setRoomError(null);
    router.push(`/watch/${fullHandle}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-4 py-16 dark:bg-black">
      {peopleOnline !== null && (
        <span className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {peopleOnline} {peopleOnline === 1 ? "pessoa" : "pessoas"} em salas agora
        </span>
      )}
      {false && <>

        <h2 style={{ color: "#ff2828", maxWidth: "500px", fontSize: "1.3rem" }}>Site fora do ar momentâneamente!!</h2>
        <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>A API foi reiniciar pra atualizar e não consegue mais ligar por ter mais de 2000 pessoas tentando reconectar.</h2>
        <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>Eu tô programando um sistema de balanceamento de carga. Aguentaí que já volta</h2>
        <h2 style={{ color: "#ff6767", maxWidth: "500px" }}>Deve voltar em uns 10 minutos</h2>
        <h2 style={{ color: "#67c7ff", maxWidth: "500px" }}>Para atualizações/sugestões/etc entre no meu Discord: <Link style={{ color: "#00ff00" }} href={"https://go.nemtudo.me/golive-nemtudodiscord"} target="_blank">discord.gg/nemtudo</Link></h2>
        <h2 style={{ color: "#67c7ff", maxWidth: "500px" }}>Me segue no Twitter tbm, sempre posto update e projeto por lá <Link style={{ color: "#00ff00" }} href={"https://go.nemtudo.me/golive-nemtudo-twitter"} target="_blank">x.com/NemTudo_</Link></h2>
      </>
      }
      <main className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          GoLive
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Compartilhe sua tela com quem estiver na mesma sala, sem cadastro.
        </p>
        <Link href="/rooms" className={`mt-3 inline-block ${linkButtonClass}`}>
          Ver salas públicas ativas
        </Link>

        {restoring ? (
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Reconectando...</p>
        ) : mode === "create" ? (
          <form onSubmit={handleCreateSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="username" className={labelClass}>
              Usuário
            </label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
              placeholder="Ex: maria123"
              className={inputClass}
            />
            <label htmlFor="displayName" className={labelClass}>
              Nome de exibição
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className={inputClass}
            />
            <label htmlFor="password" className={labelClass}>
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={submitting} className={`flex-1 ${primaryButtonClass}`}>
                {submitting ? "Criando..." : "Criar conta"}
              </button>
              <button type="button" onClick={resetIdentityForm} className={secondaryButtonClass}>
                Voltar
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setFormError(null);
              }}
              className={linkButtonClass}
            >
              Já tenho uma conta
            </button>
          </form>
        ) : mode === "login" ? (
          <form onSubmit={handleLoginSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="loginUsername" className={labelClass}>
              Usuário
            </label>
            <input
              id="loginUsername"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
            <label htmlFor="loginPassword" className={labelClass}>
              Senha
            </label>
            <input
              id="loginPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            {formError && <p className="text-sm text-red-500">{formError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={submitting || !username.trim() || !password}
                className={`flex-1 ${primaryButtonClass}`}
              >
                {submitting ? "Entrando..." : "Entrar"}
              </button>
              <button type="button" onClick={resetIdentityForm} className={secondaryButtonClass}>
                Voltar
              </button>
            </div>
            <button
              type="button"
              onClick={openCreateMode}
              className={linkButtonClass}
            >
              Criar uma conta
            </button>
          </form>
        ) : !registered ? (
          <>
            {mode === "landing" && (
              <form onSubmit={handleGuestSubmit} className="mt-8 flex flex-col gap-3">
                <label htmlFor="name" className={labelClass}>
                  Seu nome
                </label>
                <div className="flex gap-2">
                  <input
                    id="name"
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={24}
                    placeholder="Ex: Maria"
                    className={`min-w-0 flex-1 ${inputClass}`}
                  />
                  <button
                    type="submit"
                    disabled={!nameInput.trim()}
                    className={`shrink-0 ${primaryButtonClass}`}
                  >
                    Continuar
                  </button>
                </div>
                {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
                <button type="button" onClick={openCreateMode} className={secondaryButtonClass}>
                  Criar uma conta
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setFormError(null);
                  }}
                  className={`${linkButtonClass} self-center`}
                >
                  Já tenho uma conta
                </button>
              </form>
            )}
          </>
        ) : changingName ? (
          <form onSubmit={handleRenameSubmit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="name" className={labelClass}>
              Novo nome
            </label>
            <input
              id="name"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={24}
              placeholder="Ex: Maria"
              className={inputClass}
            />
            {state.nameError && <p className="text-sm text-red-500">{state.nameError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={!nameInput.trim() || nameInput.trim() === state.name}
                className={`flex-1 ${primaryButtonClass}`}
              >
                Salvar nome
              </button>
              <button
                type="button"
                onClick={() => {
                  setChangingName(false);
                  setNameInput("");
                }}
                className={secondaryButtonClass}
              >
                Cancelar
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setChangingName(false);
                setNameInput("");
                openCreateMode();
              }}
              className={linkButtonClass}
            >
              Ou crie uma conta
            </button>
          </form>
        ) : (
          <form onSubmit={handleRoomSubmit} className="mt-8 flex flex-col gap-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Conectado como{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{state.name}</span>{" "}
              {isAccount ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="font-medium underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Sair
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(state.name ?? "");
                      setChangingName(true);
                    }}
                    className="font-medium underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Trocar
                  </button>{" "}
                  <button
                    type="button"
                    onClick={openCreateMode}
                    className="font-medium underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Criar conta
                  </button>
                </>
              )}
            </p>
            <label htmlFor="room" className={labelClass}>
              Para qual sala você quer ir ou criar?
            </label>
            <input
              id="room"
              autoFocus
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="Ex: reuniao-time"
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={roomIsPrivate}
                onChange={(e) => setRoomIsPrivate(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
              />
              Sala privada (não aparece na lista de salas públicas)
            </label>
            {roomError && <p className="text-sm text-red-500">{roomError}</p>}
            <button type="submit" disabled={!roomInput.trim()} className={`mt-2 ${primaryButtonClass}`}>
              Entrar na sala
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Desenvolvido por{" "}
          <span className="font-medium text-zinc-500 dark:text-zinc-400">@NemTudo</span> (
          <a
            href="https://discord.gg/nemtudo"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
            style={{ color: "#267fff" }}
          >
            discord.gg/nemtudo
          </a>
          )
        </p>
      </main>
    </div>
  );
}
