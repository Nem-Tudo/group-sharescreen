"use client";

import { getAccountToken } from "./accountApi";
import {
  generateRoomCode,
  getSignalingHttpBase,
  THEME_CREATION_ROOM_NAME,
  THEME_VIEW_PARAM,
  THEME_VIEW_ROOM_NAME,
  toPrivateRoomHandle,
} from "./roomsApi";
import { translate } from "@/lib/i18n";

// Room themes: what one is, and how one is put on a screen.
//
// The mechanism is the whole reason this feature is small enough to exist. A
// room is thousands of Tailwind classes — `bg-zinc-950`, `border-zinc-200`,
// `dark:text-zinc-50` — and a Tailwind v4 utility compiles to
// `background-color: var(--color-zinc-950)`. The site's own dark theme is
// already built on that (see globals.css, which repaints four zinc steps and
// nothing else), so a room theme is the same trick with somebody else's
// colours: rewrite the variables and every class in the room follows, with not
// one line of markup changed.
//
// The catch, and the reason `data-theme` is pinned below: the light and dark
// ladders *share* tokens. `bg-zinc-950` is a near-black button in light mode
// and a card surface in dark mode — one variable, two jobs. Painting both
// ladders at once therefore cannot work, so a theme declares which one it is
// (by the luminance of its own page colour) and the room is pinned to that
// mode while it is worn. A light theme in a dark browser is a light room, and
// that is the correct answer: a theme is a look, not a preference.

export interface RoomThemePalette {
  page: string;
  surface: string;
  raised: string;
  border: string;
  input: string;
  text: string;
  /** Usernames, labels, the second line of a row. */
  textSoft: string;
  /** Hints, timestamps, "ninguém está transmitindo ainda". */
  muted: string;
}

export interface RoomThemeBackground {
  url: string;
  blur: number;
  dim: number;
}

/**
 * A gradient behind the room, or null for a flat page.
 *
 * One colour and an angle rather than two: the near end is always the
 * palette's own `page`, so a gradient is "the page colour fading into this"
 * and cannot end up disagreeing with the colour every other surface was picked
 * against.
 */
export interface RoomThemeGradient {
  to: string;
  angle: number;
}

export interface RoomThemeSpec {
  palette: RoomThemePalette;
  accent: string;
  accentText: string;
  gradient: RoomThemeGradient | null;
  background: RoomThemeBackground | null;
}

/** The eight directions the picker offers — the profile gradient's own list. */
export const GRADIENT_DIRECTIONS: { angle: number; label: string }[] = [
  { angle: 180, get label() { return translate("common.downwards"); } },
  { angle: 0, get label() { return translate("common.upwards"); } },
  { angle: 90, get label() { return translate("common.toTheRight"); } },
  { angle: 270, get label() { return translate("common.toTheLeft"); } },
  { angle: 135, get label() { return translate("common.diagonal"); } },
  { angle: 225, get label() { return translate("common.diagonal2"); } },
  { angle: 45, get label() { return translate("common.diagonal3"); } },
  { angle: 315, get label() { return translate("common.diagonal4"); } },
];

/** The CSS a gradient becomes, or null when there is none. */
export function gradientCss(spec: RoomThemeSpec): string | null {
  if (!spec.gradient) return null;
  return `linear-gradient(${spec.gradient.angle}deg, ${spec.palette.page}, ${spec.gradient.to})`;
}

/** Who made a theme, drawn the way they are drawn everywhere else. */
export interface ThemeAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  flags: string[];
  bot?: boolean;
  nameColor: string | null;
}

export interface RoomTheme {
  id: string;
  name: string;
  description: string;
  spec: RoomThemeSpec;
  published: boolean;
  /** What it costs in points. Zero is free, which most of them are. */
  price: number;
  /** What its author takes home from one sale — the server's arithmetic. */
  authorCut: number;
  /**
   * Whether the account reading this may wear it: bought, free, or written by
   * them. A price alone cannot answer it, which is why it comes from the API
   * rather than being worked out here.
   */
  owned: boolean;
  authorId: string;
  author: ThemeAuthor | null;
  likes: number;
  /** Whether the account reading this has liked it. */
  liked: boolean;
  uses: number;
  createdAt: number;
  updatedAt: number;
}

// The order the editor lists them in, which is loudest-to-quietest for the
// three text steps: they are read as a set, and a list that interleaved them
// with surfaces would make "is this quiet enough?" a scrolling question.
export const PALETTE_KEYS = [
  "page",
  "surface",
  "raised",
  "border",
  "input",
  "text",
  "textSoft",
  "muted",
] as const;

/** The band a paid theme's price has to fall in. Mirrors the API's roomTheme.ts. */
export const MIN_THEME_PRICE = 100;
export const MAX_THEME_PRICE = 10_000;
/** The author's cut, for showing what a price is worth before it is saved. */
export const THEME_AUTHOR_SHARE = 0.85;

/** What each slot is called, and what it actually paints. For the editor. */
export const PALETTE_LABELS: Record<keyof RoomThemePalette, { label: string; hint: string }> = {
  page: { get label() { return translate("common.background"); }, get hint() { return translate("roomThemes.thePageBehindEverything"); } },
  surface: { get label() { return translate("roomThemes.surface"); }, get hint() { return translate("roomThemes.cardsHeaderChat"); } },
  raised: { get label() { return translate("roomThemes.raised"); }, get hint() { return translate("roomThemes.controlsOnTopOfASurface"); } },
  border: { get label() { return translate("roomThemes.border"); }, get hint() { return translate("roomThemes.linesAndDividers"); } },
  input: { get label() { return translate("roomThemes.field"); }, get hint() { return translate("roomThemes.textBoxesAndSubtleFills"); } },
  text: { get label() { return translate("common.text"); }, get hint() { return translate("roomThemes.theMainText"); } },
  textSoft: { get label() { return translate("roomThemes.secondaryText"); }, get hint() { return translate("roomThemes.usernameLabelsSecondLine"); } },
  muted: { get label() { return translate("roomThemes.subtleText"); }, get hint() { return translate("roomThemes.hintsTimestampsEmptyNotices"); } },
};

/** The look a room has when nobody chose anything — the site's own dark. */
export const DEFAULT_THEME_SPEC: RoomThemeSpec = {
  palette: {
    page: "#101014",
    surface: "#1a1a1f",
    raised: "#232329",
    border: "#313139",
    input: "#43434d",
    text: "#e9e9ec",
    textSoft: "#a1a1aa",
    muted: "#71717a",
  },
  accent: "#6366f1",
  accentText: "#ffffff",
  gradient: null,
  background: null,
};

// Three, six or eight digits — the eighth pair being alpha. Kept in step with
// the API's own regex; a colour it accepts and this one refuses is a theme
// that saves and then will not load.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Whether this is a colour at all.
 *
 * Takes `unknown` rather than `string`, and that is not defensive noise: a
 * palette arrives over the network from an API that may be older than this
 * build, and a slot it has never heard of comes back undefined. TypeScript
 * says string; the wire says whatever it says.
 */
export function isHexColor(value: unknown): boolean {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

/**
 * `#rrggbb` from any accepted form, so a picker always has six digits.
 *
 * Anything that is not a colour becomes black rather than a fragment: the one
 * caller that can be handed rubbish is a colour picker, and `"#"` is a value it
 * would try to parse and then behave strangely about.
 */
export function colorBase(value: string): string {
  if (!isHexColor(value)) return "#000000";
  const clean = value.trim().replace("#", "");
  if (clean.length === 3) {
    return `#${clean
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return `#${clean.slice(0, 6)}`;
}

/**
 * The alpha a colour carries, 0–1. One when it carries none.
 *
 * Six digits meaning "fully opaque" is what every theme written before the
 * opacity sliders existed says, and it is the right reading: they were opaque.
 */
export function colorAlpha(value: string): number {
  const clean = (value ?? "").trim().replace("#", "");
  if (clean.length !== 8) return 1;
  const alpha = Number.parseInt(clean.slice(6, 8), 16);
  return Number.isFinite(alpha) ? alpha / 255 : 1;
}

/**
 * A colour with an alpha attached, or without one when it is fully opaque.
 *
 * Dropping the channel at 1 rather than writing "ff" keeps an untouched
 * palette looking the way it was typed — six digits, the way anybody would
 * write it down or paste it somewhere else.
 */
export function withAlpha(value: string, alpha: number): string {
  const base = colorBase(value);
  const clamped = Math.min(1, Math.max(0, alpha));
  if (clamped >= 1) return base;
  return `${base}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * Relative luminance, the WCAG definition — the same one the profile gradient
 * and the API's roomTheme.ts use. Kept in step with those on purpose: this
 * number decides which ladder a theme is painted into, and two sides
 * disagreeing about it is a room where the text matches the wall.
 */
export function luminance(hex: string): number {
  // Alpha dropped, same reasoning as the API's copy: this decides which ladder
  // a theme is painted into, and a translucent page has no honest luminance.
  const clean = hex.trim().replace("#", "").slice(0, 6);
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return 0;
  const channel = (byte: number) => {
    const v = byte / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((num >> 16) & 255) +
    0.7152 * channel((num >> 8) & 255) +
    0.0722 * channel(num & 255)
  );
}

/** How much of `text` the quieter steps keep when a theme names neither. */
const SOFT_FALLBACK_ALPHA = 0.72;
const MUTED_FALLBACK_ALPHA = 0.55;

/**
 * A spec with every slot filled, whatever arrived.
 *
 * The API fills these in too (see its roomTheme.ts, which is where the rule
 * belongs), so on a current deployment this changes nothing. It exists for the
 * two moments the client is on its own: a build newer than the API it is
 * talking to, and a theme read from a cache written before a slot existed.
 *
 * A missing text step becomes the text colour faded, which is both the
 * compatible answer and the right one — quiet text in the theme's own hue
 * rather than a grey that belongs to no theme at all.
 */
export function completeSpec(spec: RoomThemeSpec): RoomThemeSpec {
  const palette = spec.palette ?? DEFAULT_THEME_SPEC.palette;
  const text = isHexColor(palette.text) ? palette.text : DEFAULT_THEME_SPEC.palette.text;
  return {
    ...spec,
    palette: {
      ...DEFAULT_THEME_SPEC.palette,
      ...palette,
      textSoft: isHexColor(palette.textSoft)
        ? palette.textSoft
        : withAlpha(text, SOFT_FALLBACK_ALPHA),
      muted: isHexColor(palette.muted) ? palette.muted : withAlpha(text, MUTED_FALLBACK_ALPHA),
    },
  };
}

export function isDarkTheme(spec: RoomThemeSpec): boolean {
  return luminance(spec.palette.page) < 0.5;
}

/**
 * Which variables a palette is written into, per mode.
 *
 * These are not a design decision, they are a reading of the room's own
 * markup: in dark mode a page is `bg-black`, a card is `dark:bg-zinc-950` and
 * a divider is `dark:border-zinc-800`; in light mode the same three are
 * `bg-zinc-50`, `bg-white` and `border-zinc-200`. Anything not listed here is
 * a colour the theme deliberately does not own — the greens, reds and ambers
 * that mean something (recording, an error, a warning) keep meaning it.
 */
function tokensFor(input: RoomThemeSpec): Record<string, string> {
  // Completed here rather than trusted: this is the last stop before the
  // values become CSS, and `--color-zinc-400: undefined` is a room with
  // Tailwind's grey text on somebody's pink surface.
  const spec = completeSpec(input);
  const { palette } = spec;
  const dark = isDarkTheme(spec);
  // With a picture behind the room, the page itself has to get out of the
  // way: the room's outermost element paints the page token across the whole
  // viewport, and an opaque one would cover the image completely. It becomes
  // transparent and the picture is painted on <html> instead (see globals.css),
  // with the real colour kept in --room-page-solid for the dimming layer to
  // use — the image is darkened *towards the theme's own page colour* rather
  // than towards black, so a light theme with a photo stays a light theme.
  // The page token gets out of the way for anything painted *behind* the room
  // — a picture or a gradient. Both are drawn on <html> (see globals.css), and
  // an opaque page would cover them completely, because the room's outermost
  // element paints that token across the whole viewport.
  const page = spec.background || spec.gradient ? "transparent" : palette.page;
  const gradient = gradientCss(spec);
  const shared = {
    "--background": page,
    // Deliberately stripped of alpha: this is the colour painted *behind*
    // everything, and a translucent one would let the browser's own canvas
    // through — which is not a colour the theme chose.
    "--room-page-solid": colorBase(palette.page),
    "--foreground": palette.text,
    "--room-accent": spec.accent,
    "--room-accent-text": spec.accentText,
    ...(gradient ? { "--room-gradient": gradient } : {}),
  };
  // Whatever alpha the palette carries goes straight through: how much of what
  // is behind a panel shows through it is a decision the theme's author makes
  // per surface (see the opacity slider under every colour in the editor).
  //
  // This used to be two constants applied automatically whenever a theme had a
  // background picture, which was a guess made once for every theme ever
  // written — right for a dark photograph behind a dark room and wrong for
  // most other things.
  const surface = palette.surface;
  const raised = palette.raised;

  return dark
    ? {
        ...shared,
        "--color-black": page,
        "--color-zinc-950": surface,
        "--color-zinc-900": raised,
        "--color-zinc-800": palette.border,
        "--color-zinc-700": palette.input,
        // In dark mode this is both the body text *and* the fill of a primary
        // button whose label is `dark:text-zinc-950`. One value serves both:
        // text on a dark surface, and a button in that same colour with the
        // surface colour written on it.
        "--color-zinc-50": palette.text,
        "--color-zinc-100": palette.text,
        // The two quieter steps. Between them these are most of the words in a
        // room — `dark:text-zinc-300` and `dark:text-zinc-400` alone are 66 of
        // the room's text classes — and until now the theme did not own either,
        // so a coloured room kept Tailwind's greys and lost them against its
        // own surfaces.
        // 200 rides with the soft step because it is the primary button's
        // hover: the fill goes text → textSoft, which is a step quieter rather
        // than a different colour.
        "--color-zinc-200": palette.textSoft,
        "--color-zinc-300": palette.textSoft,
        "--color-zinc-400": palette.muted,
        "--color-zinc-500": palette.muted,
      }
    : {
        ...shared,
        "--color-zinc-50": page,
        "--color-white": surface,
        "--color-zinc-100": raised,
        "--color-zinc-200": palette.border,
        "--color-zinc-300": palette.input,
        // The mirror of the note above: in light mode these are the dark end,
        // used for body text and for the fill of a primary button labelled in
        // white.
        "--color-zinc-950": palette.text,
        "--color-zinc-900": palette.text,
        // And the mirror of the quiet steps. 800 rides with the soft one for
        // the same reason 200 does in dark mode: it is the primary button's
        // hover fill.
        "--color-zinc-800": palette.textSoft,
        "--color-zinc-700": palette.textSoft,
        "--color-zinc-600": palette.muted,
        "--color-zinc-500": palette.muted,
        "--color-zinc-400": palette.muted,
      };
}

/** Everything currently written by this module, so a change can be a diff. */
let appliedTokens: Record<string, string> = {};

/** The complete set of variables one theme wants on the document. */
function tokensWithBackground(spec: RoomThemeSpec): Record<string, string> {
  const tokens = tokensFor(spec);
  if (!spec.background) return tokens;
  return {
    ...tokens,
    "--room-background-image": `url("${spec.background.url}")`,
    "--room-background-blur": `${spec.background.blur}px`,
    "--room-background-dim": String(spec.background.dim),
  };
}

/**
 * Paints a theme onto the document, or strips one off with `null`.
 *
 * On the document element rather than on the room's own container, and that is
 * load-bearing: dialogs portal to `<body>` (see every ntpopups popup and the
 * profile card), so a theme scoped to the room would stop at the edge of every
 * one of them. There is one page in the app that shows a room, and while it is
 * open the theme *is* the page.
 *
 * Written with `important`, because `--color-black` carries an `!important` in
 * globals.css — a plain inline declaration loses to it no matter how specific
 * the element is, which would leave the page colour as the one thing a theme
 * could not change.
 *
 * A *diff* rather than a clear-and-rewrite, and that is a performance fix
 * rather than tidiness. These variables are read by essentially every element
 * on the page, so each one written invalidates the style of the whole document
 * — and clearing sixteen and setting sixteen back is thirty-two of those for a
 * change that usually moved one colour. Under a live preview, with a drag
 * firing several times a frame, that was the whole cost.
 */
export function applyRoomTheme(spec: RoomThemeSpec | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (!spec) {
    for (const token of Object.keys(appliedTokens)) root.style.removeProperty(token);
    appliedTokens = {};
    root.removeAttribute("data-room-theme");
    // Handing the mode back to whoever owns it — see lib/theme.ts, which is
    // the only other writer of this attribute.
    const chosen = root.getAttribute("data-room-theme-restore");
    if (chosen !== null) {
      root.setAttribute("data-theme", chosen);
      root.removeAttribute("data-room-theme-restore");
    }
    return;
  }

  // Remembered once, on the way in. Re-reading it on a later call would store
  // the theme's own mode as "what they had before".
  if (!root.hasAttribute("data-room-theme-restore")) {
    root.setAttribute("data-room-theme-restore", root.getAttribute("data-theme") ?? "");
  }

  const next = tokensWithBackground(spec);
  for (const token of Object.keys(appliedTokens)) {
    if (!(token in next)) root.style.removeProperty(token);
  }
  for (const [name, value] of Object.entries(next)) {
    if (appliedTokens[name] !== value) root.style.setProperty(name, value, "important");
  }
  appliedTokens = next;

  // A picture wins over a gradient: it is painted on top, `cover`, so one
  // underneath would never be seen. Saying which with one attribute keeps the
  // CSS from having to express a precedence it cannot see.
  const mark = spec.background ? "image" : spec.gradient ? "gradient" : "flat";
  if (root.getAttribute("data-room-theme") !== mark) root.setAttribute("data-room-theme", mark);
  const mode = isDarkTheme(spec) ? "dark" : "light";
  if (root.getAttribute("data-theme") !== mode) root.setAttribute("data-theme", mode);
}

// ─── Making it instant ────────────────────────────────────────────────────
//
// Putting a theme on used to take three round trips before a single colour
// moved: save the choice, re-read the account to learn the choice, then fetch
// the palette the choice names. Sequential, so a second of latency was three
// seconds of a room that had not changed.
//
// Two stores fix it, and both are the same idea — the browser already knows
// the answer, so it should stop asking:
//
//   the cache — every theme that has passed through this module is kept. A
//     person pressing "usar" is pressing it on a card they are looking at, so
//     the palette is already in hand and there is nothing to fetch.
//   the override — what this tab has just chosen to wear, before the account
//     has caught up. The account is still the truth; this is the half-second
//     before the truth arrives.
//
// Neither is allowed to be wrong for long. An edit empties the cache (see
// notifyThemeChanged below), and the override is dropped by whoever set it as
// soon as the account agrees.

const themeCache = new Map<string, RoomTheme>();

/** Files away everything a listing or a read turned up. */
export function rememberThemes(themes: RoomTheme[]): void {
  for (const theme of themes) themeCache.set(theme.id, theme);
}

export function getCachedTheme(id: string): RoomTheme | null {
  return themeCache.get(id) ?? null;
}

let wornOverride: string | null | undefined;
const wornListeners = new Set<() => void>();

/**
 * What this tab is wearing right now, ahead of the account.
 *
 * `undefined` means "nothing pending, ask the account". `null` is a real
 * answer and means "taking it off" — which is why this is three-valued and not
 * two.
 */
export function setWornOverride(id: string | null | undefined): void {
  if (wornOverride === id) return;
  wornOverride = id;
  for (const listener of wornListeners) listener();
}

export function getWornOverride(): string | null | undefined {
  return wornOverride;
}

export function getWornOverrideServer(): undefined {
  return undefined;
}

export function subscribeWornOverride(listener: () => void): () => void {
  wornListeners.add(listener);
  return () => wornListeners.delete(listener);
}

// ─── "A theme was edited" ─────────────────────────────────────────────────
//
// The room reads a theme once, on join, and holds on to it — which is right
// almost always: a palette does not change while somebody is in a call.
//
// It changes in exactly one case, and it is the case that matters most. Its
// author edits it, from inside the very room that is wearing it. Without this
// signal the editor closes, the preview drops, and useRoomTheme repaints from
// the copy it fetched on join — so the room goes back to the *old* version and
// the save looks like it did nothing.
//
// A counter rather than the new spec: what changed is "the row behind this id
// is not what you have", and the answer is to ask again. Pushing the palette
// through here would be a second way for a theme to arrive, and the two would
// eventually disagree about which is current.

let themeSeq = 0;
const themeListeners = new Set<() => void>();

/** Says that some theme's contents changed. Called after a save or a delete. */
export function notifyThemeChanged(): void {
  themeSeq += 1;
  // Emptied rather than patched: the edit that just landed may have been to
  // any theme, and a cache that keeps one stale entry is worse than one that
  // costs a few requests to refill.
  themeCache.clear();
  for (const listener of themeListeners) listener();
}

export function getThemeSeq(): number {
  return themeSeq;
}

export function subscribeThemeChanged(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

// ─── "Never the room's theme" ─────────────────────────────────────────────
//
// A room theme is put on by somebody else and lands on everybody in the room,
// which is the point of it and also the reason this exists: a look chosen for
// a group is still a look somebody did not choose, and a person who finds it
// unreadable — or simply cannot stand it — needs a way out that does not
// involve leaving the room.
//
// Per browser rather than per account, and that is deliberate. It is a
// *viewing* preference, in the same family as muting notifications and picking
// light or dark: it belongs to the screen somebody is looking at, not to the
// identity behind it. Somebody who tolerates room themes on a big monitor and
// not on a phone is expressing two true things, not contradicting themselves.

const ROOM_THEME_OPT_OUT_KEY = "sharescreen:room-theme-opt-out";

let optedOut: boolean | null = null;
const optOutListeners = new Set<() => void>();

function readOptOut(): boolean {
  if (optedOut !== null) return optedOut;
  try {
    optedOut = window.localStorage.getItem(ROOM_THEME_OPT_OUT_KEY) === "1";
  } catch {
    // Private mode, or storage the browser refused. The permissive answer is
    // the right default: room themes are the feature, this is the escape.
    optedOut = false;
  }
  return optedOut;
}

/** Whether this browser refuses room themes. */
export function isRoomThemeOptedOut(): boolean {
  if (typeof window === "undefined") return false;
  return readOptOut();
}

/** The server has no browser, and therefore no preference. */
export function isRoomThemeOptedOutServer(): boolean {
  return false;
}

export function setRoomThemeOptedOut(next: boolean): void {
  optedOut = next;
  try {
    if (next) window.localStorage.setItem(ROOM_THEME_OPT_OUT_KEY, "1");
    else window.localStorage.removeItem(ROOM_THEME_OPT_OUT_KEY);
  } catch {
    // Kept in memory for this visit either way — a preference that cannot be
    // written is still a preference for as long as the tab is open.
  }
  for (const listener of optOutListeners) listener();
}

export function subscribeRoomThemeOptOut(listener: () => void): () => void {
  optOutListeners.add(listener);
  return () => optOutListeners.delete(listener);
}

// ─── The live preview ─────────────────────────────────────────────────────
//
// The editor opens *inside a room* (see RoomAccountCard, where it sits beside
// the cosmetics shop), and the whole reason it lives there is that a palette
// cannot be judged on a swatch. Every keystroke repaints the room behind the
// dialog — the real chat, the real dock, the real video tiles.
//
// The preview paints *here*, directly, and only tells React whether it is on.
//
// That split is the whole point and it was learned the hard way. The obvious
// version publishes the spec through the store and lets useRoomTheme apply it
// — but useRoomTheme is called from inside WatchRoom, so every tick of a drag
// re-rendered a six-thousand-line component with video tiles in it. Dragging a
// colour was re-rendering the entire room several times a frame.
//
// So the listeners are told about the *boolean* only, which flips twice in a
// whole editing session. The colours themselves never go through React while
// the picker is being dragged: they are written straight to the document, at
// most once per frame.
//
// useRoomTheme is still the owner of what the room wears — it simply stands
// aside while a preview is up and repaints on its own the moment one ends,
// which is what makes cancelling restore correctly without the editor knowing
// what was there before.

let previewSpec: RoomThemeSpec | null = null;
let previewFrame: number | null = null;
const previewListeners = new Set<() => void>();

/** Shows `spec` in place of the room's real theme, or `null` to stop. */
export function setThemePreview(spec: RoomThemeSpec | null): void {
  const wasActive = previewSpec !== null;
  previewSpec = spec;

  if (spec) {
    // Coalesced to one paint per frame. A colour picker being dragged fires
    // faster than the screen refreshes, and every extra write is a style
    // invalidation of the whole document for a colour nobody ever saw.
    if (previewFrame === null) {
      previewFrame = requestAnimationFrame(() => {
        previewFrame = null;
        if (previewSpec) applyRoomTheme(previewSpec);
      });
    }
  } else if (previewFrame !== null) {
    // A frame still queued when the preview ends would repaint the room with
    // the abandoned colours a tick after it was put back.
    cancelAnimationFrame(previewFrame);
    previewFrame = null;
  }

  // Only when it actually started or stopped. Firing on every colour is what
  // dragged WatchRoom through a re-render per pointer move.
  if ((spec !== null) !== wasActive) {
    for (const listener of previewListeners) listener();
  }
}

export function subscribeThemePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

/** Whether the editor is showing something right now. */
export function isThemePreviewActive(): boolean {
  return previewSpec !== null;
}

/** No preview on the server, and nothing to draw one on. */
export function isThemePreviewActiveServer(): boolean {
  return false;
}

// ─── The API ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type WorkshopSort = "popular" | "liked" | "recent";

/** The workshop grid. No account needed — it is a shop window. */
export async function fetchWorkshop(
  sort: WorkshopSort,
  signal?: AbortSignal
): Promise<RoomTheme[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/workshop?sort=${sort}`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { themes?: RoomTheme[] };
    const themes = Array.isArray(data.themes) ? data.themes : [];
    rememberThemes(themes);
    return themes;
  } catch {
    return [];
  }
}

/** Everything this account made, published or not. */
export async function fetchMyThemes(signal?: AbortSignal): Promise<RoomTheme[]> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/mine`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { themes?: RoomTheme[] };
    const themes = Array.isArray(data.themes) ? data.themes : [];
    rememberThemes(themes);
    return themes;
  } catch {
    return [];
  }
}

// Making a theme happens in a room.
//
// The editor previews onto whatever is behind it — the real chat, the real
// dock, the real video tiles — which is the only way to judge a colour. On the
// themes page there is nothing behind it but the themes page, so "Criar tema"
// there used to open an editor previewing onto a grid the theme will never be
// worn on. This is the fix: the button takes you into a room first, and the
// editor opens once you are in it.
//
// An ordinary private room, deliberately. It is not a sandbox or a special
// mode — it can be shared, people can join it, it shows up in the recent list
// like any other. The name is only so its address says what it is for.

/**
 * How the room is told to open the editor.
 *
 * A query parameter rather than anything held in this tab, because what
 * happens in between is a full navigation into a page that mounts from
 * scratch. The room reads it and then takes it back out of the address bar
 * (see WatchRoom), so the link somebody copies out of that bar afterwards is
 * the plain room.
 */
export const THEME_EDITOR_PARAM = "theme";
const THEME_EDITOR_VALUE = "create";

/** A brand new theme-creation room, with the editor asked for. */
export function themeCreationRoomLink(): string {
  const handle = toPrivateRoomHandle(THEME_CREATION_ROOM_NAME, generateRoomCode());
  return `/watch/${handle}?${THEME_EDITOR_PARAM}=${THEME_EDITOR_VALUE}`;
}

/** Whether this address bar is asking for the editor. */
export function wantsThemeEditor(search: string): boolean {
  return new URLSearchParams(search).get(THEME_EDITOR_PARAM) === THEME_EDITOR_VALUE;
}

// Looking at a theme happens in a room too, for the same reason making one
// does: a palette is judged against the chat and the tiles it will be worn on,
// not against a rectangle on a product page.
//
// The id rides in the address and is *left* there, unlike the editor's. That
// is the difference between the two: the editor is a one-off action, whereas
// this room is about the theme for as long as it is open — a refresh should
// still show it, and a friend handed the link should see what you are seeing.

/** A brand new room for looking at one theme. */
export function themeViewRoomLink(themeId: string): string {
  const handle = toPrivateRoomHandle(THEME_VIEW_ROOM_NAME, generateRoomCode());
  return `/watch/${handle}?${THEME_VIEW_PARAM}=${encodeURIComponent(themeId)}`;
}


/**
 * A theme's own page — the address a share button hands over.
 *
 * Absolute, and read off the browser rather than built from a constant: this
 * is a link somebody is about to paste somewhere else, so it has to carry the
 * host they are actually on. Falls back to the path alone on the server, where
 * there is no host to read and no clipboard to copy to.
 */
export function themeLink(id: string): string {
  const path = `/theme/${encodeURIComponent(id)}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/**
 * One theme, by id.
 *
 * The read a room does on join, and the reason an edit reaches everybody: the
 * room and the account both store an *id*, so this is where the current
 * palette comes from every single time.
 */
export async function fetchTheme(id: string, signal?: AbortSignal): Promise<RoomTheme | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { theme?: RoomTheme };
    if (data.theme) rememberThemes([data.theme]);
    return data.theme ?? null;
  } catch {
    return null;
  }
}

export type SaveThemeInput = {
  name: string;
  description: string;
  spec: RoomThemeSpec;
  published: boolean;
  /**
   * In points. Zero, or between MIN_THEME_PRICE and MAX_THEME_PRICE — the
   * server clamps rather than refuses, so a number outside the band comes back
   * snapped into it instead of losing the whole save.
   */
  price?: number;
  /**
   * A new background, as a `data:` URL. Absent means "keep whatever is on the
   * row" — the server never accepts a URL, so this is the only way a picture
   * gets in (see the API's themeRoutes).
   */
  backgroundImage?: string;
};

export type SaveThemeResult =
  | { ok: true; theme: RoomTheme }
  | { ok: false; error: string };

async function saveRequest(url: string, method: string, input: SaveThemeInput) {
  const res = await fetch(url, {
    method,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { theme?: RoomTheme; error?: string };
  if (!res.ok || !data.theme) {
    return { ok: false as const, error: data.error ?? translate("roomThemes.couldNotSaveTheTheme") };
  }
  return { ok: true as const, theme: data.theme };
}

export async function createTheme(input: SaveThemeInput): Promise<SaveThemeResult> {
  try {
    return await saveRequest(`${getSignalingHttpBase()}/themes`, "POST", input);
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export async function updateTheme(id: string, input: SaveThemeInput): Promise<SaveThemeResult> {
  try {
    return await saveRequest(
      `${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}`,
      "PATCH",
      input
    );
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export async function deleteTheme(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Toggles a heart. Answers with the count so the card can settle on truth. */
export async function likeTheme(
  id: string,
  liked: boolean
): Promise<{ liked: boolean; likes: number } | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}/like`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ liked }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { liked: boolean; likes: number };
  } catch {
    return null;
  }
}

/** Wears one, or takes it off with `null`. */
export async function applyTheme(themeId: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/apply`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ themeId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type BuyThemeResult = { ok: true } | { ok: false; error: string };

/**
 * Buys a paid theme with points.
 *
 * Nothing about the money travels in this call — not the price, not the
 * author's cut. Both are read from the row by the server (see its
 * /themes/:id/buy), so there is no shape of this request that changes what
 * somebody is charged.
 */
export async function buyTheme(id: string): Promise<BuyThemeResult> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/themes/${encodeURIComponent(id)}/buy`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? translate("roomThemes.couldNotBuyRightNow") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}
