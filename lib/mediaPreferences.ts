// Local, device-only UI preferences for the room controls — persisted so a
// returning visitor's mic/noise-suppression/mute setup carries over instead
// of resetting to defaults on every reload.

const NOISE_SUPPRESSION_KEY = "sharescreen:noiseSuppressionOn";
const MIC_ON_KEY = "sharescreen:micOn";
const MICS_MUTED_KEY = "sharescreen:micsMuted";
const FORCE_RELAY_ICE_KEY = "sharescreen:forceRelayIce";
const GUEST_ACCOUNT_BANNER_DISMISSED_KEY = "sharescreen:guestAccountBannerDismissed";
const AUTO_JOIN_KEY = "sharescreen:autoJoin";
// "Sempre abrir salas no aplicativo" — see components/OpenInAppBanner.
const OPEN_IN_APP_KEY = "sharescreen:openRoomsInApp";
const OPEN_IN_APP_DISMISSED_KEY = "sharescreen:openInAppDismissed";
const MIC_DEVICE_ID_KEY = "sharescreen:micDeviceId";
const SPEAKER_DEVICE_ID_KEY = "sharescreen:speakerDeviceId";
const CAMERA_DEVICE_ID_KEY = "sharescreen:cameraDeviceId";

function getStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function setStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function getStoredNoiseSuppressionOn(): boolean {
  return getStoredBoolean(NOISE_SUPPRESSION_KEY, true);
}
export function setStoredNoiseSuppressionOn(value: boolean) {
  setStoredBoolean(NOISE_SUPPRESSION_KEY, value);
}

// The mic's own on/off state — restored by auto-starting the mic once on
// mount (and again after a room switch) when this was last true, same as
// how a returning visitor's noise-suppression/mute choices come back.
export function getStoredMicOn(): boolean {
  return getStoredBoolean(MIC_ON_KEY, false);
}
export function setStoredMicOn(value: boolean) {
  setStoredBoolean(MIC_ON_KEY, value);
}

export function getStoredMicsMuted(): boolean {
  return getStoredBoolean(MICS_MUTED_KEY, false);
}
export function setStoredMicsMuted(value: boolean) {
  setStoredBoolean(MICS_MUTED_KEY, value);
}

// "Impedir conexões diretas": forces every peer connection this client makes
// (sending or receiving, any channel) through the TURN relay instead of
// negotiating direct P2P — our own host/srflx candidates are gathered but
// never offered to the other side, so they only ever learn our TURN
// server's address, never ours. See lib/iceConfig.ts's iceConfigFor. Off by
// default: it costs latency and, on a slow TURN server, quality too.
export function getStoredForceRelayIce(): boolean {
  return getStoredBoolean(FORCE_RELAY_ICE_KEY, false);
}
export function setStoredForceRelayIce(value: boolean) {
  setStoredBoolean(FORCE_RELAY_ICE_KEY, value);
}

// Per-peer volume dials (mic "speaking" volume, and a shared screen/camera
// "transmission" volume) — the caller keys these by PeerInfo.userId (a
// stable per-account/per-guest id from the server, constant across that
// person's reconnects/reloads), falling back to their connection id only
// for a peer an older server hasn't sent one for yet. Capped like
// hidden-announcement ids so a long history of past peers doesn't grow this
// forever.
const PEER_VOLUMES_KEY = "sharescreen:peerVolumes";
const TRANSMISSION_VOLUMES_KEY = "sharescreen:transmissionVolumes";
const MAX_STORED_VOLUMES = 50;

function getStoredVolumes(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function setStoredVolume(key: string, peerId: string, volume: number) {
  if (typeof window === "undefined") return;
  try {
    const current = getStoredVolumes(key);
    // Delete-then-set moves this id to the end, so trimming below drops the
    // least-recently-touched entries first instead of an arbitrary one.
    delete current[peerId];
    current[peerId] = volume;
    const entries = Object.entries(current);
    const trimmed =
      entries.length > MAX_STORED_VOLUMES ? entries.slice(entries.length - MAX_STORED_VOLUMES) : entries;
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function getStoredPeerVolumes(): Record<string, number> {
  return getStoredVolumes(PEER_VOLUMES_KEY);
}
export function setStoredPeerVolume(peerId: string, volume: number) {
  setStoredVolume(PEER_VOLUMES_KEY, peerId, volume);
}

export function getStoredTransmissionVolumes(): Record<string, number> {
  return getStoredVolumes(TRANSMISSION_VOLUMES_KEY);
}
export function setStoredTransmissionVolume(peerId: string, volume: number) {
  setStoredVolume(TRANSMISSION_VOLUMES_KEY, peerId, volume);
}

// Whether a guest already dismissed the "crie uma conta" nudge banner —
// dismissing it is permanent (not per-room), since it's suggesting the same
// thing regardless of which room they're in.
export function getStoredGuestAccountBannerDismissed(): boolean {
  return getStoredBoolean(GUEST_ACCOUNT_BANNER_DISMISSED_KEY, false);
}
export function setStoredGuestAccountBannerDismissed(value: boolean) {
  setStoredBoolean(GUEST_ACCOUNT_BANNER_DISMISSED_KEY, value);
}

// Whether this browser should hand room links straight to the desktop app.
// Off by default and only ever turned on by an explicit click: a website
// cannot tell whether an app is installed (browsers deliberately prevent
// it), so an automatic attempt on a machine without it would pop a useless
// "no application found" dialog on every visit.
export function getStoredOpenRoomsInApp(): boolean {
  return getStoredBoolean(OPEN_IN_APP_KEY, false);
}
export function setStoredOpenRoomsInApp(value: boolean) {
  setStoredBoolean(OPEN_IN_APP_KEY, value);
}

// Whether the offer to open in the app has been waved away. Separate from
// the preference above so "no thanks" is remembered without being confused
// with "not configured yet" — otherwise the banner would return on every
// room, forever.
export function getStoredOpenInAppDismissed(): boolean {
  return getStoredBoolean(OPEN_IN_APP_DISMISSED_KEY, false);
}
export function setStoredOpenInAppDismissed(value: boolean) {
  setStoredBoolean(OPEN_IN_APP_DISMISSED_KEY, value);
}

// "Entrar em transmissões automaticamente" — on by default. Off means a
// peer's screen/camera share doesn't connect on its own; the tile shows a
// "click to watch" prompt instead (see useRoomMedia's autoJoin gate).
export function getStoredAutoJoin(): boolean {
  return getStoredBoolean(AUTO_JOIN_KEY, true);
}
export function setStoredAutoJoin(value: boolean) {
  setStoredBoolean(AUTO_JOIN_KEY, value);
}

function getStoredString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredString(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

// Chosen input/output device ids for the mic-source and audio-output device
// pickers — null means "system default". Persisted so a returning visitor's
// picked mic/speaker carries over like the rest of their media setup.
export function getStoredMicDeviceId(): string | null {
  return getStoredString(MIC_DEVICE_ID_KEY);
}
export function setStoredMicDeviceId(value: string | null) {
  setStoredString(MIC_DEVICE_ID_KEY, value);
}

export function getStoredSpeakerDeviceId(): string | null {
  return getStoredString(SPEAKER_DEVICE_ID_KEY);
}
export function setStoredSpeakerDeviceId(value: string | null) {
  setStoredString(SPEAKER_DEVICE_ID_KEY, value);
}

// Which camera the camera share (and, on phones, the camera fallback for
// "compartilhar tela") captures from — null means "let the browser pick",
// which is the front-facing one. Persisted like the mic/speaker choices:
// someone who broadcasts from a capture card or a second webcam shouldn't
// have to re-pick it every session.
export function getStoredCameraDeviceId(): string | null {
  return getStoredString(CAMERA_DEVICE_ID_KEY);
}
export function setStoredCameraDeviceId(value: string | null) {
  setStoredString(CAMERA_DEVICE_ID_KEY, value);
}
