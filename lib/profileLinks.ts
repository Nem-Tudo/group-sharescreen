import type { IconType } from "react-icons";
import {
  FaBluesky,
  FaDiscord,
  FaFacebook,
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaPinterest,
  FaReddit,
  FaSnapchat,
  FaSoundcloud,
  FaSpotify,
  FaSteam,
  FaTelegram,
  FaThreads,
  FaTiktok,
  FaTwitch,
  FaWhatsapp,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6";
import { SiKick } from "react-icons/si";
import { MdLink } from "react-icons/md";

// The presentation half of the API's profileLinks.ts: what each network looks
// like and what its field says. The API owns which links are *valid* (the
// hostnames a network is allowed to point at); this file owns the icon, the
// colour and the placeholder.
//
// Mirrored rather than served, the same way lib/entitlements.ts mirrors the
// feature table — an icon cannot travel over the wire, so the ids have to be
// known here regardless, and one more request on the way into the editor buys
// nothing. Keep the ids in step with the server's NETWORKS: one that only this
// side knows is a network the API will refuse, and one only that side knows is
// simply never offered.
//
// Ordered the way the picker lists them, which is roughly "how likely somebody
// is to want it" rather than alphabetically — the point of the list is to be
// scanned, and the five people actually look for should not be under S.

export type ProfileLink = { network: string; url: string };

export type NetworkMeta = {
  id: string;
  label: string;
  Icon: IconType;
  /**
   * The brand's own colour, used for the icon on the profile.
   *
   * One value for both themes, because these are logos: a brand colour that
   * shifts with the page is not that brand's colour any more. They are all
   * saturated enough to sit on either background.
   */
  color: string;
  /** A real link, not a pattern — it is what the field looks like filled in. */
  placeholder: string;
};

export const NETWORKS: NetworkMeta[] = [
  { id: "instagram", label: "Instagram", Icon: FaInstagram, color: "#E1306C", placeholder: "https://instagram.com/seu.perfil" },
  { id: "tiktok", label: "TikTok", Icon: FaTiktok, color: "#EE1D52", placeholder: "https://tiktok.com/@seuperfil" },
  { id: "youtube", label: "YouTube", Icon: FaYoutube, color: "#FF0000", placeholder: "https://youtube.com/@seucanal" },
  { id: "x", label: "X", Icon: FaXTwitter, color: "#71767B", placeholder: "https://x.com/seuperfil" },
  { id: "twitch", label: "Twitch", Icon: FaTwitch, color: "#9146FF", placeholder: "https://twitch.tv/seucanal" },
  { id: "kick", label: "Kick", Icon: SiKick, color: "#53FC18", placeholder: "https://kick.com/seucanal" },
  { id: "discord", label: "Discord", Icon: FaDiscord, color: "#5865F2", placeholder: "https://discord.gg/seuconvite" },
  { id: "telegram", label: "Telegram", Icon: FaTelegram, color: "#2AABEE", placeholder: "https://t.me/seuperfil" },
  { id: "whatsapp", label: "WhatsApp", Icon: FaWhatsapp, color: "#25D366", placeholder: "https://wa.me/5511999999999" },
  { id: "facebook", label: "Facebook", Icon: FaFacebook, color: "#1877F2", placeholder: "https://facebook.com/seuperfil" },
  { id: "threads", label: "Threads", Icon: FaThreads, color: "#8E8E8E", placeholder: "https://threads.net/@seuperfil" },
  { id: "bluesky", label: "Bluesky", Icon: FaBluesky, color: "#0285FF", placeholder: "https://bsky.app/profile/voce.bsky.social" },
  { id: "reddit", label: "Reddit", Icon: FaReddit, color: "#FF4500", placeholder: "https://reddit.com/user/seuperfil" },
  { id: "pinterest", label: "Pinterest", Icon: FaPinterest, color: "#E60023", placeholder: "https://pinterest.com/seuperfil" },
  { id: "snapchat", label: "Snapchat", Icon: FaSnapchat, color: "#F7C600", placeholder: "https://snapchat.com/add/seuperfil" },
  { id: "spotify", label: "Spotify", Icon: FaSpotify, color: "#1DB954", placeholder: "https://open.spotify.com/user/seuperfil" },
  { id: "soundcloud", label: "SoundCloud", Icon: FaSoundcloud, color: "#FF5500", placeholder: "https://soundcloud.com/seuperfil" },
  { id: "steam", label: "Steam", Icon: FaSteam, color: "#66C0F4", placeholder: "https://steamcommunity.com/id/seuperfil" },
  { id: "github", label: "GitHub", Icon: FaGithub, color: "#8B949E", placeholder: "https://github.com/seuperfil" },
  { id: "linkedin", label: "LinkedIn", Icon: FaLinkedin, color: "#0A66C2", placeholder: "https://linkedin.com/in/seuperfil" },
  // The escape hatch, and the only one drawn as a generic link — it is allowed
  // to point anywhere, so it must not borrow anybody's logo.
  { id: "website", label: "Site", Icon: MdLink, color: "#71717A", placeholder: "https://seusite.com" },
];

/** Mirrors the API's MAX_PROFILE_LINKS — the cap it enforces. */
export const MAX_PROFILE_LINKS = 8;

const BY_ID = new Map(NETWORKS.map((network) => [network.id, network]));

/**
 * The look for a network id, with a generic fallback.
 *
 * Never null: an id this build has no icon for still draws, as a plain link
 * with the id as its label. That is what keeps a network added on the server
 * from disappearing off profiles until the two Square Cloud instances have
 * both rebuilt — an old bundle shows a neutral chip instead of nothing.
 */
export function networkMeta(id: string): NetworkMeta {
  return BY_ID.get(id) ?? { id, label: id, Icon: MdLink, color: "#71717A", placeholder: "https://" };
}

/**
 * The handle inside a link, for the label beside the icon.
 *
 * Purely cosmetic and deliberately dumb: the last non-empty path segment, with
 * an "@" stripped off the front. It gets "@fulano" out of a normal profile URL
 * and something unhelpful out of a deep link — which is why the caller falls
 * back to the network's name rather than showing whatever this returns.
 */
export function handleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last || last.length > 30) return null;
    return last.replace(/^@/, "") || null;
  } catch {
    return null;
  }
}
