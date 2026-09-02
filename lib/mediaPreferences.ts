// Local, device-only UI preferences for the room controls — persisted so a
// returning visitor's mic/noise-suppression/mute setup carries over instead
// of resetting to defaults on every reload.

const NOISE_SUPPRESSION_KEY = "sharescreen:noiseSuppressionOn";
const MIC_ON_KEY = "sharescreen:micOn";
const MICS_MUTED_KEY = "sharescreen:micsMuted";
const FORCE_RELAY_ICE_KEY = "sharescreen:forceRelayIce";
const GUEST_ACCOUNT_BANNER_DISMISSED_KEY = "sharescreen:guestAccountBannerDismissed";
// Whether the one-time "ligue o microfone" nudge above the mic button has
// already been shown (see WatchRoom's micHint). Per device rather than per
// account on purpose: it teaches how the room works, and someone who has
// already learned it should not be taught again on the same browser just
// because they signed in as someone else.
const MIC_HINT_SEEN_KEY = "sharescreen:micHintSeen";

// This listener's own volume for the room's music (see components/MusicBar),
// 0-1. Not a shared setting: the track, where it is and whether it's playing
// belong to the room, but how loud it is in *your* headphones is yours.
//
// Defaults to half rather than full. Music here plays underneath a
// conversation, and a soundtrack that arrives at the same level as the person
// talking is one everybody turns down anyway — the first thing a default
// should avoid is being the wrong answer for everyone.
const MUSIC_VOLUME_KEY = "sharescreen:musicVolume";
export const DEFAULT_MUSIC_VOLUME = 0.5;
const AUTO_JOIN_KEY = "sharescreen:autoJoin";
// Whether a double click on a tile puts it in "Focar" (see WatchRoom's
// toggleSpotlight). On by default — it is how focusing has always worked —
// but it costs something now that a single click on a local file's picture is
// play/pause: a double click fires its first click too, so the play/pause has
// to wait out the double-click window before acting. Turning this off is what
// makes that click instant for someone who focuses with the button instead.
const DOUBLE_CLICK_FOCUS_KEY = "sharescreen:doubleClickFocus";
// "Sempre abrir salas no aplicativo" — see components/OpenInAppBanner.
const OPEN_IN_APP_KEY = "sharescreen:openRoomsInApp";
const OPEN_IN_APP_DISMISSED_KEY = "sharescreen:openInAppDismissed";
// The screen-share dials: resolution, frame rate, bitrate, content profile
// and "qualidade inteligente". Persisted for the same reason the mic and
// camera choices are — someone who broadcasts a game at 1080p60 on the
// "Vídeo / jogo" profile is going to want that again tomorrow, and re-picking
// five settings on every visit is five chances to forget one and wonder why
// the share looks different.
//
// Stored as plain strings here on purpose. The values they may take live with
// the pickers in useRoomMedia (SHARE_*_OPTIONS), and validating against those
// from this file would mean importing them — a runtime cycle, since
// useRoomMedia imports this module. So this end stores and returns text, and
// the caller decides what counts as a valid answer. That split also happens
// to be the right one: what is *allowed* changes with the app's options, what
// is *stored* is just what was last chosen.
const SHARE_RESOLUTION_KEY = "sharescreen:shareResolution";
const SHARE_FPS_KEY = "sharescreen:shareFps";
const SHARE_BITRATE_KEY = "sharescreen:shareBitrate";
const SHARE_PROFILE_KEY = "sharescreen:shareProfile";
const SMART_QUALITY_KEY = "sharescreen:smartQuality";

const MIC_DEVICE_ID_KEY = "sharescreen:micDeviceId";
const SPEAKER_DEVICE_ID_KEY = "sharescreen:speakerDeviceId";
const CAMERA_DEVICE_ID_KEY = "sharescreen:cameraDeviceId";
const CAMERA_FACING_KEY = "sharescreen:cameraFacing";

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

export function getStoredDoubleClickFocus(): boolean {
  return getStoredBoolean(DOUBLE_CLICK_FOCUS_KEY, true);
}
export function setStoredDoubleClickFocus(value: boolean) {
  setStoredBoolean(DOUBLE_CLICK_FOCUS_KEY, value);
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

export function getStoredMusicVolume(): number {
  if (typeof window === "undefined") return DEFAULT_MUSIC_VOLUME;
  try {
    const raw = window.localStorage.getItem(MUSIC_VOLUME_KEY);
    if (raw === null) return DEFAULT_MUSIC_VOLUME;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_MUSIC_VOLUME;
    return Math.min(1, Math.max(0, parsed));
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}
export function setStoredMusicVolume(volume: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUSIC_VOLUME_KEY, String(Math.min(1, Math.max(0, volume))));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

export function getStoredMicHintSeen(): boolean {
  return getStoredBoolean(MIC_HINT_SEEN_KEY, false);
}
export function setStoredMicHintSeen(value: boolean) {
  setStoredBoolean(MIC_HINT_SEEN_KEY, value);
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

// See the SHARE_*_KEY block above for why these deal in raw strings and
// leave validation to the caller. A null means "nothing stored yet", which
// the caller reads as "use the default" — distinct from a stored value that
// is no longer offered, which it also has to handle.
export function getStoredShareResolution(): string | null {
  return getStoredString(SHARE_RESOLUTION_KEY);
}
export function setStoredShareResolution(value: string) {
  setStoredString(SHARE_RESOLUTION_KEY, value);
}

export function getStoredShareBitrate(): string | null {
  return getStoredString(SHARE_BITRATE_KEY);
}
export function setStoredShareBitrate(value: string) {
  setStoredString(SHARE_BITRATE_KEY, value);
}

export function getStoredShareProfile(): string | null {
  return getStoredString(SHARE_PROFILE_KEY);
}
export function setStoredShareProfile(value: string) {
  setStoredString(SHARE_PROFILE_KEY, value);
}

// A number rather than a string, and NaN-guarded: this one is compared
// against numeric option values, and a stored "abc" coming back as NaN would
// silently fail every comparison and look like "nothing stored".
export function getStoredShareFps(): number | null {
  const raw = getStoredString(SHARE_FPS_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
export function setStoredShareFps(value: number) {
  setStoredString(SHARE_FPS_KEY, String(value));
}

// "Qualidade inteligente" — on by default, matching useRoomMedia.
export function getStoredSmartQuality(): boolean {
  return getStoredBoolean(SMART_QUALITY_KEY, true);
}
export function setStoredSmartQuality(value: boolean) {
  setStoredBoolean(SMART_QUALITY_KEY, value);
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

/**
 * Which way the phone's camera points, for the flip button.
 *
 * A separate preference from the camera *device id* above, and deliberately
 * so. A device id is a specific lens on a specific machine: it does not
 * survive a different phone, it is meaningless on a desktop, and on Android
 * the ids are opaque strings whose labels ("camera2 0, facing back") are only
 * readable after permission has been granted — so a flip button built on them
 * would be guessing at which entry is the back one, and guessing wrong on the
 * phones that expose three.
 *
 * `facingMode` is the constraint the browser resolves itself, on any device,
 * with no enumeration and no labels. So the flip button sets this and clears
 * the device id (see setCameraFacing in useRoomMedia): picking a lens by hand
 * and flipping front-to-back are two different intentions, and the last one
 * expressed is the one that should hold.
 */
export type CameraFacing = "user" | "environment";

export function getStoredCameraFacing(): CameraFacing {
  if (typeof window === "undefined") return "user";
  try {
    return window.localStorage.getItem(CAMERA_FACING_KEY) === "environment"
      ? "environment"
      : "user";
  } catch {
    return "user";
  }
}

export function setStoredCameraFacing(facing: CameraFacing) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CAMERA_FACING_KEY, facing);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}
