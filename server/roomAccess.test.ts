import assert from "node:assert/strict";
import test from "node:test";
import {
  hashRoomPassword,
  RoomAccessTokens,
  RoomAuthRateLimiter,
  verifyRoomPassword,
} from "./roomAccess.ts";

test("hashes and verifies a room password without retaining plaintext", async () => {
  const hash = await hashRoomPassword("teste123");
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes("teste123"), false);
  assert.equal(await verifyRoomPassword("teste123", hash), true);
  assert.equal(await verifyRoomPassword("senhaerrada", hash), false);
});

test("issues room-specific expiring access tokens", () => {
  const tokens = new RoomAccessTokens(1_000);
  const { accessToken } = tokens.issue("priv-filme", 10_000);
  assert.equal(tokens.validate("priv-filme", accessToken, 10_999), true);
  assert.equal(tokens.validate("priv-outra", accessToken, 10_999), false);
  assert.equal(tokens.validate("priv-filme", accessToken, 11_000), false);
  assert.equal(tokens.validate("priv-filme", "invalid", 10_500), false);
});

test("invalidates every token when a room is removed", () => {
  const tokens = new RoomAccessTokens(1_000);
  const { accessToken } = tokens.issue("priv-filme", 10_000);
  tokens.invalidateRoom("priv-filme");
  assert.equal(tokens.validate("priv-filme", accessToken, 10_001), false);
});

test("rate limits repeated failures and resets after the window", () => {
  const limiter = new RoomAuthRateLimiter(2, 1_000);
  limiter.recordFailure("ip:room", 10_000);
  assert.equal(limiter.check("ip:room", 10_100).allowed, true);
  limiter.recordFailure("ip:room", 10_200);
  assert.equal(limiter.check("ip:room", 10_300).allowed, false);
  assert.equal(limiter.check("ip:room", 11_000).allowed, true);
});
