// Generated from lib/nativeVideoSink.worker.ts by "npm run workers:build". Do not edit.
"use strict";
(() => {
  // lib/nativeVideoFrames.ts
  var MAX_FRAME_BYTES = 32 * 1024 * 1024;
  function splitNalUnits(data) {
    const units = [];
    for (let i = 0; i + 2 < data.length; i++) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
      const start = i > 0 && data[i - 1] === 0 ? i - 1 : i;
      if (units.length > 0) units[units.length - 1].end = start;
      const header = i + 3;
      units.push({ start, end: data.length, type: header < data.length ? data[header] & 31 : 0 });
      i = header - 1;
    }
    return units;
  }
  var NAL_IDR = 5;
  var NAL_SPS = 7;
  var NAL_PPS = 8;
  var NAL_AUD = 9;
  var ParameterSetKeeper = class {
    constructor() {
      this.sps = null;
      this.pps = null;
    }
    /** The SPS bytes after the NAL header, for codecStringFromSps. */
    get spsPayload() {
      if (!this.sps) return null;
      const offset = (this.sps[2] === 1 ? 3 : 4) + 1;
      return this.sps.subarray(offset);
    }
    process(data) {
      const units = splitNalUnits(data);
      let idr = false;
      let hasSps = false;
      let hasPps = false;
      for (const unit of units) {
        if (unit.type === NAL_IDR) idr = true;
        if (unit.type === NAL_SPS) {
          this.sps = data.slice(unit.start, unit.end);
          hasSps = true;
        }
        if (unit.type === NAL_PPS) {
          this.pps = data.slice(unit.start, unit.end);
          hasPps = true;
        }
      }
      if (!idr || hasSps && hasPps || !this.sps || !this.pps) return { data, idr };
      let at = 0;
      for (const unit of units) {
        if (unit.type !== NAL_AUD) break;
        at = unit.end;
      }
      const out = new Uint8Array(data.length + this.sps.length + this.pps.length);
      out.set(data.subarray(0, at), 0);
      out.set(this.sps, at);
      out.set(this.pps, at + this.sps.length);
      out.set(data.subarray(at), at + this.sps.length + this.pps.length);
      return { data: out, idr };
    }
  };

  // lib/nativeVideoSink.ts
  var STALL_TIMEOUT_MS = 300;
  var HOLD_KEY_TIMEOUT_MS = 2500;
  var MAX_BACKLOG = 30;
  var MIN_WRITE_GAP_MS = 2;
  var SenderSink = class {
    constructor(writer, host) {
      this.stats = { keyHolds: 0, keyStale: 0, resyncs: 0, keys: 0, keyWaitMs: 0 };
      this.closed = false;
      // Since when this viewer's picture has been waiting for an IDR; null when it is not.
      this.waitingSince = null;
      this.queue = [];
      this.inflight = null;
      this.held = null;
      this.needKey = true;
      this.connected = false;
      // The viewer is not looking: nothing is fed in, and the encoder sits idle.
      this.paused = false;
      this.timestamp = 0;
      this.stallTimer = null;
      this.lastWriteAt = -Infinity;
      this.gapTimer = null;
      this.writer = writer;
      this.host = host;
      this.blank = new Uint8Array(16 * 16 + 2 * 8 * 8);
      this.blank.fill(16, 0, 16 * 16);
      this.blank.fill(128, 16 * 16);
    }
    /** Whether frames are going out to this viewer: connected, and looking. */
    get taking() {
      return !this.closed && this.connected && !this.paused;
    }
    setConnected(connected) {
      if (this.closed || this.connected === connected) return;
      this.connected = connected;
      if (connected) {
        this.resync("fresh");
      } else {
        this.queue = [];
        this.waitingSince = null;
      }
    }
    setPaused(paused) {
      if (this.closed || this.paused === paused) return;
      this.paused = paused;
      this.queue = [];
      if (!paused) this.resync("fresh");
      else this.waitingSince = null;
    }
    onNative(frame) {
      if (this.closed || !this.connected || this.paused) return;
      if (frame.key) this.stats.keys += 1;
      if (this.held) {
        if (!frame.key) return;
        this.release(frame);
        this.endWait();
        return;
      }
      if (this.needKey) {
        if (!frame.key) return;
        this.needKey = false;
        this.endWait();
      }
      this.queue.push(frame);
      this.pump();
    }
    startWait() {
      this.waitingSince ??= performance.now();
    }
    endWait() {
      if (this.waitingSince === null) return;
      this.stats.keyWaitMs += performance.now() - this.waitingSince;
      this.waitingSince = null;
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.stallTimer) clearTimeout(this.stallTimer);
      if (this.gapTimer) clearTimeout(this.gapTimer);
      if (this.held) {
        const { resolve } = this.held;
        this.held = null;
        resolve();
      }
      this.queue = [];
      void this.writer.close().catch(() => {
      });
    }
    resync(need = "lost") {
      this.stats.resyncs += 1;
      this.inflight = null;
      this.queue = [];
      this.needKey = true;
      this.startWait();
      this.host.requestKeyFrame(need);
    }
    pump() {
      if (this.closed || this.inflight || this.held || this.queue.length === 0) return;
      if (!this.connected || this.paused) return;
      if (this.queue.length > MAX_BACKLOG) {
        this.resync("lost");
        return;
      }
      const wait = this.lastWriteAt + MIN_WRITE_GAP_MS - performance.now();
      if (wait > 0) {
        this.gapTimer ??= setTimeout(() => {
          this.gapTimer = null;
          this.pump();
        }, wait);
        return;
      }
      this.lastWriteAt = performance.now();
      this.inflight = this.queue.shift();
      this.timestamp = Math.max(Math.round((this.inflight.timeMs ?? performance.now()) * 1e3), this.timestamp + 1e3);
      const frame = new VideoFrame(this.blank, {
        format: "I420",
        codedWidth: 16,
        codedHeight: 16,
        timestamp: this.timestamp
      });
      void this.writer.write(frame).then(
        () => frame.close(),
        () => frame.close()
      );
      if (this.stallTimer) clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        if (this.inflight) this.resync("lost");
      }, STALL_TIMEOUT_MS);
    }
    fill(frame, controller, native) {
      const copy = new Uint8Array(native.data.byteLength);
      copy.set(native.data);
      frame.data = copy.buffer;
      controller.enqueue(frame);
    }
    release(native) {
      const held = this.held;
      if (!held) return;
      this.held = null;
      this.needKey = false;
      this.fill(held.frame, held.controller, native);
      held.resolve();
    }
    /** The transform on the stand-in's encoded output. */
    onEncoded(frame, controller) {
      if (this.stallTimer) {
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
      }
      const native = this.inflight;
      this.inflight = null;
      if (this.closed) return;
      if (frame.type === "key" && !(native && native.key)) {
        this.queue = [];
        this.needKey = true;
        this.stats.keyHolds += 1;
        this.startWait();
        this.host.requestKeyFrame("lost");
        return new Promise((resolve) => {
          this.held = { frame, controller, resolve };
          setTimeout(() => {
            if (this.held?.frame !== frame) return;
            const fallback = this.host.lastKey();
            if (fallback) {
              this.stats.keyStale += 1;
              this.release(fallback);
              this.needKey = true;
              this.host.requestKeyFrame("lost");
            } else {
              this.held = null;
              resolve();
            }
          }, HOLD_KEY_TIMEOUT_MS);
        }).then(() => queueMicrotask(() => this.pump()));
      }
      if (!native) {
        this.resync("lost");
        return;
      }
      this.fill(frame, controller, native);
      queueMicrotask(() => this.pump());
    }
  };
  var PACE_MIN_GAP_MS = 1e3;
  var PACE_FREE_VIEWERS = 3;
  var PACE_GAP_PER_VIEWER_MS = 250;
  var PACE_MAX_GAP_MS = 2500;
  var PACE_BACKOFF_FIRST_MS = 2e3;
  var PACE_BACKOFF_MAX_MS = 4e3;
  var PACE_REPEAT_WINDOW_MS = 1e4;
  var PACE_RESEND_MS = 2e3;
  var realClock = {
    now: () => performance.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle)
  };
  var KeyPacer = class {
    constructor(send, clock = realClock) {
      /** Whether this machine is in the experiment. Off: every request goes straight through. */
      this.enabled = false;
      /** IDRs asked of the helper, for the tests. */
      this.sent = 0;
      // Who is waiting, and from when they may be served.
      this.pending = /* @__PURE__ */ new Map();
      this.history = /* @__PURE__ */ new Map();
      this.active = 0;
      this.lastSentAt = -Infinity;
      this.timer = null;
      this.timerAt = Infinity;
      this.send = send;
      this.clock = clock;
    }
    /** `sink` needs an IDR; `active` is how many viewers are taking frames right now. */
    request(sink, need, active) {
      this.active = active;
      if (!this.enabled || active < 2) {
        this.sent += 1;
        this.send();
        return;
      }
      const now = this.clock.now();
      const past = this.history.get(sink);
      const at = need === "lost" && past && now - past.servedAt < PACE_REPEAT_WINDOW_MS ? past.servedAt + past.backoff : now;
      const before = this.pending.get(sink);
      this.pending.set(sink, before === void 0 ? at : Math.min(before, at));
      this.schedule();
    }
    /** An IDR from the helper went out: whoever was waiting has it. */
    keyArrived() {
      if (this.pending.size === 0) return;
      const now = this.clock.now();
      for (const sink of this.pending.keys()) {
        const past = this.history.get(sink);
        const again = past !== void 0 && now - past.servedAt < PACE_REPEAT_WINDOW_MS;
        this.history.set(sink, {
          servedAt: now,
          backoff: again ? Math.min(past.backoff * 2, PACE_BACKOFF_MAX_MS) : PACE_BACKOFF_FIRST_MS
        });
      }
      this.pending.clear();
      this.cancel();
    }
    /** This viewer is gone. */
    forget(sink) {
      this.pending.delete(sink);
      this.history.delete(sink);
      if (this.pending.size === 0) this.cancel();
    }
    /** The experiment turned off: whoever is waiting goes now. */
    setEnabled(enabled) {
      if (this.enabled === enabled) return;
      this.enabled = enabled;
      if (enabled || this.pending.size === 0) return;
      this.pending.clear();
      this.cancel();
      this.sent += 1;
      this.send();
    }
    gap() {
      const extra = Math.max(0, this.active - PACE_FREE_VIEWERS);
      return Math.min(PACE_MAX_GAP_MS, PACE_MIN_GAP_MS + extra * PACE_GAP_PER_VIEWER_MS);
    }
    cancel() {
      if (this.timer !== null) this.clock.clearTimeout(this.timer);
      this.timer = null;
      this.timerAt = Infinity;
    }
    schedule() {
      if (this.pending.size === 0) return;
      const at = Math.max(Math.min(...this.pending.values()), this.lastSentAt + this.gap());
      if (this.timer !== null && this.timerAt <= at) return;
      this.cancel();
      this.timerAt = at;
      this.timer = this.clock.setTimeout(() => this.fire(), Math.max(0, at - this.clock.now()));
    }
    fire() {
      this.timer = null;
      this.timerAt = Infinity;
      if (this.pending.size === 0) return;
      const now = this.clock.now();
      const due = Math.min(...this.pending.values());
      if (due > now || now < this.lastSentAt + this.gap()) {
        this.schedule();
        return;
      }
      this.lastSentAt = now;
      this.sent += 1;
      this.send();
      this.timerAt = now + PACE_RESEND_MS;
      this.timer = this.clock.setTimeout(() => this.fire(), PACE_RESEND_MS);
    }
  };

  // lib/nativeVideoSink.worker.ts
  var scope = self;
  var sinks = /* @__PURE__ */ new Map();
  var keeper = new ParameterSetKeeper();
  var lastKeyFrame = null;
  var previewActive = false;
  var pacer = new KeyPacer(() => scope.postMessage({ type: "need-key" }));
  function takingSinks() {
    let n = 0;
    for (const sink of sinks.values()) if (sink.taking) n += 1;
    return n;
  }
  function hostFor(id) {
    return {
      requestKeyFrame: (need) => pacer.request(id, need, takingSinks()),
      lastKey: () => lastKeyFrame
    };
  }
  function onFrame(raw, timeMs) {
    const { data, idr } = keeper.process(raw);
    const frame = { key: idr, data, timeMs };
    if (idr) lastKeyFrame = frame;
    for (const sink of sinks.values()) sink.onNative(frame);
    if (idr) pacer.keyArrived();
    if (previewActive) {
      const copy = data.slice(0);
      scope.postMessage({ type: "preview-frame", key: idr, data: copy.buffer }, [copy.buffer]);
    }
  }
  scope.onmessage = (event) => {
    const message = event.data;
    switch (message.type) {
      case "frame":
        onFrame(new Uint8Array(message.data), message.timeMs);
        break;
      case "port":
        message.port.onmessage = (e) => {
          if (e.data?.data instanceof Uint8Array) onFrame(e.data.data, e.data.timeMs);
        };
        break;
      case "preview":
        previewActive = message.active;
        break;
      case "sink": {
        const sink = new SenderSink(message.writable.getWriter(), hostFor(message.id));
        sinks.set(message.id, sink);
        const transform = new TransformStream({
          transform: (frame, controller) => sink.onEncoded(frame, controller)
        });
        void message.encodedReadable.pipeThrough(transform).pipeTo(message.encodedWritable).catch(() => {
        });
        break;
      }
      case "passthrough":
        void message.readable.pipeTo(message.writable).catch(() => {
        });
        break;
      case "state":
        sinks.get(message.id)?.setConnected(message.connected);
        break;
      case "paused":
        sinks.get(message.id)?.setPaused(message.paused);
        break;
      case "close":
        sinks.get(message.id)?.close();
        sinks.delete(message.id);
        pacer.forget(message.id);
        break;
      case "pace":
        pacer.setEnabled(message.on);
        break;
      case "stop":
        for (const sink of sinks.values()) sink.close();
        sinks.clear();
        break;
    }
  };
  scope.setInterval(() => {
    if (sinks.size === 0) return;
    scope.postMessage({
      type: "stats",
      stats: [...sinks].map(([id, sink]) => ({ id, ...sink.stats }))
    });
  }, 5e3);
})();
