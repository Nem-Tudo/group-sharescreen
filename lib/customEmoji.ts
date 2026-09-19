"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";
import { useFeature } from "./features";

// Custom emoji — Discord's, down to the token a message carries: `<:name:id>`,
// or `<a:name:id>` for an animated one. The twin of the API's customEmoji.ts,
// and the two must agree on the patterns below.
//
// What is drawn comes from the id alone (see customEmojiUrl: the API answers
// with the picture), so a message needs no lookup to show one. What the
// picker and the ":" list offer does need one — which emoji this person has,
// and which may go where they are writing — and that is the store below.
//
// A composer shows `:name:` while somebody types (a text box cannot hold a
// picture) and turns it into the token on the way out; see
// useEmojiAutocomplete's convert.

/** The experiment the whole thing sits behind (admin panel's "Features"). */
export const CUSTOM_EMOJI_FEATURE = "custom-emojis";
/** The "NOVO" badge's id — see components/NewBadge. */
export const CUSTOM_EMOJI_BADGE = CUSTOM_EMOJI_FEATURE;

/** What the feature counts — each must be in its "site events" in the admin panel. */
export const CUSTOM_EMOJI_EVENTS = {
  /** A custom emoji was added (group's or account's). */
  create: "custom_emoji_create",
  /** A message went out with at least one custom emoji in it. */
  send: "custom_emoji_send",
  /** Somebody reacted with a custom emoji. */
  react: "custom_emoji_react",
  /** The picker's custom tab was opened. */
  pickerOpen: "custom_emoji_picker_open",
} as const;

export {
  CUSTOM_EMOJI_TOKEN,
  EMOJI_IMAGE_MAX_BYTES,
  EMOJI_NAME_RE,
  emojiLabel,
  emojiToken,
  isJumboEmojiText,
  parseEmojiToken,
  plainEmoji,
  splitEmojiTokens,
  composerTextFor,
  encodeCustomEmojis,
  usableCustomEmojis,
  type EmojiSegment,
  type ParsedEmojiToken,
} from "./customEmojiTokens";
import { CUSTOM_EMOJI_TOKEN } from "./customEmojiTokens";

/** Where an emoji's picture is — the API redirects to the CDN. */
export function customEmojiUrl(id: string): string {
  return `${getSignalingHttpBase()}/emojis/${encodeURIComponent(id)}`;
}


// ─── What somebody may use, where ───────────────────────────────────────────

export interface CustomEmoji {
  id: string;
  name: string;
  animated: boolean;
  url: string;
  /** False when its owner is over the limit, or the room does not allow it here. */
  usable: boolean;
}

export interface CustomEmojiSource {
  /** Stable key: "group:<id>" or "mine". */
  key: string;
  kind: "group" | "mine";
  name: string;
  iconUrl: string | null;
  /** The group being written in — its emoji come first. */
  here: boolean;
  emojis: CustomEmoji[];
}

export interface CustomEmojiSet {
  available: boolean;
  sources: CustomEmojiSource[];
  can: { custom: boolean; external: boolean };
}

/** Where a composer is writing: a group's text room, a voice room's chat (by handle), or neither (a DM). */
export type EmojiPlace = { group: string; channel: string } | { room: string } | null;

/**
 * Whether this person is in the experiment, at `place` — the composers ask
 * with `track` (the picker's tab and the ":" list are where it shows).
 */
export function useCustomEmojiEnabled(place: EmojiPlace, track: boolean): boolean {
  const group = place && "group" in place ? place.group : null;
  const room = place && "room" in place ? place.room : null;
  return useFeature(CUSTOM_EMOJI_FEATURE, { group, room, track }).enabled;
}

type PickerAnswer = {
  available: boolean;
  group: { id: string; name: string; iconUrl: string | null; emojis: CustomEmoji[] } | null;
  mine: CustomEmoji[];
  others: { group: { id: string; name: string; iconUrl: string | null }; emojis: CustomEmoji[] }[];
  can: { custom: boolean; external: boolean };
};

function authToken(): string | null {
  return getAccountToken() ?? getStoredGuestToken();
}

function placeKey(place: EmojiPlace): string {
  if (!place) return "none";
  return "room" in place ? `room:${place.room}` : `group:${place.group}:${place.channel}`;
}

function toSet(answer: PickerAnswer): CustomEmojiSet {
  const sources: CustomEmojiSource[] = [];
  if (answer.group) {
    sources.push({
      key: `group:${answer.group.id}`,
      kind: "group",
      name: answer.group.name,
      iconUrl: answer.group.iconUrl,
      here: true,
      emojis: answer.group.emojis,
    });
  }
  if (answer.mine.length > 0) {
    sources.push({
      key: "mine",
      kind: "mine",
      name: translate("customEmoji.yourEmojis"),
      iconUrl: null,
      here: false,
      emojis: answer.mine,
    });
  }
  for (const other of answer.others) {
    sources.push({
      key: `group:${other.group.id}`,
      kind: "group",
      name: other.group.name,
      iconUrl: other.group.iconUrl,
      here: false,
      emojis: other.emojis,
    });
  }
  return { available: answer.available, sources, can: answer.can };
}

// One answer per place, kept for a little while: the picker and the ":" list
// ask on every open, and a group that just added an emoji should show it
// without a reload.
const FRESH_MS = 30_000;
const cache = new Map<string, { at: number; set: CustomEmojiSet }>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads what `place` offers again — after adding, renaming or deleting one. */
export function invalidateCustomEmojis(): void {
  cache.clear();
  emit();
}

export function loadCustomEmojis(place: EmojiPlace, force = false): Promise<void> {
  const key = placeKey(place);
  const held = cache.get(key);
  if (!force && held && Date.now() - held.at < FRESH_MS) return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;
  const token = authToken();
  if (!token) return Promise.resolve();
  const params = new URLSearchParams();
  if (place && "room" in place) params.set("room", place.room);
  else if (place) {
    params.set("group", place.group);
    params.set("channel", place.channel);
  }
  const work = fetch(`${getSignalingHttpBase()}/emojis/picker?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (res) => {
      if (!res.ok) return;
      cache.set(key, { at: Date.now(), set: toSet((await res.json()) as PickerAnswer) });
      emit();
    })
    .catch(() => {
      // Offline: the picker simply has no custom tab this time.
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

/**
 * What the picker and the ":" list offer at `place` — null until it has
 * loaded, and always null while `enabled` is false (outside the experiment).
 */
export function useCustomEmojiSet(place: EmojiPlace, enabled: boolean): CustomEmojiSet | null {
  const key = placeKey(place);
  const set = useSyncExternalStore(
    subscribe,
    () => (enabled ? (cache.get(key)?.set ?? null) : null),
    () => null
  );
  useEffect(() => {
    if (enabled) void loadCustomEmojis(place);
    // The key says everything about the place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return set;
}

/** Whether a text carries any custom emoji — for counting sends. */
export function hasCustomEmoji(text: string): boolean {
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  return CUSTOM_EMOJI_TOKEN.test(text);
}

// ─── Managing them ──────────────────────────────────────────────────────────

export interface ManagedEmoji extends CustomEmoji {
  createdBy: string;
  createdAt: number;
}

export interface ManagedEmojiList {
  available: boolean;
  limit: number;
  emojis: ManagedEmoji[];
  canManage?: boolean;
}

export type EmojiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function request<T extends object>(method: string, path: string, body?: unknown): Promise<EmojiResult<T>> {
  const token = authToken();
  try {
    const res = await fetch(`${getSignalingHttpBase()}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? translate("groupsApi.somethingWentWrongTryAgain") };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/** The owner a list belongs to: a group, or the signed-in account ("mine"). */
export type EmojiOwner = { group: string } | "mine";

function ownerPath(owner: EmojiOwner): string {
  return owner === "mine" ? "/emojis/mine" : `/groups/${encodeURIComponent(owner.group)}/emojis`;
}

export const fetchManagedEmojis = (owner: EmojiOwner) => request<ManagedEmojiList>("GET", ownerPath(owner));

export const createEmoji = (owner: EmojiOwner, name: string, image: string) =>
  request<ManagedEmojiList>("POST", ownerPath(owner), { name, image });

export const renameEmoji = (owner: EmojiOwner, id: string, name: string) =>
  request<ManagedEmojiList>("PATCH", `${ownerPath(owner)}/${encodeURIComponent(id)}`, { name });

export const deleteEmoji = (owner: EmojiOwner, id: string) =>
  request<ManagedEmojiList>("DELETE", `${ownerPath(owner)}/${encodeURIComponent(id)}`);

/** A file's name as an emoji name: "Pepe Feliz (1).png" → "Pepe_Feliz_1". */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 32);
}

/**
 * A picture ready to upload: a GIF as it is (resizing one would lose its
 * frames), anything else fitted inside 128×128 and re-encoded — which is also
 * what keeps it under the limit.
 */
export async function prepareEmojiImage(file: File): Promise<{ dataUrl: string; bytes: number }> {
  const read = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error(translate("common.couldNotReadTheFile")));
      reader.readAsDataURL(blob);
    });
  const sizeOf = (dataUrl: string) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
  };
  const original = await read(file);
  if (file.type === "image/gif") return { dataUrl: original, bytes: sizeOf(original) };
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(translate("common.couldNotOpenTheImage")));
      el.src = original;
    });
    const scale = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0, width, height);
      // WebP keeps the transparency an emoji almost always has; PNG where the
      // browser cannot write WebP.
      const webp = canvas.toDataURL("image/webp", 0.92);
      const encoded = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
      if (sizeOf(encoded) < sizeOf(original)) return { dataUrl: encoded, bytes: sizeOf(encoded) };
    }
  } catch {
    // Sent as it is; the API says so if it is too big.
  }
  return { dataUrl: original, bytes: sizeOf(original) };
}
