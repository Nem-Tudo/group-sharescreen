// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/screenCodec.test.mts
//
// What goes first for whoever is outside sq-new-send.

import assert from "node:assert/strict";
import { setClassicSend } from "./classicSend.ts";
import { defaultShareProfile, firstCodecFor, screenCodecTag, setScreenCodecVariant } from "./screenCodec.ts";
import { videoCodecOrder } from "./videoCodecPreferences.ts";

// "auto" follows the machine, except for "motion", and has no opinion until it knows.
assert.equal(firstCodecFor("auto", "balanced", true), "h264");
assert.equal(firstCodecFor("auto", "text", true), "h264");
assert.equal(firstCodecFor("auto", "balanced", false), "vp9");
assert.equal(firstCodecFor("auto", "text", false), "vp9");
assert.equal(firstCodecFor("auto", "motion", false), null);
assert.equal(firstCodecFor("auto", "balanced", null), null);
assert.equal(firstCodecFor("text", "balanced", true), null);
assert.equal(firstCodecFor(null, "balanced", true), null);

// With no opinion, the profile's own.
setClassicSend(true);
setScreenCodecVariant("text");
assert.equal(videoCodecOrder("text"), "vp9");
assert.equal(videoCodecOrder("balanced"), "h264");
assert.equal(videoCodecOrder("motion"), "h264");

// "text" makes it the default for whoever never picked one, and the reports say so.
assert.equal(defaultShareProfile(), "text");
assert.equal(screenCodecTag(), "screen-codec=text");

// Inside sq-new-send it has no say over any of it.
setClassicSend(false);
assert.equal(defaultShareProfile(), "balanced");
assert.equal(screenCodecTag(), null);
assert.equal(videoCodecOrder("text"), "h264");

console.log("screenCodec: ok");
