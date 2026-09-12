"use client";

import { useSyncExternalStore } from "react";
import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { getCaptchaToken } from "./turnstile";
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
import { translate } from "@/lib/i18n";

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

export function setAdminToken(token: string | null) {
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
/**
 * Signs in as an administrator.
 *
 * The captcha token is minted here, immediately before the request. Cloudflare
 * decides on its own whether this person is shown a challenge first (see
 * lib/turnstile.ts), so there is nothing for the page to catch and re-submit:
 * by the time this resolves, that has already happened or was never needed.
 */
export async function adminLogin(user: string, password: string): Promise<void> {
  // /auth/login is captcha-gated on the server exactly like the main site's
  // login is (see the API's passesHttpCaptcha). This used to send nothing at
  // all, which was invisible while enforcement stayed off and then refused
  // every administrator outright the moment it was switched on — with the 403
  // landing in the same `catch` as a wrong password and being read back as
  // "Usuário ou senha inválidos.", which is the one thing it was not.
  const turnstileToken = await getCaptchaToken("login");
  const res = await fetch(`${getSignalingHttpBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password, turnstileToken }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || translate("common.invalidUsernameOrPassword"));
  }
  const data = (await res.json()) as { token: string; account: { flags: string[] } };
  if (!data.account.flags.includes("ADMIN")) {
    throw new Error(translate("adminApi.thisAccountDoesNotHaveAdministrator"));
  }
  setAdminToken(data.token);
}

export function adminLogout() {
  // JWTs are stateless — there's nothing to revoke server-side, so logging
  // out is just dropping the locally stored token.
  setAdminToken(null);
}

// The live room list (fetchAdminRooms, AdminRoom, AdminRoomPeer) used to sit
// here. It moved out with the panels that called it — see ../sharescreen-admin,
// which keeps its own trimmed copy of this module. Nothing on this page reads
// who is in a room right now; everything left below configures the service.

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
  if (!res.ok) throw new Error(translate("adminApi.couldNotLoadTheNoticeStatus", { status: res.status }));
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
        translate("adminApi.couldNotSaveTheNoticeStatus", { status: res.status })
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
  if (!res.ok) throw new Error(translate("adminApi.couldNotRemoveTheNoticeStatus", { status: res.status }));
}

// Shared by every admin fetch below: attaches the bearer token, treats a 401
// as a signal to drop the stored token (mirrors fetchAdminRooms above), and
// throws with the server's own error message when one is provided.
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // The account's own session, not a second one.
  //
  // This used to keep an administrator token in its own localStorage slot,
  // minted by a login form of its own. That was a second way to be signed in
  // to the same site: two tokens, two expiries, and a panel that could be
  // "logged in" while the header said nobody was. There is one session now,
  // and being an administrator is a flag on the account behind it (see the
  // API's requireAdmin) rather than a separate credential.
  const token = getAccountToken();
  if (!token) throw new Error("unauthorized");
  const res = await fetch(`${getSignalingHttpBase()}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? translate("adminApi.errorStatus", { status: res.status }));
  }
  return (await res.json()) as T;
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
  streamersOnline?: number;
  externalStreams?: number;
  mongo: { enabled: boolean; connected: boolean };
};

export async function fetchAdminStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>("/admin/stats");
}

export type StreamExternalEntry = {
  id: string;
  room: string;
  target: string;
  targetKind: "screen" | "camera" | "file" | "video-source" | "other";
  targetId: string;
  authorId?: string;
  authorName?: string;
  connectedAt: number;
  connectedSeconds: number;
};

export type StreamStats = {
  streamersOnline: number;
  roomsWithStreamerMode: number;
  externalStreamClients: number;
  activeExternalStreams: number;
  byKind: {
    screens: number;
    cameras: number;
    files: number;
    videoSources: number;
  };
  streams: StreamExternalEntry[];
};

export async function fetchStreamStats(): Promise<StreamStats> {
  return adminFetch<StreamStats>("/admin/stream-stats");
}

// What a ban is keyed on (see the server's moderationStore.ts). An IP is the
// weakest of the three — shared behind a CGNAT, and reassigned on its own to
// anyone on mobile data — which is why an account id and a browser
// fingerprint can be banned too.
export type BanSubject = "ip" | "account" | "fingerprint";

export const BAN_SUBJECT_LABELS: Record<BanSubject, string> = {
  ip: "IP",
  get account() { return translate("adminApi.account"); },
  get fingerprint() { return translate("common.browser"); },
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

// Names no group may take as its custom invite link (see the API's
// reservedInvites.ts). The whole list, read and replaced at once — the admin
// page is a textarea of one name per line, like the chat filter above.
export async function fetchReservedInvites(): Promise<string[]> {
  const data = await adminFetch<{ names: string[] }>("/admin/reserved-invites");
  return data.names;
}

export async function setReservedInvites(names: string[]): Promise<string[]> {
  const data = await adminFetch<{ names: string[] }>("/admin/reserved-invites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  return data.names;
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

// The Adsterra kill switch (see the API's adsConfig.ts). Reading it needs no
// admin rights — it is the same value every visitor's page already fetches to
// decide whether to render a slot — so this goes to the public route rather
// than minting an admin-only mirror of it. Writing it is admin-only, and the
// API pushes the new value down every open socket before answering.
export async function fetchAdsterraEnabled(): Promise<boolean> {
  const res = await fetch(`${getSignalingHttpBase()}/ads/config`);
  if (!res.ok) throw new Error(translate("adminApi.couldNotReadTheAdSettings"));
  const data = (await res.json()) as { adsterraEnabled?: unknown };
  return data.adsterraEnabled !== false;
}

export async function setAdsterraEnabled(enabled: boolean): Promise<boolean> {
  const data = await adminFetch<{ adsterraEnabled: boolean }>("/admin/ads/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adsterraEnabled: enabled }),
  });
  return data.adsterraEnabled;
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
  // Key to this ad's public report page (/ad/[token]) — the link the
  // admin hands an advertiser so they can watch their own numbers without an
  // account. Optional here only for a server that predates reports; every ad
  // gets one backfilled at startup (see the API's Partner.reportToken).
  reportToken?: string | null;
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
  // Clicks on that same CTA from inside the reward-video popup. Optional/absent from a
  // server that predates the split — rendered as 0, not as "—", because
  // unlike uniqueViews this one *is* genuinely zero on such a server: no
  // video click was ever counted anywhere.
  clicksByVideo?: number;
  // How many times people minimized the left sidebar with this ad active.
  minimizes?: number;
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

// ── Client eval ────────────────────────────────────────────────────────────
//
// The targeting model is shared with the server (see the API's adminEval.ts) —
// mirrored here rather than imported because the two are different packages,
// and the shapes are small and change together. The field/op lists drive the
// panel's dropdowns so a new field is added in one place.

export type EvalOp = "eq" | "neq" | "contains" | "regex" | "exists" | "is" | "has";
export type EvalClause = { field: string; op: EvalOp; value?: string };
export type EvalFilter = { combine: "and" | "or"; clauses: EvalClause[] };

// Each targetable field, its value kind, and a human label. `bool` fields use
// the "is" op with a true/false value; `string` fields use the text ops.
// `enum` values feed a dropdown instead of a free text box.
export type EvalFieldDef = {
  key: string;
  label: string;
  kind: "string" | "bool";
  // When set, the value is chosen from these instead of typed.
  options?: readonly string[];
  placeholder?: string;
};

// Must stay in step with the API's CLIENT_PLATFORMS.
export const EVAL_DEVICE_OPTIONS = [
  "desktop-browser",
  "desktop-webview",
  "desktop-app",
  "mobile-browser",
  "mobile-webview",
  "unknown",
] as const;

export const EVAL_FIELDS: readonly EvalFieldDef[] = [
  { key: "version", get label() { return translate("adminApi.buildCommit"); }, kind: "string", placeholder: "ex: 0.1.17-abc1234" },
  { key: "room", get label() { return translate("common.room"); }, kind: "string", placeholder: "handle da sala" },
  { key: "inRoom", get label() { return translate("adminApi.isInARoom"); }, kind: "bool" },
  { key: "path", get label() { return translate("adminApi.currentPage"); }, kind: "string", placeholder: "ex: /watch/" },
  { key: "platform", get label() { return translate("adminApi.device"); }, kind: "string", options: EVAL_DEVICE_OPTIONS },
  { key: "name", get label() { return translate("common.name"); }, kind: "string" },
  { key: "userId", get label() { return translate("adminApi.idAccountOrGuest"); }, kind: "string" },
  { key: "accountId", get label() { return translate("adminApi.accountId"); }, kind: "string" },
  { key: "guestId", get label() { return translate("adminApi.guestId"); }, kind: "string" },
  { key: "account", get label() { return translate("adminApi.isASignedInAccount"); }, kind: "bool" },
  { key: "registered", get label() { return translate("adminApi.hasRegisteredAName"); }, kind: "bool" },
  { key: "flag", get label() { return translate("adminApi.accountFlag"); }, kind: "string", get placeholder() { return translate("adminApi.eGVerifiedAdmin"); } },
  { key: "sharing", get label() { return translate("adminApi.broadcastingScreenOrCamera"); }, kind: "bool" },
  { key: "sharingScreen", get label() { return translate("adminApi.broadcastingTheScreen"); }, kind: "bool" },
  { key: "sharingCamera", get label() { return translate("adminApi.broadcastingTheCamera"); }, kind: "bool" },
  { key: "mic", get label() { return translate("adminApi.microphoneOn"); }, kind: "bool" },
  { key: "ip", label: "IP", kind: "string" },
  { key: "fingerprint", get label() { return translate("adminApi.fingerprint"); }, kind: "string" },
] as const;

// Which ops each value kind offers, in menu order.
export const EVAL_STRING_OPS: { value: EvalOp; label: string }[] = [
  { value: "eq", get label() { return translate("adminApi.isEqualTo"); } },
  { value: "neq", get label() { return translate("adminApi.isDifferentFrom"); } },
  { value: "contains", get label() { return translate("adminApi.contains"); } },
  { value: "regex", label: "casa regex" },
  { value: "exists", get label() { return translate("adminApi.existsNotEmpty"); } },
];
export const EVAL_BOOL_OPS: { value: EvalOp; label: string }[] = [
  { value: "is", get label() { return translate("adminApi.is"); } },
];

export function evalFieldDef(key: string): EvalFieldDef | undefined {
  return EVAL_FIELDS.find((f) => f.key === key);
}

export type EvalResult = { id: string; matched: number; total: number };

export async function sendClientEval(code: string, filter: EvalFilter): Promise<EvalResult> {
  return adminFetch<EvalResult>("/admin/eval", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filter }),
  });
}

// ─── Conceder plano ───────────────────────────────────────────────────────
//
// Comping somebody a plan by hand (see the API's premiumRoutes admin block).
// Deliberately its own set of calls rather than reusing the buyer-facing
// /premium routes: those are about money, and nothing here involves any.

export interface AdminAccountHit {
  id: string;
  username: string;
  displayName: string;
  /** The flags actually stored — never the projection, which adds PRO. */
  flags: string[];
  points: number;
  premium: { method?: string; currentPeriodEnd: number; status: string } | null;
}

export interface AdminPlanOption {
  id: string;
  title: string;
  priceLabel: string;
  active: boolean;
}

/**
 * One account search for the whole admin area, so "find the person" behaves
 * the same wherever it is asked.
 *
 * `canEditAdminFlags` is what to *offer*: the server enforces the ADMIN /
 * ADMIN_MASTER rules again on every write, whatever this page draws.
 */
export async function searchAdminAccounts(
  query: string
): Promise<{ accounts: AdminAccountHit[]; canEditAdminFlags: boolean }> {
  return adminFetch<{ accounts: AdminAccountHit[]; canEditAdminFlags: boolean }>(
    `/admin/accounts?q=${encodeURIComponent(query)}`
  );
}

/** Replaces an account's flags with exactly this list. */
export async function setAccountFlags(userId: string, flags: string[]): Promise<string[]> {
  const data = await adminFetch<{ account: { flags: string[] } }>(
    `/admin/accounts/${encodeURIComponent(userId)}/flags`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flags }),
    }
  );
  return data.account.flags;
}

// ─── Groups ──────────────────────────────────────────────────────────────

/** A group as the admin panel sees it — see the API's adminGroup. */
export interface AdminGroupHit {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  visibility: "private" | "public";
  flags: string[];
  memberCount: number;
  channelCount: number;
  createdAt: number;
  owner: { id: string; displayName: string; username: string | null };
  suspension: { reason: string; at: number; by: string } | null;
}

/** By id or a piece of the name; the newest groups when the query is empty. */
export async function searchAdminGroups(query: string): Promise<AdminGroupHit[]> {
  const data = await adminFetch<{ groups: AdminGroupHit[] }>(`/admin/groups?q=${encodeURIComponent(query)}`);
  return data.groups;
}

/** Replaces a group's flags with exactly this list. */
export async function setAdminGroupFlags(groupId: string, flags: string[]): Promise<AdminGroupHit> {
  const data = await adminFetch<{ group: AdminGroupHit }>(`/admin/groups/${encodeURIComponent(groupId)}/flags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flags }),
  });
  return data.group;
}

/** Suspends a group — out of use for everybody in it until lifted. */
export async function suspendAdminGroup(groupId: string, reason: string): Promise<AdminGroupHit> {
  const data = await adminFetch<{ group: AdminGroupHit }>(
    `/admin/groups/${encodeURIComponent(groupId)}/suspension`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }
  );
  return data.group;
}

export async function unsuspendAdminGroup(groupId: string): Promise<AdminGroupHit> {
  const data = await adminFetch<{ group: AdminGroupHit }>(
    `/admin/groups/${encodeURIComponent(groupId)}/suspension`,
    { method: "DELETE" }
  );
  return data.group;
}

/** Deletes a group for good. */
export async function deleteAdminGroup(groupId: string): Promise<void> {
  await adminFetch<{ ok: true }>(`/admin/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
}

/** One theme as the moderation panel sees it. */
export type AdminThemeHit = {
  id: string;
  name: string;
  description: string;
  published: boolean;
  price: number;
  likes: number;
  uses: number;
  createdAt: number;
  authorId: string;
  authorName: string | null;
  authorUsername: string | null;
  authorBanned: boolean;
  /** Enough to draw the swatch. Typed loosely on purpose — the panel only
      reads colours out of it, and pinning the palette's shape here would be a
      second copy of it to keep in step with lib/roomThemes. */
  spec: { palette?: Record<string, string>; accent?: string } | null;
};

/** Themes by name, by id, or by who made them. Includes private ones. */
export async function searchAdminThemes(query: string): Promise<AdminThemeHit[]> {
  const data = await adminFetch<{ themes: AdminThemeHit[] }>(
    `/admin/themes?q=${encodeURIComponent(query)}`
  );
  return data.themes;
}

/** Everything one person has made — what a ban decision is made on. */
export async function fetchAdminThemesByAuthor(authorId: string): Promise<AdminThemeHit[]> {
  const data = await adminFetch<{ themes: AdminThemeHit[] }>(
    `/admin/themes/by-author/${encodeURIComponent(authorId)}`
  );
  return data.themes;
}

/**
 * Deletes a theme, optionally banning its author in the same request.
 *
 * One call rather than two because it is one decision — see the API's
 * adminThemeRoutes. Answers whether the ban actually landed.
 */
export async function deleteAdminTheme(
  themeId: string,
  banAuthor = false
): Promise<{ banned: boolean }> {
  return adminFetch<{ ok: true; banned: boolean }>(
    `/admin/themes/${encodeURIComponent(themeId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banAuthor }),
    }
  );
}

/** Sets or lifts the theme ban on one account. */
export async function setThemeBan(userId: string, banned: boolean): Promise<boolean> {
  const data = await adminFetch<{ banned: boolean }>(
    `/admin/accounts/${encodeURIComponent(userId)}/theme-ban`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned }),
    }
  );
  return data.banned;
}

export async function fetchAdminPlans(): Promise<AdminPlanOption[]> {
  const data = await adminFetch<{ plans: AdminPlanOption[] }>("/admin/premium/plans");
  return data.plans;
}

export async function grantPremium(userId: string, planId: string, days: number): Promise<void> {
  await adminFetch("/admin/premium/grant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, planId, days }),
  });
}

export async function revokePremiumGrant(userId: string): Promise<void> {
  await adminFetch(`/admin/premium/grant/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

/** One comped gift link, as the panel that made it shows it. */
export interface AdminGift {
  giftId: string;
  code: string;
  days: number;
  planId: string;
  planTitle: string;
}

/**
 * Mints a gift link nobody paid for.
 *
 * Unaddressed on purpose — handing a plan to a named account is grantPremium
 * above, which needs no link and no redemption. This is for the case that one
 * cannot serve: a prize or a giveaway, where who ends up with it is decided
 * after the fact, possibly by somebody who has no account yet.
 */
export async function createAdminGift(planId: string, days: number): Promise<AdminGift> {
  return adminFetch<AdminGift>("/admin/premium/gift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId, days }),
  });
}

// ─── Registro de ações ────────────────────────────────────────────────────

export interface AdminLogEntry {
  id: string;
  adminId: string;
  adminUsername: string;
  method: string;
  path: string;
  status: number;
  details: string;
  ip: string;
  ts: number;
}

/**
 * The administrators' record. `canDelete` says whether to draw the delete
 * control — the server enforces it regardless (only ADMIN_MASTER), so this is
 * what to *show*, never what is allowed.
 */
export async function fetchAdminLog(
  before?: number
): Promise<{ entries: AdminLogEntry[]; canDelete: boolean }> {
  const query = before ? `?before=${before}` : "";
  return adminFetch<{ entries: AdminLogEntry[]; canDelete: boolean }>(`/admin/logs${query}`);
}

export async function deleteAdminLogEntry(id: string): Promise<void> {
  await adminFetch(`/admin/logs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** How an admin's points edit is meant to be applied. */
export type PointsMode = "set" | "add" | "remove";

/**
 * Changes somebody's points and returns their new total.
 *
 * The mode goes to the server rather than being resolved here into a final
 * number: an increment computed in the browser would be based on the total
 * the page happened to load, and anything the account earned since would be
 * erased by the save.
 */
export async function setAccountPoints(
  id: string,
  mode: PointsMode,
  amount: number
): Promise<number> {
  const data = await adminFetch<{ account: { id: string; points: number } }>(
    `/admin/accounts/${encodeURIComponent(id)}/points`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, amount }),
    }
  );
  return data.account.points;
}

// ─── Regras de flag automática ───────────────────────────────────────────

export interface AutoFlagRule {
  id: string;
  label: string;
  kind: "signup" | "subscription";
  planId: string | null;
  from: number | null;
  to: number | null;
  flag: string;
  enabled: boolean;
  createdAt: number;
}

export async function fetchAutoFlagRules(): Promise<AutoFlagRule[]> {
  const data = await adminFetch<{ rules: AutoFlagRule[] }>("/admin/auto-flags");
  return data.rules;
}

export async function createAutoFlagRule(input: {
  label: string;
  kind: "signup" | "subscription";
  planId: string | null;
  /** ISO dates, as the date inputs produce them. Either may be null. */
  from: string | null;
  to: string | null;
  flag: string;
}): Promise<AutoFlagRule> {
  const data = await adminFetch<{ rule: AutoFlagRule }>("/admin/auto-flags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.rule;
}

export async function setAutoFlagRuleEnabled(id: string, enabled: boolean): Promise<AutoFlagRule[]> {
  const data = await adminFetch<{ rules: AutoFlagRule[] }>(
    `/admin/auto-flags/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
  return data.rules;
}

export async function deleteAutoFlagRule(id: string): Promise<AutoFlagRule[]> {
  const data = await adminFetch<{ rules: AutoFlagRule[] }>(
    `/admin/auto-flags/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  return data.rules;
}

/** Applies every rule to every account. Returns how much it granted. */
export async function runAutoFlagRules(): Promise<{ accounts: number; grants: number }> {
  return adminFetch<{ accounts: number; grants: number }>("/admin/auto-flags/run", {
    method: "POST",
  });
}
