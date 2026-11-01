// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/avatarBuilder.test.mts
import assert from "node:assert/strict";
import {
  AVATAR_SLOTS,
  DEFAULT_AVATAR_CONFIG,
  avatarConfigFromPath,
  avatarPathFor,
  decodeAvatarCode,
  encodeAvatarCode,
  randomAvatarConfig,
  renderAvatarSvg,
} from "./avatarBuilder";

// 1. Every choice fits in one character, or the code stops being one per slot.
for (const slot of AVATAR_SLOTS) assert.ok(slot.count <= 36, `${slot.key} has too many options`);

// 2. A path comes back as the same choices.
const config = { ...DEFAULT_AVATAR_CONFIG, background: 21, hair: 11, outfitColor: 11 };
assert.deepEqual(avatarConfigFromPath(avatarPathFor(config)), config);

// 3. Slots are only added at the end, so a shorter code is still a picture.
assert.deepEqual(decodeAvatarCode(encodeAvatarCode(config).slice(0, 4)), { ...config, outfitColor: 0 });

// 4. Anything else is not an avatar.
const tooMany = "0".repeat(AVATAR_SLOTS.length + 1);
for (const code of ["", tooMany, "z", "0-", "0A", "../"]) {
  assert.equal(decodeAvatarCode(code), null, `"${code}" must be refused`);
}
for (const path of [null, undefined, "", "/assets/default_avatars/01.png", "/avatar/z.png", "/avatar/0.svg", "https://x/avatar/0.png"]) {
  assert.equal(avatarConfigFromPath(path), null, `${path} is not a built avatar`);
}

// 5. Every option of every slot draws, in both body types.
for (const gender of [0, 1]) {
  for (const slot of AVATAR_SLOTS) {
    for (let index = 0; index < slot.count; index += 1) {
      const svg = renderAvatarSvg({ ...DEFAULT_AVATAR_CONFIG, gender, [slot.key]: index });
      assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
      assert.ok(!/undefined|NaN/.test(svg), `${slot.key} ${index} drew something broken`);
    }
  }
}

// 6. A random one is always a valid one, at both ends of the random source.
for (const random of [() => 0, () => 0.999999, Math.random]) {
  const rolled = randomAvatarConfig(random);
  assert.deepEqual(decodeAvatarCode(encodeAvatarCode(rolled)), rolled);
}

console.log("avatarBuilder.test.mts: ok");
