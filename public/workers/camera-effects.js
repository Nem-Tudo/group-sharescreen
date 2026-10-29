// The frame loop of "Efeitos de câmera" (see lib/cameraEffects.ts).
//
// The camera's frames arrive here as VideoFrames (a MediaStreamTrackProcessor
// on the page, its readable transferred in) and leave as VideoFrames (into a
// MediaStreamTrackGenerator's writable) — or, in Safari, where those two only
// exist in workers, the camera track itself comes in and the generated track
// goes back (see startTrackPipeline) — so nothing on the page's thread
// touches a pixel, and nothing here is paced by requestAnimationFrame — which
// is what keeps the camera moving for the room while the tab is in the
// background.
//
// MediaPipe (face landmarks, selfie segmentation) is loaded from the CDN the
// first time an effect that needs it is picked, and only that model: blur
// never downloads the face model, a dog nose never downloads the segmenter.
// Three.js likewise, only for the 3D objects (see the end of the file).
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
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Detection runs on a copy this wide, not on the camera's own frame: both
// models resize to 256px or less internally, so handing them 1080p only adds
// an upload. The segmentation mask comes back at this size too, which is what
// keeps reading it back cheap.
const DETECT_WIDTH = 320;
// The background is blurred at the detection size and stretched back up — at
// 320px a 6px blur reads like ~36px at 1920, for a fraction of the work, and
// the stretch only adds to the blur.
const BLUR_PX = 6;

// The faces of experiment "camera-effects-3d" (see the end of the file).
const FACES_3D = new Set(["glasses3d", "tophat3d", "viking3d"]);

const COLOR_FILTERS = {
  none: "none",
  mono: "grayscale(1)",
  sepia: "sepia(0.85)",
  vivid: "saturate(1.45) contrast(1.08)",
};

let settings = null;
let visionPromise = null;
// `promise`: the load under way, settled either way.
const tasks = {
  face: { task: null, loading: false, failed: false, promise: null },
  segment: { task: null, loading: false, failed: false, promise: null },
  // Only for the reactions (claps, thumbs up).
  hand: { task: null, loading: false, failed: false, promise: null },
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
  } else if (data.type === "prepare") {
    // Answered once what the settings need is loaded and warmed up (or has
    // failed), so the page can keep sending the plain camera until then
    // rather than a camera frozen behind the loading (see prepareCameraEffects).
    if (data.settings !== undefined) {
      settings = data.settings || null;
      ensureTasks();
    }
    readiness().then(() => self.postMessage({ type: "prepared", nonce: data.nonce }));
  } else if (data.type === "probe") {
    // Safari's kind of insertable streams, which only exists in here (see
    // probeWorkerTracks in lib/cameraEffects.ts).
    self.postMessage({ type: "probe", workerTracks: workerTracksSupported() });
  } else if (data.type === "start-track") {
    startTrackPipeline(data.id, data.track);
  } else if (data.type === "constraints") {
    const held = heldTracks.get(data.id);
    if (held) held.applyConstraints(data.constraints).catch(() => {});
  } else if (data.type === "stop") {
    const pipeline = pipelines.get(data.id);
    if (pipeline) pipeline.stopped = true;
  } else if (data.type === "background-image") {
    setCustomBackground(data.bitmap || null);
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
          // The expressions, for the reactions (a blink, a smile, raised brows).
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        })
      : kind === "hand"
      ? vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          numHands: 2,
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
  let task;
  try {
    task = await make("GPU");
  } catch {
    task = await make("CPU");
  }
  warmUp(kind, task);
  return task;
}

// The first run of a model compiles its shaders, which on a phone holds this
// thread (and so every camera frame) for a second or more: paid here, on a
// blank picture, before any pipeline gets to use it.
function warmUp(kind, task) {
  try {
    const blank = new OffscreenCanvas(DETECT_WIDTH, Math.round((DETECT_WIDTH * 3) / 4));
    blank.getContext("2d").fillRect(0, 0, blank.width, blank.height);
    if (kind === "segment") task.segmentForVideo(blank, nextTimestamp(), () => {});
    else task.detectForVideo(blank, nextTimestamp());
  } catch {
    // Only a head start; the real frames will find out if it is broken.
  }
}

function readiness() {
  const waits = ["face", "segment", "hand"]
    .filter((kind) => wants(kind) && tasks[kind].promise)
    .map((kind) => tasks[kind].promise);
  if (wants3d() && three.promise) waits.push(three.promise);
  return Promise.allSettled(waits);
}

function wants(kind) {
  if (!settings) return false;
  if (kind === "face") return settings.face !== "none" || settings.reactions === "on";
  if (kind === "hand") return settings.reactions === "on";
  return settings.background !== "none";
}

function wants3d() {
  return Boolean(settings && FACES_3D.has(settings.face));
}

function ensureTasks() {
  if (wants3d()) ensureThree();
  for (const kind of ["face", "segment", "hand"]) {
    const slot = tasks[kind];
    if (!wants(kind) || slot.task || slot.loading || slot.failed) continue;
    slot.loading = true;
    slot.promise = createTask(kind)
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
  const loading =
    ["face", "segment", "hand"].some((kind) => wants(kind) && tasks[kind].loading) || (wants3d() && three.loading);
  self.postMessage({ type: "status", loading });
}

// Both tasks want strictly increasing timestamps, across every pipeline
// feeding them.
function nextTimestamp() {
  lastTimestamp = Math.max(lastTimestamp + 1, performance.now());
  return lastTimestamp;
}

// ---------------------------------------------------------------------------
// Safari: the camera itself comes in (a clone, transferred), and the track
// with the effects goes back out

// The camera clones this worker owns, by pipeline: stopped when it ends.
const heldTracks = new Map();

function workerTracksSupported() {
  return (
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof VideoTrackGenerator !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}

function startTrackPipeline(id, track) {
  let generator;
  let processor;
  try {
    processor = new MediaStreamTrackProcessor({ track });
    generator = new VideoTrackGenerator();
    self.postMessage({ type: "track", id, track: generator.track }, [generator.track]);
  } catch (err) {
    if (track) track.stop();
    self.postMessage({ type: "track", id, error: String((err && err.message) || err).slice(0, 120) });
    self.postMessage({ type: "ended", id });
    return;
  }
  heldTracks.set(id, track);
  startPipeline(id, processor.readable, generator.writable);
  const pipeline = pipelines.get(id);
  if (pipeline) pipeline.track = track;
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
    particles: [],
    reactions: [],
    hands: [],
    handTick: 0,
    handState: { thumbFrames: 0, lastThumb: 0, lastClap: 0, apartAt: 0, pair: null },
    render3dFailed: false,
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
      const held = heldTracks.get(id);
      if (held) {
        held.stop();
        heldTracks.delete(id);
      }
      self.postMessage({ type: "ended", id });
    });
}

function needsDrawing() {
  return Boolean(
    settings &&
      (settings.face !== "none" ||
        settings.background !== "none" ||
        settings.color !== "none" ||
        settings.reactions === "on")
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
      fx3d: Boolean(settings && (FACES_3D.has(settings.face) || settings.reactions === "on")),
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

// A frame that says how it should be turned (Safari's camera on an iPhone
// held upright sends the sensor's landscape frames with rotation 90) drawn
// the right way up once, so detection sees an upright face and what goes out
// is upright too — drawImage of the frame itself ignores its rotation, and
// the VideoFrame made from the canvas carries none. Null: already upright.
function uprightSource(p, frame) {
  const rotation = ((rotationOf(p, frame) % 360) + 360) % 360;
  const flip = Boolean(frame.flip);
  if (rotation === 0 && !flip) return null;
  const sideways = rotation === 90 || rotation === 270;
  const w = sideways ? frame.displayHeight : frame.displayWidth;
  const h = sideways ? frame.displayWidth : frame.displayHeight;
  if (!p.upright || p.upright.width !== w || p.upright.height !== h) {
    p.upright = new OffscreenCanvas(w, h);
    p.uprightCtx = p.upright.getContext("2d", { alpha: false });
  }
  const ctx = p.uprightCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(w / 2, h / 2);
  // Turned the other way from what the number says: rotating by +rotation
  // (clockwise, on a canvas) came out upside down on an iPhone.
  ctx.rotate((-rotation * Math.PI) / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2, frame.displayWidth, frame.displayHeight);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return p.upright;
}

// The frame's own rotation; where a browser does not fill it in, the camera
// track this worker holds (Safari) says which way the picture should stand,
// and a frame the other way round is a sensor's sideways one.
function rotationOf(p, frame) {
  if (typeof frame.rotation === "number") return frame.rotation;
  if (!p.track) return 0;
  const settings = p.track.getSettings();
  if (!settings.width || !settings.height) return 0;
  const portraitTrack = settings.height > settings.width;
  const portraitFrame = frame.displayHeight > frame.displayWidth;
  if (portraitTrack === portraitFrame) return 0;
  return settings.facingMode === "user" ? 270 : 90;
}

function render(p, rawFrame) {
  // `frame` from here on is what gets drawn: the camera's frame, or its
  // upright copy. Only the timestamp is read from the frame itself.
  const frame = uprightSource(p, rawFrame) || rawFrame;
  const width = frame === rawFrame ? rawFrame.displayWidth : frame.width;
  const height = frame === rawFrame ? rawFrame.displayHeight : frame.height;
  ensureCanvases(p, width, height);
  const s = settings;
  const ctx = p.ctx;

  // How far apart frames arrive, for the detection budget below, and how far
  // the reactions' particles move.
  const ts = rawFrame.timestamp / 1000;
  let dt = 0;
  if (p.lastFrameTs && ts > p.lastFrameTs) {
    p.frameInterval = p.frameInterval * 0.9 + (ts - p.lastFrameTs) * 0.1;
    dt = Math.min(0.1, (ts - p.lastFrameTs) / 1000);
  }
  p.lastFrameTs = ts;

  const segmenter = s.background !== "none" ? tasks.segment.task : null;
  const reacting = s.reactions === "on";
  const landmarker = s.face !== "none" || reacting ? tasks.face.task : null;
  // Hands every other detection: a clap or a thumb is slower than a blink.
  const hander = reacting ? tasks.hand.task : null;
  if (!segmenter) p.hasMask = false;
  if (!landmarker) p.faces = [];
  if (!hander) p.hands = [];

  p.frameIndex += 1;
  if ((segmenter || landmarker) && p.frameIndex % p.detectEvery === 0) {
    const started = performance.now();
    p.smallCtx.drawImage(frame, 0, 0, p.small.width, p.small.height);
    const timestamp = nextTimestamp();
    if (segmenter) segment(p, segmenter, timestamp);
    if (landmarker) detectFaces(p, landmarker, timestamp, width, height);
    if (hander) {
      p.handTick = (p.handTick + 1) % 2;
      if (p.handTick === 0) detectHands(p, hander, nextTimestamp(), width, height);
    }
    p.detectCost = p.detectCost ? p.detectCost * 0.8 + (performance.now() - started) * 0.2 : performance.now() - started;
    adaptDetection(p);
  }

  const color = COLOR_FILTERS[s.color] || "none";
  ctx.filter = color;
  ctx.drawImage(frame, 0, 0, width, height);
  ctx.filter = "none";
  if (segmenter && p.hasMask) {
    if (s.background === "blur") drawBlurredBackground(p, frame, color, width, height);
    else drawReplacedBackground(p, s.background, color, width, height);
  }
  if (landmarker) for (const face of p.faces) drawFace(ctx, s.face, face);
  if (landmarker && FACES_3D.has(s.face)) draw3d(ctx, p, s.face, width, height);
  if (reacting) {
    if (landmarker) p.faces.forEach((face, i) => spawnReactions(p, face, i, ts));
    if (hander) handReactions(p, ts);
    drawParticles(ctx, p, dt);
  } else if (p.particles.length > 0) {
    p.particles = [];
  }

  return new VideoFrame(p.canvas, { timestamp: rawFrame.timestamp, alpha: "discard" });
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
  const shapes = result.faceBlendshapes || [];
  const found = (result.faceLandmarks || []).map((landmarks, i) =>
    anchorsOf(landmarks, width, height, shapes[i])
  );
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
// With depth: the landmarks' z is on the same scale as their x.
function point3(landmarks, index, width, height) {
  const q = landmarks[index];
  return { x: q.x * width, y: q.y * height, z: q.z * width };
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function mid3(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

// The expressions the reactions read, 0 to 1.
function expressionsOf(blendshapes) {
  const score = {};
  for (const c of (blendshapes && blendshapes.categories) || []) score[c.categoryName] = c.score;
  const get = (name) => score[name] || 0;
  return {
    blinkL: get("eyeBlinkLeft"),
    blinkR: get("eyeBlinkRight"),
    smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    brow: get("browInnerUp"),
    pucker: get("mouthPucker"),
    jaw: get("jawOpen"),
    puff: get("cheekPuff"),
  };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The handful of points the overlays hang off, in output pixels. Indices are
// MediaPipe's face mesh: 10 top of the forehead, 152 chin, 234/454 the sides
// of the face, 33/133 and 263/362 the corners of each eye, 1 the tip of the
// nose, 13/14 the inside of the lips, 164/0 the philtrum and the top of the
// upper lip, 205/425 the cheeks. The `3` ones keep depth, for the 3D objects;
// `raw` is the expressions, left out of the smoothing (a blink is over in a
// frame or two, and averaged it would never register).
function anchorsOf(landmarks, width, height, blendshapes) {
  const at = (index) => point(landmarks, index, width, height);
  const at3 = (index) => point3(landmarks, index, width, height);
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
    lipTop: at(13),
    lipBottom: at(14),
    philtrum: mid(at(164), at(0)),
    mouthOpen: faceH > 0 ? dist(at(13), at(14)) / faceH : 0,
    eyeLeft,
    eyeRight,
    eyeCenter: mid(eyeLeft, eyeRight),
    cheekLeft: at(205),
    cheekRight: at(425),
    eye3Left: mid3(at3(33), at3(133)),
    eye3Right: mid3(at3(263), at3(362)),
    top3: at3(10),
    chin3: at3(152),
    side3Left: at3(234),
    side3Right: at3(454),
    raw: blendshapes ? expressionsOf(blendshapes) : null,
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
  const lerpPoint = (a, b) =>
    b.z === undefined ? { x: lerp(a.x, b.x), y: lerp(a.y, b.y) } : { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z) };
  const out = {};
  for (const key of Object.keys(next)) {
    const a = previous[key];
    const b = next[key];
    if (key === "raw" || a === undefined || a === null || b === null) out[key] = b;
    else out[key] = typeof b === "number" ? lerp(a, b) : lerpPoint(a, b);
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
  else if (kind === "bunny") drawBunny(ctx, face);
  else if (kind === "bear") drawBear(ctx, face);
  else if (kind === "pig") drawPig(ctx, face);
  else if (kind === "mustache") drawMustache(ctx, face);
  else if (kind === "hearts") drawHearts(ctx, face);
  else if (kind === "devil") drawDevil(ctx, face);
  else if (kind === "angel") drawAngel(ctx, face);
  else if (kind === "pirate") drawPirate(ctx, face);
  else if (kind === "party") drawPartyHat(ctx, face);
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

function drawBunny(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 0.16 * s, -0.06 * s);
      ctx.rotate(side * 0.18);
      ctx.beginPath();
      ctx.ellipse(0, -0.32 * s, 0.1 * s, 0.32 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f7f7f7";
      ctx.fill();
      ctx.lineWidth = 0.015 * s;
      ctx.strokeStyle = "#cfcfcf";
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -0.3 * s, 0.05 * s, 0.24 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#ffb6c8";
      ctx.fill();
      ctx.restore();
    }
  });
  // Buck teeth under the upper lip, once the mouth opens enough to show them.
  if (f.mouthOpen > 0.04) {
    inFaceFrame(ctx, f.lipTop, f.angle, () => {
      const tw = 0.06 * s;
      const th = Math.min(0.1 * s, 0.05 * s + f.mouthOpen * 0.5 * s);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#c8c8c8";
      ctx.lineWidth = 0.008 * s;
      for (const x of [-tw - 0.004 * s, 0.004 * s]) {
        ctx.beginPath();
        ctx.roundRect(x, -0.01 * s, tw, th, [0, 0, 0.015 * s, 0.015 * s]);
        ctx.fill();
        ctx.stroke();
      }
    });
  }
  inFaceFrame(ctx, f.nose, f.angle, () => {
    ctx.beginPath();
    ctx.moveTo(-0.045 * s, -0.035 * s);
    ctx.lineTo(0.045 * s, -0.035 * s);
    ctx.lineTo(0, 0.02 * s);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.02 * s;
    ctx.fillStyle = "#ff8fab";
    ctx.strokeStyle = "#ff8fab";
    ctx.fill();
    ctx.stroke();
  });
}

function drawBear(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * 0.4 * s, -0.04 * s, 0.15 * s, 0, Math.PI * 2);
      ctx.fillStyle = "#7a4a26";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(side * 0.4 * s, -0.04 * s, 0.08 * s, 0, Math.PI * 2);
      ctx.fillStyle = "#c89a6c";
      ctx.fill();
    }
  });
  inFaceFrame(ctx, f.nose, f.angle, () => {
    ctx.beginPath();
    ctx.ellipse(0, 0.03 * s, 0.16 * s, 0.11 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200, 154, 108, 0.92)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -0.02 * s, 0.07 * s, 0.045 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1b1b1b";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0.02 * s);
    ctx.lineTo(0, 0.07 * s);
    ctx.lineWidth = 0.012 * s;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1b1b1b";
    ctx.stroke();
  });
}

function drawPig(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 0.36 * s, -0.02 * s);
      ctx.rotate(side * 0.6);
      ctx.beginPath();
      ctx.moveTo(-0.12 * s, 0);
      ctx.quadraticCurveTo(0, -0.34 * s, 0.12 * s, 0);
      ctx.closePath();
      ctx.fillStyle = "#f7a1b5";
      ctx.fill();
      ctx.lineWidth = 0.015 * s;
      ctx.strokeStyle = "#d9748d";
      ctx.stroke();
      ctx.restore();
    }
  });
  inFaceFrame(ctx, f.nose, f.angle, () => {
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.13 * s, 0.09 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f7a1b5";
    ctx.fill();
    ctx.lineWidth = 0.015 * s;
    ctx.strokeStyle = "#d9748d";
    ctx.stroke();
    ctx.fillStyle = "#a8475f";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.045 * s, 0, 0.022 * s, 0.035 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawMustache(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.philtrum, f.angle, () => {
    ctx.fillStyle = "#3b2414";
    for (const side of [-1, 1]) {
      const x = (v) => side * v * s;
      const y = (v) => v * s;
      ctx.beginPath();
      ctx.moveTo(0, y(-0.015));
      ctx.bezierCurveTo(x(0.08), y(-0.07), x(0.2), y(-0.05), x(0.26), y(0));
      // The curl at the tip.
      ctx.bezierCurveTo(x(0.3), y(0.035), x(0.34), y(0), x(0.32), y(-0.04));
      ctx.bezierCurveTo(x(0.31), y(0.03), x(0.24), y(0.06), x(0.17), y(0.04));
      ctx.bezierCurveTo(x(0.1), y(0.03), x(0.04), y(0.045), 0, y(0.03));
      ctx.closePath();
      ctx.fill();
    }
  });
}

function heartPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.2, cx - r * 0.6, cy - r * 1.3, cx, cy - r * 0.45);
  ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 1.6, cy - r * 0.2, cx, cy + r * 0.9);
  ctx.closePath();
}

function drawHearts(ctx, f) {
  const s = f.size;
  const half = dist(f.eyeLeft, f.eyeRight) / 2;
  // A slow beat, off the clock: the frame is drawn anyway.
  const beat = 1 + 0.08 * Math.sin(performance.now() / 160);
  inFaceFrame(ctx, f.eyeCenter, f.angle, () => {
    const r = 0.12 * s * beat;
    for (const side of [-1, 1]) {
      const cx = side * half;
      const gradient = ctx.createRadialGradient(cx - r * 0.3, -r * 0.4, r * 0.1, cx, 0, r * 1.2);
      gradient.addColorStop(0, "#ff7a9a");
      gradient.addColorStop(1, "#e0123f");
      heartPath(ctx, cx, 0, r);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.45, -r * 0.45, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fill();
    }
  });
}

function drawDevil(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    for (const side of [-1, 1]) {
      const x = (v) => side * v * s;
      // Landmark 10 is the top of the forehead: the horns stand a little
      // above it, in the hair, over each temple rather than meeting in the
      // middle.
      const y = (v) => -(v + 0.1) * s;
      const gradient = ctx.createLinearGradient(0, y(0), 0, y(0.46));
      gradient.addColorStop(0, "#9e0b0b");
      gradient.addColorStop(1, "#ff3b2f");
      ctx.beginPath();
      // Upright, convex edge outside, the tip leaning only slightly inwards.
      ctx.moveTo(x(0.37), y(0));
      ctx.bezierCurveTo(x(0.4), y(0.2), x(0.35), y(0.38), x(0.25), y(0.46));
      ctx.quadraticCurveTo(x(0.25), y(0.18), x(0.19), y(0));
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.lineWidth = 0.012 * s;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#6e0606";
      ctx.stroke();
    }
  });
}

function drawAngel(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    // A wide faint stroke for the glow (shadowBlur would cost every frame),
    // the ring, and a light line along it.
    ctx.beginPath();
    ctx.ellipse(0, -0.3 * s, 0.32 * s, 0.08 * s, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.07 * s;
    ctx.strokeStyle = "rgba(255, 230, 120, 0.35)";
    ctx.stroke();
    ctx.lineWidth = 0.04 * s;
    ctx.strokeStyle = "#f5c518";
    ctx.stroke();
    ctx.lineWidth = 0.012 * s;
    ctx.strokeStyle = "#fff6c8";
    ctx.stroke();
  });
}

function drawPirate(ctx, f) {
  const s = f.size;
  const half = dist(f.eyeLeft, f.eyeRight) / 2;
  inFaceFrame(ctx, f.eyeCenter, f.angle, () => {
    // The strap first, round the side and across the forehead; the patch over it.
    ctx.beginPath();
    ctx.moveTo(-0.55 * s, 0.02 * s);
    ctx.lineTo(-half, 0);
    ctx.lineTo(0.55 * s, -0.42 * s);
    ctx.lineWidth = 0.022 * s;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#151515";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-half, 0.005 * s, 0.13 * s, 0.1 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111111";
    ctx.fill();
    ctx.lineWidth = 0.01 * s;
    ctx.strokeStyle = "#3a3a3a";
    ctx.stroke();
  });
}

function drawPartyHat(ctx, f) {
  const s = f.size;
  inFaceFrame(ctx, f.top, f.angle, () => {
    ctx.save();
    ctx.translate(0.08 * s, -0.04 * s);
    ctx.rotate(0.18);
    const w = 0.42 * s;
    const h = 0.55 * s;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(0, -h);
    ctx.lineTo(w / 2, 0);
    ctx.closePath();
    ctx.fillStyle = "#7c4dff";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const stripes = ["#ffd54f", "#ff4f8b", "#4fc3f7"];
    ctx.lineWidth = 0.04 * s;
    for (let i = 0; i < 6; i += 1) {
      const y = -h + (i + 0.5) * (h / 6);
      ctx.beginPath();
      ctx.moveTo(-w, y + 0.06 * s);
      ctx.lineTo(w, y - 0.06 * s);
      ctx.strokeStyle = stripes[i % stripes.length];
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -h, 0.06 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 0.02 * s, -0.035 * s, w + 0.04 * s, 0.05 * s, 0.025 * s);
    ctx.fill();
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// Reactions (experiment "camera-effects-3d", the "Reações" switch): what the
// face, the head and the hands do sets off particles drawn in 2D, over
// whatever mask is on.
//
//   face (MediaPipe's blendshapes): blink → sparkles, wink → a star, smile →
//   hearts, raised brows → "!", kiss → hearts from the lips, mouth wide open
//   → 😮, puffed cheeks → bubbles
//   head (its pose, from the 3D points): nod → ✅, shake → ❌, face raised →
//   confetti
//   hands (MediaPipe's hand landmarker, loaded only with the switch on):
//   clap → 👏 and confetti, thumbs up → 👍
//
// No tongue: MediaPipe's tongueOut blendshape was never trained and stays at 0.

const MAX_PARTICLES = 160;
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const CONFETTI_COLORS = ["#ff4f8b", "#ffd54f", "#4fc3f7", "#7c4dff", "#4cd964", "#ff8a3d"];
const reportedReactions = new Set();

// Once per kind of reaction per worker, for the usage stats.
function report(name) {
  if (reportedReactions.has(name)) return;
  reportedReactions.add(name);
  self.postMessage({ type: "reaction", name });
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function reactionState(p, index) {
  if (!p.reactions[index]) {
    p.reactions[index] = {
      blinking: false,
      winking: false,
      browUp: false,
      wow: false,
      headUp: false,
      lastHeart: 0,
      lastKiss: 0,
      lastBubble: 0,
      lastHead: 0,
      basePitch: null,
      pose: [],
    };
  }
  return p.reactions[index];
}

function addParticle(p, particle) {
  if (p.particles.length >= MAX_PARTICLES) p.particles.shift();
  particle.age = 0;
  p.particles.push(particle);
}

function emoji(p, char, x, y, size, opts = {}) {
  addParticle(p, { kind: "emoji", char, x, y, vx: opts.vx || 0, vy: opts.vy ?? -0.25 * size, size, life: opts.life || 1.2 });
}

function confetti(p, x, y, spread, count, size, opts = {}) {
  for (let i = 0; i < count; i += 1) {
    const a = opts.down ? rnd(0.3, Math.PI - 0.3) : rnd(-Math.PI, 0);
    const speed = rnd(0.4, 1) * spread;
    addParticle(p, {
      kind: "confetti",
      x: x + (opts.down ? rnd(-1, 1) * spread : 0),
      y,
      vx: Math.cos(a) * speed * (opts.down ? 0.3 : 1),
      vy: opts.down ? rnd(0.2, 0.5) * spread : Math.sin(a) * speed,
      gravity: spread * 1.2,
      size: rnd(0.6, 1) * size,
      rot: rnd(0, Math.PI),
      spin: rnd(-8, 8),
      life: opts.down ? 2.2 : 1.4,
      hue: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    });
  }
}

// The head's turn (yaw) and tilt up (pitch), in radians, from the same 3D
// points as the objects' basis.
function headAngles(face) {
  const v = (q) => [q.x, -q.y, -q.z];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const x = norm(sub(v(face.eye3Right), v(face.eye3Left)));
  const up = sub(v(face.top3), v(face.chin3));
  const d = up[0] * x[0] + up[1] * x[1] + up[2] * x[2];
  const y = norm([up[0] - x[0] * d, up[1] - x[1] * d, up[2] - x[2] * d]);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return { yaw: Math.atan2(z[0], z[2]), pitch: Math.atan2(z[1], z[2]) };
}

// How many times `key` turned back by more than `hysteresis` radians.
function swings(history, key, hysteresis) {
  let count = 0;
  let dir = 0;
  let extreme = history.length ? history[0][key] : 0;
  for (const h of history) {
    const value = h[key];
    if (dir >= 0 && value < extreme - hysteresis) {
      if (dir > 0) count += 1;
      dir = -1;
      extreme = value;
    } else if (dir <= 0 && value > extreme + hysteresis) {
      if (dir < 0) count += 1;
      dir = 1;
      extreme = value;
    } else if ((dir > 0 && value > extreme) || (dir < 0 && value < extreme)) {
      extreme = value;
    }
  }
  return count;
}

function range(history, key) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of history) {
    lo = Math.min(lo, h[key]);
    hi = Math.max(hi, h[key]);
  }
  return hi - lo;
}

function spawnReactions(p, face, index, now) {
  const raw = face.raw;
  const st = reactionState(p, index);
  const s = face.size;
  const mouth = mid(face.lipTop, face.lipBottom);

  if (raw) {
    // Both eyes, so a wink or a squint against the light does not count.
    const blinking = raw.blinkL > 0.5 && raw.blinkR > 0.5;
    if (blinking && !st.blinking) {
      for (const eye of [face.eyeLeft, face.eyeRight]) {
        for (let i = 0; i < 5; i += 1) {
          const a = rnd(0, Math.PI * 2);
          const speed = rnd(0.4, 0.9) * s;
          addParticle(p, {
            kind: "sparkle",
            x: eye.x,
            y: eye.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 0.2 * s,
            gravity: 0.6 * s,
            size: rnd(0.06, 0.11) * s,
            life: 0.7,
            hue: Math.random() < 0.5 ? "#fff3a1" : "#ffffff",
          });
        }
      }
      report("blink");
    }
    st.blinking = blinking;

    // One eye shut and the other open: a blink's two eyes never part this far.
    const winking = (raw.blinkL > 0.6 && raw.blinkR < 0.25) || (raw.blinkR > 0.6 && raw.blinkL < 0.25);
    if (winking && !st.winking) {
      addParticle(p, {
        kind: "star",
        x: face.eyeCenter.x,
        y: face.eyeCenter.y - 0.25 * s,
        vx: rnd(-0.1, 0.1) * s,
        vy: -0.35 * s,
        size: 0.15 * s,
        rot: 0,
        spin: rnd(-3, 3),
        life: 1.1,
        hue: "#ffd400",
      });
      report("wink");
    }
    st.winking = winking;

    if (raw.smile > 0.55 && now - st.lastHeart > 160) {
      st.lastHeart = now;
      const cheek = Math.random() < 0.5 ? face.cheekLeft : face.cheekRight;
      addParticle(p, {
        kind: "heart",
        x: cheek.x + rnd(-0.05, 0.05) * s,
        y: cheek.y,
        vx: rnd(-0.08, 0.08) * s,
        vy: -rnd(0.35, 0.6) * s,
        size: rnd(0.05, 0.08) * s,
        life: 1.4,
        hue: Math.random() < 0.3 ? "#ff8fb3" : "#ff2d55",
      });
      report("smile");
    }

    const browUp = raw.brow > 0.55;
    if (browUp && !st.browUp) {
      addParticle(p, {
        kind: "bang",
        x: face.top.x + 0.28 * s,
        y: face.top.y - 0.05 * s,
        vx: 0.1 * s,
        vy: -0.35 * s,
        size: 0.16 * s,
        life: 0.9,
        hue: "#ffd400",
      });
      report("brow");
    }
    st.browUp = browUp;

    // Lips pushed out, mouth shut: hearts off the lips, growing as they go.
    if (raw.pucker > 0.55 && raw.jaw < 0.3 && raw.smile < 0.3 && now - st.lastKiss > 220) {
      st.lastKiss = now;
      const a = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
      addParticle(p, {
        kind: "heart",
        x: mouth.x,
        y: mouth.y,
        vx: Math.cos(a) * 0.45 * s,
        vy: Math.sin(a) * 0.45 * s,
        size: 0.05 * s,
        grow: 2.2,
        life: 1.2,
        hue: "#e0123f",
      });
      report("kiss");
    }

    const wow = raw.jaw > 0.5 && raw.smile < 0.3;
    if (wow && !st.wow) {
      emoji(p, "😮", face.top.x - 0.45 * s, face.top.y + 0.1 * s, 0.3 * s, { vx: -0.1 * s });
      report("wow");
    }
    st.wow = wow;

    if (raw.puff > 0.45 && now - st.lastBubble > 140) {
      st.lastBubble = now;
      addParticle(p, {
        kind: "bubble",
        x: mouth.x + rnd(-0.15, 0.15) * s,
        y: mouth.y,
        vx: rnd(-0.1, 0.1) * s,
        vy: -rnd(0.3, 0.55) * s,
        size: rnd(0.03, 0.07) * s,
        grow: 0.8,
        life: 1.6,
        hue: "rgba(180, 230, 255, 0.9)",
      });
      report("puff");
    }
  }

  if (!face.eye3Left) return;
  const { yaw, pitch } = headAngles(face);
  // Neutral is wherever this head usually is (a webcam above the screen sees
  // a face tipped down a little), followed slowly.
  st.basePitch = st.basePitch === null ? pitch : st.basePitch + (pitch - st.basePitch) * 0.01;
  st.pose.push({ t: now, yaw, pitch });
  while (st.pose.length > 0 && now - st.pose[0].t > 1400) st.pose.shift();
  if (now - st.lastHead > 1500 && st.pose.length > 6) {
    const above = { x: face.top.x, y: face.top.y - 0.35 * s };
    if (swings(st.pose, "pitch", 0.1) >= 2 && range(st.pose, "yaw") < range(st.pose, "pitch")) {
      emoji(p, "✅", above.x, above.y, 0.35 * s);
      st.lastHead = now;
      st.pose = [];
      report("nod");
    } else if (swings(st.pose, "yaw", 0.12) >= 2 && range(st.pose, "pitch") < range(st.pose, "yaw")) {
      emoji(p, "❌", above.x, above.y, 0.35 * s);
      st.lastHead = now;
      st.pose = [];
      report("shake");
    }
  }
  const headUp = pitch - st.basePitch > 0.3;
  if (headUp && !st.headUp && now - st.lastHead > 800) {
    // From the top of the frame, or just above the head when that is lower.
    confetti(p, face.top.x, Math.max(0, face.top.y - 1.2 * s), 1.2 * s, 40, 0.06 * s, { down: true });
    report("headup");
  }
  st.headUp = headUp;
}

// ---------------------------------------------------------------------------
// Hands, for the claps and the thumbs up. Indices are MediaPipe's hand
// landmarks: 0 the wrist, 2/4 the base and tip of the thumb, 5/9/13/17 the
// knuckles, 6/10/14/18 the middle joints and 8/12/16/20 the fingertips.

function detectHands(p, task, timestamp, width, height) {
  const result = task.detectForVideo(p.small, timestamp);
  p.hands = (result.landmarks || []).map((landmarks) => landmarks.map((q) => ({ x: q.x * width, y: q.y * height })));
}

function palmOf(hand) {
  let x = 0;
  let y = 0;
  for (const i of [0, 5, 9, 13, 17]) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / 5, y: y / 5 };
}

function handSize(hand) {
  return dist(hand[0], hand[9]) || 1;
}

function thumbsUp(hand) {
  const size = handSize(hand);
  const folded = [[8, 6], [12, 10], [16, 14], [20, 18]].every(
    ([tip, joint]) => dist(hand[tip], hand[0]) < dist(hand[joint], hand[0]) * 1.05
  );
  if (!folded) return false;
  if (hand[4].y > hand[2].y - 0.5 * size) return false;
  return hand.every((q, i) => i === 3 || i === 4 || q.y > hand[4].y);
}

function handReactions(p, now) {
  const st = p.handState;
  const hands = p.hands;

  const thumb = hands.find(thumbsUp);
  if (thumb) {
    st.thumbFrames += 1;
    // Held for two looks in a row, so a hand passing through the pose does not count.
    if (st.thumbFrames === 2 && now - st.lastThumb > 1200) {
      st.lastThumb = now;
      const size = handSize(thumb);
      emoji(p, "👍", thumb[4].x, thumb[4].y - 0.4 * size, 0.9 * size, { vy: -0.4 * size });
      report("thumbs");
    }
  } else {
    st.thumbFrames = 0;
  }

  const clap = (at, size) => {
    st.lastClap = now;
    st.apartAt = 0;
    emoji(p, "👏", at.x, at.y - 0.5 * size, 0.9 * size, { vy: -0.5 * size, life: 0.9 });
    confetti(p, at.x, at.y, 1.6 * size, 14, 0.12 * size);
    report("clap");
  };
  if (hands.length === 2) {
    const a = palmOf(hands[0]);
    const b = palmOf(hands[1]);
    const size = (handSize(hands[0]) + handSize(hands[1])) / 2;
    const apart = dist(a, b) / size;
    if (apart > 1.6) st.apartAt = now;
    // Coming together from apart, quickly.
    if (apart < 1.0 && now - st.apartAt < 700 && now - st.lastClap > 250) clap(mid(a, b), size);
    st.pair = { at: mid(a, b), size, apart, t: now };
  } else if (st.pair && now - st.pair.t < 250 && st.pair.apart < 1.5 && now - st.apartAt < 700 && now - st.lastClap > 250) {
    // The two hands met and the detector saw one (or none): that was the clap.
    clap(st.pair.at, st.pair.size);
    st.pair = null;
  }
}

// ---------------------------------------------------------------------------
// Particles: moved and drawn every frame, `dt` seconds on.

function drawParticles(ctx, p, dt) {
  const alive = [];
  for (const q of p.particles) {
    q.age += dt;
    if (q.age >= q.life) continue;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.gravity) q.vy += q.gravity * dt;
    if (q.spin) q.rot += q.spin * dt;
    alive.push(q);
    const t = q.age / q.life;
    const size = q.size * (1 + (q.grow || 0) * t);
    ctx.save();
    ctx.globalAlpha = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.55) / 0.45);
    ctx.fillStyle = q.hue || "#ffffff";
    if (q.kind === "sparkle") {
      sparklePath(ctx, q.x, q.y, size * (1 - t * 0.5));
      ctx.fill();
    } else if (q.kind === "heart") {
      heartPath(ctx, q.x + Math.sin(q.age * 6) * size * 0.4, q.y, size);
      ctx.fill();
    } else if (q.kind === "star") {
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      starPath(ctx, size);
      ctx.fill();
      ctx.lineWidth = size * 0.08;
      ctx.strokeStyle = "#b8860b";
      ctx.stroke();
    } else if (q.kind === "confetti") {
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    } else if (q.kind === "bubble") {
      ctx.beginPath();
      ctx.arc(q.x + Math.sin(q.age * 5) * size * 0.3, q.y, size, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, size * 0.12);
      ctx.strokeStyle = q.hue;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x - size * 0.35, q.y - size * 0.35, size * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fill();
    } else if (q.kind === "emoji") {
      const pop = t < 0.15 ? 0.5 + (t / 0.15) * 0.6 : t < 0.25 ? 1.1 - ((t - 0.15) / 0.1) * 0.1 : 1;
      ctx.font = `${Math.round(size * pop)}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(q.char, q.x, q.y);
    } else {
      const pop = t < 0.2 ? 0.6 + t * 2 : 1;
      ctx.font = `900 ${Math.round(size * pop)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = size * 0.12;
      ctx.strokeStyle = "#7a4b00";
      ctx.strokeText("!", q.x, q.y);
      ctx.fillText("!", q.x, q.y);
    }
    ctx.restore();
  }
  p.particles = alive;
}

function sparklePath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

function starPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// 3D objects (experiment "camera-effects-3d")
//
// Three.js, from the CDN, the first time one is picked. The head's pose comes
// from the face landmarks themselves (their z is depth on the same scale as
// x), as a basis at the point between the eyes:
//
//   x along the eyes, y from the chin to the forehead, z out of the face,
//   one unit = the face's width (landmarks 234 to 454).
//
// Every model below is built in that space, so it follows the head turning
// and tilting. An invisible head (an ellipsoid writing depth only) hides
// whatever is behind it — the arms of the glasses, the back of a hat's brim.
// Drawn orthographically: a webcam's perspective over a face is too slight
// to be worth matching.

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
// The 3D layer is drawn at most this wide and stretched onto the frame.
const RENDER_3D_WIDTH = 960;

const three = { lib: null, loading: false, failed: false, promise: null };
let gl = null;

function ensureThree() {
  if (three.lib || three.loading || three.failed) return;
  three.loading = true;
  three.promise = import(THREE_URL)
    .then(
      (lib) => {
        three.lib = lib;
      },
      (err) => {
        three.failed = true;
        const reason = String((err && err.message) || err).slice(0, 120);
        self.postMessage({ type: "error", kind: "three", reason });
      }
    )
    .finally(() => {
      three.loading = false;
      postStatus();
    });
}

function ensureGl(width, height) {
  const THREE = three.lib;
  const scale = Math.min(1, RENDER_3D_WIDTH / width);
  const rw = Math.max(2, Math.round(width * scale));
  const rh = Math.max(2, Math.round(height * scale));
  if (!gl) {
    const canvas = new OffscreenCanvas(rw, rh);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.35, 0.6, 1);
    scene.add(sun);
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 1e6);
    camera.position.set(0, 0, 5e5);
    gl = { canvas, renderer, scene, camera, kind: null, heads: [], width: 0, height: 0 };
  }
  if (gl.width !== width || gl.height !== height || gl.canvas.width !== rw) {
    gl.renderer.setSize(rw, rh, false);
    gl.camera.left = 0;
    gl.camera.right = width;
    gl.camera.top = 0;
    gl.camera.bottom = -height;
    gl.camera.updateProjectionMatrix();
    gl.width = width;
    gl.height = height;
  }
  return gl;
}

// One group per face (up to two), each holding the occluder and the model.
function headsFor(kind, count) {
  const THREE = three.lib;
  if (gl.kind !== kind) {
    for (const head of gl.heads) {
      gl.scene.remove(head);
      head.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    gl.heads = [];
    gl.kind = kind;
  }
  while (gl.heads.length < count) {
    const head = new THREE.Group();
    head.matrixAutoUpdate = false;
    head.add(makeOccluder(THREE));
    head.add(makeModel(THREE, kind));
    gl.scene.add(head);
    gl.heads.push(head);
  }
  return gl.heads;
}

function makeOccluder(THREE) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshBasicMaterial({ colorWrite: false })
  );
  mesh.scale.set(0.5, 0.8, 0.62);
  mesh.position.set(0, 0.06, -0.6);
  mesh.renderOrder = -1;
  return mesh;
}

function makeModel(THREE, kind) {
  if (kind === "glasses3d") return makeGlasses3d(THREE);
  if (kind === "tophat3d") return makeTopHat(THREE);
  if (kind === "viking3d") return makeViking(THREE);
  return new THREE.Group();
}

function makeGlasses3d(THREE) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.45 });
  const w = 1.04;
  const h = 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -h / 2);
  shape.lineTo(w / 2, -h / 2);
  shape.lineTo(w / 2, h / 2);
  shape.lineTo(-w / 2, h / 2);
  shape.closePath();
  for (const side of [-1, 1]) {
    const hole = new THREE.Path();
    const cx = side * 0.23;
    hole.moveTo(cx - 0.17, -0.11);
    hole.lineTo(cx + 0.17, -0.11);
    hole.lineTo(cx + 0.17, 0.11);
    hole.lineTo(cx - 0.17, 0.11);
    hole.closePath();
    shape.holes.push(hole);
  }
  const front = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 }),
    frameMat
  );
  front.position.set(0, 0.02, 0.12);
  group.add(front);
  // Red and cyan, like cinema 3D glasses.
  for (const [side, color] of [[-1, 0xff2a2a], [1, 0x22d3ee]]) {
    const lens = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.22),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5, roughness: 0.15, side: THREE.DoubleSide })
    );
    lens.position.set(side * 0.23, 0.02, 0.15);
    group.add(lens);
    // Back to about the ear, no further.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.56), frameMat);
    arm.position.set(side * 0.52, 0.04, 0.12 - 0.28);
    group.add(arm);
  }
  return group;
}

function makeTopHat(THREE) {
  const group = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.55 });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.34, 0.62, 40), black);
  crown.position.y = 0.31;
  group.add(crown);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.01, 40), black);
  top.position.y = 0.62;
  group.add(top);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.035, 48), black);
  group.add(brim);
  const ribbon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.345, 0.345, 0.1, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc81e3a, roughness: 0.4 })
  );
  ribbon.position.y = 0.07;
  group.add(ribbon);
  group.position.set(0.03, 0.56, -0.48);
  group.rotation.z = -0.12;
  group.rotation.x = -0.08;
  return group;
}

function makeViking(THREE) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.75, roughness: 0.35 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb07a2c, metalness: 0.7, roughness: 0.4 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xf1e6c8, roughness: 0.6 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.56, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  dome.scale.set(1, 0.95, 1.08);
  dome.position.set(0, 0.3, -0.56);
  group.add(dome);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.575, 0.575, 0.09, 48, 1, true), bronze);
  band.scale.set(1, 1, 1.08);
  band.position.set(0, 0.33, -0.56);
  group.add(band);
  const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.535, 0.025, 8, 40, Math.PI), bronze);
  ridge.rotation.y = Math.PI / 2;
  ridge.scale.set(1.08, 0.97, 1);
  ridge.position.set(0, 0.3, -0.56);
  group.add(ridge);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.04), bronze);
  guard.position.set(0, 0.17, 0.06);
  group.add(guard);
  // Each horn a chain of tapering cylinders along a curve out and up.
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.5, 0.45, -0.52),
      new THREE.Vector3(side * 0.74, 0.58, -0.48),
      new THREE.Vector3(side * 0.86, 0.86, -0.44),
      new THREE.Vector3(side * 0.8, 1.08, -0.42),
    ]);
    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      const a = curve.getPoint(i / steps);
      const b = curve.getPoint((i + 1) / steps);
      const length = a.distanceTo(b);
      const r0 = 0.11 * (1 - i / steps) + 0.008;
      const r1 = 0.11 * (1 - (i + 1) / steps) + 0.008;
      const piece = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, length * 1.08, 14), ivory);
      piece.position.copy(a.clone().add(b).multiplyScalar(0.5));
      piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      group.add(piece);
    }
  }
  return group;
}

// The head's basis (see above) from one face's smoothed 3D points, in the
// scene's coordinates: y up and z towards the camera, where the image has y
// down and the landmarks' z grows away from it.
function headMatrix(THREE, face, matrix) {
  const v = (q) => new THREE.Vector3(q.x, -q.y, -q.z);
  const eyeL = v(face.eye3Left);
  const eyeR = v(face.eye3Right);
  const x = eyeR.clone().sub(eyeL).normalize();
  const up = v(face.top3).sub(v(face.chin3));
  const y = up.sub(x.clone().multiplyScalar(up.dot(x))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const size = v(face.side3Left).distanceTo(v(face.side3Right));
  matrix.makeBasis(x, y, z);
  matrix.scale(new THREE.Vector3(size, size, size));
  matrix.setPosition(eyeL.add(eyeR).multiplyScalar(0.5));
  return matrix;
}

function draw3d(ctx, p, kind, width, height) {
  if (!three.lib || p.render3dFailed || p.faces.length === 0) return;
  try {
    const g = ensureGl(width, height);
    const heads = headsFor(kind, p.faces.length);
    heads.forEach((head, i) => {
      const face = p.faces[i];
      head.visible = Boolean(face && face.eye3Left);
      if (head.visible) headMatrix(three.lib, face, head.matrix);
      head.matrixWorldNeedsUpdate = true;
    });
    g.renderer.render(g.scene, g.camera);
    ctx.drawImage(g.canvas, 0, 0, width, height);
  } catch (err) {
    p.render3dFailed = true;
    self.postMessage({ type: "error", kind: "render3d", reason: String((err && err.message) || err).slice(0, 120) });
  }
}

// ---------------------------------------------------------------------------
// Background replacement
//
// Same cut-out as the blur, the other way round: the replacement is drawn at
// the frame's full size, the person is cut out of it with the mask (stretched
// up from the detection size, which softens the edge a little), and the rest
// goes over the camera. The ready-made ones are painted here, once per size —
// no image files to fetch — and a custom one arrives as an ImageBitmap from
// the page (see pushCustomBackground in lib/cameraEffects.ts).

let customBackground = null;
const backgroundCache = new Map();

function setCustomBackground(bitmap) {
  if (customBackground) customBackground.close();
  customBackground = bitmap;
  for (const key of [...backgroundCache.keys()]) {
    if (key.startsWith("custom:")) backgroundCache.delete(key);
  }
}

function backgroundImage(kind, width, height) {
  if (kind === "custom" && !customBackground) return null;
  const key = `${kind}:${width}x${height}`;
  let canvas = backgroundCache.get(key);
  if (canvas) return canvas;
  const painter = BACKGROUND_PAINTERS[kind];
  if (!painter) return null;
  // A handful at most: a camera flip or a resolution change briefly needs two.
  if (backgroundCache.size >= 4) backgroundCache.clear();
  canvas = new OffscreenCanvas(width, height);
  painter(canvas.getContext("2d"), width, height);
  backgroundCache.set(key, canvas);
  return canvas;
}

function drawReplacedBackground(p, kind, color, width, height) {
  const image = backgroundImage(kind, width, height);
  if (!image) return;
  if (!p.full || p.full.width !== width || p.full.height !== height) {
    p.full = new OffscreenCanvas(width, height);
    p.fullCtx = p.full.getContext("2d");
  }
  const ctx = p.fullCtx;
  ctx.globalCompositeOperation = "copy";
  ctx.filter = color;
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "destination-out";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(p.mask, 0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  p.ctx.drawImage(p.full, 0, 0);
}

// A fixed sequence, so a background looks the same every time it is painted.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function verticalGradient(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([at, c]) => g.addColorStop(at, c));
  return g;
}

function glow(ctx, x, y, r, inner) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// A ridge from left to right at `base`, filled down to the bottom.
function ridge(ctx, w, h, base, amp, freq, phase, fill) {
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i <= 48; i += 1) {
    const x = (i / 48) * w;
    const y = base + amp * Math.sin((i / 48) * freq + phase) + amp * 0.4 * Math.sin((i / 48) * freq * 2.7 + phase * 1.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const BACKGROUND_PAINTERS = {
  sunset(ctx, w, h) {
    ctx.fillStyle = verticalGradient(ctx, 0, h, [[0, "#2b1055"], [0.45, "#c2417d"], [0.7, "#ff8a5b"], [1, "#ffc46b"]]);
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.68, h * 0.64, h * 0.4, "rgba(255, 214, 150, 0.75)");
    ctx.beginPath();
    ctx.arc(w * 0.68, h * 0.64, h * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe3a3";
    ctx.fill();
    ridge(ctx, w, h, h * 0.7, h * 0.04, 5, 0.6, "#7a2d63");
    ridge(ctx, w, h, h * 0.8, h * 0.035, 4, 2.1, "#4a1747");
    ridge(ctx, w, h, h * 0.9, h * 0.025, 3, 4.0, "#2a0c2e");
  },
  beach(ctx, w, h) {
    ctx.fillStyle = verticalGradient(ctx, 0, h * 0.56, [[0, "#3d9cf5"], [1, "#cdeeff"]]);
    ctx.fillRect(0, 0, w, h * 0.56);
    glow(ctx, w * 0.82, h * 0.17, h * 0.22, "rgba(255, 250, 210, 0.9)");
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.17, h * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = "#fffbe0";
    ctx.fill();
    const rand = seeded(7);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    for (const [cx, cy, size] of [[0.2, 0.16, 1], [0.48, 0.1, 0.8], [0.6, 0.28, 0.6]]) {
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.ellipse(w * cx + (i - 2) * h * 0.05 * size, h * cy + (rand() - 0.5) * h * 0.02, h * 0.06 * size, h * 0.035 * size, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = verticalGradient(ctx, h * 0.55, h * 0.8, [[0, "#1667b8"], [1, "#3fb5e6"]]);
    ctx.fillRect(0, h * 0.55, w, h * 0.27);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(1, h * 0.004);
    for (let i = 0; i < 14; i += 1) {
      const y = h * (0.58 + rand() * 0.2);
      const x = rand() * w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w * (0.04 + rand() * 0.08), y);
      ctx.stroke();
    }
    ridge(ctx, w, h, h * 0.8, h * 0.012, 6, 1, "rgba(255, 255, 255, 0.85)");
    ctx.save();
    ctx.translate(0, h * 0.012);
    ridge(ctx, w, h, h * 0.8, h * 0.012, 6, 1, verticalGradient(ctx, h * 0.78, h, [[0, "#f6dca6"], [1, "#e4b874"]]));
    ctx.restore();
  },
  space(ctx, w, h) {
    const bg = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, Math.max(w, h));
    bg.addColorStop(0, "#2a1d5c");
    bg.addColorStop(1, "#05040f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.25, h * 0.6, h * 0.6, "rgba(150, 60, 200, 0.25)");
    glow(ctx, w * 0.6, h * 0.2, h * 0.5, "rgba(40, 120, 220, 0.2)");
    const rand = seeded(42);
    const unit = h / 720;
    for (let i = 0; i < 320; i += 1) {
      ctx.globalAlpha = 0.3 + rand() * 0.7;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, (0.4 + rand() * 1.4) * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const px = w * 0.8;
    const py = h * 0.28;
    const r = h * 0.13;
    const ring = (start, end) => {
      ctx.beginPath();
      ctx.ellipse(px, py, r * 1.9, r * 0.4, -0.3, start, end);
      ctx.lineWidth = r * 0.12;
      ctx.strokeStyle = "rgba(255, 220, 180, 0.65)";
      ctx.stroke();
    };
    ring(Math.PI, Math.PI * 2);
    const planet = ctx.createRadialGradient(px - r * 0.4, py - r * 0.4, r * 0.1, px, py, r);
    planet.addColorStop(0, "#ffc58a");
    planet.addColorStop(1, "#8a3d1c");
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = planet;
    ctx.fill();
    ring(0, Math.PI);
  },
  office(ctx, w, h) {
    ctx.fillStyle = verticalGradient(ctx, 0, h, [[0, "#f1ebe1"], [1, "#d6ccbd"]]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = verticalGradient(ctx, h * 0.84, h, [[0, "#a77f58"], [1, "#7f5d3d"]]);
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    // The window.
    const wx = w * 0.06;
    const wy = h * 0.12;
    const ww = w * 0.3;
    const wh = h * 0.5;
    ctx.fillStyle = verticalGradient(ctx, wy, wy + wh, [[0, "#8fcbff"], [1, "#e3f3ff"]]);
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.ellipse(wx + ww * 0.3, wy + wh * 0.3, ww * 0.12, wh * 0.05, 0, 0, Math.PI * 2);
    ctx.ellipse(wx + ww * 0.42, wy + wh * 0.28, ww * 0.1, wh * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = h * 0.014;
    ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy);
    ctx.lineTo(wx + ww / 2, wy + wh);
    ctx.moveTo(wx, wy + wh / 2);
    ctx.lineTo(wx + ww, wy + wh / 2);
    ctx.stroke();
    // Two shelves of books, and a plant on the lower one.
    const rand = seeded(3);
    const colors = ["#c0392b", "#2c6fbb", "#e1a12f", "#3c8d5a", "#6c4ab6", "#d35d8a", "#34495e"];
    const sx = w * 0.62;
    const sw = w * 0.32;
    for (const [shelfY, until] of [[h * 0.38, 1], [h * 0.62, 0.62]]) {
      let x = sx + w * 0.01;
      while (x < sx + sw * until - w * 0.02) {
        const bw = w * (0.012 + rand() * 0.012);
        const bh = h * (0.1 + rand() * 0.06);
        ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
        ctx.fillRect(x, shelfY - bh, bw, bh);
        x += bw + w * 0.002;
      }
      ctx.fillStyle = "#8b5e3c";
      ctx.fillRect(sx, shelfY, sw, h * 0.022);
    }
    const potX = sx + sw * 0.8;
    const potY = h * 0.62;
    ctx.fillStyle = "#3d8b4f";
    for (let i = 0; i < 7; i += 1) {
      const a = -Math.PI / 2 + (i - 3) * 0.32;
      ctx.beginPath();
      ctx.ellipse(potX + Math.cos(a) * h * 0.05, potY - h * 0.07 + Math.sin(a) * h * 0.05, h * 0.018, h * 0.055, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#c8693b";
    ctx.fillRect(potX - h * 0.035, potY - h * 0.06, h * 0.07, h * 0.06);
  },
  aurora(ctx, w, h) {
    ctx.fillStyle = verticalGradient(ctx, 0, h, [[0, "#030a14"], [1, "#0b2236"]]);
    ctx.fillRect(0, 0, w, h);
    const rand = seeded(11);
    const unit = h / 720;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 160; i += 1) {
      ctx.globalAlpha = 0.2 + rand() * 0.6;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h * 0.7, (0.4 + rand()) * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    const tints = ["rgba(46, 230, 160, 0.4)", "rgba(60, 200, 255, 0.28)", "rgba(170, 90, 255, 0.26)", "rgba(46, 230, 160, 0.3)"];
    tints.forEach((tint, i) => {
      ctx.save();
      ctx.translate(w * (0.15 + i * 0.24), h * (0.3 + (i % 2) * 0.08));
      ctx.scale(1, 0.45);
      glow(ctx, 0, 0, w * 0.32, tint);
      ctx.restore();
    });
    ctx.globalCompositeOperation = "source-over";
    ridge(ctx, w, h, h * 0.82, h * 0.05, 4, 0.3, "#06101a");
    ridge(ctx, w, h, h * 0.9, h * 0.03, 6, 2, "#020609");
  },
  studio(ctx, w, h) {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.75);
    g.addColorStop(0, "#6b7280");
    g.addColorStop(0.55, "#2a2f37");
    g.addColorStop(1, "#0d0f12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
  custom(ctx, w, h) {
    // Covering the frame, cropped from the middle.
    const b = customBackground;
    const scale = Math.max(w / b.width, h / b.height);
    const dw = b.width * scale;
    const dh = b.height * scale;
    ctx.drawImage(b, (w - dw) / 2, (h - dh) / 2, dw, dh);
  },
};
