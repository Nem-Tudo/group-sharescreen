import { VerifiedBadge } from "./VerifiedBadge";
import type { VerifiedTone } from "@/lib/entitlements";
import { Tooltip } from "./Tooltip";
import { BotTag } from "./BotTag";

// Single place that renders a person's display name — every "name" shown
// anywhere in the app (participant list, video tile labels, chat messages,
// admin views) should go through this instead of interpolating a raw
// `peer.name` string directly, so a future addition (verified badge,
// moderator badge, colored role tag, etc.) only needs to change here.
export function DisplayUserName({
  name,
  isGuest,
  verified,
  bot,
  color,
  connectionLost,
  className,
}: {
  name: string;
  isGuest?: boolean;
  // Which verified mark this person carries, from lib/entitlements'
  // verifiedBadge — "gold" for the top plan, "blue" for everyone else with
  // one, null/false for none. Never set for a guest.
  //
  // `boolean` is still accepted because a couple of callers receive the
  // answer as one through their own props; true renders the blue mark, which
  // is what it always meant.
  verified?: VerifiedTone | boolean;
  // A bot account (the `bot` field every person projection carries) — gets
  // the BOT tag after the name, see components/BotTag.
  bot?: boolean;
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
      {/* One shared component decides which mark, so this and the profile
          page cannot disagree about what somebody bought — see
          components/VerifiedBadge. `true` from a caller that only has a
          boolean still means the blue one, as it always did. */}
      {verified && (
        <VerifiedBadge
          flags={verified === "gold" ? ["PRO_MAX"] : ["VERIFIED"]}
          className="ml-1 inline h-5.5 w-5.5 shrink-0 align-text-top"
        />
      )}
      {bot && <BotTag className="ml-1" />}
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
