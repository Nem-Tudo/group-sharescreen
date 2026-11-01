import assert from "node:assert/strict";
import { test } from "node:test";
import { customEffectFilter, DEFAULT_ADJUST, DEFAULT_WARP, hasCustomWarp, MAX_CUSTOM_EFFECTS, MAX_CUSTOM_STICKERS, sanitizeCustomEffects } from "./cameraCustomEffectsModel";

test("untouched adjustments draw no filter at all", () => {
  assert.equal(customEffectFilter(DEFAULT_ADJUST), "none");
});

test("the adjustments become a canvas filter", () => {
  assert.equal(
    customEffectFilter({ brightness: 120, contrast: 90, saturation: 0, hue: -30, vignette: 50 }),
    "brightness(1.2) contrast(0.9) saturate(0) hue-rotate(-30deg)"
  );
});

test("garbage in storage comes back as no effects", () => {
  assert.deepEqual(sanitizeCustomEffects(null), []);
  assert.deepEqual(sanitizeCustomEffects("x"), []);
  assert.deepEqual(sanitizeCustomEffects([1, {}, { id: "none" }]), []);
});

test("values out of range are pulled back and missing ones filled in", () => {
  const [effect] = sanitizeCustomEffects([
    {
      id: "a",
      name: "x".repeat(99),
      adjust: { brightness: 9999, hue: "red" },
      stickers: [{ id: "s", emoji: "🐶", anchor: "elbow", size: 99, x: Number.NaN }],
    },
  ]);
  assert.equal(effect.name.length, 24);
  assert.equal(effect.adjust.brightness, 180);
  assert.equal(effect.adjust.hue, 0);
  assert.equal(effect.adjust.contrast, 100);
  assert.deepEqual(effect.stickers, [{ id: "s", emoji: "🐶", anchor: "forehead", x: 0, y: 0, size: 3, rotation: 0 }]);
});

test("a sticker with nothing to draw is dropped", () => {
  const [effect] = sanitizeCustomEffects([{ id: "a", stickers: [{ id: "s" }, { emoji: "🐶" }] }]);
  assert.deepEqual(effect.stickers, []);
});

test("distortions default to none, come back in range, and say whether any is set", () => {
  const [plain, pushed] = sanitizeCustomEffects([{ id: "a" }, { id: "b", warp: { eyes: 999, nose: "x" } }]);
  assert.deepEqual(plain.warp, DEFAULT_WARP);
  assert.equal(hasCustomWarp(plain.warp), false);
  assert.equal(pushed.warp.eyes, 100);
  assert.equal(pushed.warp.nose, 0);
  assert.equal(hasCustomWarp(pushed.warp), true);
});

test("the limits hold for what was stored", () => {
  const stickers = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, emoji: "🐶" }));
  const effects = sanitizeCustomEffects(Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, stickers })));
  assert.equal(effects.length, MAX_CUSTOM_EFFECTS);
  assert.equal(effects[0].stickers.length, MAX_CUSTOM_STICKERS);
});
