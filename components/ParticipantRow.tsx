"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useSpeaking } from "@/lib/useSpeaking";
import { MicIcon, MicOffIcon, ScreenIcon, CameraIcon } from "./icons";
import { MdOutlineDesktopWindows, MdOutlineOndemandVideo } from "react-icons/md";
import { FaCrown } from "react-icons/fa";
import { VolumeSlider } from "./VolumeSlider";
import { DisplayUserName } from "./DisplayUserName";
import { Tooltip, Popover } from "./Tooltip";
import { MAX_GAIN } from "@/lib/audioGain";

export function ParticipantRow({
  name,
  isSelf = false,
  isGuest = false,
  userId,
  micOn,
  sharing,
  screen,
  camera,
  sharingVideo = false,
  micStream,
  muted = false,
  onToggleMute,
  volume = 1,
  onVolumeChange,
  connectionLost = false,
  verified = false,
  isOwner = false,
  isAdmin = false,
  isApp = false,
  renderMenu,
  onContextMenu,
}: {
  name: string;
  isSelf?: boolean;
  isGuest?: boolean;
  // Account id (see server/signaling.ts's peerSummary) — only ever a real,
  // viewable profile when the peer isn't a guest. Undefined for a peer sent
  // by an older server version that doesn't include it yet, same as isGuest.
  userId?: string;
  micOn: boolean;
  sharing: boolean;
  // Which of the two channels `sharing` is made of (see PeerInfo.screen in
  // lib/signalingClient.ts). null/undefined means the peer's client never
  // said — that falls back to the single screen icon this row has always
  // shown, rather than guessing a channel and labelling it wrong.
  screen?: boolean | null;
  camera?: boolean | null;
  // Whether this person has a room video source on screen (see
  // components/VideoSourceTile) — a different thing from `sharing`, which is
  // about transmitting their own screen or camera. Shown with its own icon
  // because it also says who is allowed to play/pause it.
  sharingVideo?: boolean;
  micStream?: MediaStream | null;
  muted?: boolean;
  onToggleMute?: () => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // This peer's audio peer connection is down (failed/disconnected) while we
  // still expect one — see useRoomMedia's recvConnectionStates.
  connectionLost?: boolean;
  verified?: boolean;
  // Owns this room (see server/roomStore.ts's RoomRecord.ownerId) — gets a
  // gold crown right after the name. Exactly one person in a room has this
  // at a time; ownership moves on when they leave.
  isOwner?: boolean;
  // Promoted by the owner to help run the room (RoomRecord.admins) — the
  // same crown, in a muted color, so the two read as the same kind of thing
  // without looking like two owners.
  isAdmin?: boolean;
  // Connected through the GoLive desktop app instead of a browser (see
  // PeerInfo.app in lib/signalingClient.ts) — gets the same app icon the
  // download/"abrir no aplicativo" surfaces use, so the two read as the same
  // thing. False for anyone on the web, and for a peer sent by a server that
  // predates the field.
  isApp?: boolean;
  // Right click opens the room's actions for this person (see
  // MemberActionsModal). Omitted where there are none to offer — for yourself,
  // and for anyone when this viewer does not run the room — so the browser's
  // own context menu is left alone rather than replaced with an empty one.
  //
  // Two shapes, and the caller picks by which one it passes. `renderMenu`
  // opens the panel right beside this row, which is where a menu about
  // somebody belongs; `onContextMenu` just reports the click and lets the
  // caller open whatever it likes, which is what a phone gets — a panel
  // hanging off a row in a 360px column has nowhere to hang.
  // Handed a `close` so an action taken inside can dismiss the panel it is
  // in — the open state lives here, not with whoever built the content.
  renderMenu?: (close: () => void) => ReactNode;
  onContextMenu?: () => void;
}) {
  const speaking = useSpeaking(micOn ? micStream : null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = Boolean(renderMenu || onContextMenu);
  // Whether the screen/camera split is actually known for this peer — see
  // the `screen`/`camera` props.
  const knowsChannels = screen != null || camera != null;
  // A guest has no account behind it — nowhere for /user/[id] to point — and
  // an older server that doesn't send userId yet leaves this peer
  // unclickable rather than linking to a broken profile.
  const canOpenProfile = !isGuest && Boolean(userId);
  const nameElement = (
    <DisplayUserName
      name={name}
      isGuest={isGuest}
      verified={verified}
      connectionLost={connectionLost}
      className={`truncate font-medium transition-colors ${
        speaking
          ? "text-emerald-600 dark:text-emerald-400"
          : isSelf
            ? "text-zinc-900 dark:text-zinc-100"
            : ""
      }`}
    />
  );

  const row = (
    <li
      onContextMenu={
        hasMenu
          ? (e) => {
              e.preventDefault();
              if (renderMenu) setMenuOpen((open) => !open);
              else onContextMenu?.();
            }
          : undefined
      }
      // The whole row reacts when there is something behind it, rather than
      // leaving a right click to be discovered. A pointer cursor and a hover
      // on the *container* — not just on the name — because the row is the
      // target: the actions are about the person, not about the word.
      title={hasMenu ? "Clique com o botão direito para ver as ações" : undefined}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelf ? "bg-zinc-100 dark:bg-zinc-900" : "text-zinc-700 dark:text-zinc-300"
      } ${
        hasMenu ? "cursor-pointer transition hover:bg-zinc-200/70 dark:hover:bg-zinc-800" : ""
      }`}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        {canOpenProfile ? (
          <Link href={`/user/${userId}`} target="_blank" className="min-w-0 hover:underline">
            {nameElement}
          </Link>
        ) : (
          nameElement
        )}
        {isOwner ? (
          <Tooltip content={`${name} é o dono da sala`}>
            <span className="flex shrink-0 items-center self-center">
              <FaCrown className="h-3.5 w-3.5 text-amber-500" />
            </span>
          </Tooltip>
        ) : (
          isAdmin && (
            <Tooltip content={`${name} é administrador da sala`}>
              <span className="flex shrink-0 items-center self-center">
                <FaCrown className="h-3 w-3 text-zinc-400 dark:text-zinc-500" />
              </span>
            </Tooltip>
          )
        )}
        {isApp && (
          <Tooltip content={`${name} está usando o aplicativo do GoLive`}>
            <span className="flex shrink-0 items-center self-center">
              <MdOutlineDesktopWindows className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            </span>
          </Tooltip>
        )}
        {isSelf && <span className="shrink-0 text-xs font-normal text-zinc-500">(você)</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-zinc-400 dark:text-zinc-500">
        {micOn ? (
          <MicIcon className="h-4 w-4 text-sky-500" />
        ) : (
          <MicOffIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
        )}
        {knowsChannels ? (
          <>
            {screen && (
              <Tooltip content={`${name} está transmitindo a tela`}>
                <span className="flex shrink-0 items-center">
                  <ScreenIcon className="h-4 w-4 text-emerald-500" />
                </span>
              </Tooltip>
            )}
            {camera && (
              <Tooltip content={`${name} está transmitindo a câmera`}>
                <span className="flex shrink-0 items-center">
                  <CameraIcon className="h-4 w-4 text-violet-500" />
                </span>
              </Tooltip>
            )}
          </>
        ) : (
          sharing && <ScreenIcon className="h-4 w-4 text-emerald-500" />
        )}
        {sharingVideo && (
          <Tooltip content={`${name} adicionou uma ou mais fontes de vídeo`}>
            <span className="flex shrink-0 items-center">
              <MdOutlineOndemandVideo className="h-4 w-4 text-red-500" />
            </span>
          </Tooltip>
        )}
        {!isSelf && onVolumeChange && (
          <VolumeSlider
            value={volume}
            label={`Volume do áudio de ${name}`}
            onChange={onVolumeChange}
            muted={muted}
            onToggleMute={onToggleMute}
            collapseOnIdle
            max={MAX_GAIN}
            className="text-zinc-400 dark:text-zinc-500"
          />
        )}
      </span>
    </li>
  );

  if (!renderMenu) return row;

  // The panel points at this row, so what it is about needs no explaining.
  // "right-start" on a sidebar list puts it beside the name and lets Tippy
  // flip it to the other side when the column is against the window edge.
  return (
    <Popover
      open={menuOpen}
      onClose={() => setMenuOpen(false)}
      placement="right-start"
      content={menuOpen ? renderMenu(() => setMenuOpen(false)) : null}
    >
      {row}
    </Popover>
  );
}
