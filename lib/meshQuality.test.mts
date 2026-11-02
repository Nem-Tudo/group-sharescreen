// node --experimental-strip-types lib/meshQuality.test.mts
//
// Pins the pure piece the whole mesh strategy rests on: how a rendered tile size
// becomes a quality tier, and what that tier may spend. Testable without a
// browser, a peer connection, or a room.

import assert from "node:assert/strict";
import {
  capTier,
  encoderCeilingKbps,
  scaleForHeight,
  stepDownUnder,
  tierForRenderedSize,
  MAX_TIER_FPS,
  tierSpec,
  TIERS,
} from "./videoQuality";

const encodeMpxs = (tier: Parameters<typeof tierSpec>[0]) => {
  const s = tierSpec(tier);
  return (s.width * s.height * s.frameRate) / 1e6;
};

// --- tier selection -------------------------------------------------------

// The case the entire optimisation exists for: a 30-person grid on a 1080p
// screen gives each tile ~320x216, which must not pull 1080p.
assert.equal(tierForRenderedSize(320, 216, 1), "576p30");
// 576p is the floor, so nothing — however small the tile — goes below it.
assert.equal(tierForRenderedSize(160, 90, 1), "576p30", "nada desce abaixo do piso");
assert.ok(
  TIERS.every((t) => t.height >= 576),
  "a escada não pode ter nenhum degrau abaixo de 576p"
);
// devicePixelRatio still decides between rungs: a 640x360 tile fits the floor
// on a 1x display and genuinely needs 1280x720 device pixels on a retina one.
assert.equal(tierForRenderedSize(640, 360, 1), "576p30");
assert.equal(tierForRenderedSize(640, 360, 2), "720p60");
// Someone watching fullscreen gets the top tier.
assert.equal(tierForRenderedSize(1920, 1080, 1), "1080p60");
// Making a window small must never be read as "this person wants 15fps".
// Frame rate is a response to pressure, not to tile size — so no size, however
// tiny, selects a reduced-fps tier on its own.
for (const w of [40, 120, 320, 640]) {
  const t = tierForRenderedSize(w, Math.round((w * 9) / 16), 1);
  assert.ok(!t.endsWith("15"), `${w}px não deveria escolher um tier de 15fps (veio ${t})`);
}

// maxFps caps the pool: a 30fps share can never be assigned a 60fps tier.
assert.equal(tierForRenderedSize(1920, 1080, 1, 30), "1080p30");

// The ladder must offer 60fps at every resolution someone can actually pick,
// not only at 1080p. It used not to, and the consequence was silent: a
// broadcaster who chose 720p60 was served 720p30 because that was the only
// 720p tier in existence.
assert.equal(tierForRenderedSize(1280, 720, 1, 60), "720p60");
assert.equal(tierForRenderedSize(2560, 1440, 1, 60), "1440p60");
assert.equal(tierForRenderedSize(2560, 1440, 1, 30), "1440p30");
// There is deliberately no 576p60: the floor is where every small tile lands,
// and the resolution tie-break prefers the higher frame rate, so a 60fps rung
// there would hand 60fps to a whole grid of thumbnails at once. Asking for
// 576p at 60fps gets the resolution, at the frame rate the floor offers.
assert.equal(tierForRenderedSize(1024, 576, 1, 60), "576p30");

// The paid dials are real rungs, not capture-only settings. The ladder used to
// stop at 1440p60, so a 4K or 120 fps share was scaled and frame-dropped down to
// it for every viewer.
assert.equal(tierForRenderedSize(3840, 2160, 1, 60), "2160p60");
assert.equal(tierForRenderedSize(3840, 2160, 1, 30), "2160p30");
assert.equal(tierForRenderedSize(3840, 2160, 1, 120), "2160p120");
assert.equal(tierForRenderedSize(2560, 1440, 1, 120), "1440p120");
assert.equal(tierForRenderedSize(1920, 1080, 1, 120), "1080p120");
// A 240 fps dial is sent at the fastest rung there is.
assert.equal(tierForRenderedSize(1920, 1080, 1, 240), "1080p120");
// No 720p120, for the same reason as no 576p60: medium tiles all land here.
assert.equal(tierForRenderedSize(1280, 720, 1, MAX_TIER_FPS), "720p60");
// And the grid floor stays at 30 even when viewers ask at the ladder's top fps.
assert.equal(tierForRenderedSize(320, 216, 1, MAX_TIER_FPS), "576p30");

// --- ladder invariants ----------------------------------------------------

// Both cost columns must fall monotonically down the ladder: a step down always
// frees both bandwidth and CPU.
//
// One tie is allowed on the CPU column: 2160p30 and 1080p120 are exactly the
// same pixels per second, so that one step frees bandwidth only. Bandwidth
// must still strictly fall at every step.
for (let i = 1; i < TIERS.length; i += 1) {
  const better = TIERS[i - 1];
  const worse = TIERS[i];
  assert.ok(
    worse.baseKbps < better.baseKbps,
    `${worse.tier} deveria custar menos banda que ${better.tier}`
  );
  assert.ok(
    encodeMpxs(worse.tier) <= encodeMpxs(better.tier),
    `${worse.tier} deveria custar menos CPU que ${better.tier}`
  );
}

// That ordering is by *cost*, and cost alone — 1440p30 sits below 1080p60 on
// purpose. So walking the ladder down can walk resolution *up*, and anywhere a
// step down is applied to a tier somebody actually asked for it has to stay
// under it: stepDownUnder walks only the rungs under the request.
for (const start of TIERS) {
  let prevKbps = Infinity;
  let prevMpxs = Infinity;
  for (let steps = 0; steps < TIERS.length; steps += 1) {
    const stepped = stepDownUnder(start.tier, steps);
    const spec = tierSpec(stepped);
    assert.ok(
      spec.width <= start.width && spec.frameRate <= start.frameRate,
      `descer ${steps} de ${start.tier} não pode ultrapassar o próprio teto (deu ${stepped})`
    );
    assert.ok(
      spec.baseKbps <= prevKbps && encodeMpxs(stepped) <= prevMpxs,
      `descer de ${start.tier} tem que ficar monotonicamente mais barato (${stepped} no passo ${steps})`
    );
    prevKbps = spec.baseKbps;
    prevMpxs = encodeMpxs(stepped);
  }
}

// --- ceilings -------------------------------------------------------------

// The broadcaster's three dials are independent, and capTier is where that is
// enforced: it clamps pixels and frames separately instead of picking "the
// worse of two tiers" off a single ladder, which cannot express "1080p but
// only 30fps" at all.
assert.equal(capTier("720p60", "1080p30"), "720p30", "teto de 30fps limita fps");
assert.equal(capTier("1080p60", "720p60"), "720p60", "teto de 720p limita resolução");
assert.equal(capTier("1440p60", "1080p60"), "1080p60");
assert.equal(capTier("576p30", "1080p60"), "576p30", "quem pede pouco continua recebendo pouco");
assert.equal(capTier("1080p60", "1080p60"), "1080p60", "teto igual ao pedido não mexe em nada");
// A viewer asks at the top fps (see qualityNegotiation); the broadcaster's fps
// dial is what brings it down.
assert.equal(capTier("1080p120", "2160p60"), "1080p60", "teto de 60fps limita pedido de 120");
assert.equal(capTier("1080p120", "2160p120"), "1080p120", "dial de 120 entrega 120");
assert.equal(capTier("2160p120", "1440p120"), "1440p120");
assert.equal(capTier("2160p60", "2160p30"), "2160p30");

// The bitrate dial's scale is anchored to 1440p60, not to the ladder's top:
// adding the 4K/120 rungs must not have cut what ordinary tiers are allowed.
assert.equal(encoderCeilingKbps("1080p60", 32000), Math.round((32000 * 5000) / 9000));
assert.equal(encoderCeilingKbps("2160p120", 32000), 32000, "degrau de cima recebe o dial inteiro");

// What the encoder is handed is a *ceiling*, and a ceiling set at the tier's
// average clips every busy moment. This is the regression that made shares
// look frozen, so it is pinned: at the default dial, the allowance is above
// the average cost, never at it.
for (const t of TIERS) {
  const ceiling = encoderCeilingKbps(t.tier, 4000);
  assert.ok(
    ceiling > t.baseKbps || ceiling === 4000,
    `${t.tier} deveria ter folga acima da média (veio ${ceiling} para base ${t.baseKbps})`
  );
}
// The dial is a hard limit in both directions: it caps the cheap settings and
// genuinely lifts the expensive ones. "ultra" and "máximo" used to be the
// same tier, i.e. the same setting sold twice.
assert.equal(encoderCeilingKbps("1080p60", 700), 700, "bitrate baixo é um teto de verdade");
assert.ok(
  encoderCeilingKbps("1080p60", 16000) > encoderCeilingKbps("1080p60", 8000),
  "máximo precisa entregar mais que ultra"
);
// ...and it scales down the ladder: a thumbnail must not be handed a 16 Mbps
// allowance just because the broadcaster picked the top setting.
assert.ok(
  encoderCeilingKbps("576p30", 16000) < encoderCeilingKbps("1080p60", 16000),
  "tier pequeno não deve receber a mesma verba do tier grande"
);
assert.equal(
  encoderCeilingKbps("1080p30", 4000),
  Math.round(Math.min(4000, tierSpec("1080p30").baseKbps * 1.5))
);

// --- scale ------------------------------------------------------------------

// Downscaling never upscales a capture that is already small.
assert.equal(scaleForHeight(1080, 1280, 720), 1);
assert.equal(scaleForHeight(720, 1920, 0), 1, "captura de altura desconhecida");
assert.equal(scaleForHeight(720, 1920, 1080), 1.5);
// The exact size, and not 1.88, which makes 1021x574.
assert.equal(scaleForHeight(576, 1920, 1080), 1.875);

// A hardware H264 encoder refuses odd sides, so the picture always comes out even,
// on every screen there is and on whatever size a window happens to be.
for (const [width, height] of [
  [1920, 1080], [2560, 1440], [3840, 2160], [1366, 768], [1536, 864], [1600, 900], [1920, 1200],
  [1280, 720], [1280, 800], [1440, 900], [1680, 1050], [2560, 1080], [3440, 1440], [1920, 1024],
  [1904, 1048], [1357, 763], [801, 1203],
]) {
  for (const target of [2160, 1440, 1080, 720, 576, 432, 360]) {
    const scale = scaleForHeight(target, width, height);
    const out = [Math.round(width / scale), Math.round(height / scale)];
    if (scale === 1) continue;
    assert.ok(out[0] % 2 === 0 && out[1] % 2 === 0, `${width}x${height} para ${target}: ${out} com ${scale}`);
    assert.ok(out[1] <= target && out[1] >= target - 24, `${width}x${height} para ${target}: ${out}`);
  }
}

console.log("meshQuality: ok");
