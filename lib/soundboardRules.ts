export const SOUNDBOARD_MAX_DURATION_MS = 10_000;
export const SOUNDBOARD_MAX_BYTES = 5 * 1024 * 1024;
export const SOUNDBOARD_MAX_CATALOG_SOUNDS = 64;

export function clampSoundboardVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function effectiveSoundboardVolume(
  globalVolume: number,
  peerVolume: number,
  peerMuted: boolean,
  deafened: boolean
): number {
  if (deafened || peerMuted) return 0;
  return clampSoundboardVolume(globalVolume) * clampSoundboardVolume(peerVolume);
}

export function isSoundboardFileWithinLimits(sizeBytes: number, durationMs: number): boolean {
  return (
    Number.isFinite(sizeBytes) &&
    Number.isFinite(durationMs) &&
    sizeBytes > 0 &&
    sizeBytes <= SOUNDBOARD_MAX_BYTES &&
    durationMs > 0 &&
    durationMs <= SOUNDBOARD_MAX_DURATION_MS
  );
}
