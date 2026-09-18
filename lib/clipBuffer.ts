// "Clipar os últimos 30s" of any tile in the room.
//
// A browser cannot keep one MediaRecorder running and cut its last 30 seconds
// out: every chunk after the first depends on the header and keyframe at the
// very start, so a tail on its own does not play. Instead a fresh recorder is
// started every STAGGER_MS, and each is thrown away once it is older than
// MAX_AGE_MS. At any moment the oldest live recorder has been running for
// between CLIP_MS and MAX_AGE_MS, so stopping it yields a complete, standalone
// file covering (at least) the last 30 seconds. Nothing is remuxed and nothing
// leaves the browser.
//
// Cost: up to MAX_AGE_MS / STAGGER_MS encoders per buffered stream, so the
// bitrate is capped to keep that affordable.

export const CLIP_MS = 30_000;
const STAGGER_MS = 10_000;
const MAX_AGE_MS = CLIP_MS + STAGGER_MS;
const VIDEO_BITS_PER_SECOND = 2_500_000;

type Segment = {
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
};

// MP4 first: it is what people expect to open and post anywhere. Chrome/Edge
// (126+) and Safari record it natively; Firefox only records WebM, so that is
// the fallback there. No transcoding happens in the page.
function pickMimeType(hasAudio: boolean): string | undefined {
  const candidates = hasAudio
    ? [
        "video/mp4;codecs=avc1.640028,mp4a.40.2",
        "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
        "video/mp4;codecs=avc1,mp4a",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]
    : [
        "video/mp4;codecs=avc1.640028",
        "video/mp4;codecs=avc1.42E01F",
        "video/mp4;codecs=avc1",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function clipSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
}

export class ClipBuffer {
  private segments: Segment[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private mimeType: string | undefined;
  private disposed = false;

  constructor(private readonly stream: MediaStream) {
    this.mimeType = pickMimeType(stream.getAudioTracks().length > 0);
    this.startSegment();
    this.timer = setInterval(() => {
      this.startSegment();
      this.prune();
    }, STAGGER_MS);
  }

  // How much is buffered right now, so the button can say "clipping 12s" while
  // the buffer is still filling up after joining.
  bufferedMs(): number {
    const oldest = this.segments[0];
    return oldest ? Math.min(Date.now() - oldest.startedAt, MAX_AGE_MS) : 0;
  }

  // Stops the oldest recorder and hands back its file. That recorder's
  // coverage is gone afterwards, but the next one is at most STAGGER_MS
  // younger, so a second clip right after still gets ~20s+.
  async clip(): Promise<{ blob: Blob; durationMs: number } | null> {
    const segment = this.segments.shift();
    if (!segment) return null;
    const { recorder, chunks, startedAt } = segment;
    const durationMs = Date.now() - startedAt;
    const finish = () =>
      chunks.length ? { blob: new Blob(chunks, { type: this.blobType(recorder) }), durationMs } : null;
    if (recorder.state === "inactive") return finish();
    return new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(finish()), { once: true });
      recorder.stop();
    });
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of this.segments) this.stopRecorder(s.recorder);
    this.segments = [];
  }

  private blobType(recorder: MediaRecorder): string {
    return (recorder.mimeType || this.mimeType || "video/webm").split(";")[0];
  }

  private startSegment() {
    if (this.disposed) return;
    if (!this.stream.getVideoTracks().some((track) => track.readyState === "live")) return;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch {
      return;
    }
    const segment: Segment = { recorder, chunks: [], startedAt: Date.now() };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) segment.chunks.push(event.data);
    };
    // A track being added/removed mid-recording errors the recorder; drop it
    // and let the next stagger start a clean one.
    recorder.onerror = () => {
      this.segments = this.segments.filter((s) => s !== segment);
    };
    try {
      // A timeslice keeps the data flowing into `chunks` instead of one giant
      // blob held inside the recorder until stop().
      recorder.start(1000);
    } catch {
      return;
    }
    this.segments.push(segment);
  }

  private prune() {
    const now = Date.now();
    while (this.segments.length > 1 && now - this.segments[0].startedAt > MAX_AGE_MS) {
      this.stopRecorder(this.segments.shift()!.recorder);
    }
  }

  private stopRecorder(recorder: MediaRecorder) {
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already torn down with its tracks.
      }
    }
  }
}

// A plain start/stop recording of one tile, for the "gravar" button. Unlike
// the clip buffer this is a single recorder for as long as the person wants.
export class TileRecorder {
  private recorder: MediaRecorder | null;
  private chunks: Blob[] = [];
  readonly startedAt = Date.now();

  constructor(stream: MediaStream) {
    const mimeType = pickMimeType(stream.getAudioTracks().length > 0);
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1000);
  }

  stop(): Promise<{ blob: Blob; durationMs: number } | null> {
    const recorder = this.recorder;
    this.recorder = null;
    const durationMs = Date.now() - this.startedAt;
    if (!recorder) return Promise.resolve(null);
    const finish = () => {
      if (!this.chunks.length) return null;
      const type = (recorder.mimeType || "video/webm").split(";")[0];
      return { blob: new Blob(this.chunks, { type }), durationMs };
    };
    if (recorder.state === "inactive") return Promise.resolve(finish());
    return new Promise((resolve) => {
      recorder.addEventListener("stop", () => resolve(finish()), { once: true });
      recorder.stop();
    });
  }
}

// The mark on clips from accounts without Pro Max ("clip_no_watermark"):
// small, bottom-right, on a dark pill so it reads on any picture.
export const CLIP_WATERMARK = "Clipped with golive.nemtudo.me";

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  const size = Math.max(11, Math.round(height * 0.026));
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const padX = size * 0.6;
  const padY = size * 0.35;
  const textWidth = ctx.measureText(text).width;
  const boxW = textWidth + padX * 2;
  const boxH = size + padY * 2;
  const margin = Math.round(size * 0.8);
  const x = width - boxW - margin;
  const y = height - boxH - margin;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, boxH / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + boxH / 2);
}

// Cutting a recording down to [startS, endS]. There is no muxer in the page
// (and adding ffmpeg.wasm for this would be a heavy dependency), so the chosen
// stretch is played back into a fresh MediaRecorder: it takes as long as the
// stretch itself, in exchange for zero dependencies. The picture comes from
// the element's captureStream, the sound through WebAudio so nothing is heard
// while it runs. With a watermark, the picture goes through a canvas instead.
export async function trimRecording(
  blob: Blob,
  startS: number,
  endS: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  options: { watermark?: string | null } = {},
): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  let audioContext: AudioContext | null = null;
  let drawFrame = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("load"));
    });
    video.currentTime = startS;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const capture = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const tracks: MediaStreamTrack[] = [];
    if (options.watermark) {
      // The picture goes through a canvas so the mark is part of the file.
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const text = options.watermark;
      const draw = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawWatermark(ctx, canvas.width, canvas.height, text);
        drawFrame = requestAnimationFrame(draw);
      };
      draw();
      tracks.push(...canvas.captureStream(30).getVideoTracks());
    } else {
      const source = capture.captureStream?.() ?? capture.mozCaptureStream?.();
      if (!source) return null;
      tracks.push(...source.getVideoTracks());
    }
    try {
      audioContext = new AudioContext();
      const node = audioContext.createMediaElementSource(video);
      const destination = audioContext.createMediaStreamDestination();
      node.connect(destination);
      tracks.push(...destination.stream.getAudioTracks());
    } catch {
      // No WebAudio: the cut keeps the picture only, and the element stays
      // muted so nothing plays out loud.
      video.muted = true;
    }
    const stream = new MediaStream(tracks);
    const mimeType = pickMimeType(stream.getAudioTracks().length > 0);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.start(1000);
    await video.play();

    await new Promise<void>((resolve) => {
      const finish = () => {
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
        resolve();
      };
      const tick = () => {
        if (signal.aborted || video.ended || video.currentTime >= endS) return finish();
        onProgress(Math.min(1, (video.currentTime - startS) / Math.max(0.001, endS - startS)));
        requestAnimationFrame(tick);
      };
      video.onended = finish;
      signal.addEventListener("abort", finish, { once: true });
      tick();
    });
    await stopped;
    if (signal.aborted || !chunks.length) return null;
    onProgress(1);
    return new Blob(chunks, { type: (recorder.mimeType || mimeType || "video/webm").split(";")[0] });
  } catch {
    return null;
  } finally {
    cancelAnimationFrame(drawFrame);
    video.pause();
    video.removeAttribute("src");
    video.load();
    void audioContext?.close();
    URL.revokeObjectURL(url);
  }
}

export function downloadClip(blob: Blob, name: string) {
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const safe = name.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "clip";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe} ${stamp}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
