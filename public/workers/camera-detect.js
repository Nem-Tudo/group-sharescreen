// The detection of "Efeitos de câmera": MediaPipe (face landmarks, selfie
// segmentation, hands), in a worker of its own, started by
// camera-effects.js (the frame loop) and answering only it.
//
// Apart because loading a model holds its thread: creating the task and its
// first run (which compiles the GPU shaders) took close to 3 seconds on a
// computer and more on a phone, and while all that ran on the frame loop's
// thread every camera frame waited behind it — the picture froze each time
// an effect needing a model not loaded yet was picked. Here it only holds
// the answers back; the frames keep going, with the last answer or none.
//
// MediaPipe is loaded from the CDN the first time an effect that needs it is
// picked, and only that model: blur never downloads the face model, a dog
// nose never downloads the segmenter.
//
// A classic worker, not a module one: MediaPipe loads its WASM glue with
// importScripts, which module workers do not have. The library itself is its
// ES module build, through import() (allowed in a classic worker too).
//
// Loaded with the frame loop's own ?v=N (see WORKER_VERSION in
// lib/cameraEffects.ts): bump it there whenever this file changes.
//
// Messages in:
//   { type: "want", face, segment, hand }   which models the effects need now
//   { type: "ready?", nonce }               answered once those have loaded (or failed)
//   { type: "detect", seq, bitmap, face, segment, hand }
// Messages out:
//   { type: "status", loading }   { type: "loaded", kind }   { type: "error", kind, reason }
//   { type: "ready", nonce }
//   { type: "result", seq, faces?, blendshapes?, mask?, hands?, failed? }

const VISION_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const SEGMENT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// The size the frame loop sends (DETECT_WIDTH there), for the warm-up.
const WARM_UP_WIDTH = 320;

const KINDS = ["face", "segment", "hand"];
let wanted = { face: false, segment: false, hand: false };
let visionPromise = null;
// `promise`: the load under way, settled either way.
const tasks = {
  face: { task: null, loading: false, failed: false, promise: null },
  segment: { task: null, loading: false, failed: false, promise: null },
  // Only for the reactions (claps, thumbs up).
  hand: { task: null, loading: false, failed: false, promise: null },
};
let lastTimestamp = 0;

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "want") {
    wanted = { face: Boolean(data.face), segment: Boolean(data.segment), hand: Boolean(data.hand) };
    ensureTasks();
  } else if (data.type === "ready?") {
    readiness().then(() => self.postMessage({ type: "ready", nonce: data.nonce }));
  } else if (data.type === "detect") {
    detect(data);
  }
};

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
// thread for a second or more: paid here, on a blank picture, before any
// frame is sent to it.
function warmUp(kind, task) {
  try {
    const blank = new OffscreenCanvas(WARM_UP_WIDTH, Math.round((WARM_UP_WIDTH * 3) / 4));
    blank.getContext("2d").fillRect(0, 0, blank.width, blank.height);
    if (kind === "segment") task.segmentForVideo(blank, nextTimestamp(), () => {});
    else task.detectForVideo(blank, nextTimestamp());
  } catch {
    // Only a head start; the real frames will find out if it is broken.
  }
}

function readiness() {
  const waits = KINDS.filter((kind) => wanted[kind] && tasks[kind].promise).map((kind) => tasks[kind].promise);
  return Promise.allSettled(waits);
}

function ensureTasks() {
  for (const kind of KINDS) {
    const slot = tasks[kind];
    if (!wanted[kind] || slot.task || slot.loading || slot.failed) continue;
    slot.loading = true;
    slot.promise = createTask(kind)
      .then(
        (task) => {
          slot.task = task;
          self.postMessage({ type: "loaded", kind });
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
  const loading = KINDS.some((kind) => wanted[kind] && tasks[kind].loading);
  self.postMessage({ type: "status", loading });
}

// Every task wants strictly increasing timestamps.
function nextTimestamp() {
  lastTimestamp = Math.max(lastTimestamp + 1, performance.now());
  return lastTimestamp;
}

// One look at one small copy of a frame, with whichever of the asked models
// are loaded. Only what the frame loop uses goes back: the landmarks, the
// expressions' scores, and the person's mask (transferred, not copied).
function detect(data) {
  const out = { type: "result", seq: data.seq };
  const transfer = [];
  const bitmap = data.bitmap;
  try {
    const timestamp = nextTimestamp();
    if (data.segment && tasks.segment.task) {
      tasks.segment.task.segmentForVideo(bitmap, timestamp, (result) => {
        const masks = result.confidenceMasks;
        if (!masks || masks.length === 0) return;
        // Two masks: background, person. One: person.
        const mask = masks.length > 1 ? masks[1] : masks[0];
        // A copy: the task's own array is only good inside this callback.
        out.mask = new Float32Array(mask.getAsFloat32Array());
        transfer.push(out.mask.buffer);
      });
    }
    if (data.face && tasks.face.task) {
      const result = tasks.face.task.detectForVideo(bitmap, timestamp);
      out.faces = result.faceLandmarks || [];
      out.blendshapes = (result.faceBlendshapes || []).map((shapes) => ({
        categories: (shapes.categories || []).map((c) => ({ categoryName: c.categoryName, score: c.score })),
      }));
    }
    if (data.hand && tasks.hand.task) {
      const result = tasks.hand.task.detectForVideo(bitmap, nextTimestamp());
      out.hands = result.landmarks || [];
    }
  } catch (err) {
    out.failed = String((err && err.message) || err).slice(0, 120);
  } finally {
    if (bitmap) bitmap.close();
  }
  self.postMessage(out, transfer);
}
