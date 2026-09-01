"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signalingClient, getStoredName } from "@/lib/signalingClient";
import { useSignaling, useHasStoredName } from "@/lib/useSignaling";
import { trackEvent } from "@/lib/analytics";
import {
  toRoomHandle,
  isPrivateRoomHandle,
  generateRoomCode,
  roomExists,
  toPrivateRoomHandle,
  splitPrivateRoomHandle,
  ROOM_CODE_LENGTH,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
  ENFORCE_NEW_ROOM_CODE_SYSTEM,
} from "@/lib/roomsApi";
import { usePeopleOnline } from "@/lib/peopleOnline";
import { useAuth } from "@/lib/AuthContext";
import { CreateAccountForm } from "@/components/CreateAccountForm";
import { LoginForm } from "@/components/LoginForm";
import { OAuthButtons } from "@/components/OAuthButtons";
import { CompleteOAuthSignupForm } from "@/components/CompleteOAuthSignupForm";
import type { OAuthResult } from "@/lib/oauthApi";
import { GlobeIcon } from "@/components/icons";
import { DownloadAppButton } from "@/components/DownloadAppButton";
import { RecentRooms } from "@/components/RecentRooms";
import { MdLock, MdOutlineMap } from "react-icons/md";
import { SocialLinks } from "@/components/SocialLinks";
import { SiteHeader } from "@/components/SiteHeader";
import { Tooltip } from "@/components/Tooltip";

// Mirrors server/signaling.ts's HANDLE_RE — must match exactly, or a name
// this lets through but the server rejects lands the user in a dead room
// (join fails server-side, but the client's already navigated to it).
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
// How long typing has to settle before the room lookup fires. Long enough
// that a name typed straight through costs one request rather than one per
// letter, short enough that the button has settled by the time someone's
// hand reaches it.
const ROOM_CHECK_DEBOUNCE_MS = 450;
// How long "Reconectando..." is allowed to stand on its own before the page
// offers something to press. Long enough that an ordinary reconnect — a
// reload, a laptop waking up — is never interrupted by a button suggesting
// something is wrong; short enough that nobody sits watching a word for a
// minute with no way to act.
const STUCK_RECONNECT_MS = 15_000;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-lg bg-zinc-950 px-4 py-2.5 font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const linkButtonClass =
  "self-start text-sm font-medium underline underline-offset-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";
// The room-type / create-vs-join choices below. Selected state is a filled
// button rather than a subtle border, because which one is active decides
// what the rest of the form asks for.
function roomTabClass(selected: boolean): string {
  return `flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${selected
    ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    }`;
}

// Pre-registration identity choice — "landing" is the two-button choice
// itself, the other three are the forms each choice opens.
type IdentityMode = "landing" | "create" | "login";

// What the room form is currently set up to do. Private rooms split in two
// because the two directions genuinely need different things from the
// person: creating takes a name and mints the code, joining takes a name
// *and* the code someone already has. Collapsing them into one box (the old
// "sala privada" checkbox) meant a typo in the code created a second, empty
// room instead of failing — the person then sat alone in it, with no way to
// tell that from "nobody showed up yet".
type RoomMode = "public" | "private-create" | "private-join";

export default function Home() {
  const state = useSignaling();
  const router = useRouter();
  const { loading: resolvingAccount } = useAuth();

  // One shared poller for the whole page rather than one per component — see
  // lib/peopleOnline.ts for why that mattered enough to be worth a module.
  const peopleOnline = usePeopleOnline();
  const [roomInput, setRoomInput] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [roomMode, setRoomMode] = useState<RoomMode>("public");
  const [checkingRoom, setCheckingRoom] = useState(false);
  // Every "does this room exist?" answer this session, keyed by handle.
  // State rather than a ref because a landing answer has to re-render the
  // button, and a plain map doubles as the cache: backspacing through a
  // name never re-asks about a handle already answered.
  const [roomExistsAnswers, setRoomExistsAnswers] = useState<Record<string, boolean>>({});
  // Read by the lookup effect, which must *not* re-run when an answer lands
  // — that would restart the very fetch that produced it. Kept current from
  // an effect rather than during render, which is what React asks for.
  const roomExistsAnswersRef = useRef(roomExistsAnswers);

  const [mode, setMode] = useState<IdentityMode>("landing");
  const [nameInput, setNameInput] = useState("");
  // A social login that turned out to be a signup. It takes over the whole
  // identity area below (see the branch before `mode`), because the username
  // step replaces whichever form the buttons were sitting under — rendering
  // it alongside left the two stacked on top of each other.
  const [oauthTicket, setOAuthTicket] = useState<
    Extract<OAuthResult, { kind: "ticket" }> | null
  >(null);

  const hasStoredName = useHasStoredName();

  // useAccountToken()/useHasStoredName() briefly report empty/false on the
  // very first client paint (their useSyncExternalStore server snapshot),
  // before correcting to the real localStorage-backed value — so for that one
  // frame a returning visitor looks like a brand-new one, and the identity
  // forms below would flash into view before flipping back.
  //
  // This gates only those forms now, not the page. Gating the page meant the
  // pre-hydration state was a connection status the server could not know, and
  // that a page which failed to hydrate had no way out of it — see `restoring`
  // below.
  const [mounted, setMounted] = useState(false);
  // Deferred by a tick rather than set synchronously in the effect: setting
  // state during the effect body forces a second render pass before the
  // browser paints, which is the cascading-render pattern React 19 warns
  // about. Matches the same gate in WatchRoom.
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  // The public handle currently worth looking up, or null when there's
  // nothing to ask about (another mode, empty, or not a legal handle).
  // Derived rather than stored, so it can never disagree with the field.
  const trimmedRoomInput = roomInput.trim();
  const publicRoomToCheck =
    roomMode === "public" && trimmedRoomInput && HANDLE_RE.test(trimmedRoomInput)
      ? trimmedRoomInput
      : null;
  // What the button should say it's about to do. null = not known yet,
  // which reads as "Criar sala" — the resting assumption, since entering
  // and creating are the same click for a public room and most names typed
  // are new ones.
  const publicRoomExists = publicRoomToCheck
    ? roomExistsAnswers[publicRoomToCheck] ?? null
    : null;

  const registered = Boolean(state.name);
  // Connection states the client has deliberately stopped retrying from (see
  // signalingClient's onclose). Neither is a reconnect in progress, and both
  // used to be rendered here as one: this page never read `status` at all, so a
  // tab that had been superseded or banned sat on "Reconectando..." forever
  // while nothing anywhere was reconnecting or ever would. The room view has
  // had proper screens for both of these all along; this one just never got
  // them.
  const superseded = state.status === "superseded";
  const banned = state.status === "banned";
  // `mounted` is deliberately NOT part of this any more, and that is the whole
  // point of the change.
  //
  // It used to be, as `!mounted || ...`, which meant the server-rendered HTML
  // for this page always said "Reconectando...". That is a claim the server
  // cannot possibly make — it knows nothing about this visitor's connection —
  // and it turned every failure to hydrate into a permanently dead landing
  // page: the text is server HTML so it paints, but `mounted`, the fifteen-
  // second timer behind the retry button and every network call on this page
  // all live in effects that never ran. The result was a site that said it was
  // reconnecting while nothing was connecting, offered no button, and made no
  // requests at all. Anything can stop hydration — a chunk that fails to
  // download while the API is under load, an extension, a cold cache on a slow
  // link — and none of it should be able to do that.
  //
  // Now the pre-hydration render is the ordinary page. The cost is the flash
  // `mounted` was added to prevent (see its own comment), which is handled
  // below where it actually happens instead of by hiding the entire page.
  const restoring =
    !banned &&
    !superseded &&
    !registered &&
    (resolvingAccount || (hasStoredName && !state.nameError));

  // "Reconectando..." is honest for a second or two and useless after fifteen:
  // the automatic retry is still running, but it has backed off to one attempt
  // every ten seconds (see signalingClient's scheduleReconnect), so what the
  // person is looking at is a page that says it is working and gives them
  // nothing to do. Past this, they get something to press.
  const [stuckReconnecting, setStuckReconnecting] = useState(false);
  useEffect(() => {
    if (!restoring) return;
    const timer = setTimeout(() => setStuckReconnecting(true), STUCK_RECONNECT_MS);
    // Cleared on the way out rather than on the way in: this runs when the
    // connection recovers, so a later stall gets the full fifteen seconds of
    // quiet again instead of showing the button the instant it starts.
    return () => {
      clearTimeout(timer);
      setStuckReconnecting(false);
    };
  }, [restoring]);

  function resetIdentityForm() {
    setMode("landing");
    setOAuthTicket(null);
  }

  function openCreateMode() {
    setMode("create");
  }

  function handleGuestSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    signalingClient.register(trimmed);
  }

  useEffect(() => {
    roomExistsAnswersRef.current = roomExistsAnswers;
  }, [roomExistsAnswers]);

  // Looks up the public room being typed, so the button can say whether
  // this is about to create one or walk into one that's already running.
  // Public only, deliberately: for a private room the handle *is* the
  // secret, and a lookup firing on every keystroke would turn this into a
  // fast way to probe codes. "Entrar em sala" checks on submit instead.
  useEffect(() => {
    // Nothing to ask about, or the answer is already in hand — note this
    // reads `roomExistsAnswers` but doesn't depend on it: a landing answer
    // must not re-trigger the very effect that fetched it.
    if (!publicRoomToCheck || publicRoomToCheck in roomExistsAnswersRef.current) return;
    const handle = publicRoomToCheck;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCheckingRoom(true);
      try {
        const exists = await roomExists(handle, controller.signal);
        setRoomExistsAnswers((prev) => ({ ...prev, [handle]: exists }));
      } catch {
        // Unreachable directory, or superseded by the next keystroke. Left
        // unanswered rather than guessed at — the button falls back to
        // "Criar sala", and for a public room the click does the right
        // thing either way.
      } finally {
        setCheckingRoom(false);
      }
    }, ROOM_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [publicRoomToCheck]);

  // Clears whatever the previous mode had to say about what was typed — an
  // error about a missing code has no business surviving a switch to the
  // form that doesn't ask for one.
  function switchRoomMode(next: RoomMode) {
    setRoomMode(next);
    setRoomError(null);
  }

  async function handleRoomSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = roomInput.trim();
    setRoomError(null);

    if (roomMode === "private-create") {
      if (trimmed.length > MAX_PRIVATE_ROOM_NAME_LENGTH) {
        setRoomError(`O nome pode ter no máximo ${MAX_PRIVATE_ROOM_NAME_LENGTH} caracteres.`);
        return;
      }
      // The code is minted here, client-side, and becomes part of the URL —
      // the server reads it back out of the handle rather than inventing
      // one of its own (see roomCodeFromHandle), so the link is the room.
      const handle = toPrivateRoomHandle(trimmed, generateRoomCode());
      if (!HANDLE_RE.test(handle)) {
        setRoomError("Use de 1 a 32 letras, números, - e _.");
        return;
      }
      trackEvent("room_create", { visibility: "private" });
      router.push(`/watch/${handle}`);
      return;
    }

    if (roomMode === "private-join") {
      // Name and code arrive as one string ("familia-123456"), the same
      // shape the handle itself has minus the "priv-" — so it's what
      // someone reads off a link, and there's no second field to get out
      // of step with the first. Pasting the whole handle straight from a
      // link works too: the prefix is stripped rather than doubled, since
      // "priv-priv-familia-123456" is nobody's intent.
      const handle = isPrivateRoomHandle(trimmed) ? trimmed : toRoomHandle(trimmed, true);
      if (!HANDLE_RE.test(handle)) {
        setRoomError("Use de 1 a 32 letras, números, - e _.");
        return;
      }
      // Only demanded once the scheme is being enforced — see
      // ENFORCE_NEW_ROOM_CODE_SYSTEM. While it's off a bare name is allowed
      // through, because private rooms created before this existed have no
      // code to type and this is the only way back into them. The existence
      // check below is what catches a typo either way.
      if (ENFORCE_NEW_ROOM_CODE_SYSTEM && !splitPrivateRoomHandle(handle)) {
        setRoomError(`Inclua o código no fim: nome-${"0".repeat(ROOM_CODE_LENGTH)}`);
        return;
      }
      // Checked before navigating precisely because joining a room that
      // isn't there would *create* it — the person would land in an empty
      // room that looks exactly like the right one with nobody in it yet.
      setCheckingRoom(true);
      try {
        if (!(await roomExists(handle))) {
          setRoomError("Sala não encontrada. Confira o nome e o código.");
          return;
        }
      } catch {
        setRoomError("Não foi possível verificar a sala. Tente de novo.");
        return;
      } finally {
        setCheckingRoom(false);
      }
      router.push(`/watch/${handle}`);
      return;
    }

    const fullHandle = toRoomHandle(trimmed, false);
    if (!HANDLE_RE.test(fullHandle)) {
      setRoomError("Use de 1 a 32 letras, números, - e _.");
      return;
    }
    router.push(`/watch/${fullHandle}`);
  }

  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 px-4 py-16 dark:bg-black">
        {peopleOnline !== null && (<div className="inline-flex gap-2">
          <span className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {peopleOnline} {peopleOnline === 1 ? "pessoa" : "pessoas"} em salas agora
          </span>
          <DownloadAppButton source="home" />
        </div>
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
          {/* Wrapped so the two sit side by side and wrap together on a
            narrow screen — the download button renders nothing at all in
            the app itself or on mobile, and the row collapses cleanly. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href="/rooms"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 px-3.5 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-400 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:border-sky-600 dark:hover:bg-sky-900"
            >
              <GlobeIcon className="h-4 w-4" />
              Ver salas públicas
            </Link>
            {/* The same rooms, arranged by where their owners put them on the
              globe instead of by headcount — see app/worldmap. Only ever public
              ones, same as the list beside it. */}
            <Tooltip content="Encontre salas no seu país, cidade ou bairro!">
              <Link
                href="/worldmap"
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 px-3.5 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-400 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-300 dark:hover:border-sky-600 dark:hover:bg-sky-900"
              >
                <MdOutlineMap className="h-4 w-4" />
                Ver mapa de salas
              </Link>
            </Tooltip>
          </div>
          {banned ? (
            <div className="mt-8 flex flex-col items-start gap-2">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                {state.bannedReason
                  ? `Você foi banido do site: ${state.bannedReason}`
                  : "Você foi temporariamente banido do site pelo AntiSpam. Duração: 1h."}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Se você acredita que isso é um engano, abra um ticket em{" "}
                <a
                  href="https://discord.gg/nemtudo"
                  target="_blank"
                  className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
                >
                  discord.gg/nemtudo
                </a>
              </p>
            </div>
          ) : superseded ? (
            <div className="mt-8 flex flex-col items-start gap-2">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Essa sessão foi aberta em outra aba ou dispositivo.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Só é possível ficar conectado com o mesmo nome em um lugar por vez.
              </p>
              <button
                type="button"
                onClick={() => {
                  // state.name is null when this tab never got as far as
                  // registering, which is exactly the case that used to look
                  // like an endless reconnect — so fall back to the name on
                  // disk rather than leaving the button doing nothing.
                  const name = state.name ?? getStoredName();
                  if (name) signalingClient.register(name);
                }}
                className={secondaryButtonClass}
              >
                Usar esta aba
              </button>
            </div>
          ) : restoring ? (
            <div className="mt-8 flex flex-col items-start gap-2">
              <p className="text-sm text-sky-500 dark:text-zinc-400">Conectando...</p>
              {stuckReconnecting && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      // Not a page reload: the socket is what is stuck, and
                      // reloading would throw away everything else that is
                      // already loaded to fix one connection.
                      signalingClient.retryNow();
                      setStuckReconnecting(false);
                    }}
                    className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Tentar novamente
                  </button>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Está demorando mais que o normal. Pode ser a sua conexão ou o servidor.
                  </p>
                </>
              )}
            </div>
          ) : !mounted ? (
            // The one frame where a returning visitor still looks brand new
            // (see `mounted`), sized so the layout does not jump when the real
            // content lands.
            //
            // It says something, and it carries an escape hatch, because this
            // is also the exact markup a visitor is left staring at if the page
            // never hydrates — and a silent empty box is the worst possible
            // thing to leave them with. The link is a plain anchor revealed by
            // a CSS animation (see .reveal-when-stuck), so it works when no
            // JavaScript on the page is running at all, which is precisely the
            // situation it exists for.
            <div className="mt-8 flex h-24 flex-col items-start gap-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Carregando...</p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                  A plain anchor on purpose. <Link> is client-side navigation,
                  which needs the very JavaScript that has failed to arrive in
                  the one situation this link exists for; it would render a
                  control that does nothing. A real href does a full document
                  load with no script involved at all. */}
              <a href="/" className={`reveal-when-stuck ${linkButtonClass}`}>
                Demorou demais — recarregar a página
              </a>
            </div>
          ) : oauthTicket ? (
            <div className="mt-8">
              <CompleteOAuthSignupForm
                ticket={oauthTicket.ticket}
                provider={oauthTicket.provider}
                suggestedUsername={oauthTicket.suggestedUsername}
                suggestedDisplayName={oauthTicket.suggestedDisplayName}
                onSuccess={resetIdentityForm}
                // Back to whichever form the user came from, not out of the
                // identity area entirely.
                onCancel={() => setOAuthTicket(null)}
              />
            </div>
          ) : mode === "create" ? (
            <CreateAccountForm
              initialDisplayName={state.name ?? ""}
              onSuccess={resetIdentityForm}
              onCancel={resetIdentityForm}
              onSwitchToLogin={() => setMode("login")}
            />
          ) : mode === "login" ? (
            <LoginForm
              onSuccess={resetIdentityForm}
              onCancel={resetIdentityForm}
              onSwitchToCreate={openCreateMode}
              // Handled above rather than inside the form, so the username
              // step takes over the whole identity area (same as a ticket
              // coming from the landing buttons).
              onTicket={setOAuthTicket}
            />
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
                    onClick={() => setMode("login")}
                    className={`${linkButtonClass} self-center`}
                  >
                    Já tenho uma conta
                  </button>
                </form>
              )}
              {/* The highest-value spot for these: someone landing here with
                no account gets in with one click, skipping both the guest
                name and the signup form. */}
              {mode === "landing" && (
                <div className="mt-3">
                  <OAuthButtons onSuccess={resetIdentityForm} onTicket={setOAuthTicket} />
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleRoomSubmit} className="mt-8 flex flex-col gap-3">
              {/* Last rooms this browser was in. Hidden when empty so a first
                visit doesn't grow the form for nothing — see RecentRooms. */}
              <RecentRooms />
              {/* Public/private as two visible options rather than a
                checkbox under the name field: the choice changes what the
                form even asks for, so it belongs above the fields it
                governs instead of below them. */}
              <span className={labelClass}>Que tipo de sala?</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchRoomMode("public")}
                  aria-pressed={roomMode === "public"}
                  className={roomTabClass(roomMode === "public")}
                >
                  <GlobeIcon className="h-4 w-4 shrink-0" />
                  Pública
                </button>
                {/* Lands on "Entrar em sala" — someone who was handed a link
                  or a code is the common arrival here, and creating is the
                  one click away that a first-timer is already looking for. */}
                <button
                  type="button"
                  onClick={() => switchRoomMode("private-join")}
                  aria-pressed={roomMode !== "public"}
                  className={roomTabClass(roomMode !== "public")}
                >
                  <MdLock className="h-4 w-4 shrink-0" />
                  Privada
                </button>
              </div>

              {/* Only private rooms split into create/join — a public room
                needs no such distinction, since its name alone is enough to
                both find it and make it. */}
              {roomMode !== "public" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => switchRoomMode("private-join")}
                    aria-pressed={roomMode === "private-join"}
                    className={roomTabClass(roomMode === "private-join")}
                  >
                    Entrar em sala
                  </button>
                  <button
                    type="button"
                    onClick={() => switchRoomMode("private-create")}
                    aria-pressed={roomMode === "private-create"}
                    className={roomTabClass(roomMode === "private-create")}
                  >
                    Criar sala
                  </button>
                </div>
              )}

              <label htmlFor="room" className={labelClass}>
                Nome da sala
              </label>
              {/* One field, always. For "Entrar em sala" the code is just the
                tail of what's typed here ("familia-123456") — the same
                string someone reads off a link, rather than a second box to
                split it into. */}
              <input
                id="room"
                autoFocus
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                maxLength={roomMode === "private-create" ? MAX_PRIVATE_ROOM_NAME_LENGTH : 32}
                placeholder={
                  roomMode === "private-join" ? "Ex: familia-123456" : "Ex: reuniao-time"
                }
                className={inputClass}
              />

              {/* One line explaining what this mode is about to do, where the
                old form had a parenthetical about the public list. */}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {roomMode === "public" ? (
                  <>Aparece na lista de salas públicas.</>
                ) : roomMode === "private-create" ? (
                  <>
                    Geramos um código de {ROOM_CODE_LENGTH} dígitos e ele vira parte do link. Quem
                    tiver o link entra; a sala não aparece na lista pública.
                  </>
                ) : ENFORCE_NEW_ROOM_CODE_SYSTEM ? (
                  <>Cole o nome com o código no fim, como no link que te mandaram.</>
                ) : (
                  // While the code scheme isn't enforced, a room from before
                  // it exists has no code to type — so this can't read as if
                  // one were mandatory.
                  <>Cole o nome da sala, com o código no fim se ela tiver um.</>
                )}
              </p>

              {roomError && <p className="text-sm text-red-500">{roomError}</p>}
              <button
                type="submit"
                disabled={!roomInput.trim() || checkingRoom}
                className={`mt-2 ${primaryButtonClass}`}
              >
                {roomMode === "private-create"
                  ? "Criar sala privada"
                  : roomMode === "private-join"
                    ? checkingRoom
                      ? "Verificando..."
                      : "Entrar na sala"
                    : // Public: entering and creating are the same click, so
                    // the label is the only thing that tells someone which
                    // of the two they're about to do. "Criar sala" is the
                    // resting state and only a confirmed hit flips it —
                    // typing a name nobody has used is the common case, and
                    // promising "Entrar" before the lookup lands would walk
                    // that back a moment later on most names.
                    publicRoomExists === true
                      ? "Entrar na sala"
                      : "Criar sala"}
              </button>
            </form>
          )}
        </main>
        {/* No heading on this one: the home page is a form someone came here to
          fill in, and three handles under it explain themselves. */}
        <SocialLinks title={null} className="mt-6" />
        <p className="mt-4 flex gap-5 text-center text-xs text-zinc-400 dark:text-zinc-600" style={{ alignItems: "center" }}>
          <Link
            href="/termos"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Termos de uso
          </Link>
          <Link href={"https://go.nemtudo.me/square-link"} target="_blank">
            <img src={"https://cdn.squarecloud.app/assets/powered-by.svg"} style={{ width: "200px" }} />
          </Link>
        </p>
        {/* <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Este site é protegido pelo reCAPTCHA. Aplicam-se a{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Política de Privacidade
          </a>{" "}
          e os{" "}
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Termos de Serviço
          </a>{" "}
          do Google.
        </p> */}
      </div>
    </>
  );
}
