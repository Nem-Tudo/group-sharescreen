import { VerifiedBadgeIcon } from "./icons";
import { Tooltip } from "./Tooltip";

// Single place that renders a person's display name — every "name" shown
// anywhere in the app (participant list, video tile labels, chat messages,
// admin views) should go through this instead of interpolating a raw
// `peer.name` string directly, so a future addition (verified badge,
// moderator badge, colored role tag, etc.) only needs to change here.
export function DisplayUserName({
  name,
  isGuest,
  verified,
  color,
  connectionLost,
  className,
}: {
  name: string;
  isGuest?: boolean;
  // Account has the "VERIFIED" flag (see RegisteredAccount.flags /
  // PeerInfo.flags) — never true for a guest.
  verified?: boolean;
  // Cosmetics-store name color (see PeerInfo.nameColor / lib/cosmetics.ts) —
  // a hex value applied to the name text itself. Undefined/null for no
  // color equipped, which leaves the name at whatever color its container
  // already set (e.g. ParticipantRow's speaking-state color).
  color?: string | null;
  // Shows a small red dot after the name — this peer has (or recently had)
  // an active stream from them, but the underlying peer connection just
  // isn't there right now (failed/disconnected, mid-reconnect). See
  // useRoomMedia's recvConnectionStates.
  connectionLost?: boolean;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: "flex" }}>
      <span style={color ? { color } : undefined}>{name}</span>
      {verified && (
        <VerifiedBadgeIcon
          className="ml-1 inline h-5.5 w-5.5 shrink-0 align-text-top text-blue-500"
        />
      )}
      {isGuest && <span className="font-normal text-zinc-500" style={{ marginLeft: "4px" }}>(guest)</span>}
      {connectionLost && (
        <Tooltip content="Conexão perdida com essa pessoa — tentando reconectar">
          <span
            aria-label="Conexão perdida"
            className="ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500 align-middle"
          />
        </Tooltip>
      )}
    </span>
  );
}
