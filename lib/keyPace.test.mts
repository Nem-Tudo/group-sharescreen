// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/keyPace.test.mts
//
// Experiment sq-key-pace (see lib/keyPace): how often the GPU capture's one encoder is asked
// for an IDR, against what happens without it.

import assert from "node:assert/strict";

class FakeVideoFrame {
  constructor(_data: unknown, _init: { timestamp: number }) {}
  close() {}
}
(globalThis as Record<string, unknown>).VideoFrame = FakeVideoFrame;

const { KeyPacer, SenderSink } = await import("./nativeVideoSink.ts");

// A clock that only moves when told to, with the timers on it.
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let first: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= end && (!first || entry[1].at < first[1].at)) first = entry;
        if (!first) break;
        timers.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = end;
    },
  };
}

// A helper that answers every request with an IDR 50 ms later, and the pacer it answers.
function setup(enabled: boolean) {
  const clock = fakeClock();
  let pending = false;
  const pacer = new KeyPacer(() => {
    if (pending) return;
    pending = true;
    clock.setTimeout(() => {
      pending = false;
      pacer.keyArrived();
    }, 50);
  }, clock);
  pacer.setEnabled(enabled);
  return { clock, pacer };
}

// One viewer on a bad link loses the picture every second, for a minute, with three others
// watching. Without the experiment every one of those is an IDR for all four.
function oneLossyViewer(enabled: boolean) {
  const { clock, pacer } = setup(enabled);
  for (let s = 0; s < 60; s += 1) {
    pacer.request(1, "lost", 4);
    clock.advance(1000);
  }
  return pacer.sent;
}
{
  const before = oneLossyViewer(false);
  const after = oneLossyViewer(true);
  assert.equal(before, 60);
  // One every 4 s at most, once the viewer's wait has grown to its ceiling.
  assert.ok(after <= 16, `com o experimento, ${after} IDRs num minuto`);
}

// A viewer who just arrived is not held back by the lossy one's history, nor kept waiting
// longer than the gap.
{
  const { clock, pacer } = setup(true);
  for (let s = 0; s < 20; s += 1) {
    pacer.request(1, "lost", 4);
    clock.advance(1000);
  }
  const sent = pacer.sent;
  pacer.request(2, "fresh", 5);
  clock.advance(1300);
  assert.equal(pacer.sent, sent + 1, "quem chegou recebe o seu em até 1,3 s");
}

// Ten viewers, each losing the picture now and then, together about one a second: without the
// experiment one IDR a second for everybody; with it, at most one every 2.5 s.
function tenViewers(enabled: boolean) {
  const { clock, pacer } = setup(enabled);
  for (let t = 0; t < 60_000; t += 500) {
    // Each viewer every 5 s, staggered: two requests a second in all.
    for (let v = 0; v < 10; v += 1) if ((t / 500 + v) % 10 === 0) pacer.request(v, "lost", 10);
    clock.advance(500);
  }
  return pacer.sent;
}
{
  const before = tenViewers(false);
  const after = tenViewers(true);
  assert.equal(before, 120, "sem o experimento, cada pedido é um IDR (a página junta em 1 por segundo)");
  assert.ok(after <= 25, `com ele, ${after} num minuto`);
}

// Turned off with somebody waiting: they are served at once.
{
  const { clock, pacer } = setup(true);
  pacer.request(1, "lost", 3);
  clock.advance(100);
  pacer.request(1, "lost", 3);
  const sent = pacer.sent;
  pacer.setEnabled(false);
  assert.equal(pacer.sent, sent + 1);
}

// --- what a connection's report says about it -------------------------------------------

{
  const writer = { write: async () => {}, close: async () => {} } as unknown as WritableStreamDefaultWriter<VideoFrame>;
  const needs: string[] = [];
  const sink = new SenderSink(writer, { requestKeyFrame: (need) => needs.push(need), lastKey: () => null });
  sink.setConnected(true);
  assert.deepEqual(needs, ["fresh"], "chegou: sem imagem nenhuma ainda");
  assert.equal(sink.taking, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  sink.onNative({ key: false, data: new Uint8Array([2]) });
  sink.onNative({ key: true, data: new Uint8Array([1]) });
  assert.equal(sink.stats.keys, 1);
  assert.ok(sink.stats.keyWaitMs >= 25, `esperou ${sink.stats.keyWaitMs} ms pelo primeiro IDR`);
  sink.setPaused(true);
  assert.equal(sink.taking, false);
  sink.setPaused(false);
  assert.deepEqual(needs, ["fresh", "fresh"], "de volta de uma pausa: também");
  sink.close();
}

console.log("keyPace ok");
