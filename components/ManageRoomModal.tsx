"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  MIN_ROOM_MEMBER_LIMIT,
  MAX_ROOM_MEMBER_LIMIT,
} from "@/lib/roomLimits";
import { BsGearFill } from "react-icons/bs";
import { FaCrown } from "react-icons/fa";
import {
  MdGavel,
  MdGroups,
  MdOutlineOndemandVideo,
  MdChevronRight,
  MdArrowBack,
  MdOutlineChat,
  MdGif,
  MdOutlineMap,
} from "react-icons/md";
import {
  signalingClient,
  type RoomPermissionKey,
  type PeerInfo,
  type RoomLocation,
} from "@/lib/signalingClient";
import { useSignaling } from "@/lib/useSignaling";
import { DisplayUserName } from "./DisplayUserName";
import { WorldMap } from "./WorldMap";
import { usePublicRoomMarkers } from "@/lib/usePublicRoomMarkers";
import { MicIcon, ScreenIcon, CameraIcon } from "./icons";
import Link from "next/link";

// The room-level switches, in the order they're shown. Each label is phrased
// as what it *permits*, so it reads true when the toggle is on — and the note
// above the list spells out what turning one off actually does, since "off"
// here never means "nobody", only "owner and admins".
const PERMISSION_ROWS: {
  key: RoomPermissionKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "mic", label: "Permitir que todos liguem o microfone", icon: MicIcon },
  { key: "screen", label: "Permitir que todos compartilhem sua tela", icon: ScreenIcon },
  { key: "camera", label: "Permitir que todos liguem sua câmera", icon: CameraIcon },
  {
    key: "videoSource",
    label: "Permitir que todos adicionem uma fonte de vídeo",
    icon: MdOutlineOndemandVideo,
  },
  { key: "chat", label: "Permitir que todos enviem mensagens no chat", icon: MdOutlineChat },
  { key: "gif", label: "Permitir que todos enviem GIFS", icon: MdGif },
];

type View = "menu" | "admins" | "permissions" | "location" | "bans" | "limit";

// Rounded for display only — the full precision is what gets sent. Six
// decimals is roughly a tenth of a metre, far past anything a click on a
// world map means, so anything longer is just noise in a readout.
function formatCoordinate(value: number): string {
  return value.toFixed(4);
}

// The popup behind the "Gerenciar sala" button above the chat (see
// WatchRoom.tsx) — an ntpopups popup type, registered as "manage_room" in
// NtPopups.tsx, same pattern as AddVideoSourceModal.
//
// Deliberately takes no `data`: everything it shows (the peer list, who's an
// admin, which permissions are on) is live room state that can change while
// it's open — someone joins, another admin flips a switch — so it reads
// straight from the signaling store rather than a snapshot captured when it
// was opened.
export type ManageRoomPopupData = {
  // Which screen to open on. WatchRoom's "Local no mapa" button opens this
  // same popup straight on "location" (see openRoomLocationPopup there),
  // which is why that one has no entry in the menu below — the button *is*
  // the entry.
  initialView?: View;
  // False for the read-only "where is this room" view every participant can
  // open — the map, the pin and the search box, minus the ability to move it.
  // The owner/admin check itself lives in WatchRoom (it decides which button
  // to render); this only says which of the two was pressed, and the server
  // refuses a move from anyone else regardless.
  canEdit?: boolean;
  // Opened by itself the moment someone's join created a public room (see
  // WatchRoom), rather than by pressing a button. Same location view, but
  // introduced as the congratulation it is: a brand-new room is exactly when
  // putting it on the map is worth something, and the moment its owner is
  // most likely to bother.
  justCreated?: boolean;
};

export function ManageRoomModal({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: ManageRoomPopupData;
}) {
  const state = useSignaling();
  const [view, setView] = useState<View>(data?.initialView ?? "menu");
  // Where the pin currently sits in the "Definir local do mundo" view —
  // local until "Salvar local", so a stray click on the map doesn't move the
  // room out from under everyone mid-drag. Seeded once, from wherever the
  // room already is, rather than synced continuously: it *is* the unsaved
  // edit, and the popup is opened straight onto this view (see
  // WatchRoom's openRoomLocationPopup) so there is no later moment to seed it.
  const [pick, setPick] = useState<RoomLocation | null>(state.roomLocation);
  // Seeded once from the room's current limit, and left alone after: it is the
  // unsaved edit, and re-syncing it while somebody types would fight them.
  const [limitInput, setLimitInput] = useState(
    state.roomMemberLimit === null ? "" : String(state.roomMemberLimit)
  );
  // The rooms already on the map, drawn under the pin being placed. Someone
  // choosing a spot is choosing it *relative to* other rooms — and an owner
  // looking at an empty globe has no reason to think anyone would ever find
  // them there. This room itself is left out: it is the `pick` pin.
  const { markers } = usePublicRoomMarkers({ excludeHandle: state.room ?? undefined });

  const isOwner = Boolean(state.selfUserId && state.roomOwnerId === state.selfUserId);
  // Admins may flip the permission switches but not hand out admin — see
  // server/signaling.ts's isRoomOwner for why that stays the owner's alone.
  const canManageAdmins = isOwner;

  // Moderators ride the peer list so their WebRTC connections get set up, but
  // are invisible to real participants (see WatchRoom's visiblePeers) — they
  // must not show up here as someone to promote either. Nor must anyone an
  // older server never sent a stable userId for: there'd be nothing to key
  // the promotion on.
  const promotablePeers = state.peers.filter(
    (p): p is PeerInfo & { userId: string } =>
      p.role !== "moderator" && Boolean(p.userId) && p.userId !== state.roomOwnerId
  );

  // Asked for rather than pushed on join: most managers never open this, and
  // who a room banned is not something the room at large is told (see the
  // server's sendRoomBansToManagers). Re-asked on entering the tab, so a list
  // left open through a reconnect is not a stale one.
  useEffect(() => {
    if (view === "bans") signalingClient.requestRoomBans();
  }, [view]);

  const saved = state.roomLocation;
  const pinMoved = pick?.lat !== saved?.lat || pick?.lng !== saved?.lng;
  // Read-only unless the opener said otherwise *and* this viewer really is a
  // manager — the flag says which button was pressed, the check says whether
  // they were entitled to press it.
  const isManager = isOwner || state.roomAdmins.some((a) => a.id === state.selfUserId);
  const canEditLocation = (data?.canEdit ?? true) && isManager;
  // Only ever the celebration when there is genuinely something to celebrate
  // *and* to act on: whoever cannot move the pin has nothing to do here.
  const celebrating = Boolean(data?.justCreated) && canEditLocation;

  const title =
    view === "admins"
      ? "Gerenciar administradores"
      : view === "permissions"
        ? "Gerenciar permissões"
        : view === "limit"
          ? "Limite de participantes"
          : view === "bans"
            ? "Banimentos"
            : view === "location"
              ? celebrating
                ? "Você criou uma sala pública!"
                : canEditLocation
                  ? "Definir local do mundo"
                  : "Local da sala no mundo"
              : "Gerenciar sala";


  return (
    <div
      className={`flex max-h-[92vh] max-w-full flex-col gap-4 overflow-y-auto bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 ${
        // The map view fills whatever box the popup was opened with — its
        // width is set on the popup itself (see WatchRoom's
        // openRoomLocationPopup), because a fixed width here would be sized
        // against the *viewport* while the popup is sized against its own
        // container, and the two disagree by exactly enough to overflow. The
        // other views have no such caller, so they still set their own.
        view === "location" ? "w-full" : "w-80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* No back arrow when this popup was opened straight onto a view —
              there is no menu behind it to go back to. */}
          {view !== "menu" && data?.initialView === undefined && (
            <button
              type="button"
              onClick={() => setView("menu")}
              aria-label="Voltar"
              className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            >
              <MdArrowBack className="h-4 w-4" />
            </button>
          )}
          <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
            {/* The congratulation is not a settings screen, whatever it
                reuses — a gear on it reads as a chore. */}
            {celebrating ? (
              <MdOutlineMap className="h-4 w-4 shrink-0 text-sky-500" />
            ) : (
              <BsGearFill className="h-3.5 w-3.5 shrink-0 opacity-70" />
            )}
            {title}
          </p>
        </div>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      {view === "menu" && (
        <div className="flex flex-col gap-2">
          {canManageAdmins && (
            <button
              type="button"
              onClick={() => setView("admins")}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <span className="flex items-center gap-2">
                <FaCrown className="h-4 w-4 shrink-0 text-amber-500" />
                Gerenciar administradores
              </span>
              <MdChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setView("limit")}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <span className="flex items-center gap-2">
              <MdGroups className="h-4 w-4 shrink-0 text-sky-500" />
              Limite de participantes
            </span>
            <span className="flex items-center gap-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
              {state.roomMemberLimit ?? "sem limite"}
              <MdChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            </span>
          </button>
          {canManageAdmins && (
            <button
              type="button"
              onClick={() => setView("bans")}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <span className="flex items-center gap-2">
                <MdGavel className="h-4 w-4 shrink-0 text-red-500" />
                Banimentos
              </span>
              <MdChevronRight className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setView("permissions")}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 py-2.5 text-left text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <span className="flex items-center gap-2">
              <BsGearFill className="h-4 w-4 shrink-0 opacity-70" />
              Gerenciar permissões
            </span>
            <MdChevronRight className="h-4 w-4 shrink-0 opacity-50" />
          </button>
          {!canManageAdmins && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Só o dono da sala pode adicionar ou remover administradores.
            </p>
          )}
        </div>
      )}

      {view === "admins" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Administradores ({state.roomAdmins.length})
            </p>
            {state.roomAdmins.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Ninguém por enquanto. Um administrador pode mudar as permissões da sala e não é
                afetado por elas.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.roomAdmins.map((admin) => {
                  // The stored name is only a fallback — if they're in the
                  // room right now, the peer list has the current one.
                  const live = state.peers.find((p) => p.userId === admin.id);
                  return (
                    <li
                      key={admin.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-900"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <FaCrown className="h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500" />
                        <DisplayUserName
                          name={live?.name || admin.name || "Participante"}
                          isGuest={live?.isGuest}
                          verified={live?.flags?.includes("VERIFIED")}
                          className="truncate font-medium"
                        />
                        {!live && (
                          <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                            (fora da sala)
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => signalingClient.removeRoomAdmin(admin.id)}
                        className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Remover
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Participantes da sala
            </p>
            {promotablePeers.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Não há mais ninguém na sala para promover.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {promotablePeers.map((peer) => {
                  const alreadyAdmin = state.roomAdmins.some((a) => a.id === peer.userId);
                  return (
                    <li
                      key={peer.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
                    >
                      <DisplayUserName
                        name={peer.name}
                        isGuest={peer.isGuest}
                        verified={peer.flags?.includes("VERIFIED")}
                        className="truncate font-medium"
                      />
                      <button
                        type="button"
                        disabled={alreadyAdmin}
                        onClick={() => signalingClient.addRoomAdmin(peer.userId)}
                        className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                      >
                        {alreadyAdmin ? "Já é admin" : "Tornar admin"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {view === "location" && (
        <div className="flex flex-col gap-3">
          <p
            className={
              celebrating
                ? "text-sm leading-relaxed text-zinc-600 dark:text-zinc-300"
                : "text-xs text-zinc-500 dark:text-zinc-400"
            }
          >
            {celebrating ? (
              <>
                Sua sala já está no ar e aparece na lista de{" "}
                <Link style={{ color: "#25baff" }} href="/rooms" target="_blank">
                  salas públicas
                </Link>
                . Marque no mapa abaixo de onde ela é — bairro, cidade ou país, o quanto você
                quiser dizer — e ela também passa a aparecer no{" "}
                <Link style={{ color: "#25baff" }} href="/worldmap" target="_blank">
                  mapa de salas
                </Link>
                , onde quem está perto de você encontra ela primeiro. Dá para mudar ou tirar do
                mapa quando quiser.
              </>
            ) : canEditLocation ? (
              <>
                Defina um lugar para que a sala fique visível no <Link style={{color: "#25baff"}} href={"/worldmap"} target="_blank">mapa de salas</Link>. Pessoas que moram perto podem começar aparecer.
              </>
            ) : (
              <>
                Onde o dono da sala colocou ela no{" "}
                <span className="font-medium">mapa de salas</span>. Só o dono e os administradores
                podem mudar.
              </>
            )}
          </p>

          {/* Said plainly, and to everyone rather than only to whoever can
              move the pin: "põe a sala no mapa" is a sentence that sounds like
              it might be reading somebody's position, and a person who thinks
              that is being asked will simply not do it. The claim is also
              true and checkable — nothing in this app calls the geolocation
              API, and the only thing the search box sends anywhere is the
              text typed into it (see lib/geocoding.ts). */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
              Privacidade: Nada aqui é detectado automaticamente.
            </p>
            <p>
              O lugar é só o que {canEditLocation ? "você clicar" : "clicaram"} no mapa. O site
              nunca pede nem lê a localização do seu aparelho, e o alfinete marca a{" "}
              <span className="font-medium">sala</span>. Pode ser
              tão vago quanto quiser: um país, uma cidade, um bairro.
              {canEditLocation && " E dá para tirar do mapa a qualquer momento."}
            </p>
          </div>

          {/* Sized against the viewport rather than a fixed height: this is
              the whole point of the view, and the popup is as tall as the
              window allows. The floor keeps it usable on a phone, where a
              percentage of a short screen is not much map. */}
          <div className="h-[min(60vh,32rem)] min-h-64 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
            <WorldMap
              className="h-full w-full"
              searchable
              // The rooms already placed, so the globe isn't empty and the
              // spot being picked has some context around it.
              markers={markers}
              pick={pick}
              // Omitted entirely for a viewer — without it the map ignores
              // clicks, which is what makes this read-only rather than
              // "editable but rejected by the server".
              onPick={canEditLocation ? (lat, lng) => setPick({ lat, lng }) : undefined}
              // Opens on the existing pin when there is one, so neither
              // "move it slightly" nor "where is this?" starts by hunting the
              // globe for it.
              center={pick ? [pick.lat, pick.lng] : undefined}
              zoom={pick ? 6 : undefined}
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {markers.length > 0 && (
              <>
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  {markers.length}{" "}
                  {markers.length === 1 ? "outra sala já está" : "outras salas já estão"} no mapa
                </span>
                {" · "}
              </>
            )}
            {pick ? (
              <>
                {canEditLocation ? "Alfinete em" : "Sala em"}{" "}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {formatCoordinate(pick.lat)}, {formatCoordinate(pick.lng)}
                </span>
                {canEditLocation && !pinMoved && " (local salvo)"}
              </>
            ) : (
              "Esta sala ainda não tem um local no mundo."
            )}
          </p>

          {canEditLocation && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!pick || !pinMoved}
                onClick={() => {
                  signalingClient.setRoomLocation(pick);
                  // The congratulation is a one-shot errand, opened without
                  // being asked for: once it's done, get out of the way.
                  // The button reached from the room stays put, since it's
                  // just as likely to be a nudge of a pin that's off.
                  if (celebrating) closePopup(true);
                }}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saved ? "Salvar novo local" : "Salvar local"}
              </button>
              {/* Only in the popup nobody asked for. Everywhere else the ×
                  is the way out and a second one would just be noise. */}
              {celebrating && (
                <button
                  type="button"
                  onClick={() => closePopup(false)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Agora não
                </button>
              )}
              {/* Only offered once there is something to take off the map —
                  clearing a room that was never placed does nothing. */}
              {saved && (
                <button
                  type="button"
                  onClick={() => {
                    signalingClient.setRoomLocation(null);
                    setPick(null);
                  }}
                  className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remover do mapa
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {view === "limit" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Quantas pessoas cabem na sala ao mesmo tempo. Quem chega depois de cheia vê um aviso
            e não entra. Você e os administradores nunca são barrados pelo próprio limite.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Agora: <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {state.peers.filter((p) => p.role !== "moderator").length + 1}
            </span>{" "}
            na sala.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_ROOM_MEMBER_LIMIT}
              max={MAX_ROOM_MEMBER_LIMIT}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="Sem limite"
              aria-label="Limite de participantes"
              className="w-28 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="button"
              onClick={() => {
                const parsed = Number(limitInput);
                signalingClient.setRoomMemberLimit(
                  limitInput.trim() === "" || !Number.isFinite(parsed) ? null : parsed
                );
              }}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              Salvar
            </button>
          </div>
          {/* Only offered once there is one to lift — "remover" on a room that
              never had a limit is a button that does nothing. */}
          {state.roomMemberLimit !== null && (
            <button
              type="button"
              onClick={() => {
                setLimitInput("");
                signalingClient.setRoomMemberLimit(null);
              }}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Tirar o limite
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            Entre {MIN_ROOM_MEMBER_LIMIT} e {MAX_ROOM_MEMBER_LIMIT}. Baixar o limite não expulsa
            quem já está aqui — vale de agora em diante.
          </p>
        </div>
      )}

      {view === "bans" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Quem foi banido não consegue entrar nesta sala. Banir é pelo botão direito na pessoa,
            na lista de participantes ou numa mensagem dela no chat. Só o dono desfaz.
          </p>
          {state.roomBans.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Ninguém banido desta sala.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {state.roomBans.map((ban) => (
                <li
                  key={ban.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">{ban.name || ban.id}</span>
                  <button
                    type="button"
                    onClick={() => signalingClient.unbanMember(ban.id)}
                    className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Desbanir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === "permissions" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Ao desativar uma opção, só o dono e os administradores da sala continuam podendo fazer
            aquilo.
          </p>
          <ul className="flex flex-col gap-1">
            {PERMISSION_ROWS.map(({ key, label, icon: Icon }) => {
              const allowed = state.roomPermissions[key];
              return (
                <li key={key}>
                  <button
                    type="button"
                    // Belt and braces: this view is only reachable from the
                    // manager-gated menu, and the server refuses the write
                    // anyway — but this component is now openable by ordinary
                    // participants (read-only "Local no mapa"), so nothing
                    // here should assume otherwise.
                    disabled={!isManager}
                    onClick={() => signalingClient.setRoomPermission(key, !allowed)}
                    aria-pressed={allowed}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          allowed
                            ? "text-emerald-600 dark:text-emerald-500"
                            : "text-zinc-400 dark:text-zinc-600"
                        }`}
                      />
                      <span className="min-w-0">{label}</span>
                    </span>
                    {/* A plain pill rather than a checkbox, so this reads the
                        same as the header's other on/off rows (see
                        WatchRoom's MenuToggleRow). */}
                    <span
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                        allowed ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          allowed ? "left-[1.125rem]" : "left-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
