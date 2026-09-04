"use client";

// The app's one and only AudioContext, plus the machinery that keeps it
// actually *running*.
//
// Why this exists at all
// ---------------------
// Browsers start an AudioContext created without user activation in the
// "suspended" state (Chrome's Web Audio autoplay policy; Safari/iOS is
// stricter still). A suspended context does not process audio: every node in
// it is silent, in both directions.
//
// That is not a theoretical concern here, because two of the app's audio
// paths are built at moments when no click has necessarily happened yet:
//
//   - the mic: useRoomMedia auto-starts it from a stored preference on load
//     (getStoredMicOn), and the captured audio is broadcast through an
//     RNNoise graph (rnnoise.ts). A suspended context there means the
//     MediaStreamAudioDestinationNode outputs digital silence, so the person
//     is transmitting nothing while their own UI shows the mic on and their
//     peer connections look perfectly healthy. "Ninguém me ouve."
//
//   - playback: audioGain.ts routes every remote stream through a GainNode
//     and mutes the <audio>/<video> element, because the graph is a second
//     path to the speakers. A suspended context there means the graph is
//     silent *and* the element is muted. "Não ouço ninguém."
//
// Both used to call `ctx.resume()` once, fire-and-forget, and swallow the
// rejection — so a context that started suspended stayed suspended for the
// whole session, with nothing in the UI to suggest anything was wrong. A
// later click could have fixed it, and nothing was listening for one.
//
// Why one context and not four
// ----------------------------
// There used to be four creators: this gain graph, the mic's RNNoise graph,
// the sound effects, and — the expensive one — useSpeaking, which built a
// *whole context per participant* just to run an analyser. Chrome caps
// concurrent AudioContexts per page (6) and throws on construction past it,
// so a call with six people talking could take out the audio graph itself.
// One context, many nodes, is what Web Audio is designed for.

// The rate the context is asked to run at, and the only rate RNNoise can
// be fed (see rnnoise.ts, and the "Assumes sample rate to be 48kHz" on the
// library node itself).
//
// Left unspecified, a context takes the sample rate of the *output* device —
// 44.1 kHz on a great deal of onboard hardware, and 16 kHz or 8 kHz on a
// Bluetooth headset switched into hands-free mode. RNNoise checks none of
// that: it slices fixed 480-sample frames whatever the rate, so at anything
// but 48 kHz it mis-reads the signal and its voice detector gates away what
// it no longer recognises as speech. The person is transmitting, their
// microphone is the one they picked, and nobody hears them — and because the
// rate came from the speaker, changing microphone never helped.
//
// Asking for it here fixes that for everyone the browser grants it to.
// rnnoise.ts still checks, for the ones it does not.
export const RNNOISE_SAMPLE_RATE = 48000;

const GESTURE_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

let sharedContext: AudioContext | null = null;
let constructionFailed = false;
// Bumped on anything a consumer might need to react to: the context's state
// changing, or the preferred output device changing. Consumers read it
// through useSyncExternalStore (see useGainedAudio) rather than polling.
let version = 0;
const listeners = new Set<() => void>();
let gestureArmed = false;
const gestureCallbacks = new Set<() => void>();
let preferredSinkId: string | null = null;
// Whether the context itself could be pointed at `preferredSinkId`. False
// when a specific device is wanted but AudioContext.setSinkId isn't
// available — see canRouteToPreferredSink, which is what stops the gain
// graph from silently overriding someone's speaker choice.
let sinkHonored = true;

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeAudioStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Snapshot for useSyncExternalStore: any change that consumers care about
// bumps it, so "did anything change" is a cheap integer comparison.
export function getAudioStatusVersion(): number {
  return version;
}

export function getAudioStatusVersionServer(): number {
  return 0;
}

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || constructionFailed) return null;
  if (sharedContext) return sharedContext;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    constructionFailed = true;
    return null;
  }
  try {
    sharedContext = new Ctor({ sampleRate: RNNOISE_SAMPLE_RATE });
  } catch {
    // Two very different failures land here: a browser refusing this
    // particular rate, and construction failing for a reason that has
    // nothing to do with it (Chrome's concurrent-context cap being the
    // famous one). Retrying without the option is what tells them apart —
    // hardware that will not take 48 kHz still gets a working context at
    // whatever rate it prefers, and rnnoise.ts declines to build its graph
    // on that context rather than feeding RNNoise a rate it mis-reads.
    try {
      sharedContext = new Ctor();
    } catch {
      // Genuinely no context to be had. Remembered so every later caller
      // falls back cleanly (element volume, no analyser) instead of
      // throwing again from inside a React effect.
      constructionFailed = true;
      return null;
    }
  }
  // iOS in particular re-suspends on interruptions (a call, the screen
  // locking), so this isn't only about the first resume.
  sharedContext.addEventListener("statechange", () => {
    notify();
    if (sharedContext?.state === "suspended") armGestureResume();
  });
  applyPreferredSink();
  return sharedContext;
}

export function isSharedAudioContextRunning(): boolean {
  return sharedContext?.state === "running";
}

// Runs `cb` on the next real user interaction anywhere on the page. This is
// the only thing a browser accepts as permission to start audio, and the
// listeners are capture-phase and passive so nothing in the app can swallow
// the gesture before we see it.
export function onNextUserGesture(cb: () => void) {
  gestureCallbacks.add(cb);
  armGestureListeners();
}

function armGestureListeners() {
  if (gestureArmed || typeof window === "undefined") return;
  gestureArmed = true;
  const handler = () => {
    disarmGestureListeners();
    const callbacks = [...gestureCallbacks];
    gestureCallbacks.clear();
    for (const cb of callbacks) {
      try {
        cb();
      } catch {
        // One bad callback must not stop the others from getting their
        // gesture — there is only ever one first click to spend.
      }
    }
  };
  gestureHandler = handler;
  for (const event of GESTURE_EVENTS) {
    window.addEventListener(event, handler, { capture: true, passive: true });
  }
}

let gestureHandler: (() => void) | null = null;

function disarmGestureListeners() {
  if (!gestureHandler || typeof window === "undefined") return;
  for (const event of GESTURE_EVENTS) {
    window.removeEventListener(event, gestureHandler, { capture: true });
  }
  gestureHandler = null;
  gestureArmed = false;
}

function armGestureResume() {
  onNextUserGesture(() => {
    void ensureSharedAudioContextRunning();
  });
}

// Resumes the context, and — if the browser refuses because nothing has been
// clicked yet — arms a retry on the next gesture. Awaitable so callers that
// can genuinely make a decision from the answer (rnnoise.ts falls back to
// the raw mic capture) get to.
export async function ensureSharedAudioContextRunning(): Promise<boolean> {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  // Both checks go through isSharedAudioContextRunning rather than reading
  // ctx.state directly: the state changes underneath us across the await,
  // which is precisely what a narrowed local read would fail to notice.
  if (isSharedAudioContextRunning()) return true;
  try {
    await ctx.resume();
  } catch {
    // Expected without user activation — not an error worth surfacing, just
    // a "not yet".
  }
  if (isSharedAudioContextRunning()) return true;
  armGestureResume();
  return false;
}

type SinkableContext = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

function applyPreferredSink() {
  const ctx = sharedContext as SinkableContext | null;
  if (!ctx) return;
  if (!preferredSinkId) {
    sinkHonored = true;
    return;
  }
  if (typeof ctx.setSinkId !== "function") {
    // No way to move this context's output. Reported through
    // canRouteToPreferredSink so playback falls back to the media element,
    // whose setSinkId does work — capped at 100%, but coming out of the
    // speaker the person actually chose.
    sinkHonored = false;
    notify();
    return;
  }
  ctx
    .setSinkId(preferredSinkId)
    .then(() => {
      sinkHonored = true;
      notify();
    })
    .catch(() => {
      // Device unplugged since it was picked, or refused — same fallback.
      sinkHonored = false;
      notify();
    });
}

// Called when someone picks an output device in the speaker picker.
export function setPreferredAudioSink(sinkId: string | null) {
  if (preferredSinkId === sinkId) return;
  preferredSinkId = sinkId;
  sinkHonored = !sinkId;
  applyPreferredSink();
  notify();
}

// Whether audio routed through the shared context reaches the device the
// user asked for. Always true when they haven't asked for a specific one.
export function canRouteToPreferredSink(): boolean {
  return sinkHonored;
}

// Starts playback and, if the browser blocks it for the same
// no-user-activation reason a suspended context has, retries on the next
// gesture. A media element's autoplay is a separate gate from the audio
// graph's: both have to be gotten through, and this covers the element side.
export function playWhenAllowed(element: HTMLMediaElement) {
  const attempt = () => {
    const promise = element.play();
    if (!promise) return;
    promise.catch(() => {
      onNextUserGesture(() => {
        void element.play().catch(() => {});
      });
    });
  };
  attempt();
}
