"use client";

import { useState, type ComponentType } from "react";
import { BsGearFill } from "react-icons/bs";
import { FaCrown } from "react-icons/fa";
import {
  MdOutlineOndemandVideo,
  MdChevronRight,
  MdArrowBack,
  MdOutlineChat,
  MdGif,
} from "react-icons/md";
import { signalingClient, type RoomPermissionKey, type PeerInfo } from "@/lib/signalingClient";
import { useSignaling } from "@/lib/useSignaling";
import { DisplayUserName } from "./DisplayUserName";
import { MicIcon, ScreenIcon, CameraIcon } from "./icons";

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

type View = "menu" | "admins" | "permissions";

// The popup behind the "Gerenciar sala" button above the chat (see
// WatchRoom.tsx) — an ntpopups popup type, registered as "manage_room" in
// NtPopups.tsx, same pattern as AddVideoSourceModal.
//
// Deliberately takes no `data`: everything it shows (the peer list, who's an
// admin, which permissions are on) is live room state that can change while
// it's open — someone joins, another admin flips a switch — so it reads
// straight from the signaling store rather than a snapshot captured when it
// was opened.
export function ManageRoomModal({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const state = useSignaling();
  const [view, setView] = useState<View>("menu");

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

  const title =
    view === "admins"
      ? "Gerenciar administradores"
      : view === "permissions"
        ? "Gerenciar permissões"
        : "Gerenciar sala";

  return (
    <div className="flex max-h-[80vh] w-80 max-w-[calc(100vw-1rem)] flex-col gap-4 overflow-y-auto bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {view !== "menu" && (
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
            <BsGearFill className="h-3.5 w-3.5 shrink-0 opacity-70" />
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
                    onClick={() => signalingClient.setRoomPermission(key, !allowed)}
                    aria-pressed={allowed}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
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
