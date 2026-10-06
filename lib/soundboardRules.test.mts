import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUNDBOARD_MAX_BYTES,
  SOUNDBOARD_MAX_DURATION_MS,
  clampSoundboardVolume,
  effectiveSoundboardVolume,
  isSoundboardFileWithinLimits,
} from "./soundboardRules.ts";

test("soundboard volume is clamped to the listener range", () => {
  assert.equal(clampSoundboardVolume(-1), 0);
  assert.equal(clampSoundboardVolume(0.35), 0.35);
  assert.equal(clampSoundboardVolume(2), 1);
  assert.equal(clampSoundboardVolume(Number.NaN), 1);
});

test("global and per-person effect volumes multiply locally", () => {
  assert.equal(effectiveSoundboardVolume(0.5, 0.2, false, false), 0.1);
  assert.equal(effectiveSoundboardVolume(0.5, 0.2, true, false), 0);
  assert.equal(effectiveSoundboardVolume(0.5, 0.2, false, true), 0);
});

test("soundboard files stop at ten seconds and five megabytes", () => {
  assert.equal(isSoundboardFileWithinLimits(SOUNDBOARD_MAX_BYTES, SOUNDBOARD_MAX_DURATION_MS), true);
  assert.equal(isSoundboardFileWithinLimits(SOUNDBOARD_MAX_BYTES + 1, SOUNDBOARD_MAX_DURATION_MS), false);
  assert.equal(isSoundboardFileWithinLimits(SOUNDBOARD_MAX_BYTES, SOUNDBOARD_MAX_DURATION_MS + 1), false);
  assert.equal(isSoundboardFileWithinLimits(0, 1000), false);
});
