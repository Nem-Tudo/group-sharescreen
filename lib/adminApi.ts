"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./roomsApi";
import type {
  Announcement,
  AnnouncementButtonAction,
  AnnouncementColor,
  AnnouncementDevice,
  AnnouncementSound,
  AnnouncementVisibility,
} from "./announcement";
import type { Partner, PartnerClickRewardPlacement } from "./partner";
import type { Supporter } from "./supporter";

export type {
  Announcement,
  AnnouncementButtonAction,
  AnnouncementColor,
  AnnouncementDevice,
  AnnouncementSound,
  AnnouncementVisibility,
};
export type { Partner };
export type { Supporter };

const TOKEN_STORAGE_KEY = "sharescreen:adminToken";

// localStorage (not localStorage) on purpose — a moderator token
// shouldn't silently outlive the browser tab/session the same way a
// regular viewer's display name does.
//
// Cached in a module-level variable (rather than re-reading localStorage
// on every call) specifically so useAdminToken below has a stable snapshot
// to hand useSyncExternalStore, and so login/logout notify subscribers
// instead of components having to poll or re-render themselves in an effect.
let cachedToken: string | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAdminToken(): string | null {
  if (!initialized) {
    cachedToken = readStoredToken();
    initialized = true;
  }
  return cachedToken;
}

function setAdminToken(token: string | null) {
  cachedToken = token;
  initialized = true;
  if (typeof window !== "undefined") {
    try {
      if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignored - localStorage may be unavailable (private mode, quota, etc.)
    }
  }
  listeners.forEach((l) => l());
}

function subscribeAdminToken(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getAdminTokenServer(): string | null {
  return null;
}

export function useAdminToken(): string | null {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, getAdminTokenServer);
}

// Admin is no longer a separate Basic-Auth credential — it's just a regular
// account (see accountApi.ts / server/accountStore.ts) whose flags include
// "ADMIN", so logging in here goes through the exact same /auth/login the
// rest of the app uses. The admin token is still kept in its own
// localStorage slot (not accountApi's localStorage one) so a moderator
// session doesn't silently outlive the tab the way a regular viewer's does.
export async function adminLogin(user: string, password: string): Promise<void> {
  const res = await fetch(`${getSignalingHttpBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }),
  });
  if (!res.ok) throw new Error("Usuário ou senha inválidos.");
  const data = (await res.json()) as { token: string; account: { flags: string[] } };
  if (!data.account.flags.includes("ADMIN")) {
    throw new Error("Essa conta não tem permissão de administrador.");
  }
  setAdminToken(data.token);
}

export function adminLogout() {
  // JWTs are stateless — there's nothing to revoke server-side, so logging
  // out is just dropping the locally stored token.
  setAdminToken(null);
}

export type AdminRoomPeer = {
  id: string;
  name: string | null;
  sharing: boolean;
  // Which of the two channels `sharing` is made of. null means the peer's
  // client never reported the breakdown (an outdated client), which is not
  // the same as false — see PeerInfo.screen in lib/signalingClient.ts.
  // Undefined only from a server that predates the fields.
  screen?: boolean | null;
  camera?: boolean | null;
  // How many room video sources this person added (see lib/videoSource.ts).
  // A third, separate kind of "transmitting": nothing of theirs is being
  // streamed, but a video is on everyone's screen and only they can steer
  // it. Undefined from a server that predates the field.
  videoSources?: number;
  mic: boolean;
  ip: string;
  isGuest: boolean;
  // The three below are what the moderation panel's search actually matches
  // a person on (see ModerationPanel's peerMatches). All optional: a server
  // that predates them simply sends nothing, and search just falls back to
  // the fields above instead of breaking.
  //
  // Account id — the same id /user/[id] is keyed on, so a profile URL
  // pasted into the search box finds that person's room.
  accountId?: string | null;
  // Account username, which is *not* necessarily the display name in
  // `name` (see the server's AccountDoc: username vs displayName).
  username?: string | null;
  // Stable across a guest's reconnects, unlike `id` — the only durable
  // handle a non-account visitor has.
  guestId?: string | null;
  // Hash of this person's browser/device traits (see lib/fingerprint.ts).
  // Survives a new guest identity, a fresh account and an IP change, which
  // is what makes it worth banning on. null when the client didn't send one.
  fingerprint?: string | null;
};

export type AdminRoom = {
  handle: string;
  isPrivate: boolean;
  createdAt: number;
  peopleCount: number;
  peers: AdminRoomPeer[];
  // Stable id (account or guest) of the room's current owner. Optional for
  // the same old-server reason as the peer fields above.
  ownerId?: string | null;
  // Private room access code, when the room has one.
  code?: string | null;
  // Total room video sources, across everyone — the sum of the peers'
  // `videoSources` above.
  videoSourceCount?: number;
};

export async function fetchAdminRooms(signal?: AbortSignal): Promise<AdminRoom[]> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao carregar salas (status ${res.status})`);
  const data = (await res.json()) as { rooms: AdminRoom[] };
  return data.rooms;
}

export type AnnouncementStats = {
  views: number;
  buttonClicks: number;
  xClicks: number;
};

export type AnnouncementState = {
  announcement: Announcement | null;
  stats: AnnouncementStats | null;
};

export async function fetchCurrentAnnouncement(signal?: AbortSignal): Promise<AnnouncementState> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao carregar aviso (status ${res.status})`);
  return (await res.json()) as AnnouncementState;
}

export type SendAnnouncementInput = {
  // Optional custom id — server generates one when omitted. Ignored by
  // editAnnouncement below (an edit always keeps the active announcement's
  // existing id).
  id?: string;
  text: string;
  hasButton: boolean;
  // The four fields below are only validated/used server-side when
  // hasButton is true.
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Required unless buttonAction is "reload".
  buttonUrl?: string;
  color: AnnouncementColor;
  dismissible: boolean;
  visibility: AnnouncementVisibility;
  sound: AnnouncementSound;
  persistent: boolean;
  // Must hold at least one value — the server rejects an empty list rather
  // than reading it as "everyone" (see parseAnnouncementDevices).
  devices: AnnouncementDevice[];
};

async function postOrPutAnnouncement(
  method: "POST" | "PUT",
  input: SendAnnouncementInput | (Omit<SendAnnouncementInput, "id"> & { id: string })
): Promise<AnnouncementState> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
        `Falha ao salvar aviso (status ${res.status})`
    );
  }
  return (await res.json()) as AnnouncementState;
}

export async function sendAnnouncement(input: SendAnnouncementInput): Promise<AnnouncementState> {
  return postOrPutAnnouncement("POST", input);
}

// Edits the currently active announcement in place — same id, accumulated
// stats preserved, version bumped (see server/signaling.ts's PUT handler).
// `id` must match the currently active announcement's id (a stale/mismatched
// one is rejected with a 409, surfaced as a thrown error) so a second admin
// tab can't silently clobber an announcement someone else already replaced.
export async function editAnnouncement(
  id: string,
  input: Omit<SendAnnouncementInput, "id">
): Promise<AnnouncementState> {
  return postOrPutAnnouncement("PUT", { ...input, id });
}

export async function clearAnnouncement(): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}/admin/announcement`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`Falha ao remover aviso (status ${res.status})`);
}

// Shared by every admin fetch below: attaches the bearer token, treats a 401
// as a signal to drop the stored token (mirrors fetchAdminRooms above), and
// throws with the server's own error message when one is provided.
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    setAdminToken(null);
    throw new Error("unauthorized");
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
        `Falha na requisição (status ${res.status})`
    );
  }
  return res.json() as Promise<T>;
}

export type AdminStats = {
  connectedSockets: number;
  peopleOnline: number;
  sharingCount: number;
  publicRooms: number;
  privateRooms: number;
  bannedIps: number;
  // Both optional: a server that predates per-subject bans reports only the
  // IP count, and rendering a hard 0 for the other two would read as a real
  // measurement rather than "this server doesn't have them".
  bannedAccounts?: number;
  bannedFingerprints?: number;
  bannedWords: number;
  mongo: { enabled: boolean; connected: boolean };
};

export async function fetchAdminStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>("/admin/stats");
}

// What a ban is keyed on (see the server's moderationStore.ts). An IP is the
// weakest of the three — shared behind a CGNAT, and reassigned on its own to
// anyone on mobile data — which is why an account id and a browser
// fingerprint can be banned too.
export type BanSubject = "ip" | "account" | "fingerprint";

export const BAN_SUBJECT_LABELS: Record<BanSubject, string> = {
  ip: "IP",
  account: "Conta",
  fingerprint: "Navegador",
};

export type Ban = {
  subject: BanSubject;
  value: string;
  reason: string;
  createdAt: number;
  expiresAt: number | null;
};

// A server that predates ban subjects answers with the bare `{ ip, ... }`
// shape and no subject/value at all — everything it ever banned was an IP.
// Normalising here (rather than letting undefined through) is the mirror of
// the legacy `ip` alias the current server still sends: it keeps this panel
// working against the older one, which is exactly what happens in the window
// between the frontend and the API being deployed.
function normalizeBan(raw: Ban & { ip?: string }): Ban {
  return {
    subject: raw.subject ?? "ip",
    value: raw.value ?? raw.ip ?? "",
    reason: raw.reason ?? "",
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt ?? null,
  };
}

export async function fetchBans(): Promise<Ban[]> {
  const data = await adminFetch<{ bans: (Ban & { ip?: string })[] }>("/admin/bans");
  // An entry with no value at all can't be displayed or removed, and two of
  // them would collide on the list key — drop them rather than render them.
  return data.bans.map(normalizeBan).filter((ban) => ban.value.length > 0);
}

export type BanInput = {
  subject: BanSubject;
  value: string;
  reason: string;
  // Omitted/undefined means permanent.
  durationMinutes?: number;
};

export async function createBan(input: BanInput): Promise<Ban> {
  const data = await adminFetch<{ ban: Ban & { ip?: string } }>("/admin/bans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `ip` alongside `value` so a server that predates ban subjects still
    // reads the value out of the field it knows (it ignores the rest, and
    // only ever banned IPs anyway).
    body: JSON.stringify({ ...input, ip: input.value }),
  });
  // Same normalisation as fetchBans — the echoed ban goes straight into the
  // list, so an un-normalised one would sit there keyed on undefined.
  return normalizeBan(data.ban);
}

export async function removeBan(subject: BanSubject, value: string): Promise<void> {
  await adminFetch<void>(
    `/admin/bans/${encodeURIComponent(subject)}/${encodeURIComponent(value)}`,
    { method: "DELETE" }
  );
}

export async function fetchBannedWords(): Promise<string[]> {
  const data = await adminFetch<{ words: string[] }>("/admin/banned-words");
  return data.words;
}

export async function setBannedWords(words: string[]): Promise<string[]> {
  const data = await adminFetch<{ words: string[] }>("/admin/banned-words", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ words }),
  });
  return data.words;
}

// Kill switch for the server's auto-ban system (see server/signaling.ts's
// recordRateLimitViolation) — lets an admin turn it off without a redeploy.
export async function fetchAntiSpamEnabled(): Promise<boolean> {
  const data = await adminFetch<{ enabled: boolean }>("/admin/antispam");
  return data.enabled;
}

export async function setAntiSpamEnabled(enabled: boolean): Promise<boolean> {
  const data = await adminFetch<{ enabled: boolean }>("/admin/antispam", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return data.enabled;
}

// Supporters list shown in the "Apoiar projeto" hover card (see
// components/SupportersTooltip.tsx) — same whole-list-replace shape as
// banned words, no per-item id.
// Tells every connected app to check GitHub for a new release right now,
// instead of on its own six-hourly schedule (see server/signaling.ts's POST
// /admin/desktop-update). Resolves with the number of *connections* that
// were notified — not desktop apps, which the server cannot count, since the
// shell and a browser tab are the same website on the same socket.
export async function launchDesktopUpdate(): Promise<number> {
  const data = await adminFetch<{ notified: number }>("/admin/desktop-update", {
    method: "POST",
  });
  return data.notified;
}

export async function fetchAdminSupporters(): Promise<Supporter[]> {
  const data = await adminFetch<{ supporters: Supporter[] }>("/admin/supporters");
  return data.supporters;
}

export async function setSupporters(supporters: Supporter[]): Promise<Supporter[]> {
  const data = await adminFetch<{ supporters: Supporter[] }>("/admin/supporters", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supporters }),
  });
  return data.supporters;
}

// Sidebar partner-ad slot (see components/PartnerCard.tsx). Unlike the
// announcement banner there can be more than one active at once — this is
// admin-only bookkeeping (weight/createdAt) on top of the public `Partner`
// shape everyone else gets.
export type AdminPartner = Partner & {
  weight: number;
  createdAt: number;
};

export type PartnerStats = {
  // Total impressions: one per *serve*, so a slot that rotates every five
  // minutes (see PartnerCard's rotation) counts each time it lands on this
  // ad, not once per visitor per session.
  views: number;
  // Reach per session: one per (tab x ad), which is exactly what the old
  // "views" counted before the slot started rotating. Kept as its own number
  // rather than folded into either neighbour — a visitor who reloads twice is
  // two sessions and one person, so this sits genuinely between the two.
  sessionViews?: number;
  // How many distinct people are behind those impressions. Only the server
  // can answer this — the browser has no idea who else is out there — so it
  // is optional here and rendered as "—" until the signaling server starts
  // sending it. Reporting it as 0 instead would be worse than admitting we
  // do not know: an unimplemented field would read as a real, alarming
  // measurement.
  uniqueViews?: number;
  // CTA clicks from the sidebar card. Anything counted before card and video
  // clicks were split lives here, since that is where the only button was.
  clicks: number;
  // CTA clicks from inside the reward-video popup. Optional/absent from a
  // server that predates the split — rendered as 0, not as "—", because
  // unlike uniqueViews this one *is* genuinely zero on such a server: no
  // video click was ever counted anywhere.
  clicksByVideo?: number;
  // Watch-to-earn funnel (see components/PartnerRewardModal.tsx) — all
  // optional/absent for an ad with no reward configured, or from a server
  // that predates this feature. rewardVideoOpens/rewardVideoCompletions are
  // raw counts (same caveat as views/clicks: a repeat visit counts again);
  // rewardClaims is a distinct-account count, same as uniqueViews, since the
  // server refuses a second claim from the same account outright.
  rewardVideoOpens?: number;
  rewardVideoCompletions?: number;
  rewardClaims?: number;
  // Distinct accounts that collected the click reward — same
  // one-claim-per-account guarantee as rewardClaims, counted separately
  // because the two rewards are claimed independently.
  clickRewardClaims?: number;
};

export type PartnerAdminList = {
  partners: AdminPartner[];
  emptyPercent: number;
  stats: Record<string, PartnerStats>;
};

export type PartnerInput = {
  title: string;
  description: string;
  imageUrl?: string;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string;
  textColor?: string;
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
  weight: number;
  expiresAt: number | null;
  rewardVideoUrl?: string;
  rewardPoints?: number;
  // Click-to-earn reward. Omitted entirely when the ad has none; the
  // placement only travels alongside an amount (see the server's
  // parsePartnerBody, which pairs them).
  clickRewardPoints?: number;
  clickRewardPlacement?: PartnerClickRewardPlacement;
};

export async function fetchAdminPartners(): Promise<PartnerAdminList> {
  return adminFetch<PartnerAdminList>("/admin/partners");
}

export async function createPartner(
  input: PartnerInput
): Promise<{ partner: AdminPartner; stats: PartnerStats }> {
  return adminFetch("/admin/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function editPartner(
  id: string,
  input: PartnerInput
): Promise<{ partner: AdminPartner; stats: PartnerStats }> {
  return adminFetch(`/admin/partners/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deletePartner(id: string): Promise<void> {
  await adminFetch<void>(`/admin/partners/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setPartnerEmptyPercent(emptyPercent: number): Promise<number> {
  const data = await adminFetch<{ emptyPercent: number }>("/admin/partner-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emptyPercent }),
  });
  return data.emptyPercent;
}
