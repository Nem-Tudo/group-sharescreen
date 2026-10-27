// The frame loop of "Efeitos de câmera" (see lib/cameraEffects.ts).
//
// The camera's frames arrive here as VideoFrames (a MediaStreamTrackProcessor
// on the page, its readable transferred in) and leave as VideoFrames (into a
// MediaStreamTrackGenerator's writable), so nothing on the page's thread
// touches a pixel, and nothing here is paced by requestAnimationFrame — which
// is what keeps the camera moving for the room while the tab is in the
// background.
//
// MediaPipe (face landmarks, selfie segmentation) is loaded from the CDN the
// first time an effect that needs it is picked, and only that model: blur
// never downloads the face model, a dog nose never downloads the segmenter.
// Until it is ready, frames go through untouched instead of waiting.
//
// A classic worker, not a module one: MediaPipe loads its WASM glue with
// importScripts, which module workers do not have. The library itself is its
// ES module build, through import() (allowed in a classic worker too).
//
// One worker for every pipeline (a camera flip briefly runs two), so the
// models are loaded once and shared.

// Loaded as /workers/camera-effects.js?v=N (see WORKER_VERSION in
// lib/cameraEffects.ts): bump it there whenever this file changes.
const VISION_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const SEGMENT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

// Detection runs on a copy this wide, not on the camera's own frame: both
// models resize to 256px or less internally, so handing them 1080p only adds
// an upload. The segmentation mask comes back at this size too, which is what
// keeps reading it back cheap.
const DETECT_WIDTH = 320;
// The background is blurred at the detection size and stretched back up — at
// 320px a 6px blur reads like ~36px at 1920, for a fraction of the work, and
// the stretch only adds to the blur.
const BLUR_PX = 6;

const COLOR_FILTERS = {
  none: "none",
  mono: "grayscale(1)",
  sepia: "sepia(0.85)",
  vivid: "saturate(1.45) contrast(1.08)",
};

let settings = null;
let visionPromise = null;
const tasks = {
  face: { task: null, loading: false, failed: false },
  segment: { task: null, loading: false, failed: false },
};
const pipelines = new Map();
let lastTimestamp = 0;

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "settings") {
    settings = data.settings || null;
    ensureTasks();
  } else if (data.type === "start") {
    startPipeline(data.id, data.readable, data.writable);
  } else if (data.type === "stop") {
    const pipeline = pipelines.get(data.id);
    if (pipeline) pipeline.stopped = true;
  }
};

// ---------------------------------------------------------------------------
// MediaPipe

function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      // The ES module build, through import(). The CommonJS one cannot be
      // loaded at all: jsDelivr serves .cjs as "application/node", which
      // importScripts refuses to execute (strict MIME checking).
      const vision = await import(`${VISION_BASE}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_BASE}/wasm`);
      return { vision, fileset };
    })();
    visionPromise.catch(() => {
      visionPromise = null;
    });
  }
  return visionPromise;
}

async function createTask(kind) {
  const { vision, fileset } = await loadVision();
  const make = (delegate) =>
    kind === "face"
      ? vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          numFaces: 2,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        })
      : vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
  // The GPU first; a machine whose WebGL will not have it (blocklisted
  // driver, software rendering) still gets the effect on the CPU, slower.
  try {
    return await make("GPU");
  } catch {
    return make("CPU");
  }
}

function wants(kind) {
  if (!settings) return false;
  return kind === "face" ? settings.face !== "none" : settings.background !== "none";
}

function ensureTasks() {
  for (const kind of ["face", "segment"]) {
    const slot = tasks[kind];
    if (!wants(kind) || slot.task || slot.loading || slot.failed) continue;
    slot.loading = true;
    createTask(kind)
      .then(
        (task) => {
          slot.task = task;
        },
        (err) => {
          slot.failed = true;
          const reason = String((err && err.message) || err).slice(0, 120);
          self.postMessage({ type: "error", kind, reason });
        }
      )
      .finally(() => {
        slot.loading = false;
        postStatus();
      });
  }
  postStatus();
}

function postStatus() {
  const loading = ["face", "segment"].some((kind) => wants(kind) && tasks[kind].loading);
  self.postMessage({ type: "status", loading });
}

// Both tasks want strictly increasing timestamps, across every pipeline
// feeding them.
function nextTimestamp() {
  lastTimestamp = Math.max(lastTimestamp + 1, performance.now());
  return lastTimestamp;
}

// ---------------------------------------------------------------------------
// The frame loop

function startPipeline(id, readable, writable) {
  const pipeline = {
    id,
    stopped: false,
    canvas: null,
    ctx: null,
    small: null,
    smallCtx: null,
    bg: null,
    bgCtx: null,
    mask: null,
    maskCtx: null,
    maskData: null,
    maskBuffer: null,
    hasMask: false,
    faces: [],
    missed: 0,
    frameIndex: 0,
    detectEvery: 1,
    detectCost: 0,
    lastFrameTs: 0,
    frameInterval: 33,
    renderFailed: false,
    statsSince: performance.now(),
    statsFrames: 0,
    statsMs: 0,
  };
  pipelines.set(id, pipeline);
  run(pipeline, readable.getReader(), writable.getWriter())
    .catch(() => {})
    .finally(() => {
      pipelines.delete(id);
      self.postMessage({ type: "ended", id });
    });
}

function needsDrawing() {
  return Boolean(
    settings && (settings.face !== "none" || settings.background !== "none" || settings.color !== "none")
  );
}

async function run(pipeline, reader, writer) {
  try {
    while (!pipeline.stopped) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      if (pipeline.stopped) {
        frame.close();
        break;
      }
      let out = frame;
      // Nothing picked (or only just un-picked): straight through, no canvas,
      // no copy — what keeps a camera that had effects on this session as
      // cheap as one that never did.
      if (needsDrawing() && !pipeline.renderFailed) {
        const started = performance.now();
        try {
          out = render(pipeline, frame);
        } catch (err) {
          pipeline.renderFailed = true;
          self.postMessage({ type: "error", kind: "render", reason: String((err && err.message) || err).slice(0, 120) });
          out = frame;
        }
        if (out !== frame) frame.close();
        pipeline.statsFrames += 1;
        pipeline.statsMs += performance.now() - started;
      }
      try {
        await writer.write(out);
      } catch (err) {
        out.close();
        throw err;
      }
      reportStats(pipeline);
    }
  } finally {
    reader.cancel().catch(() => {});
    writer.close().catch(() => {});
  }
}

function reportStats(pipeline) {
  const now = performance.now();
  if (now - pipeline.statsSince < 10000) return;
  if (pipeline.statsFrames > 0) {
    self.postMessage({
      type: "stats",
      id: pipeline.id,
      frameMs: pipeline.statsMs / pipeline.statsFrames,
      detectMs: pipeline.detectCost,
      detectEvery: pipeline.detectEvery,
    });
  }
  pipeline.statsSince = now;
  pipeline.statsFrames = 0;
  pipeline.statsMs = 0;
}

function ensureCanvases(p, width, height) {
  if (p.canvas && p.canvas.width === width && p.canvas.height === height) return;
  p.canvas = new OffscreenCanvas(width, height);
  p.ctx = p.canvas.getContext("2d", { alpha: false });
  const sw = Math.min(DETECT_WIDTH, width);
  const sh = Math.max(2, Math.round((sw * height) / width));
  p.small = new OffscreenCanvas(sw, sh);
  p.smallCtx = p.small.getContext("2d", { alpha: false });
  p.bg = new OffscreenCanvas(sw, sh);
  p.bgCtx = p.bg.getContext("2d");
  p.mask = new OffscreenCanvas(sw, sh);
  p.maskCtx = p.mask.getContext("2d");
  p.maskData = new ImageData(sw, sh);
  p.maskBuffer = new Float32Array(sw * sh);
  p.hasMask = false;
  p.faces = [];
}

function render(p, frame) {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  ensureCanvases(p, width, height);
  const s = settings;
  const ctx = p.ctx;

  // How far apart frames arrive, for the detection budget below.
  const ts = frame.timestamp / 1000;
  if (p.lastFrameTs && ts > p.lastFrameTs) {
    p.frameInterval = p.frameInterval * 0.9 + (ts - p.lastFrameTs) * 0.1;
  }
  p.lastFrameTs = ts;

  const segmenter = s.background !== "none" ? tasks.segment.task : null;
  const landmarker = s.face !== "none" ? tasks.face.task : null;
  if (!segmenter) p.hasMask = false;
  if (!landmarker) p.faces = [];

  p.frameIndex += 1;
  if ((segmenter || landmarker) && p.frameIndex % p.detectEvery === 0) {
    const started = performance.now();
    p.smallCtx.drawImage(frame, 0, 0, p.small.width, p.small.height);
    const timestamp = nextTimestamp();
    if (segmenter) segment(p, segmenter, timestamp);
    if (landmarker) detectFaces(p, landmarker, timestamp, width, height);
    p.detectCost = p.detectCost ? p.detectCost * 0.8 + (performance.now() - started) * 0.2 : performance.now() - started;
    adaptDetection(p);
  }

  const color = COLOR_FILTERS[s.color] || "none";
  ctx.filter = color;
  ctx.drawImage(frame, 0, 0, width, height);
  ctx.filter = "none";
  if (segmenter && p.hasMask) drawBlurredBackground(p, frame, color, width, height);
  if (landmarker) for (const face of p.faces) drawFace(ctx, s.face, face);

  return new VideoFrame(p.canvas, { timestamp: frame.timestamp, alpha: "discard" });
}

// Detection on every frame while it fits in half a frame's time; past that,
// every other frame (or third, or fourth) with the last answer reused in
// between. A 60 fps camera never detects more than 30 times a second — the
// overlay moving at 30 is indistinguishable, the cost is not.
function adaptDetection(p) {
  const budget = p.frameInterval * 0.5;
  const floor = p.frameInterval < 25 ? 2 : 1;
  const needed = Math.ceil(p.detectCost / Math.max(budget, 1));
  p.detectEvery = Math.min(4, Math.max(floor, needed));
}

// ---------------------------------------------------------------------------
// Background blur

function segment(p, segmenter, timestamp) {
  segmenter.segmentForVideo(p.small, timestamp, (result) => {
    const masks = result.confidenceMasks;
    if (!masks || masks.length === 0) return;
    // Two masks: background, person. One: person.
    const mask = masks.length > 1 ? masks[1] : masks[0];
    const values = mask.getAsFloat32Array();
    const buffer = p.maskBuffer;
    const pixels = p.maskData.data;
    // A little of the previous mask kept, against flicker at the edges.
    const keep = p.hasMask ? 0.45 : 0;
    const count = Math.min(values.length, buffer.length);
    for (let i = 0; i < count; i += 1) {
      const v = buffer[i] * keep + values[i] * (1 - keep);
      buffer[i] = v;
      // Steepened, so a half-sure edge is not a ghost of the person.
      pixels[i * 4 + 3] = (v - 0.25) * 510;
    }
    p.maskCtx.putImageData(p.maskData, 0, 0);
    p.hasMask = true;
  });
}

function drawBlurredBackground(p, frame, color, width, height) {
  const bg = p.bg;
  const ctx = p.bgCtx;
  ctx.globalCompositeOperation = "copy";
  ctx.filter = color === "none" ? `blur(${BLUR_PX}px)` : `blur(${BLUR_PX}px) ${color}`;
  // Drawn past the edges so the blur has something to pull in there, instead
  // of fading the borders to black.
  const pad = BLUR_PX * 2;
  ctx.drawImage(frame, -pad, -pad, bg.width + pad * 2, bg.height + pad * 2);
  ctx.filter = "none";
  // The person cut out of the blurred copy, which then goes over the sharp
  // frame: only the background ends up blurred.
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(p.mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  p.ctx.drawImage(bg, 0, 0, width, height);
}

// ---------------------------------------------------------------------------
// Faces

function detectFaces(p, landmarker, timestamp, width, height) {
  const result = landmarker.detectForVideo(p.small, timestamp);
  const found = (result.faceLandmarks || []).map((landmarks) => anchorsOf(landmarks, width, height));
  if (found.length === 0) {
    // A face lost for a frame or two (a hand passing, motion blur) keeps its
    // overlay instead of blinking.
    p.missed += 1;
    if (p.missed > 3) p.faces = [];
    return;
  }
  p.missed = 0;
  p.faces = found.map((face) => {
    const previous = nearest(p.faces, face);
    return previous ? smooth(previous, face) : face;
  });
}

function point(landmarks, index, width, height) {
  const q = landmarks[index];
  return { x: q.x * width, y: q.y * height };
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The handful of points the overlays hang off, in output pixels. Indices are
// MediaPipe's face mesh: 10 top of the forehead, 152 chin, 234/454 the sides
// of the face, 33/133 and 263/362 the corners of each eye, 1 the tip of the
// nose, 13/14 the inside of the lips, 205/425 the cheeks.
function anchorsOf(landmarks, width, height) {
  const at = (index) => point(landmarks, index, width, height);
  const eyeLeft = mid(at(33), at(133));
  const eyeRight = mid(at(263), at(362));
  const top = at(10);
  const chin = at(152);
  const faceH = dist(top, chin);
  return {
    angle: Math.atan2(eyeRight.y - eyeLeft.y, eyeRight.x - eyeLeft.x),
    size: dist(at(234), at(454)),
    top,
    nose: at(1),
    lipBottom: at(14),
    mouthOpen: faceH > 0 ? dist(at(13), at(14)) / faceH : 0,
    eyeLeft,
    eyeRight,
    eyeCenter: mid(eyeLeft, eyeRight),
    cheekLeft: at(205),
    cheekRight: at(425),
  };
}

function nearest(faces, face) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of faces) {
    const d = dist(candidate.nose, face.nose);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best && bestDistance < face.size * 0.6 ? best : null;
}

// Half of the old position kept: the landmarks jitter by a pixel or two from
// frame to frame, and an ear that shivers looks broken.
function smooth(previous, next) {
  const k = 0.5;
  const lerp = (a, b) => a + (b - a) * k;
  const lerpPoint = (a, b) => ({ x: lerp(a.x, b.x), y: lerp(a.y, b.y) });
  const out = {};
  for (const key of Object.keys(next)) {
    const a = previous[key];
    const b = next[key];
    out[key] = typeof b === "number" ? lerp(a, b) : lerpPoint(a, b);
  }
  return out;
}

// Draws with the origin at `origin`, x along the eyes and y down the face.
function inFaceFrame(ctx, origin, angle, draw) {
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(angle);
  draw();
  ctx.restore();
}

function drawFace(ctx, kind, face) {
  if (kind === "dog") drawDog(ctx, face);
  else if (kind === "cat") drawCat(ctx, face);
  else if (kind === "glasses") drawGlasses(ctx, face);
  else if (kind === "clown") drawClown(ctx, face);
  else if (kind === "crown") drawCrown(ctx, face);
}

function drawDog(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 0.4 * s, -0.12 * s);
      ctx.rotate(side * 0.45);
      ctx.beginPath();
      ctx.ellipse(0, -0.08 * s, 0.17 * s, 0.3 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#8b5a2b";
      ctx.fill();
      ctx.lineWidth = 0.02 * s;
      ctx.strokeStyle = "#5c3a1a";
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -0.06 * s, 0.095 * s, 0.2 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#d29a6a";
      ctx.fill();
      ctx.restore();
    }
  });
  if (f.mouthOpen > 0.07) {
    inFaceFrame(ctx, f.lipBottom, f.angle, () => {
      const w = 0.2 * s;
      const length = s * Math.min(0.45, Math.max(0.12, (f.mouthOpen - 0.05) * 3.2));
      const r = w / 2;
      ctx.beginPath();
      ctx.moveTo(-r, -0.02 * s);
      ctx.lineTo(-r, length - r);
      ctx.arc(0, length - r, r, Math.PI, 0, true);
      ctx.lineTo(r, -0.02 * s);
      ctx.closePath();
      ctx.fillStyle = "#ff6f91";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0.02 * s);
      ctx.lineTo(0, length * 0.7);
      ctx.lineWidth = 0.015 * s;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#d94a6e";
      ctx.stroke();
    });
  }
  inFaceFrame(ctx, f.nose, f.angle, () => {
    ctx.beginPath();
    ctx.ellipse(0, -0.03 * s, 0.13 * s, 0.085 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1b1b1b";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-0.045 * s, -0.06 * s, 0.035 * s, 0.02 * s, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fill();
  });
}

function drawCat(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 0.34 * s, -0.04 * s);
      ctx.rotate(side * 0.3);
      ctx.beginPath();
      ctx.moveTo(-0.16 * s, 0);
      ctx.lineTo(0, -0.38 * s);
      ctx.lineTo(0.16 * s, 0);
      ctx.closePath();
      ctx.fillStyle = "#f2a65a";
      ctx.fill();
      ctx.lineWidth = 0.02 * s;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#b86e2a";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.09 * s, -0.02 * s);
      ctx.lineTo(0, -0.26 * s);
      ctx.lineTo(0.09 * s, -0.02 * s);
      ctx.closePath();
      ctx.fillStyle = "#ffb6c8";
      ctx.fill();
      ctx.restore();
    }
  });
  inFaceFrame(ctx, f.nose, f.angle, () => {
    ctx.lineCap = "round";
    ctx.lineWidth = 0.012 * s;
    ctx.strokeStyle = "rgba(30, 30, 30, 0.85)";
    for (const side of [-1, 1]) {
      // Fanned out: one up, one level, one down.
      for (const spread of [-0.13, 0, 0.13]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.09 * s, 0.02 * s);
        ctx.lineTo(side * 0.45 * s, (0.02 + spread) * s);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.moveTo(-0.06 * s, -0.04 * s);
    ctx.lineTo(0.06 * s, -0.04 * s);
    ctx.lineTo(0, 0.03 * s);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.fillStyle = "#ff8fab";
    ctx.fill();
    ctx.lineWidth = 0.02 * s;
    ctx.strokeStyle = "#ff8fab";
    ctx.stroke();
  });
}

function drawGlasses(ctx, f) {
  const s = f.size;
  const half = dist(f.eyeLeft, f.eyeRight) / 2;
  inFaceFrame(ctx, f.eyeCenter, f.angle, () => {
    const w = 0.3 * s;
    const h = 0.19 * s;
    ctx.lineWidth = 0.025 * s;
    ctx.strokeStyle = "#0a0a0a";
    ctx.lineCap = "round";
    // The arms, then the bridge, then the lenses over both.
    ctx.beginPath();
    ctx.moveTo(-half - w / 2, -0.03 * s);
    ctx.lineTo(-0.5 * s, -0.05 * s);
    ctx.moveTo(half + w / 2, -0.03 * s);
    ctx.lineTo(0.5 * s, -0.05 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-half + w / 2, -0.03 * s);
    ctx.quadraticCurveTo(0, -0.09 * s, half - w / 2, -0.03 * s);
    ctx.stroke();
    for (const side of [-1, 1]) {
      const x = side * half - w / 2;
      const y = -h / 2;
      const gradient = ctx.createLinearGradient(0, y, 0, y + h);
      gradient.addColorStop(0, "rgba(20, 20, 24, 0.95)");
      gradient.addColorStop(1, "rgba(60, 60, 70, 0.9)");
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 0.06 * s);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h);
      ctx.lineTo(x + w * 0.45, y);
      ctx.lineTo(x + w * 0.6, y);
      ctx.lineTo(x + w * 0.3, y + h);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawClown(ctx, f) {
  const s = f.size;
  ctx.fillStyle = "rgba(255, 80, 120, 0.35)";
  for (const cheek of [f.cheekLeft, f.cheekRight]) {
    ctx.beginPath();
    ctx.arc(cheek.x, cheek.y, 0.09 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  inFaceFrame(ctx, f.nose, f.angle, () => {
    const r = 0.1 * s;
    const gradient = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, -0.02 * s, r);
    gradient.addColorStop(0, "#ff8a8a");
    gradient.addColorStop(1, "#c40000");
    ctx.beginPath();
    ctx.arc(0, -0.02 * s, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  });
}

function drawCrown(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    const w = 0.7 * s;
    const base = -0.06 * s;
    const band = 0.1 * s;
    const peak = 0.34 * s;
    const gradient = ctx.createLinearGradient(0, base - peak, 0, base);
    gradient.addColorStop(0, "#ffe27a");
    gradient.addColorStop(1, "#e0a800");
    ctx.beginPath();
    ctx.moveTo(-w / 2, base);
    ctx.lineTo(-w / 2, base - peak);
    ctx.lineTo(-w / 4, base - band - 0.08 * s);
    ctx.lineTo(0, base - peak - 0.04 * s);
    ctx.lineTo(w / 4, base - band - 0.08 * s);
    ctx.lineTo(w / 2, base - peak);
    ctx.lineTo(w / 2, base);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 0.015 * s;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#a87900";
    ctx.stroke();
    const gems = [
      [-w / 4, base - band / 2, "#e53935"],
      [0, base - band / 2, "#1e88e5"],
      [w / 4, base - band / 2, "#43a047"],
    ];
    for (const [x, y, fill] of gems) {
      ctx.beginPath();
      ctx.arc(x, y, 0.035 * s, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    for (const x of [-w / 2, 0, w / 2]) {
      ctx.beginPath();
      ctx.arc(x, base - peak - (x === 0 ? 0.04 * s : 0), 0.025 * s, 0, Math.PI * 2);
      ctx.fillStyle = "#fff3c4";
      ctx.fill();
    }
  });
}
