import type { Metadata } from "next";
import { GiftRedirect } from "./GiftRedirect";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

// The link a present travels as: golive.../gift/ABCD…
//
// What somebody arriving here should see is the site — their site, with their
// rooms and their friends on it — and a present on top of it, rather than a
// landing page that talks about GoLive to somebody who is *being given*
// GoLive. So the code is handed to the home page as a query parameter and the
// dialog opens there (see components/GiftClaimHost).
//
// The parameter survives what has to happen next, which is the reason it is a
// parameter and not a one-shot handoff: whoever follows this link often has no
// account yet, and creating one happens in a dialog on that same page. A code
// kept in memory would not survive the sign-up; one in the URL does.
//
// The move itself is a *client* redirect, and that is not a preference — see
// GiftRedirect. A server redirect leaves nothing for a crawler to read, which
// made every present shared in a chat preview as the home page.

/**
 * Where the gift's own details come from.
 *
 * Derived the same way the browser derives it (see lib/roomsApi's
 * getSignalingHttpBase) rather than read from a second variable: the HTTP and
 * WebSocket halves are one server, and a deployment that pointed them at
 * different hosts would be a preview describing somebody else's present.
 * Not imported from there because that module is client-only, and this runs
 * while a crawler waits.
 */
const API_BASE = (process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws")
  .replace(/^ws/, "http")
  .replace(/\/ws\/?$/, "");

type GiftCard = { planTitle: string; days: number; fromName: string | null };

/**
 * What is behind the code, for the card alone.
 *
 * Best-effort by design: this runs while a crawler waits, on a route that is
 * rate-limited (see the API's /premium/gift/code/:code), and a preview is not
 * worth failing a page over. Anything that goes wrong falls back to the
 * generic present, which is still a far better card than the home page's.
 */
async function loadGift(code: string): Promise<GiftCard | null> {
  try {
    const res = await fetch(`${API_BASE}/premium/gift/code/${encodeURIComponent(code)}`, {
      // A present is redeemed once and then the card is wrong for ever after,
      // so it is worth re-asking now and then — but not on every crawler in a
      // group chat forwarding the same link.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      planTitle?: string;
      days?: number;
      from?: { displayName?: string } | null;
    };
    return {
      planTitle: data.planTitle ?? translate("common.golivePro"),
      days: typeof data.days === "number" ? data.days : 0,
      fromName: data.from?.displayName ?? null,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(
  props: PageProps<"/gift/[code]">
): Promise<Metadata> {
  const { code } = await props.params;
  const gift = await loadGift(code);

  // Who it is from, when the API said. It is the half that makes a preview
  // land as a present rather than as an advertisement.
  const subtitle = gift
    ? `${gift.fromName ? `${gift.fromName} te deu` : translate("gift.someoneGaveYou")} ${
        gift.days > 0 ? `${gift.days} dias de ` : ""
      }${gift.planTitle}.`
    : translate("gift.openTheLinkToSeeWhat");

  return pageMetadata({
    path: `/gift/${code}`,
    title: translate("gift.youReceivedAGift"),
    description: subtitle,
    // Never indexed, and this is the one page where that is about more than
    // tidiness: a code in a search result is a present anybody can walk off
    // with. Shareable and unsearchable are different things.
    noindex: true,
    card: {
      title: translate("gift.youReceivedAGift"),
      subtitle,
      tone: "gift",
      badge: translate("common.gift"),
    },
  });
}

export default async function GiftPage(props: PageProps<"/gift/[code]">) {
  const { code } = await props.params;
  return <GiftRedirect code={code} />;
}
