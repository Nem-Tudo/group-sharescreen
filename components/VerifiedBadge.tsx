import { GoldVerifiedBadgeIcon, RubyVerifiedBadgeIcon, VerifiedBadgeIcon } from "@/components/icons";
import { verifiedBadge } from "@/lib/entitlements";

// A person's verified mark, from their flags.
//
// The whole point is that no caller chooses the colour. Every place that drew
// the badge itself picked `text-blue-500` — reasonable when blue was the only
// one there was, and silently wrong the moment a gold tier existed. The
// /user page kept showing blue to somebody who had paid for gold, and it took
// a bug report to find, because nothing about `<VerifiedBadgeIcon
// className="text-blue-500" />` looks incorrect on the screen it lives on.
//
// So the tone is not a prop. Hand it the flags and it draws the right mark,
// or nothing at all when there is none.
//
// Not for the *product* mark: the "Pro" link in the header and the room, and
// the supporters tooltip, all draw the badge to mean the plan rather than a
// person, and those stay blue deliberately.
export function VerifiedBadge({
  flags,
  className = "",
}: {
  flags?: readonly string[] | null;
  className?: string;
}) {
  const tone = verifiedBadge(flags);
  if (!tone) return null;
  // Ruby and gold carry their colour in their own gradients and ignore a text
  // colour; blue takes currentColor, so it gets one.
  if (tone === "ruby") return <RubyVerifiedBadgeIcon className={className} />;
  if (tone === "gold") return <GoldVerifiedBadgeIcon className={className} />;
  return <VerifiedBadgeIcon className={`${className} text-blue-500`} />;
}
