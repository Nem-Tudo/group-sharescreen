// node --experimental-strip-types lib/peerQuality.test.mts
//
// Pins the congestion control law: when a viewer's bitrate is allowed to be
// cut, and — mostly — when it must not be.
//
// Every assertion here is about *not* degrading. That is deliberate: this is
// the one part of the quality path with no natural safety net. A tier that
// comes out too low is visible and gets reported; a congestion ratio that
// comes out too low looks exactly like a bad network, so it can be wrong for
// months without anybody being able to say so.

import assert from "node:assert/strict";
import {
  congestionStep,
  initialCongestionState,
  nextRttFloor,
  type CongestionState,
} from "./congestionControl";
import type { SenderSample } from "./mediaStats";

function sample(over: Partial<SenderSample> = {}): SenderSample {
  return {
    peerId: "peer",
    fractionLost: 0,
    rtt: 0.02,
    outgoingKbps: 2500,
    framesPerSecond: 30,
    qualityLimitationReason: "none",
    frameWidth: 1920,
    frameHeight: 1080,
    ...over,
  };
}

function run(s: SenderSample, times: number, from = initialCongestionState()): CongestionState {
  let state = from;
  for (let i = 0; i < times; i += 1) state = congestionStep(state, s);
  return state;
}

// --- the delay floor -------------------------------------------------------

assert.equal(nextRttFloor(0, 0.4), 0.4, "a primeira amostra vira o piso");
assert.equal(nextRttFloor(0.4, 0.1), 0.1, "um caminho mais rápido rebaixa o piso na hora");
assert.equal(nextRttFloor(0.2, 0), 0.2, "amostra sem RTT não mexe no piso");
// Sobe devagar, e nunca acima do que está sendo observado agora — senão um
// caminho que ficou genuinamente mais lento leria como congestionamento
// permanente contra um piso que ele não alcança mais.
assert.ok(nextRttFloor(0.2, 0.9) > 0.2 && nextRttFloor(0.2, 0.9) < 0.21);
assert.equal(nextRttFloor(0.2, 0.201), 0.201, "a subida é limitada pela amostra atual");

// --- distance is not congestion --------------------------------------------

// The regression this rule exists for. A viewer 300ms away on a perfectly
// healthy link — intercontinental, mobile, or anyone at all once "Impedir
// conexões diretas" routes them through a relay — used to trip an absolute
// `rtt > 0.35` threshold on every single sample, ratchet to the floor, and
// never recover, because recovery required an RTT that path cannot produce.
assert.equal(
  run(sample({ rtt: 0.5 }), 40).ratio,
  1,
  "RTT alto e estável, sem perda, não pode reduzir nada"
);

// Even with the encoder reporting a bandwidth limit, a *steady* delay is not
// evidence of a queue: what matters is the rise above this path's own floor.
assert.equal(
  run(sample({ rtt: 0.5, qualityLimitationReason: "bandwidth" }), 40).ratio,
  1,
  "atraso constante não é fila"
);

// --- the encoder's own verdict gates everything ----------------------------

// Loss with no reported limitation is somebody else's problem — a shared
// link, another tab, the twenty other connections this machine is running.
// The encoder is meeting its target, so there is nothing here to give up.
assert.equal(
  run(sample({ fractionLost: 0.2 }), 40).ratio,
  1,
  "perda sem limitação reportada não corta bitrate"
);

// A browser that never reports the stat leaves it at "none", which switches
// this layer off entirely and defers to the browser's own adaptation.
assert.equal(run(sample({ fractionLost: 0.5, rtt: 2 }), 40).ratio, 1);

// --- real congestion still backs off ---------------------------------------

{
  const bad = sample({ fractionLost: 0.08, qualityLimitationReason: "bandwidth" });
  assert.equal(run(bad, 2).ratio, 1, "duas amostras ruins ainda não bastam");
  const after = run(bad, 3).ratio;
  assert.ok(after < 1, "congestionamento real reduz");
  assert.ok(after > 0.85, "e reduz um degrau de cada vez");
  // Nunca abaixo do piso, por pior que fique.
  assert.equal(run(bad, 300).ratio, 0.45, "para no piso, não no zero");
}

// CPU pressure counts as a limitation too — there the shortage is real, it is
// just a different one.
assert.ok(run(sample({ fractionLost: 0.08, qualityLimitationReason: "cpu" }), 3).ratio < 1);

// A delay that genuinely rises above the floor is congestion, and reads as
// such however large the floor itself happens to be.
{
  const far = run(sample({ rtt: 0.3 }), 3);
  assert.equal(far.ratio, 1, "o piso sozinho não reduz");
  const queued = run(sample({ rtt: 0.55, qualityLimitationReason: "bandwidth" }), 3, far);
  assert.ok(queued.ratio < 1, "250ms acima do piso é fila, mesmo num caminho longo");
}

// --- recovery survives an intermittent room --------------------------------

// "Neither clearly good nor clearly bad" must not erase progress towards
// recovery. The stats pump round-robins, so in a large room each sender is
// visited every ten seconds or more and a climb takes minutes — one ambiguous
// reading in that window used to send it back to the start, forever.
{
  let state = run(sample({ fractionLost: 0.08, qualityLimitationReason: "bandwidth" }), 9);
  const floor = state.ratio;
  assert.ok(floor < 1, "desceu antes de tentar subir");
  // Loss between LOSS_GOOD and LOSS_BAD with a limit reported: neither.
  const unclear = sample({ fractionLost: 0.02, qualityLimitationReason: "bandwidth" });
  for (let i = 0; i < 20; i += 1) {
    state = congestionStep(state, sample());
    state = congestionStep(state, unclear);
  }
  assert.equal(state.ratio, 1, "amostras ambíguas não bloqueiam a recuperação");
}

// An ambiguous sample on its own still holds position — it is not evidence of
// health either.
{
  const unclear = sample({ fractionLost: 0.02, qualityLimitationReason: "bandwidth" });
  let state = run(sample({ fractionLost: 0.08, qualityLimitationReason: "bandwidth" }), 3);
  const held = state.ratio;
  state = run(unclear, 20, state);
  assert.equal(state.ratio, held, "ambíguo segura, não sobe sozinho");
}

// A clean run recovers all the way back to the full tier.
{
  const backedOff = run(sample({ fractionLost: 0.08, qualityLimitationReason: "bandwidth" }), 9);
  assert.ok(backedOff.ratio < 1);
  assert.equal(run(sample(), 40, backedOff).ratio, 1, "link saudável volta ao tier inteiro");
}

console.log("peerQuality: ok");

// --- experiment "congestion-recover" ---------------------------------------

// A software H264 encoder reports "bandwidth" nearly all the time (WebRTC files
// its QP-driven quality scaling there). Once loss had cut its ratio, the old
// rule — healthy only with reason "none" — never let it climb back.
{
  const lossy = sample({ fractionLost: 0.08, qualityLimitationReason: "bandwidth" });
  const cleanButLabelled = sample({ qualityLimitationReason: "bandwidth" });
  const cut = run(lossy, 9);
  assert.ok(cut.ratio < 1, "desceu com perda");
  let state = cut;
  for (let i = 0; i < 20; i += 1) state = congestionStep(state, cleanButLabelled);
  assert.equal(state.ratio, cut.ratio, "sem o experiment, o rótulo do encoder prende o corte");
  state = cut;
  for (let i = 0; i < 20; i += 1) state = congestionStep(state, cleanButLabelled, { recoverWhileLimited: true });
  assert.equal(state.ratio, 1, "com o experiment, link limpo recupera mesmo rotulado");
  // And it still backs off on real evidence.
  let backed = initialCongestionState();
  for (let i = 0; i < 9; i += 1) backed = congestionStep(backed, lossy, { recoverWhileLimited: true });
  assert.ok(backed.ratio < 1, "o experiment não impede o recuo com perda");
}

