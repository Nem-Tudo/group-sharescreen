// The free avatars somebody puts together themselves: background, skin, hair
// and the rest, drawn in the same flat style as the two default pictures.
//
// A built avatar is not an upload. It is a short code, one character per
// choice, and it travels the way a preset does:
//
//     /avatar/0021000000000.png
//
// That path is what gets stored as avatarUrl, so every place that draws a face
// is still one <img src> that never learns this exists (see the API's
// avatarCatalog). app/avatar/[code]/route.ts answers it with the drawing below,
// and because the code is the whole picture, the answer never changes.
//
// The rules that keep old codes meaning the same picture:
//
//   - A slot's position in the code is permanent: new slots go at the end.
//   - A list of options only ever grows at the end, because a stored code holds
//     an index into it. Recolouring or redrawing an option changes the face of
//     everybody wearing it.
//   - Adding an option or a slot needs the same change in the API's
//     GENERATED_AVATAR_SLOTS, or the save is refused.
//
// No imports and no browser or Node APIs: the route, the editor and the tests
// all run this same file.

type Paint = string | readonly [string, string];

const BACKGROUNDS: readonly Paint[] = [
  "#0b6bf2",
  "#ff9ec7",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#18181b",
  "#52525b",
  "#e4e4e7",
  "#fef3c7",
  ["#6366f1", "#ec4899"],
  ["#f97316", "#facc15"],
  ["#06b6d4", "#3b82f6"],
  ["#22c55e", "#14b8a6"],
  ["#312e81", "#0f172a"],
  ["#fb7185", "#fbbf24"],
];

const SKINS = [
  "#fde3cf",
  "#f7c9a4",
  "#f4b78c",
  "#dc9a6c",
  "#c68450",
  "#a0663c",
  "#7c4a2a",
  "#54321e",
  "#8fd3a5",
  "#9db9f2",
] as const;

const HAIR_COLORS = [
  "#1c1512",
  "#3b2417",
  "#6b4226",
  "#a0693a",
  "#d9a95b",
  "#e8d3a0",
  "#b5402b",
  "#9aa0a6",
  "#f4f4f5",
  "#ec4899",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
] as const;

const EYE_COLORS = ["#3a2418", "#6b4226", "#2f7a4b", "#2f6fb3", "#7d858f", "#7c3aed"] as const;

const OUTFIT_COLORS = [
  "#1c1c22",
  "#f4f4f5",
  "#6b7280",
  "#dc2626",
  "#ea580c",
  "#facc15",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#1e3a8a",
  "#7c3aed",
  "#db2777",
] as const;

/** The choices, in code order. See the rules at the top before changing this. */
export const AVATAR_SLOTS = [
  { key: "gender", count: 2, kind: "shape" },
  { key: "background", count: BACKGROUNDS.length, kind: "color" },
  { key: "skin", count: SKINS.length, kind: "color" },
  { key: "hair", count: 12, kind: "shape" },
  { key: "hairColor", count: HAIR_COLORS.length, kind: "color" },
  { key: "eyes", count: EYE_COLORS.length, kind: "color" },
  { key: "mouth", count: 4, kind: "shape" },
  { key: "facialHair", count: 5, kind: "shape" },
  { key: "eyewear", count: 4, kind: "shape" },
  { key: "headwear", count: 4, kind: "shape" },
  { key: "earrings", count: 3, kind: "shape" },
  { key: "outfit", count: 3, kind: "shape" },
  { key: "outfitColor", count: OUTFIT_COLORS.length, kind: "color" },
] as const;

export type AvatarSlotKey = (typeof AVATAR_SLOTS)[number]["key"];
export type AvatarConfig = Record<AvatarSlotKey, number>;

/** The closest thing to the first default picture, which is where editing starts. */
export const DEFAULT_AVATAR_CONFIG: AvatarConfig = {
  gender: 0,
  background: 0,
  skin: 2,
  hair: 1,
  hairColor: 0,
  eyes: 0,
  mouth: 0,
  facialHair: 0,
  eyewear: 0,
  headwear: 0,
  earrings: 0,
  outfit: 0,
  outfitColor: 0,
};

/** The color a swatch shows for an option, as a CSS background. */
export function avatarOptionSwatch(key: AvatarSlotKey, index: number): string {
  if (key === "background") {
    const paint = BACKGROUNDS[index];
    return typeof paint === "string" ? paint : `linear-gradient(135deg, ${paint[0]}, ${paint[1]})`;
  }
  if (key === "skin") return SKINS[index];
  if (key === "hairColor") return HAIR_COLORS[index];
  if (key === "eyes") return EYE_COLORS[index];
  if (key === "outfitColor") return OUTFIT_COLORS[index];
  return "transparent";
}

// ---------------------------------------------------------------------------
// The code

const CODE_RADIX = 36;
const CODE_PATTERN = /^[0-9a-z]+$/;
const PATH_PATTERN = /^\/avatar\/([0-9a-z]+)\.png$/;

export function encodeAvatarCode(config: AvatarConfig): string {
  return AVATAR_SLOTS.map((slot) => config[slot.key].toString(CODE_RADIX)).join("");
}

/**
 * The choices in a code, or null when it is not one. A code shorter than the
 * list is fine, since slots are only ever added at the end: what it does not
 * mention stays at the default.
 */
export function decodeAvatarCode(code: string): AvatarConfig | null {
  // Checked up front because parseInt also takes capitals, and one picture
  // must have one address: the code is what it is cached under.
  if (!CODE_PATTERN.test(code) || code.length > AVATAR_SLOTS.length) return null;
  const config: AvatarConfig = { ...DEFAULT_AVATAR_CONFIG };
  for (let i = 0; i < code.length; i += 1) {
    const value = parseInt(code[i], CODE_RADIX);
    const slot = AVATAR_SLOTS[i];
    if (value >= slot.count) return null;
    config[slot.key] = value;
  }
  return config;
}

export function avatarPathFor(config: AvatarConfig): string {
  return `/avatar/${encodeAvatarCode(config)}.png`;
}

/** The choices behind a stored avatar, or null when it is any other picture. */
export function avatarConfigFromPath(path: string | null | undefined): AvatarConfig | null {
  const match = path ? PATH_PATTERN.exec(path) : null;
  return match ? decodeAvatarCode(match[1]) : null;
}

/** A whole random avatar. `random` is injectable so the tests can pin it. */
export function randomAvatarConfig(random: () => number = Math.random): AvatarConfig {
  const pick = (count: number) => Math.floor(random() * count);
  const config = { ...DEFAULT_AVATAR_CONFIG };
  for (const slot of AVATAR_SLOTS) config[slot.key] = pick(slot.count);
  // Each of these is drawn on top of the plain face, so an even split would
  // put most random faces under a pile of accessories. Everyday hair and skin
  // too: the fantasy colours are there to be picked, not to be the usual roll.
  if (random() < 0.7) config.eyewear = 0;
  if (random() < 0.7) config.headwear = 0;
  if (random() < 0.6) config.earrings = 0;
  if (config.gender === 1 || random() < 0.5) config.facialHair = 0;
  if (random() < 0.85) config.skin = pick(8);
  if (random() < 0.85) config.hairColor = pick(9);
  return config;
}

// ---------------------------------------------------------------------------
// The drawing

function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const blended = [1, 3, 5].map((at) =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount)
      .toString(16)
      .padStart(2, "0")
  );
  return `#${blended.join("")}`;
}

const INK = "#1b1210";

const HEAD_SCALE = "translate(256 300) scale(1.1) translate(-256 -300)";

/** The drawing is on a 512 square, centered on this x, like the default pictures. */
const CX = 256;

function mirror(content: string): string {
  return `<g transform="matrix(-1 0 0 1 ${CX * 2} 0)">${content}</g>`;
}

function both(content: string): string {
  return content + mirror(content);
}

function backgroundOf(paint: Paint): string {
  if (typeof paint === "string") return `<rect width="512" height="512" fill="${paint}"/>`;
  return (
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${paint[0]}"/><stop offset="1" stop-color="${paint[1]}"/>` +
    `</linearGradient></defs><rect width="512" height="512" fill="url(#bg)"/>`
  );
}

function bodyOf(config: AvatarConfig, skin: string, skinShade: string): string {
  const feminine = config.gender === 1;
  const color = OUTFIT_COLORS[config.outfitColor];
  const shade = mix(color, "#000000", 0.2);
  const line = mix(color, color === OUTFIT_COLORS[0] ? "#ffffff" : "#000000", 0.14);

  const neckHalf = feminine ? 42 : 56;
  const base = neckHalf + 18;
  const collarTop = feminine ? 402 : 398;
  const collarBottom = collarTop + 44;
  const neck =
    `<path fill="${skin}" d="M${CX - neckHalf} 300V${collarTop - 34}C${CX - neckHalf} ${collarTop - 12} ${CX - base} ${collarTop - 8} ${CX - base - 10} ${collarTop + 4}V470H${CX + base + 10}V${collarTop + 4}C${CX + base} ${collarTop - 8} ${CX + neckHalf} ${collarTop - 12} ${CX + neckHalf} ${collarTop - 34}V300Z"/>` +
    // The shadow the chin throws down the neck.
    `<path fill="${skinShade}" d="M${CX - neckHalf} 340C${CX - neckHalf + 14} 404 ${CX + neckHalf - 14} 404 ${CX + neckHalf} 340V300H${CX - neckHalf}Z"/>`;

  // The neckline is cut into the shirt itself, so the neck shows through it.
  const neckline = `C${CX - 48} ${collarBottom} ${CX + 48} ${collarBottom} ${CX + base} ${collarTop}`;
  const shoulders = feminine
    ? `M18 512C22 466 66 440 124 426C156 418 176 414 ${CX - base} ${collarTop}${neckline}C336 414 356 418 388 426C446 440 490 466 494 512Z`
    : `M-6 512C0 460 52 434 112 418C146 408 170 406 ${CX - base} ${collarTop}${neckline}C342 406 366 408 400 418C460 434 512 460 518 512Z`;

  let outfit = `<path fill="${color}" d="${shoulders}"/>`;
  outfit += `<path fill="none" stroke="${line}" stroke-width="7" stroke-linecap="round" d="M${CX - base} ${collarTop}${neckline}"/>`;

  if (config.outfit === 1) {
    // A hoodie: the hood bunched around the neck and two cords hanging in front.
    const hoodHalf = base + 34;
    outfit =
      outfit +
      `<path fill="${shade}" d="M${CX - hoodHalf} ${collarTop + 14}C${CX - hoodHalf + 4} ${collarTop - 28} ${CX - base} ${collarTop - 34} ${CX - base + 4} ${collarTop - 20}C${CX - base + 8} ${collarBottom - 26} ${CX - 30} ${collarBottom + 2} ${CX} ${collarBottom + 2}C${CX + 30} ${collarBottom + 2} ${CX + base - 8} ${collarBottom - 26} ${CX + base - 4} ${collarTop - 20}C${CX + base} ${collarTop - 34} ${CX + hoodHalf - 4} ${collarTop - 28} ${CX + hoodHalf} ${collarTop + 14}C${CX + hoodHalf - 10} ${collarBottom + 30} ${CX + 40} ${collarBottom + 34} ${CX} ${collarBottom + 34}C${CX - 40} ${collarBottom + 34} ${CX - hoodHalf + 10} ${collarBottom + 30} ${CX - hoodHalf} ${collarTop + 14}Z"/>` +
      `<path fill="none" stroke="#f4f4f5" stroke-width="5" stroke-linecap="round" d="M${CX - 22} ${collarBottom + 22}V${collarBottom + 62}M${CX + 22} ${collarBottom + 22}V${collarBottom + 52}"/>`;
  } else if (config.outfit === 2) {
    // A collared shirt, buttoned up, with the collar's two flaps on top.
    const collar = mix(color, "#ffffff", color === OUTFIT_COLORS[1] ? 0 : 0.14);
    outfit +=
      `<path stroke="${line}" stroke-width="4" d="M${CX} ${collarBottom - 6}V512"/>` +
      `<circle cx="${CX + 10}" cy="${collarBottom + 26}" r="4" fill="${line}"/>` +
      `<path fill="${collar}" stroke="${line}" stroke-width="3" stroke-linejoin="round" d="M${CX - base - 2} ${collarTop - 6}L${CX} ${collarBottom - 8}L${CX - 30} ${collarBottom + 22}L${CX - base - 24} ${collarTop + 22}Z"/>` +
      `<path fill="${collar}" stroke="${line}" stroke-width="3" stroke-linejoin="round" d="M${CX + base + 2} ${collarTop - 6}L${CX} ${collarBottom - 8}L${CX + 30} ${collarBottom + 22}L${CX + base + 24} ${collarTop + 22}Z"/>`;
  }
  return neck + outfit;
}

/** Long styles fall over the ears, which would otherwise poke through the gap. */
const HAIR_OVER_EARS: readonly number[] = [7, 8, 9];

const FACE_MASCULINE =
  "M172 226C172 134 340 134 340 226C340 276 332 306 306 334C288 354 272 364 256 364C240 364 224 354 206 334C180 306 172 276 172 226Z";
const FACE_FEMININE =
  "M178 226C178 138 334 138 334 226C334 270 324 300 300 330C284 350 270 362 256 362C242 362 228 350 212 330C188 300 178 270 178 226Z";

function faceOf(config: AvatarConfig, skin: string, skinShade: string): string {
  const feminine = config.gender === 1;
  const left = feminine ? 178 : 172;
  const ear =
    `<path fill="${skin}" d="M${left + 6} 226C${left - 14} 214 ${left - 26} 226 ${left - 22} 250C${left - 18} 272 ${left - 6} 286 ${left + 8} 278Z"/>` +
    `<path fill="${skinShade}" d="M${left - 2} 238C${left - 12} 232 ${left - 16} 240 ${left - 13} 252C${left - 11} 262 ${left - 6} 268 ${left} 264Z"/>`;
  const shape = feminine ? FACE_FEMININE : FACE_MASCULINE;
  // The only modelling on the face: the same outline a little smaller over a
  // darker one, which leaves a crescent of shade around the jaw.
  const edge = mix(skin, skinShade, 0.55);
  return (
    (HAIR_OVER_EARS.includes(config.hair) ? "" : both(ear)) +
    `<path fill="${edge}" d="${shape}"/>` +
    `<path fill="${skin}" transform="translate(${CX} 200) scale(.965 .955) translate(-${CX} -200)" d="${shape}"/>`
  );
}

function eyesOf(config: AvatarConfig, skin: string, skinShade: string, hair: string): string {
  const feminine = config.gender === 1;
  const iris = EYE_COLORS[config.eyes];
  const dx = 44;
  const y = 232;
  const brow = mix(hair, INK, 0.35);

  // Drawn at a nominal size and scaled, so the numbers below stay readable.
  const eye =
    `<g transform="translate(${CX - dx} ${y}) scale(1.22) translate(${dx - CX} -${y})">` +
    `<path fill="#fff" d="M${CX - dx - 21} ${y + 1}C${CX - dx - 11} ${y - 12} ${CX - dx + 11} ${y - 12} ${CX - dx + 21} ${y + 2}C${CX - dx + 10} ${y + 10} ${CX - dx - 11} ${y + 10} ${CX - dx - 21} ${y + 1}Z"/>` +
    `<circle cx="${CX - dx}" cy="${y - 1}" r="10.5" fill="${iris}"/>` +
    `<circle cx="${CX - dx}" cy="${y - 1}" r="5.5" fill="${INK}"/>` +
    `<circle cx="${CX - dx + 3.5}" cy="${y - 4.5}" r="2.6" fill="#fff"/>` +
    // The lid covers the top of the iris, which is what makes the eye look calm
    // rather than startled.
    `<path fill="${skin}" d="M${CX - dx - 24} ${y + 1}C${CX - dx - 12} ${y - 22} ${CX - dx + 12} ${y - 22} ${CX - dx + 24} ${y + 2}C${CX - dx + 11} ${y - 11} ${CX - dx - 11} ${y - 11} ${CX - dx - 24} ${y + 1}Z"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="${feminine ? 4.5 : 3.5}" stroke-linecap="round" d="M${CX - dx - 22} ${y + 1}C${CX - dx - 11} ${y - 12} ${CX - dx + 11} ${y - 12} ${CX - dx + 21} ${y + 2}"/>` +
    `<path fill="none" stroke="${skinShade}" stroke-width="2.5" stroke-linecap="round" d="M${CX - dx - 12} ${y + 10}C${CX - dx - 4} ${y + 13} ${CX - dx + 6} ${y + 13} ${CX - dx + 13} ${y + 9}"/>` +
    (feminine
      ? `<path fill="${INK}" d="M${CX - dx - 21} ${y + 2}L${CX - dx - 33} ${y - 8}L${CX - dx - 17} ${y - 4}Z"/>`
      : "") +
    `</g>`;
  const eyebrow = feminine
    ? `<path fill="${brow}" d="M${CX - dx - 32} ${y - 22}C${CX - dx - 18} ${y - 40} ${CX - dx + 8} ${y - 41} ${CX - dx + 28} ${y - 30}C${CX - dx + 8} ${y - 34} ${CX - dx - 14} ${y - 32} ${CX - dx - 32} ${y - 22}Z"/>`
    : `<path fill="${brow}" d="M${CX - dx - 34} ${y - 25}C${CX - dx - 18} ${y - 40} ${CX - dx + 12} ${y - 40} ${CX - dx + 30} ${y - 30}L${CX - dx + 29} ${y - 21}C${CX - dx + 10} ${y - 29} ${CX - dx - 14} ${y - 29} ${CX - dx - 34} ${y - 25}Z"/>`;
  return both(eye + eyebrow);
}

function noseOf(skinShade: string): string {
  return (
    `<path fill="none" stroke="${skinShade}" stroke-width="3.5" stroke-linecap="round" d="M${CX + 7} 254C${CX + 9} 266 ${CX + 13} 274 ${CX + 17} 281"/>` +
    `<path fill="${skinShade}" d="M${CX - 19} 283C${CX - 14} 294 ${CX - 5} 292 ${CX} 296C${CX + 5} 292 ${CX + 14} 294 ${CX + 19} 283C${CX + 14} 287 ${CX + 7} 286 ${CX} 287C${CX - 7} 286 ${CX - 14} 287 ${CX - 19} 283Z"/>`
  );
}

function mouthOf(config: AvatarConfig, skin: string, skinShade: string): string {
  const feminine = config.gender === 1;
  const lip = mix(skin, "#b3324c", feminine ? 0.55 : 0.28);
  const lipDark = mix(lip, INK, 0.28);
  const y = 318;
  switch (config.mouth) {
    case 1:
      // A closed smile.
      return (
        `<path fill="none" stroke="${lipDark}" stroke-width="5" stroke-linecap="round" d="M${CX - 32} ${y - 6}C${CX - 16} ${y + 12} ${CX + 16} ${y + 12} ${CX + 32} ${y - 6}"/>` +
        `<path fill="${feminine ? lip : skinShade}" d="M${CX - 16} ${y + 10}C${CX - 6} ${y + 18} ${CX + 6} ${y + 18} ${CX + 16} ${y + 10}C${CX + 6} ${y + 12} ${CX - 6} ${y + 12} ${CX - 16} ${y + 10}Z"/>`
      );
    case 2:
      // An open smile, teeth showing.
      return (
        `<path fill="${mix(lip, INK, 0.55)}" d="M${CX - 34} ${y - 8}C${CX - 18} ${y - 2} ${CX + 18} ${y - 2} ${CX + 34} ${y - 8}C${CX + 28} ${y + 22} ${CX + 12} ${y + 28} ${CX} ${y + 28}C${CX - 12} ${y + 28} ${CX - 28} ${y + 22} ${CX - 34} ${y - 8}Z"/>` +
        `<path fill="#fff" d="M${CX - 28} ${y - 5}C${CX - 14} ${y - 1} ${CX + 14} ${y - 1} ${CX + 28} ${y - 5}C${CX + 25} ${y + 6} ${CX + 12} ${y + 8} ${CX} ${y + 8}C${CX - 12} ${y + 8} ${CX - 25} ${y + 6} ${CX - 28} ${y - 5}Z"/>`
      );
    case 3:
      // A smirk, up on one side only.
      return `<path fill="none" stroke="${lipDark}" stroke-width="5" stroke-linecap="round" d="M${CX - 26} ${y + 2}C${CX - 8} ${y + 8} ${CX + 14} ${y + 6} ${CX + 32} ${y - 10}"/>`;
    default:
      // Resting: the two lips, as on the default pictures.
      return (
        `<path fill="${lip}" d="M${CX - 28} ${y}C${CX - 16} ${y - 6} ${CX - 7} ${y - 9} ${CX} ${y - 5}C${CX + 7} ${y - 9} ${CX + 16} ${y - 6} ${CX + 28} ${y}C${CX + 14} ${y + (feminine ? 16 : 12)} ${CX - 14} ${y + (feminine ? 16 : 12)} ${CX - 28} ${y}Z"/>` +
        `<path fill="none" stroke="${lipDark}" stroke-width="3" stroke-linecap="round" d="M${CX - 28} ${y}C${CX - 12} ${y + 2} ${CX + 12} ${y + 2} ${CX + 28} ${y}"/>`
      );
  }
}

function facialHairOf(config: AvatarConfig, hair: string): string {
  const shade = mix(hair, "#000000", 0.15);
  switch (config.facialHair) {
    case 1:
      // Stubble: the beard's shape, faint.
      return `<path fill="${hair}" opacity=".22" d="M178 268C186 306 214 346 256 366C298 346 326 306 334 268C326 290 312 300 296 298C282 294 268 296 256 296C244 296 230 294 216 298C200 300 186 290 178 268Z"/>`;
    case 2:
      // A moustache.
      return `<path fill="${shade}" d="M${CX} 300C${CX - 12} 296 ${CX - 30} 298 ${CX - 38} 314C${CX - 24} 310 ${CX - 12} 310 ${CX} 308C${CX + 12} 310 ${CX + 24} 310 ${CX + 38} 314C${CX + 30} 298 ${CX + 12} 296 ${CX} 300Z"/>`;
    case 3:
      // A goatee, with the moustache it goes with.
      return (
        `<path fill="${shade}" d="M${CX} 300C${CX - 12} 296 ${CX - 30} 298 ${CX - 38} 314C${CX - 24} 310 ${CX - 12} 310 ${CX} 308C${CX + 12} 310 ${CX + 24} 310 ${CX + 38} 314C${CX + 30} 298 ${CX + 12} 296 ${CX} 300Z"/>` +
        `<path fill="${shade}" d="M${CX - 20} 336C${CX - 10} 340 ${CX + 10} 340 ${CX + 20} 336C${CX + 26} 352 ${CX + 14} 372 ${CX} 374C${CX - 14} 372 ${CX - 26} 352 ${CX - 20} 336Z"/>`
      );
    case 4:
      // A full beard, leaving the mouth clear.
      return `<path fill="${shade}" fill-rule="evenodd" d="M172 250C176 312 204 366 256 378C308 366 336 312 340 250C334 276 322 292 300 292C284 292 270 294 256 294C242 294 228 292 212 292C190 292 178 276 172 250ZM${CX - 34} 318C${CX - 16} 308 ${CX + 16} 308 ${CX + 34} 318C${CX + 18} 338 ${CX - 18} 338 ${CX - 34} 318Z"/>`;
    default:
      return "";
  }
}

// Each style is what goes behind the head and what goes in front of it.
function hairOf(style: number, hair: string): { back: string; front: string } {
  const shade = mix(hair, "#000000", 0.22);
  const shine = mix(hair, "#ffffff", 0.14);
  const fill = (d: string, color = hair) => `<path fill="${color}" d="${d}"/>`;
  const strand = (d: string, color = shade, width = 4) =>
    `<path fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" d="${d}"/>`;

  switch (style) {
    case 1:
      // Short and messy, like the first default picture.
      return {
        back: fill(
          "M160 270C136 230 128 180 148 140C160 106 186 86 214 80C232 58 276 52 306 66C340 70 368 98 372 134C390 172 384 232 352 270Z",
          shade
        ),
        front:
          fill(
            "M164 244C152 214 146 176 164 146C176 118 200 104 224 100C246 84 282 84 306 96C334 104 354 126 354 152C368 182 362 216 348 244C344 218 336 200 322 186C316 196 304 200 296 196C298 188 296 180 288 174C272 192 244 200 214 196C222 190 226 184 226 178C208 186 190 200 180 220C174 228 170 236 164 244Z"
          ) +
          strand("M216 124C232 142 240 156 240 176", shade) +
          strand("M268 110C278 128 284 146 284 168", shade) +
          strand("M186 168C194 158 204 150 216 146", shine, 3),
      };
    case 2:
      // Buzzed: the skull's shape, close to the skin.
      return {
        back: "",
        front: `<path fill="${hair}" opacity=".78" d="M170 222C166 118 346 118 342 222C338 206 332 196 322 190C290 176 222 176 190 190C180 196 174 206 170 222Z"/>`,
      };
    case 3:
      // A tidy side part.
      return {
        back: fill(
          "M166 262C150 216 150 164 176 132C206 96 306 94 338 132C362 164 362 216 346 262Z",
          shade
        ),
        front:
          fill(
            "M168 246C160 210 158 170 180 140C208 104 304 102 332 140C354 170 352 210 344 246C340 220 334 204 322 194C286 198 238 188 214 168C200 180 180 200 176 222C174 230 172 238 168 246Z"
          ) +
          strand("M214 168C232 150 270 132 318 136", shade) +
          strand("M236 176C260 164 296 158 330 166", shine, 3),
      };
    case 4: {
      // Curls on top, short at the sides.
      const curls = [
        [176, 176, 26], [204, 142, 30], [244, 122, 32], [288, 126, 32], [322, 150, 30],
        [340, 184, 24], [226, 170, 24], [270, 166, 26], [306, 182, 22], [190, 204, 18], [326, 208, 16],
      ];
      return {
        back: fill("M168 258C150 212 158 170 186 150H326C354 170 362 212 344 258Z", shade),
        front: curls
          .map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 3 === 2 ? shade : hair}"/>`)
          .join(""),
      };
    }
    case 5: {
      // A big, round afro.
      const puffs = Array.from({ length: 22 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 22;
        const x = CX + Math.cos(angle) * 128;
        const y = 188 + Math.sin(angle) * 118;
        return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="28" fill="${hair}"/>`;
      }).join("");
      return {
        back: `<ellipse cx="${CX}" cy="188" rx="130" ry="120" fill="${hair}"/>${puffs}`,
        front: fill(
          "M172 222C166 180 180 150 214 140C240 132 272 132 298 140C332 150 346 180 340 222C332 192 310 176 286 172C266 168 246 168 226 172C202 176 180 192 172 222Z"
        ),
      };
    }
    case 6:
      // A mohawk over shaved sides.
      return {
        back: "",
        front:
          `<path fill="${hair}" opacity=".3" d="M172 222C168 122 344 122 340 222C334 196 322 184 306 178C274 170 238 170 206 178C190 184 178 196 172 222Z"/>` +
          fill(
            "M228 186C224 150 212 110 218 72C228 84 234 92 238 98C240 76 246 54 258 38C266 56 272 76 274 96C280 88 288 80 296 72C302 112 290 150 284 186C266 176 246 176 228 186Z"
          ),
      };
    case 7:
      // Long and straight, parted in the middle.
      return {
        back: fill(
          "M152 200C150 118 212 92 256 92C300 92 362 118 360 200C362 280 380 370 372 452C340 464 300 462 256 462C212 462 172 464 140 452C132 370 150 280 152 200Z",
          shade
        ),
        front:
          fill(
            "M256 112C204 110 170 146 166 204C162 260 160 300 150 346C144 372 150 400 170 420C192 372 186 320 186 270C186 240 196 214 214 192C232 172 248 150 256 112Z"
          ) +
          fill(
            "M256 112C308 110 342 146 346 204C350 260 352 300 362 346C368 372 362 400 342 420C320 372 326 320 326 270C326 240 316 214 298 192C280 172 264 150 256 112Z"
          ) +
          strand("M176 240C172 290 170 340 166 386", shade, 3) +
          strand("M336 240C340 290 342 340 346 386", shade, 3),
      };
    case 8:
      // Long and wavy, like the second default picture.
      return {
        back: fill(
          "M150 196C146 116 212 88 256 88C300 88 366 116 362 196C368 238 356 268 372 306C390 346 366 372 384 408C396 436 376 460 346 464C316 468 196 468 166 464C136 460 116 436 128 408C146 372 122 346 140 306C156 268 144 238 150 196Z",
          shade
        ),
        front:
          fill(
            "M256 108C208 104 170 138 162 196C156 238 166 268 150 306C136 338 152 362 138 396C132 416 144 432 160 436C182 396 174 362 182 326C190 290 184 262 190 234C196 210 212 196 226 174C240 154 252 134 256 108Z"
          ) +
          fill(
            "M256 108C304 104 342 138 350 196C356 238 346 268 362 306C376 338 360 362 374 396C380 416 368 432 352 436C330 396 338 362 330 326C322 290 328 262 322 234C316 210 300 196 286 174C272 154 260 134 256 108Z"
          ) +
          strand("M172 214C166 256 176 284 160 318C150 342 160 364 150 394", shine, 3) +
          strand("M340 214C346 256 336 284 352 318C362 342 352 364 362 394", shine, 3),
      };
    case 9:
      // A chin-length bob with a fringe.
      return {
        back: fill(
          "M146 214C138 118 208 88 256 88C304 88 374 118 366 214C368 270 372 320 356 366C330 376 300 372 256 372C212 372 182 376 156 366C140 320 144 270 146 214Z",
          shade
        ),
        front:
          fill(
            "M160 300C150 240 152 170 184 134C210 106 302 106 328 134C360 170 362 240 352 300C346 330 344 346 336 358C318 330 328 268 326 214C296 214 240 206 212 176C196 194 186 214 186 244C184 286 194 330 176 358C168 346 166 330 160 300Z"
          ) + strand("M212 176C230 198 284 208 326 208", shade, 3),
      };
    case 10:
      // A bun on top, the rest pulled back.
      return {
        back:
          `<circle cx="${CX}" cy="84" r="50" fill="${shade}"/>` +
          `<circle cx="${CX - 6}" cy="78" r="36" fill="${hair}"/>` +
          fill("M162 246C146 200 156 150 186 128C218 106 294 106 326 128C356 150 366 200 350 246Z", shade),
        front:
          fill(
            "M168 236C160 196 170 158 196 138C226 118 286 118 316 138C342 158 352 196 344 236C338 208 326 186 304 176C276 164 236 164 208 176C186 186 174 208 168 236Z"
          ) +
          strand("M256 126C246 138 240 150 238 164", shade, 3) +
          strand("M256 126C266 138 272 150 274 164", shade, 3),
      };
    case 11:
      // A ponytail falling behind one shoulder, with a side-swept fringe.
      return {
        back:
          fill(
            "M336 118C392 110 424 164 414 232C408 286 428 336 404 396C392 422 370 428 362 410C374 366 354 318 350 262C346 214 352 170 318 148Z",
            shade
          ) + fill("M160 252C146 204 154 150 186 124C220 102 292 102 326 124C358 150 366 204 352 252Z", shade),
        front: fill(
          "M166 240C158 200 164 156 194 134C224 114 288 114 318 134C348 156 354 200 346 240C340 214 330 196 316 186C276 200 226 192 200 168C188 186 174 206 166 240Z"
        ),
      };
    default:
      return { back: "", front: "" };
  }
}

function eyewearOf(config: AvatarConfig): string {
  const y = 232;
  const dx = 44;
  const arm = `<path fill="none" stroke="${INK}" stroke-width="5" d="M${CX - dx - 34} ${y - 6}L170 ${y - 12}"/>`;
  switch (config.eyewear) {
    case 1:
      return both(
        `<circle cx="${CX - dx}" cy="${y}" r="33" fill="#fff" fill-opacity=".12" stroke="${INK}" stroke-width="5"/>${arm}`
      ) + `<path fill="none" stroke="${INK}" stroke-width="5" d="M${CX - dx + 32} ${y - 7}C${CX - 4} ${y - 16} ${CX + 4} ${y - 16} ${CX + dx - 32} ${y - 7}"/>`;
    case 2:
      return both(
        `<rect x="${CX - dx - 35}" y="${y - 24}" width="70" height="46" rx="10" fill="#fff" fill-opacity=".12" stroke="${INK}" stroke-width="6"/>${arm}`
      ) + `<path stroke="${INK}" stroke-width="6" d="M${CX - dx + 35} ${y - 8}H${CX + dx - 35}"/>`;
    case 3:
      return both(
        `<path fill="#111114" stroke="${INK}" stroke-width="5" stroke-linejoin="round" d="M${CX - dx - 38} ${y - 22}H${CX - dx + 36}C${CX - dx + 38} ${y + 6} ${CX - dx + 22} ${y + 26} ${CX - dx} ${y + 26}C${CX - dx - 24} ${y + 26} ${CX - dx - 38} ${y + 4} ${CX - dx - 38} ${y - 22}Z"/>` +
          `<path fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" d="M${CX - dx - 22} ${y - 10}L${CX - dx - 6} ${y - 10}"/>${arm}`
      ) + `<path stroke="${INK}" stroke-width="6" d="M${CX - dx + 36} ${y - 16}H${CX + dx - 36}"/>`;
    default:
      return "";
  }
}

function earringsOf(config: AvatarConfig): string {
  const left = config.gender === 1 ? 178 : 172;
  const gold = "#f5c542";
  if (config.earrings === 1) {
    return both(
      `<circle cx="${left - 11}" cy="292" r="13" fill="none" stroke="${gold}" stroke-width="5"/>`
    );
  }
  if (config.earrings === 2) {
    return both(`<circle cx="${left - 11}" cy="282" r="6" fill="${gold}"/>`);
  }
  return "";
}

function headwearOf(config: AvatarConfig): string {
  const color = OUTFIT_COLORS[config.outfitColor];
  const shade = mix(color, "#000000", 0.22);
  const light = mix(color, "#ffffff", 0.18);
  switch (config.headwear) {
    case 1:
      // A beanie, with its folded brim.
      return (
        `<path fill="${color}" d="M160 188C150 92 362 92 352 188Z"/>` +
        `<rect x="150" y="166" width="212" height="44" rx="14" fill="${shade}"/>` +
        `<path fill="none" stroke="${light}" stroke-width="4" d="M190 172V204M226 172V204M262 172V204M298 172V204M334 172V204"/>`
      );
    case 2:
      // A cap, peak to the front.
      return (
        `<path fill="${color}" d="M164 186C156 92 356 92 348 186Z"/>` +
        `<path fill="${shade}" d="M152 192C180 168 332 168 360 192C364 206 354 212 344 208C290 192 222 192 168 208C158 212 148 206 152 192Z"/>` +
        `<circle cx="${CX}" cy="112" r="7" fill="${shade}"/>`
      );
    case 3:
      // Headphones: the band over the top, a cup on each ear.
      return (
        `<path fill="none" stroke="#26262c" stroke-width="16" stroke-linecap="round" d="M150 236C130 40 382 40 362 236"/>` +
        both(
          `<rect x="134" y="208" width="42" height="84" rx="20" fill="#26262c"/><rect x="146" y="220" width="20" height="60" rx="10" fill="${color === OUTFIT_COLORS[0] ? "#52525b" : color}"/>`
        )
      );
    default:
      return "";
  }
}

/** The whole picture, as a standalone SVG document. */
export function renderAvatarSvg(config: AvatarConfig): string {
  const skin = SKINS[config.skin];
  const skinShade = mix(skin, "#6b2a1a", 0.26);
  const hairColor = HAIR_COLORS[config.hairColor];
  const { back, front } = hairOf(config.hair, hairColor);
  // A hat sits on the head, so whatever the style piles up above the brim has
  // to go: it would stick out through the top of the hat otherwise.
  const hatted = config.headwear === 1 || config.headwear === 2;
  const clip = hatted ? ` clip-path="url(#hat)"` : "";
  const hatClip = hatted
    ? `<defs><clipPath id="hat"><rect x="-60" y="190" width="632" height="400"/></clipPath></defs>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    backgroundOf(BACKGROUNDS[config.background]) +
    hatClip +
    // The head is drawn a little small and scaled up from the base of the neck,
    // which also carries the hair behind it, so the two stay attached.
    `<g transform="${HEAD_SCALE}"><g${clip}>${back}</g></g>` +
    bodyOf(config, skin, skinShade) +
    `<g transform="${HEAD_SCALE}">` +
    faceOf(config, skin, skinShade) +
    earringsOf(config) +
    facialHairOf(config, hairColor) +
    noseOf(skinShade) +
    mouthOf(config, skin, skinShade) +
    eyesOf(config, skin, skinShade, hairColor) +
    `<g${clip}>${front}</g>` +
    eyewearOf(config) +
    headwearOf(config) +
    `</g></svg>`
  );
}

/** The same picture as an image src, for the editor's preview and thumbnails. */
export function avatarDataUrl(config: AvatarConfig): string {
  return `data:image/svg+xml,${encodeURIComponent(renderAvatarSvg(config))}`;
}
