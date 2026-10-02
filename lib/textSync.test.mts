// node --experimental-strip-types lib/textSync.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTextOp, transform, type TextOp } from "./textOt";
import { TextSyncClient, diffText, transformIndex } from "./textSync";

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

// The server's half, as the API's roomTools.applyClientTextOp does it.
class Server {
  text = "";
  version = 0;
  history: { version: number; op: TextOp }[] = [];
  apply(base: number, op: TextOp): { op: TextOp; version: number } {
    let rebased = op;
    for (const entry of this.history.filter((h) => h.version > base)) rebased = transform(rebased, entry.op, false)[0];
    this.text = applyTextOp(this.text, rebased);
    this.version += 1;
    this.history.push({ version: this.version, op: rebased });
    return { op: rebased, version: this.version };
  }
}

test("three people typing at once end up with the same text", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rand = seeded(seed);
    const server = new Server();
    // Messages in flight, each with the tick it arrives on. Per-connection
    // order is kept (a WebSocket is ordered), so each queue is FIFO.
    const toServer: { at: number; from: number; msg: { version: number; op: TextOp; opId: string } }[][] = [[], [], []];
    const toClient: { at: number; op: TextOp; version: number; opId: string }[][] = [[], [], []];
    let tick = 0;
    const clients = [0, 1, 2].map(
      (i) => new TextSyncClient("", 0, (msg) => toServer[i].push({ at: tick + 1 + Math.floor(rand() * 4), from: i, msg }))
    );

    for (tick = 0; tick < 400; tick++) {
      for (let i = 0; i < 3; i++) {
        if (rand() < 0.3) {
          const c = clients[i];
          const p = Math.floor(rand() * (c.text.length + 1));
          const next =
            rand() < 0.65 || c.text.length === 0
              ? c.text.slice(0, p) + "abc"[i] + c.text.slice(p)
              : c.text.slice(0, p) + c.text.slice(p + 1 + Math.floor(rand() * 3));
          c.edit(next);
        }
      }
      for (let i = 0; i < 3; i++) {
        while (toServer[i].length > 0 && toServer[i][0].at <= tick) {
          const { msg } = toServer[i].shift()!;
          const applied = server.apply(msg.version, msg.op);
          for (let j = 0; j < 3; j++) {
            toClient[j].push({ at: tick + 1 + Math.floor(rand() * 4), ...applied, opId: msg.opId });
          }
        }
        while (toClient[i].length > 0 && toClient[i][0].at <= tick) {
          const m = toClient[i].shift()!;
          assert.notEqual(clients[i].receive(m.op, m.version, m.opId), "out of step");
        }
      }
    }
    // Let everything land.
    for (let round = 0; round < 50; round++) {
      tick += 10;
      for (let i = 0; i < 3; i++) {
        while (toServer[i].length > 0) {
          const { msg } = toServer[i].shift()!;
          const applied = server.apply(msg.version, msg.op);
          for (let j = 0; j < 3; j++) toClient[j].push({ at: tick, ...applied, opId: msg.opId });
        }
      }
      for (let i = 0; i < 3; i++) {
        while (toClient[i].length > 0) {
          const m = toClient[i].shift()!;
          clients[i].receive(m.op, m.version, m.opId);
        }
      }
    }
    for (const c of clients) {
      assert.equal(c.dirty, false, `seed ${seed}: still waiting`);
      assert.equal(c.text, server.text, `seed ${seed}: diverged`);
    }
  }
});

test("diffText is one delete and one insert", () => {
  assert.deepEqual(diffText("hello world", "hello there world"), [{ t: "i", p: 6, s: "there " }]);
  assert.deepEqual(diffText("abcdef", "abXef"), [
    { t: "d", p: 2, n: 2 },
    { t: "i", p: 2, s: "X" },
  ]);
  assert.deepEqual(diffText("same", "same"), []);
});

test("a caret stays put when somebody types before it", () => {
  assert.equal(transformIndex([{ t: "i", p: 0, s: "ab" }], 3), 5);
  assert.equal(transformIndex([{ t: "i", p: 5, s: "ab" }], 3), 3);
  assert.equal(transformIndex([{ t: "d", p: 0, n: 2 }], 3), 1);
  assert.equal(transformIndex([{ t: "d", p: 2, n: 5 }], 3), 2);
});
