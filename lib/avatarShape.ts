// What rides along with a profile picture: the outline it is drawn in (a
// circle, or a rounded square for Pro Ultra) and the decoration around it (a
// frame from the cosmetics catalog — see components/AvatarDecoration).
//
// Both arrive *inside the avatar URL*, as a fragment the API adds when it
// publishes an account (see its avatarShape.ts for why):
//
//     https://cdn.example/a.webp#shape=square&deco=%2Fassets%2Fdecorations%2Fx.svg
//
// so every payload that already carried a face carries its look with no new
// field. That makes this file the whole client side of it — anything that
// draws a face asks avatarShapeClass(url) for its rounding instead of writing
// `rounded-full`, and UserAvatar draws the decoration.
//
// An account with a decoration but no picture publishes the default face with
// `none=1`: "this is the default, not a choice". stripAvatarShape gives back
// the default path for it, which is what a picker should show as selected.
//
// A fragment never reaches a server, so the URL still loads as it is.

export const AVATAR_SHAPES = ["circle", "square"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

/** The first free default (same as UserAvatar's DEFAULT_AVATAR_PATH). */
const DEFAULT_FACE = "/assets/default_avatars/01.png";

/** A decoration is a picture the site itself serves; nothing else is ever drawn. */
// A picture the site serves (the first frames, in public/assets/decorations),
// or one uploaded from the admin page to the CDN (see the API's
// adminCosmeticRoutes.ts). Only those two places, never any other host.
const DECORATION_PATH =
  /^(?:\/assets\/decorations\/[a-z0-9_-]+|https:\/\/(?:blob\.squarecloud\.dev|public-blob\.squarecloud\.dev|cdn\.nemtudo\.me)\/(?!.*\.\.)[A-Za-z0-9_\-./]+)\.(svg|png|webp|gif)$/;

const FRAGMENT_KEYS = ["#shape=", "#deco=", "#none="];

function fragmentStart(url: string): number {
  let at = -1;
  for (const key of FRAGMENT_KEYS) {
    const i = url.indexOf(key);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  return at;
}

function fragmentOf(url: string | null | undefined): URLSearchParams | null {
  if (!url) return null;
  const at = fragmentStart(url);
  return at === -1 ? null : new URLSearchParams(url.slice(at + 1));
}

export function isAvatarDecorationPath(value: unknown): value is string {
  return typeof value === "string" && DECORATION_PATH.test(value);
}

/** The shape a published avatar URL asks for. A missing or unknown one is a circle. */
export function avatarShapeOf(url: string | null | undefined): AvatarShape {
  const shape = fragmentOf(url)?.get("shape");
  return shape && (AVATAR_SHAPES as readonly string[]).includes(shape) ? (shape as AvatarShape) : "circle";
}

/** The decoration a published avatar URL carries, or null. */
export function avatarDecorationOf(url: string | null | undefined): string | null {
  const deco = fragmentOf(url)?.get("deco");
  return isAvatarDecorationPath(deco) ? deco : null;
}

/** True when the URL is the default face a decorated account without a picture publishes. */
export function isDefaultFace(url: string | null | undefined): boolean {
  return fragmentOf(url)?.get("none") === "1";
}

/**
 * The URL without the fragment — what to compare against a preset path, and
 * what a picker should treat as "the picture". The published default face
 * gives back the default preset's path.
 */
export function stripAvatarShape(url: string): string {
  const at = fragmentStart(url);
  if (at === -1) return url;
  return isDefaultFace(url) ? DEFAULT_FACE : url.slice(0, at);
}

/** The picture to load for a published URL (the site's own default for `none=1`). */
export function avatarImageOf(url: string | null | undefined): string | null {
  if (!url) return null;
  return stripAvatarShape(url);
}

function build(url: string, shape: AvatarShape, decoration: string | null, none: boolean): string {
  const bare = stripAvatarShape(url);
  const parts: string[] = [];
  if (shape !== "circle" && !none) parts.push(`shape=${shape}`);
  if (decoration && isAvatarDecorationPath(decoration)) parts.push(`deco=${encodeURIComponent(decoration)}`);
  if (none && parts.length) parts.push("none=1");
  return parts.length ? `${bare}#${parts.join("&")}` : bare;
}

/** The URL as the API would publish it with this shape, for previewing a choice before it is saved. */
export function withAvatarShape(url: string, shape: AvatarShape): string {
  return build(url, shape, avatarDecorationOf(url), isDefaultFace(url));
}

/**
 * The face wearing a decoration (or none), for previewing one before it is
 * equipped — the shop, the anniversary gift. A null face is the default one.
 */
export function withAvatarDecoration(url: string | null | undefined, decoration: string | null): string {
  if (!url) return build(DEFAULT_FACE, "circle", decoration, true);
  return build(url, avatarShapeOf(url), decoration, isDefaultFace(url));
}

/**
 * The Tailwind rounding for a shape. A percentage rather than a fixed radius
 * so the square reads the same at 18px in a sidebar and at 112px on the
 * profile card.
 */
export function shapeRoundingClass(shape: AvatarShape): string {
  return shape === "square" ? "rounded-[18%]" : "rounded-full";
}

/** shapeRoundingClass, straight from a published avatar URL. */
export function avatarShapeClass(url: string | null | undefined): string {
  return shapeRoundingClass(avatarShapeOf(url));
}
