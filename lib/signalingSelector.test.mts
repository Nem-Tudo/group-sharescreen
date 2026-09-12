// node --experimental-strip-types lib/signalingSelector.test.mts
//
// Covers the caching rule useSyncExternalStore imposes: getSnapshot must
// return the *same reference* while nothing it selects has changed, or React
// re-renders forever. The hook itself needs React to run, so what is tested
// here is the cache logic it is built on, written the same way.
import assert from "node:assert/strict";
import { shallow } from "./useSignalingSelector";

// The closure from useSignalingSelector's useMemo, with the store passed in
// so it can be driven without React.
function makeGetSnapshot<S, T>(
  read: () => S,
  selector: (s: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
) {
  let lastState: S | null = null;
  let lastValue: T;
  let primed = false;
  return () => {
    const state = read();
    if (primed && lastState === state) return lastValue;
    const next = selector(state);
    lastState = state;
    if (primed && isEqual(lastValue, next)) return lastValue;
    primed = true;
    lastValue = next;
    return next;
  };
}

type State = { peers: { id: string }[]; chat: string[]; name: string | null };

let state: State = { peers: [{ id: "a" }], chat: [], name: "ana" };
const read = () => state;

// ── A selector returning a field straight out of the state ────────────────

const getPeers = makeGetSnapshot(read, (s: State) => s.peers);
const firstPeers = getPeers();
assert.equal(getPeers(), firstPeers, "repeated reads of one state must not change identity");

// A message that touches something else entirely replaces the state object
// but leaves this slice alone — the whole point of selecting.
state = { ...state, chat: ["oi"] };
assert.equal(getPeers(), firstPeers, "an unrelated field changing must not change the slice");

// And a real change to the slice does come through.
state = { ...state, peers: [{ id: "a" }, { id: "b" }] };
const grown = getPeers();
assert.notEqual(grown, firstPeers, "a real change must produce a new value");
assert.equal(grown.length, 2);

// ── A selector building a fresh object, paired with shallow ───────────────

const getIdentity = makeGetSnapshot(
  read,
  (s: State) => ({ name: s.name, peerCount: s.peers.length }),
  shallow
);
const firstIdentity = getIdentity();
assert.equal(getIdentity(), firstIdentity, "shallow must hold the reference steady");

// Fresh object, same contents: without `shallow` this would report a change
// on literally every message, which is the bug this pairing exists to stop.
state = { ...state, chat: [...state.chat, "tudo bem?"] };
assert.equal(getIdentity(), firstIdentity, "same contents must keep the previous reference");

state = { ...state, name: "bia" };
assert.notEqual(getIdentity(), firstIdentity, "a changed field must produce a new object");
assert.equal(getIdentity().name, "bia");

// ── shallow itself ────────────────────────────────────────────────────────

assert.ok(shallow({ a: 1, b: "x" }, { a: 1, b: "x" }));
assert.ok(!shallow({ a: 1 }, { a: 2 }));
assert.ok(!shallow({ a: 1 } as Record<string, unknown>, { a: 1, b: 2 }));
assert.ok(!shallow({ a: 1, b: 2 } as Record<string, unknown>, { a: 1 }));
// Compares one level only, by identity — a nested object that was rebuilt
// counts as changed, which is why selectors return flat slices.
const nested = { id: 1 };
assert.ok(shallow({ n: nested }, { n: nested }));
assert.ok(!shallow({ n: { id: 1 } }, { n: { id: 1 } }));

console.log("signalingSelector: ok");
