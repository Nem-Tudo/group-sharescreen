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
    constructor(writer, host2) {
      this.stats = { keyHolds: 0, keyStale: 0, resyncs: 0 };
      this.closed = false;
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
      this.host = host2;
      this.blank = new Uint8Array(16 * 16 + 2 * 8 * 8);
      this.blank.fill(16, 0, 16 * 16);
      this.blank.fill(128, 16 * 16);
    }
    setConnected(connected) {
      if (this.closed || this.connected === connected) return;
      this.connected = connected;
      if (connected) {
        this.resync();
      } else {
        this.queue = [];
      }
    }
    setPaused(paused) {
      if (this.closed || this.paused === paused) return;
      this.paused = paused;
      this.queue = [];
      if (!paused) this.resync();
    }
    onNative(frame) {
      if (this.closed || !this.connected || this.paused) return;
      if (this.held) {
        if (!frame.key) return;
        this.release(frame);
        return;
      }
      if (this.needKey) {
        if (!frame.key) return;
        this.needKey = false;
      }
      this.queue.push(frame);
      this.pump();
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
    resync() {
      this.stats.resyncs += 1;
      this.inflight = null;
      this.queue = [];
      this.needKey = true;
      this.host.requestKeyFrame();
    }
    pump() {
      if (this.closed || this.inflight || this.held || this.queue.length === 0) return;
      if (!this.connected || this.paused) return;
      if (this.queue.length > MAX_BACKLOG) {
        this.resync();
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
        if (this.inflight) this.resync();
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
        this.host.requestKeyFrame();
        return new Promise((resolve) => {
          this.held = { frame, controller, resolve };
          setTimeout(() => {
            if (this.held?.frame !== frame) return;
            const fallback = this.host.lastKey();
            if (fallback) {
              this.stats.keyStale += 1;
              this.release(fallback);
              this.needKey = true;
              this.host.requestKeyFrame();
            } else {
              this.held = null;
              resolve();
            }
          }, HOLD_KEY_TIMEOUT_MS);
        }).then(() => queueMicrotask(() => this.pump()));
      }
      if (!native) {
        this.resync();
        return;
      }
      this.fill(frame, controller, native);
      queueMicrotask(() => this.pump());
    }
  };

  // lib/nativeVideoSink.worker.ts
  var scope = self;
  var sinks = /* @__PURE__ */ new Map();
  var keeper = new ParameterSetKeeper();
  var lastKeyFrame = null;
  var previewActive = false;
  var host = {
    requestKeyFrame: () => scope.postMessage({ type: "need-key" }),
    lastKey: () => lastKeyFrame
  };
  function onFrame(raw, timeMs) {
    const { data, idr } = keeper.process(raw);
    const frame = { key: idr, data, timeMs };
    if (idr) lastKeyFrame = frame;
    for (const sink of sinks.values()) sink.onNative(frame);
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
        const sink = new SenderSink(message.writable.getWriter(), host);
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
