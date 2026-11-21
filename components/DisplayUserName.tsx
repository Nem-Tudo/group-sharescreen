"use client";

import { VerifiedBadge } from "./VerifiedBadge";
import { verifiedBadge, type VerifiedTone } from "@/lib/entitlements";
import { NAME_BADGES_FEATURE, getUserNameBadges, useBadgesCatalog } from "@/lib/badges";
import { useFeature } from "@/lib/features";
import { Tooltip } from "./Tooltip";
import { BotTag } from "./BotTag";
import { WebhookTag } from "./WebhookTag";
import { AuraMark } from "./groups/AuraMark";
import { translate } from "@/lib/i18n";
import { nameStyleOf } from "@/lib/nameStyle";

// Single place that renders a person's display name — every "name" shown
// anywhere in the app (participant list, video tile labels, chat messages,
// admin views) should go through this instead of interpolating a raw
// `peer.name` string directly, so a future addition (verified badge,
// moderator badge, colored role tag, etc.) only needs to change here.
export function DisplayUserName({
  name,
  isGuest,
  verified,
  flags,
  inCall,
  bot,
  webhook,
  color,
  connectionLost,
  aura,
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
  // Account flags — used to render badges marked `showInName` in /admin (and
  // as a fallback for `verified` when `verified` is omitted).
  flags?: readonly string[] | null;
  // Only in a call (the participant list and the video tiles) are badges
  // drawn after the name — experiment "name-badges". Everywhere else, never.
  inCall?: boolean;
  // A bot account (the `bot` field every person projection carries) — gets
  // the BOT tag after the name, see components/BotTag.
  bot?: boolean;
  // A group webhook's message — gets the WEBHOOK tag, see components/WebhookTag.
  webhook?: boolean;
  // Cosmetics-store name color (see PeerInfo.nameColor / lib/cosmetics.ts) —
  // a color, or one of the store's special names (gradient, glow, animated;
  // see lib/nameStyle), applied to the name text itself. Undefined/null for no
  // color equipped, which leaves the name at whatever color its container
  // already set (e.g. ParticipantRow's speaking-state color).
  color?: string | null;
  // Shows a small red dot after the name — this peer has (or recently had)
  // an active stream from them, but the underlying peer connection just
  // isn't there right now (failed/disconnected, mid-reconnect). See
  // useRoomMedia's recvConnectionStates.
  connectionLost?: boolean;
  // In a group: how many of their auras count for it — "farmando aura", the
  // mark after the name (see components/groups/AuraMark). 0/undefined for none.
  aura?: number;
  className?: string;
}) {
  const nameStyle = nameStyleOf(color);
  const catalog = useBadgesCatalog();
  const candidates = isGuest || !inCall ? [] : getUserNameBadges(flags, catalog);
  // Exposure only counted where a badge would actually be drawn — every name
  // on the page renders this component.
  const nameBadgesOn = useFeature(NAME_BADGES_FEATURE, { track: candidates.length > 0 }).enabled;
  const nameBadges = nameBadgesOn ? candidates : [];
  const effectiveVerified =
    verified === undefined ? (nameBadgesOn && flags ? verifiedBadge(flags) : null) : verified;
  return (
    <span className={className} style={{ display: "flex" }}>
      <span style={nameStyle.style} className={nameStyle.className}>{name}</span>
      {/* One shared component decides which mark, so this and the profile
          page cannot disagree about what somebody bought — see
          components/VerifiedBadge. `true` from a caller that only has a
          boolean still means the blue one, as it always did. */}
      {effectiveVerified && (
        <VerifiedBadge
          flags={effectiveVerified === "ruby" ? ["PRO_ULTRA"] : effectiveVerified === "gold" ? ["PRO_MAX"] : ["VERIFIED"]}
          className="ml-1 inline h-5.5 w-5.5 shrink-0 align-text-top"
        />
      )}
      {nameBadges.map((badge) => (
        <Tooltip key={badge.id} content={badge.name}>
          <span className="ml-1 inline-flex shrink-0 items-center self-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={badge.iconUrl}
              alt={badge.name}
              className="inline h-4.5 w-4.5 shrink-0 object-contain pointer-events-none select-none"
            />
          </span>
        </Tooltip>
      ))}
      {bot && <BotTag className="ml-1" />}
      {webhook && <WebhookTag className="ml-1" />}
      {aura ? <AuraMark count={aura} className="ml-1 self-center" /> : null}
      {isGuest && <span className="font-normal text-zinc-500" style={{ marginLeft: "4px" }}>(guest)</span>}
      {connectionLost && (
        <Tooltip content={translate("displayUserName.connectionLostWithThisPersonTrying")}>
          <span
            aria-label={translate("displayUserName.connectionLost")}
            className="ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500 align-middle"
          />
        </Tooltip>
      )}
    </span>
  );
}
