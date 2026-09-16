// The outline somebody's picture is drawn in — a circle, or a rounded square
// for Pro Ultra (see entitlements' avatar_shape).
//
// The shape arrives *inside the avatar URL*, as `#shape=square`: the API adds
// it when it publishes an account (see its avatarShape.ts for why), so every
// payload that already carried a face carries its shape with no new field.
// That makes this file the whole client side of the feature — anything that
// draws a face asks avatarShapeClass(url) for its rounding instead of writing
// `rounded-full`, and a ring or a highlight hugging the face asks the same.
//
// A fragment never reaches a server, so the URL still loads as it is.

export const AVATAR_SHAPES = ["circle", "square"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

const FRAGMENT_PREFIX = "#shape=";

/** The shape a published avatar URL asks for. A missing or unknown one is a circle. */
export function avatarShapeOf(url: string | null | undefined): AvatarShape {
  if (!url) return "circle";
  const at = url.indexOf(FRAGMENT_PREFIX);
  if (at === -1) return "circle";
  const shape = url.slice(at + FRAGMENT_PREFIX.length);
  return (AVATAR_SHAPES as readonly string[]).includes(shape) ? (shape as AvatarShape) : "circle";
}

/**
 * The URL without the shape — what to compare against a preset path, and
 * what a picker should treat as "the picture".
 */
export function stripAvatarShape(url: string): string {
  const at = url.indexOf(FRAGMENT_PREFIX);
  return at === -1 ? url : url.slice(0, at);
}

/** The URL as the API would publish it, for previewing a choice before it is saved. */
export function withAvatarShape(url: string, shape: AvatarShape): string {
  const bare = stripAvatarShape(url);
  return shape === "circle" ? bare : `${bare}${FRAGMENT_PREFIX}${shape}`;
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
