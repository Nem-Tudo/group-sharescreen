"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { MdLockOutline, MdOutlineMeetingRoom } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { ensureSharedAudioContextRunning } from "@/lib/audioContext";
import { trackFeatureEvent } from "@/lib/features";
import {
  getStoredMicOn,
  getStoredMicsMuted,
  setStoredMicOn,
  setStoredMicsMuted,
} from "@/lib/mediaPreferences";
import { recentRoomPresentation } from "@/lib/recentRooms";
import { fetchPublicRooms, roomActivity, roomExists, type PublicRoom } from "@/lib/roomsApi";
import { getStoredName, signalingClient } from "@/lib/signalingClient";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { useT } from "@/lib/useI18n";
import { UserAvatar } from "./UserAvatar";
import { HeadphonesOffIcon, MicIcon, MicOffIcon, SpeakerIcon } from "./icons";

/**
 * "Tela de entrada" — experiment "room-prejoin".
 *
 * Opening /watch/<sala> used to be joining it: the page mounted, the room
 * joined, and the mic came on from the stored preference, all before anybody
 * had clicked anything. That is how a room opened from a link could transmit
 * the person's voice while the browser was still refusing to play anybody
 * else's (the autoplay rule wants a click first): heard by everyone, hearing
 * no one, and nothing on screen saying why.
 *
 * In the experiment the door comes first: which room this is and what is going
 * on in it, who you are about to walk in as, and whether your mic and the
 * room's sound will be on — then one click to go in. That click is also the
 * one the browser was waiting for, so the room's audio is unlocked by the time
 * anybody can be heard.
 *
 * Only for ordinary rooms opened on their own page (see WatchRoomStage): a
 * group's voice room and a private call are entered from their own places and
 * never come through here.
 */
export const ROOM_PREJOIN_FEATURE = "room-prejoin";
export const ROOM_PREJOIN_EVENTS = {
  /** Went in. Both groups; on this screen, value = ms spent on it. */
  enter: "prejoin_enter",
  /** Left from this screen without going in. */
  back: "prejoin_back",
  /** Went in with the mic on / off. */
  micOn: "prejoin_mic_on",
  micOff: "prejoin_mic_off",
  /** Went in with the room's sound silenced. */
  deafened: "prejoin_deafened",
  /** A guest went in under a name they changed here. */
  rename: "prejoin_rename",
  /** "Entrar com sua conta". */
  login: "prejoin_login_click",
  /** "Não é você? Sair". */
  logout: "prejoin_logout",
} as const;

// How long a new guest name may wait for the server before the room opens anyway.
const REGISTER_WAIT_MS = 8000;

function track(name: string, value?: number) {
  trackFeatureEvent(name, { feature: ROOM_PREJOIN_FEATURE, ...(value ? { value } : {}) });
}

type RoomInfo =
  | { state: "loading" }
  | { state: "unknown" }
  | { state: "new" }
  | { state: "private" }
  | { state: "public"; room: PublicRoom | null };

export function RoomPrejoin({ handle, onEnter }: { handle: string; onEnter: () => void }) {
  const t = useT();
  const router = useRouter();
  const { account, logout } = useAuth();
  const presentation = recentRoomPresentation(handle);
  const [shownAt] = useState(() => Date.now());

  const [micOn, setMicOn] = useState(() => getStoredMicOn());
  const [soundOn, setSoundOn] = useState(() => !getStoredMicsMuted());
  const [storedName] = useState(() => getStoredName() ?? "");
  const [guestName, setGuestName] = useState(storedName);

  // A guest name is only ours once the server has said yes: it is stored, and
  // the room treats somebody as named, when "registered" comes back. Opening
  // the room on the click put the room's own "escolha um nome" screen up for
  // that moment — a second name form right after this one — and a name the
  // server refused was explained only there. So a new name waits here: in on
  // the answer, or the refusal shown on this screen.
  const registeredName = useSignalingSelector((state) => state.name);
  const nameError = useSignalingSelector((state) => state.nameError);
  // The name registered when the request went out (null for none), or
  // undefined while nothing is waiting.
  const [waitingFrom, setWaitingFrom] = useState<string | null | undefined>(undefined);
  const waiting = waitingFrom !== undefined;
  const refused = waiting ? nameError : null;
  const busy = waiting && !refused;
  useEffect(() => {
    if (!waiting || refused) return;
    if (registeredName && registeredName !== waitingFrom) {
      onEnter();
      return;
    }
    // The answer is not coming (a socket that cannot connect right now): in
    // anyway, where the room has its own reconnecting and naming screens.
    const timer = setTimeout(onEnter, REGISTER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, refused, registeredName, waitingFrom, onEnter]);

  // What can be known about the room from outside it. Never in the way: the
  // screen is usable before this answers, and a failure just says less.
  const [info, setInfo] = useState<RoomInfo>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const exists = await roomExists(handle, controller.signal);
        if (!exists) {
          setInfo({ state: "new" });
          return;
        }
        // A private room's people are its own business until you are in it —
        // the server lists only public rooms, and that is the point.
        if (presentation.isPrivate) {
          setInfo({ state: "private" });
          return;
        }
        const rooms = await fetchPublicRooms(controller.signal);
        setInfo({ state: "public", room: rooms.find((room) => room.handle === handle) ?? null });
      } catch {
        if (!controller.signal.aborted) setInfo({ state: "unknown" });
      }
    })();
    return () => controller.abort();
  }, [handle, presentation.isPrivate]);

  const trimmedGuestName = guestName.trim();
  const canEnter = (Boolean(account) || trimmedGuestName.length > 0) && !busy;

  function enter(event: FormEvent) {
    event.preventDefault();
    if (!canEnter) return;
    // Inside the click, on purpose: this is the user activation the browser
    // wants before it plays anything, spent on the shared audio context now so
    // the room's voices play from the first moment (see lib/audioContext).
    void ensureSharedAudioContextRunning();
    setStoredMicOn(micOn);
    setStoredMicsMuted(!soundOn);
    track(micOn ? ROOM_PREJOIN_EVENTS.micOn : ROOM_PREJOIN_EVENTS.micOff);
    if (!soundOn) track(ROOM_PREJOIN_EVENTS.deafened);
    track(ROOM_PREJOIN_EVENTS.enter, Math.max(1, Date.now() - shownAt));
    // A guest with a new name (a first visit has none at all): register it and
    // go in on the answer (see waitingFrom above).
    if (!account && trimmedGuestName !== (registeredName ?? storedName).trim()) {
      if (storedName) track(ROOM_PREJOIN_EVENTS.rename);
      setWaitingFrom(registeredName);
      signalingClient.register(trimmedGuestName);
      return;
    }
    onEnter();
  }

  function goBack() {
    track(ROOM_PREJOIN_EVENTS.back);
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <form
        onSubmit={enter}
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950">
            {presentation.isPrivate ? (
              <MdLockOutline className="h-6 w-6" />
            ) : (
              <MdOutlineMeetingRoom className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {presentation.isPrivate ? t("roomPrejoin.privateRoom") : t("roomPrejoin.room")}
            </p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {presentation.name}
            </h1>
          </div>
        </div>

        <RoomStatus info={info} />

        <div className="mt-6">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t("roomPrejoin.enteringAs")}</p>
          {account ? (
            <div className="mt-2 flex items-center gap-3 rounded-xl bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900">
              <UserAvatar src={account.avatarUrl} name={account.displayName} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {account.displayName}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{account.username}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  track(ROOM_PREJOIN_EVENTS.logout);
                  logout();
                }}
                className="shrink-0 text-xs font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {t("roomPrejoin.notYou")}
              </button>
            </div>
          ) : (
            <div className="mt-2">
              <label htmlFor="prejoin-name" className="sr-only">
                {t("roomPrejoin.yourName")}
              </label>
              <input
                id="prejoin-name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                maxLength={32}
                placeholder={t("roomPrejoin.yourName")}
                autoComplete="nickname"
                aria-invalid={Boolean(refused)}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              {refused && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{refused}</p>}
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {t("roomPrejoin.guestHint")}{" "}
                <Link
                  href={`/login?next=${encodeURIComponent(`/watch/${handle}`)}`}
                  onClick={() => track(ROOM_PREJOIN_EVENTS.login)}
                  className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                >
                  {t("roomPrejoin.signIn")}
                </Link>
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <ChoiceButton
            active={micOn}
            onClick={() => setMicOn((value) => !value)}
            icon={micOn ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
            label={t("roomPrejoin.microphone")}
            value={micOn ? t("roomPrejoin.on") : t("roomPrejoin.off")}
          />
          <ChoiceButton
            active={soundOn}
            onClick={() => setSoundOn((value) => !value)}
            icon={soundOn ? <SpeakerIcon className="h-4 w-4" /> : <HeadphonesOffIcon className="h-4 w-4" />}
            label={t("roomPrejoin.roomSound")}
            value={soundOn ? t("roomPrejoin.on") : t("roomPrejoin.silenced")}
          />
        </div>
        {micOn && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("roomPrejoin.micPermissionHint")}</p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("roomPrejoin.back")}
          </button>
          <button
            type="submit"
            disabled={!canEnter}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("roomPrejoin.entering") : t("roomPrejoin.enter")}
          </button>
        </div>
      </form>
    </div>
  );
}

function RoomStatus({ info }: { info: RoomInfo }) {
  const t = useT();
  let text: string | null = null;
  if (info.state === "new") text = t("roomPrejoin.newRoom");
  else if (info.state === "private") text = t("roomPrejoin.privateHint");
  else if (info.state === "public") {
    const room = info.room;
    const people = room?.peopleCount ?? 0;
    if (people === 0) text = t("roomPrejoin.empty");
    else {
      const parts = [
        people === 1 ? t("roomPrejoin.peopleOne") : t("roomPrejoin.peopleMany", { count: people }),
      ];
      const mics = room ? roomActivity(room, "micCount") : 0;
      const sharing = room ? roomActivity(room, "screenCount") + roomActivity(room, "cameraCount") : 0;
      if (mics > 0) parts.push(t("roomPrejoin.withMic", { count: mics }));
      if (sharing > 0) parts.push(t("roomPrejoin.sharing", { count: sharing }));
      text = parts.join(" · ");
    }
  }
  const description = info.state === "public" ? info.room?.description?.trim() : "";
  if (info.state === "loading") {
    return <div className="mt-4 h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" aria-hidden />;
  }
  if (!text && !description) return null;
  return (
    <div className="mt-4 space-y-1">
      {text && (
        <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          {info.state === "public" && (info.room?.peopleCount ?? 0) > 0 && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          )}
          {text}
        </p>
      )}
      {description && <p className="line-clamp-3 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
    </div>
  );
}

function ChoiceButton({
  active,
  onClick,
  icon,
  label,
  value,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs opacity-70">{label}</span>
        <span className="block truncate text-sm font-semibold">{value}</span>
      </span>
    </button>
  );
}
