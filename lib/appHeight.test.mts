import test from "node:test";
import assert from "node:assert/strict";
import { appHeightPx, isIOS } from "./appHeight";

test("appHeightPx: the keyboard shrinks it", () => {
  assert.equal(appHeightPx({ height: 844, scale: 1 }), 844);
  assert.equal(appHeightPx({ height: 508, scale: 1 }), 508);
});

test("appHeightPx: a pinch-zoom does not", () => {
  assert.equal(appHeightPx({ height: 422, scale: 2 }), 844);
  assert.equal(appHeightPx({ height: 281.33, scale: 3 }), 844);
});

test("isIOS: iPhone, and an iPad that says it is a Mac", () => {
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true);
});

test("isIOS: not a real Mac, not Android", () => {
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }), false);
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", maxTouchPoints: 5 }), false);
});
