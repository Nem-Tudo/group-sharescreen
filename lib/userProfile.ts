import { getSignalingHttpBase } from "./roomsApi";
import type { Account } from "./accountApi";

// Whoever this account is currently connected to, if it's a *public* room —
// the server (see GET /users/:id) deliberately never reveals a private one,
// same privacy line the room itself already draws for a stranger looking
// someone up.
export type LiveRoomStatus = { room: string; peopleCount: number } | null;

export type UserProfile = {
  account: Account;
  live: LiveRoomStatus;
};

// Public profile page data (see app/user/[id]/page.tsx) — reachable by
// clicking a name in the room header or the participant list, both of which
// carry the account id as PeerInfo.userId. No auth required: this is the
// same information a room's own peer list already shows to everyone in it,
// just gathered into one page. Returns null for an id that isn't a real
// account (a guest's id, or one that no longer exists).
export async function fetchUserProfile(id: string, signal?: AbortSignal): Promise<UserProfile | null> {
  const res = await fetch(`${getSignalingHttpBase()}/users/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as UserProfile;
  rememberProfile(id, data);
  return data;
}

// The last answer read for each id, so a profile opened again — or one warmed
// by prefetchUserProfile on hover — draws at once (see peekUserProfile) instead
// of saying "Carregando...". Never *instead* of reading: fetchUserProfile still
// always asks the network, and whoever shows a peeked profile replaces it with
// that answer the moment it lands, so nothing here can keep an old bio or an
// old "está numa sala" on screen. Bounded, most recently used last.
const profileCache = new Map<string, { profile: UserProfile; at: number }>();
const PROFILE_CACHE_MAX = 200;
/** A hover within this long of the last read does not read again. */
const PROFILE_PREFETCH_FRESH_MS = 30_000;
const profileInFlight = new Map<string, Promise<UserProfile | null>>();

function rememberProfile(id: string, profile: UserProfile) {
  profileCache.delete(id);
  profileCache.set(id, { profile, at: Date.now() });
  while (profileCache.size > PROFILE_CACHE_MAX) {
    const oldest = profileCache.keys().next().value;
    if (oldest === undefined) break;
    profileCache.delete(oldest);
  }
}

/** The last profile read for this id, if any — to draw while a fresh read is on its way. */
export function peekUserProfile(id: string): UserProfile | null {
  return profileCache.get(id)?.profile ?? null;
}

/**
 * Reads a profile ahead of it being opened — on hover over a name, say. A
 * no-op for a guest (no profile exists), for one read moments ago, and for one
 * already being read.
 */
export function prefetchUserProfile(id: string): void {
  if (!id || id.startsWith("guest:")) return;
  const held = profileCache.get(id);
  if (held && Date.now() - held.at < PROFILE_PREFETCH_FRESH_MS) return;
  if (profileInFlight.has(id)) return;
  const run = fetchUserProfile(id)
    .catch(() => null)
    .finally(() => {
      profileInFlight.delete(id);
    });
  profileInFlight.set(id, run);
}

// mm:ss for under an hour, h:mm:ss beyond that — matches the room's own
// formatTime convention (see PartnerRewardModal.tsx) but extended with
// hours, since a lifetime call/mic/share total realistically grows well
// past 59 minutes.
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}min`;
  }
  if (m > 0) {
    return `${m}min ${String(s).padStart(2, "0")}s`;
  }
  return `${s}s`;
}
