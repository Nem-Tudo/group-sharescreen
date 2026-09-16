// Who is in a feature rollout, worked out from the id alone.
//
// The same idea Discord's experiments use: hash "<salt>:<id>" into one of
// 10 000 positions and compare the position with the rollout. No lookup, no
// stored assignment — every worker, and the website itself, reach the same
// answer for the same id without asking anybody.
//
// Three properties the rest of the system leans on:
//
//   - Raising a rollout only ever adds people. Position < rollout is a prefix,
//     so going from 5% to 10% keeps the first 5% and adds the next 5%; nobody
//     who had the feature loses it on the way up.
//   - Each feature has its own salt, so the 5% who got one feature are not the
//     same 5% who get every other one.
//   - Changing the salt ("reshuffle") draws a fresh population.
//
// THIS FILE HAS A TWIN in sharescreen-api/server/featureHash.ts, and the two
// must stay equivalent: the API decides purchases and stats with that one,
// the site decides what to render with this one, and a disagreement would
// count people in the wrong group. Both have a test pinning the same
// vectors (featureHash.test.ts / featureHash.test.mts).

/** How many positions a rollout is measured in — 0.01% steps. */
export const FEATURE_BUCKETS = 10_000;

const encoder = new TextEncoder();

/** MurmurHash3, x86 32-bit, over the UTF-8 bytes of `input`. */
export function murmur3(input: string, seed = 0): number {
  const bytes = encoder.encode(input);
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;
  const tail = bytes.length & 3;
  const blocks = bytes.length - tail;

  for (let i = 0; i < blocks; i += 4) {
    let k =
      bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  let k = 0;
  switch (tail) {
    case 3:
      k ^= bytes[blocks + 2] << 16;
    // falls through
    case 2:
      k ^= bytes[blocks + 1] << 8;
    // falls through
    case 1:
      k ^= bytes[blocks];
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }

  h ^= bytes.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The id's position, 0–9999, for a feature with this salt. */
export function featureBucket(salt: string, id: string): number {
  return murmur3(`${salt}:${id}`) % FEATURE_BUCKETS;
}

/**
 * Which of `count` treatments an id inside the rollout gets — evenly, or in
 * proportion to `weights` (one per treatment, any scale: 70/30 or 7/3).
 *
 * A second, independent hash rather than a slice of the first: slicing the
 * rollout range would move people between treatments every time the rollout
 * grew, and a person flipping between two designs is the one thing an A/B
 * test must never do.
 */
export function featureVariantIndex(
  salt: string,
  id: string,
  count: number,
  weights?: readonly number[] | null
): number {
  if (count <= 1) return 0;
  const hash = murmur3(`${salt}:variant:${id}`);
  const usable =
    weights &&
    weights.length === count &&
    weights.every((weight) => Number.isFinite(weight) && weight >= 0) &&
    weights.some((weight) => weight > 0)
      ? weights
      : null;
  // Equal weights keep the original even split, byte for byte — so features
  // created before weights existed keep every person where they were.
  if (!usable || usable.every((weight) => weight === usable[0])) return hash % count;
  // Otherwise the hash is a point along the weights laid end to end.
  const total = usable.reduce((sum, weight) => sum + weight, 0);
  const point = (hash / 4294967296) * total;
  let reached = 0;
  for (let i = 0; i < count; i++) {
    reached += usable[i];
    if (point < reached) return i;
  }
  // Only reachable through floating-point rounding at the very end.
  for (let i = count - 1; i > 0; i--) if (usable[i] > 0) return i;
  return 0;
}

/**
 * What an override is published under.
 *
 * The site needs the override list to decide on its own, but it has no need
 * to learn *which* accounts are testers — so the list goes out hashed. A
 * 32-bit tag is plenty: a stranger colliding with one of a handful of
 * overrides is a one-in-a-billion event, and costs them a preview.
 */
export function featureOverrideTag(salt: string, id: string): string {
  return murmur3(`${salt}:override:${id}`, 0x9747b28c).toString(36);
}
