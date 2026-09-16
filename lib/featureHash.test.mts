// The site's half of the feature-rollout hash. The same vectors are pinned in
// sharescreen-api/server/featureHash.test.ts — if they drift apart, the site
// shows one side to a person the API counts in the other.
import assert from "node:assert/strict";
import test from "node:test";
import { featureBucket, featureOverrideTag, featureVariantIndex, murmur3 } from "@/lib/featureHash";

test("murmur3 matches the reference implementation", () => {
  assert.equal(murmur3(""), 0);
  assert.equal(murmur3("", 1), 0x514e28b7);
  assert.equal(murmur3("hello"), 0x248bfa47);
  assert.equal(murmur3("The quick brown fox jumps over the lazy dog", 0x9747b28c), 0x2fa826cd);
});

test("pinned vectors shared with the API", () => {
  const id = "0b6f0c3e-7d0a-4c64-9a53-2d1f4f1d9e11";
  assert.equal(featureBucket("pro-page-redesign", id), 2599);
  assert.equal(featureVariantIndex("pro-page-redesign", id, 3), 1);
  assert.equal(featureOverrideTag("pro-page-redesign", id), "1ccnuj6");
  assert.equal(featureBucket("x", "ção"), 2697);
  assert.equal(featureVariantIndex("pro-page-redesign", id, 3, [70, 20, 10]), 1);
});
