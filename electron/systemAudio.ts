// System audio capture that excludes GoLive's own output, and whatever else
// the user asked to leave out.
//
// The problem this solves
// -----------------------
// A screen share with system audio captures the whole render mix — which
// includes what GoLive itself is playing: every participant's voice, and the
// audio of every screen share being watched. Those go straight back out to
// the room, so everyone hears themselves a beat late. That is the echo.
//
// Electron's own `audio: "loopback"` cannot help, because it captures the
// endpoint mix with no way to leave a process out of it, and Chromium
// exposes no process-loopback device id to ask for one. So the capture is
// done here instead, by a small native helper (electron/native) that uses
// the WASAPI process-loopback API.
//
// Two ways to run it, and why there are two
// -----------------------------------------
// The helper's EXCLUDE mode captures everything except one process tree,
// which is exactly the shape of "everything except GoLive" — and for most
// people that is the whole story, so it stays the default path, unchanged.
//
// It does not generalise, though: AUDIOCLIENT_ACTIVATION_PARAMS carries a
// single TargetProcessId, so "everything except GoLive *and* Discord" cannot
// be requested at all. When the user has muted anything, the set is built
// from the other side instead — one INCLUDE capture per application that
// should be heard, mixed here. That costs a helper process per audible app
// (typically two or three) and a periodic re-scan to notice applications
// that start playing mid-share, which is why it is not the path taken when
// nothing is muted. (It used to be taken only when a muted application was
// already playing; see startSystemAudioCapture for why that leaked.)
//
// The trade the exclusion makes deliberately: GoLive's *other* sounds — the
// join and leave chimes, an embedded YouTube/Twitch tile — are left out too,
// since nothing distinguishes them from the participants' audio at the
// process level. That is the right outcome anyway. Everyone in the room
// already hears those locally, so putting them in the stream would double
// them.
//
// Windows runs the native helper. Linux has no process loopback to ask for,
// but PulseAudio (and PipeWire's Pulse server) can record one application's
// playback stream on its own (parec --monitor-stream), which is the INCLUDE
// shape without a helper — so Linux always runs per-application, one parec
// per stream that should be heard. macOS degrades to nothing; see
// isSystemAudioExclusionSupported.

import { app } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import { getSystemAudioSettings, type SystemAudioSettings } from "./audioSettings";
import { IPC, SYSTEM_AUDIO_FORMAT } from "./channels";

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Whether this Windows can do process loopback is decided by *asking it*,
// not by comparing build numbers.
//
// The temptation is a check against 20348, the build Microsoft's docs name.
// It would be wrong. 20348 is Server 2022, so the check reads as "Windows 11
// or later" and would exclude every Windows 10 machine — but the API is
// reported working on Windows 10 22H2, where the only thing that actually
// fails is GetMixFormat/IsFormatSupported returning E_NOTIMPL
// (microsoft/Windows-classic-samples#343). The helper calls neither: process
// loopback is not tied to an endpoint, so it states its format instead of
// negotiating one.
//
// So the helper is launched and answers for itself — it prints READY when
// the capture is running, and exits with a distinct code when activation is
// refused. A version gate here could only ever be a guess at that answer,
// and guessing high silently disables the feature on machines that support
// it while guessing low breaks the share on machines that do not.
const READY_LINE = "READY";

// How long to wait for that line before giving up. Generous: this covers a
// process start and one COM activation, both of which are fast, but a cold
// page-in of the executable on a busy machine is not.
const READY_TIMEOUT_MS = 5000;

// Remembers a refusal, so a machine that cannot do this pays for one spawn
// per session rather than one per share. Never set from an ordinary failure
// — only from the helper explicitly reporting the API unavailable, or from
// the helper not being startable at all (see markHelperUnstartable).
let knownUnsupported = false;

// The helper could not even be started: the file is gone, or Windows refused
// to run it. In practice that is Windows Defender — an unsigned, low-
// prevalence executable that records audio is exactly what its machine-
// learning detections quarantine, and some users had it happen.
//
// Treated as "this machine cannot do it" for the rest of the session, so the
// share falls back to Electron's own loopback audio (with the echo, but with
// sound). Before this, a helper that failed to start in per-app mode read as
// "that application closed", the capture carried on with nothing in it, and
// the share went out silent with no fallback at all.
function markHelperUnstartable(reason: string) {
  if (process.platform === "linux") linuxTools = false;
  else knownUnsupported = true;
  console.error(`[audiocap] The capture helper could not be started (${reason}) — falling back to Electron's loopback for this session.`);
}

// The helper's own exit code for "activation refused". Mirrors
// EXIT_UNSUPPORTED in native/src/audiocap.cpp.
const EXIT_UNSUPPORTED = 3;

// How much audio to accumulate before handing a chunk to the renderer.
// WASAPI delivers ~10 ms packets; forwarding each one individually would be
// 100 IPC messages a second for no benefit, while batching much further
// would start to matter for latency. 20 ms is the same period Opus encodes
// at anyway.
const CHUNK_MS = 20;
const BYTES_PER_FRAME = SYSTEM_AUDIO_FORMAT.channels * (SYSTEM_AUDIO_FORMAT.bitsPerSample / 8);
const CHUNK_BYTES = (SYSTEM_AUDIO_FORMAT.sampleRate / 1000) * CHUNK_MS * BYTES_PER_FRAME;

// Per-source limits that only matter when several sources are being mixed.
//
// A source that has not produced a packet for this long is treated as silent
// rather than waited for, which is the normal state of an application that
// simply is not playing anything: process loopback delivers nothing at all
// for an idle stream, so "no data" is a value, not a stall. Comfortably
// longer than the ~10 ms packet cadence, short enough that it never becomes
// audible as a lag on the sources that *are* playing.
const SOURCE_IDLE_MS = 120;

// And the other direction: a source whose audio nobody is consuming, because
// every other source went quiet at once. Half a second is far more than the
// mixer ever legitimately holds, so reaching it means dropping the oldest
// audio — this is a live stream, and stale samples have no value.
const SOURCE_MAX_QUEUED_BYTES =
  (SYSTEM_AUDIO_FORMAT.sampleRate * BYTES_PER_FRAME) / 2;

// How often the per-application capture re-reads the list of audio sessions.
// This is what notices a game that just started playing, or a browser tab
// that opened a video — neither existed as an audio session when the share
// began. Every scan is one short-lived helper process, so it is not free;
// four seconds keeps that in the noise while staying well below the point
// where a person would call it broken.
const RESCAN_MS = 4000;

// Where the helper lives, which differs between a checkout and an installed
// app. Packaged it is copied verbatim into resources/ (see
// electron-builder.yml's extraResources) rather than into app.asar, because
// a process inside an asar archive cannot be executed — the archive is not a
// real directory to the OS.
function helperPath(): string {
  const name = "golive-audiocap.exe";
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, "..", "native", "bin", name);
}

/**
 * Whether it is worth *trying* to capture system audio with GoLive left out
 * of it — this machine is Windows and the helper shipped with the build.
 *
 * Deliberately not the same question as "will it work": that one is only
 * answered by running the helper (see READY_LINE above), and the answer
 * arrives too late for the preload, which has to decide at window-creation
 * time whether to expose the bridge at all. Being optimistic here is the
 * right way round — `start()` still reports a refusal honestly, and the web
 * app treats that exactly like an absent bridge.
 */
export function isSystemAudioExclusionSupported(): boolean {
  if (process.platform === "linux") return linuxToolsAvailable();
  if (process.platform !== "win32") return false;
  if (knownUnsupported) return false;
  return existsSync(helperPath());
}

// The two PulseAudio command-line tools the Linux path runs: pactl to list the
// playback streams, parec to record each one. Both ship in the same package
// (pulseaudio-utils) and both speak to PipeWire's Pulse server as well. This
// used to answer true unconditionally, so a machine without them showed the
// per-app mute panel, "started" a capture that could never produce anything,
// and shared silence instead of falling back.
//
// A PATH lookup rather than a spawn, because the preload asks this
// synchronously at window creation (see isSystemAudioExclusionSupported).
let linuxTools: boolean | null = null;
function linuxToolsAvailable(): boolean {
  if (linuxTools !== null) return linuxTools;
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const has = (tool: string) => dirs.some((dir) => existsSync(path.join(dir, tool)));
  linuxTools = has("pactl") && has("parec");
  return linuxTools;
}

// The processes that are GoLive itself, for recognising its own playback
// streams on Linux. Electron plays audio from a utility process rather than
// the main one, so process.pid alone would miss exactly the stream that
// matters; getAppMetrics lists every process the app has.
function ownPids(): Set<number> {
  return new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]);
}

// ---------------------------------------------------------------------------
// The applications that can be muted
// ---------------------------------------------------------------------------

/** One application the helper reported, from either listing. */
export interface AudioApp {
  /** Lower-cased executable file name — the key the mute list is written in. */
  key: string;
  /** What the vendor calls it ("Discord"), or the file name as a fallback. */
  name: string;
  /** Full path to the executable, for the icon. */
  path: string;
  /** Every process currently running it. */
  pids: number[];
  /** GoLive itself, which is always muted and cannot be un-muted. */
  self: boolean;
}

/**
 * The applications currently holding an audio stream.
 *
 * This is what the capture acts on, because a stream is the only thing there
 * is to leave out of a mix — a process without one cannot make a sound.
 */
export function listAudioApps(): Promise<AudioApp[]> {
  return runListing("--list-sessions");
}

/**
 * The applications a person would say are open — what alt-tab shows.
 *
 * This is what the picker offers for muting, and it is deliberately the other
 * list: somebody mutes "Discord", a program they have open, and has no idea
 * which processes are holding audio streams. The two meet at the executable
 * name, which is what the mute list is written in.
 */
export function listOpenApps(): Promise<AudioApp[]> {
  return runListing("--list-windows");
}

// The playback streams (Pulse "sink inputs") playing right now, grouped by
// application. On Linux `pids` holds *sink-input indexes*, not process ids:
// that is what parec --monitor-stream records, and a stream is the unit here
// the way a process tree is on Windows.
//
// It used to hold PipeWire node ids and hand them to pw-record --target, which
// asks the session manager to link a capture to a *playback* stream — not a
// link WirePlumber makes, so a muted-app share recorded nothing or the wrong
// thing depending on the setup. The sink-input index and parec have no such
// ambiguity, on PulseAudio and on PipeWire's Pulse server alike.
async function listLinuxAudioStreams(): Promise<AudioApp[]> {
  try {
    const { stdout } = await execAsync("pactl -f json list sink-inputs");
    const inputs = JSON.parse(stdout);
    if (!Array.isArray(inputs)) return [];

    const own = ownPids();
    const byKey = new Map<string, AudioApp>();

    for (const input of inputs) {
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0) continue;
      const props = input.properties || {};
      const binary = props["application.process.binary"] || props["application.name"] || `App ${index}`;
      const name = props["application.name"] || props["media.name"] || binary;
      const exePath = props["application.process.binary"] || binary;
      const key = String(binary).toLowerCase();
      // GoLive's own streams — the room's voices, the whole reason this
      // capture exists. Recognised by process id first: a name check alone
      // ("golive", "electron") misses a renamed build and catches every
      // other Electron app on the machine.
      const self =
        own.has(Number(props["application.process.id"])) ||
        key.includes("golive") ||
        key === "electron";
      // Speech synthesis is the desktop reading things out, not an
      // application anybody shares.
      if (key.includes("speech-dispatcher")) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (!existing.pids.includes(index)) existing.pids.push(index);
        existing.self = existing.self || self;
        continue;
      }

      byKey.set(key, { key, name, path: exePath, pids: [index], self });
    }

    return [...byKey.values()];
  } catch {
    return [];
  }
}

/**
 * Resolves empty rather than rejecting. Every caller — the picker's panel and
 * the capture's own scan — has a reasonable answer for "nothing", and neither
 * has one for an exception.
 */
function runListing(mode: string): Promise<AudioApp[]> {
  if (process.platform === "linux") {
    return listLinuxAudioStreams();
  }
  if (!isSystemAudioExclusionSupported()) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      helperPath(),
      [mode],
      // Bounded on both axes because this runs on a timer during a live
      // share: a helper that wedges must not accumulate, and a runaway
      // listing must not be read into memory unboundedly.
      { timeout: 3000, maxBuffer: 1 << 20, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        // A string code (ENOENT, EACCES, UNKNOWN...) is the process never
        // starting; a number is it starting and exiting non-zero, which is
        // the helper's own business (see its exit codes).
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error && typeof code === "string") markHelperUnstartable(code);
        if (error && !stdout) {
          resolve([]);
          return;
        }
        resolve(parseListing(stdout));
      }
    );
  });
}

// "<pid>\t<name>\t<full path>" per line — see PrintProcessRow in
// native/src/audiocap.cpp, which is the format both listings speak. Grouped
// by executable rather than left per process, because one application is
// routinely several processes (every Chromium-based one is, and every one of
// them can have several windows) and a list that said "Discord" three times
// would be three switches for one thing.
function parseListing(stdout: string): AudioApp[] {
  const own = process.execPath.toLowerCase();
  const byKey = new Map<string, AudioApp>();
  for (const line of stdout.split("\n")) {
    const parts = line.replace(/\r$/, "").split("\t");
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const exePath = parts[2].trim();
    if (!Number.isInteger(pid) || pid <= 0 || exePath.length === 0) continue;
    const key = path.basename(exePath).toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.pids.includes(pid)) existing.pids.push(pid);
      continue;
    }
    byKey.set(key, {
      key,
      name: parts[1].trim() || path.basename(exePath),
      path: exePath,
      pids: [pid],
      // Compared by path and not by name: in development the executable is
      // Electron's own, and a checkout that happened to be running next to
      // some other Electron app must not claim that app as itself.
      self: exePath.toLowerCase() === own,
    });
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

// One helper process and the audio it has produced but that has not been
// mixed yet.
interface CaptureSource {
  /** The process tree it captures, or 0 for the single EXCLUDE capture. */
  pid: number;
  child: ChildProcessWithoutNullStreams;
  queue: Buffer[];
  queued: number;
  lastDataAt: number;
}

interface Capture {
  target: WebContents;
  detachTarget: () => void;
  /** EXCLUDE everything-but-us, or INCLUDE one tree per audible app. */
  mode: "exclude" | "include";
  /** The mute list this capture was built for, so a change can be spotted. */
  muted: string[];
  sources: Map<number, CaptureSource>;
  rescan: NodeJS.Timeout | null;
  /** Set before anything is torn down, so exit handlers stay quiet. */
  stopping: boolean;
}

let capture: Capture | null = null;

/** Whether a capture is running right now. */
export function isSystemAudioCapturing(): boolean {
  return capture !== null;
}

/**
 * Starts the capture and streams PCM to `webContents`.
 *
 * Resolves false when the capture could not be started — including when this
 * Windows turns out not to support process loopback at all, which is only
 * discoverable by trying, and when the user has switched system audio off
 * altogether in the picker. The renderer asks for this *before* calling
 * getDisplayMedia precisely so that answer still leaves time to fall back to
 * an ordinary loopback share, or to no audio at all.
 *
 * It resolves once a helper reports the capture running, rather than once the
 * process exists: a spawn that succeeds and then fails activation a few
 * milliseconds later would otherwise be reported as success, and the share
 * would come out silent instead of falling back.
 */
export async function startSystemAudioCapture(webContents: WebContents): Promise<boolean> {
  if (!isSystemAudioExclusionSupported()) return false;
  const settings = getSystemAudioSettings();
  // "Compartilhar som da tela", switched off. Answering false rather than
  // starting a capture that produces nothing is what makes the share come
  // out with no audio track at all, instead of a live but permanently silent
  // one (see the display-media handler in main.ts, which also reads this).
  if (!settings.enabled) return false;

  // A second share while one is running would otherwise leave the first
  // helper orphaned, writing into a pipe nobody reads.
  stopSystemAudioCapture();

  const muted = new Set(settings.mutedApps);
  // Per-application whenever the mute list names anything at all — and always
  // on Linux, which has no EXCLUDE to fall back on (see this file's header).
  //
  // It used to take this path only when a muted application was *already
  // playing* as the share started, and the single EXCLUDE capture otherwise,
  // on the grounds that it is cheaper and picks up new applications
  // instantly. But EXCLUDE never re-scans, so an application muted while it
  // happened to be quiet — Discord between two people speaking — was recorded
  // from the first sound it made until the share was restarted. That was the
  // "mute Discord and it is still in the stream; works one time in five"
  // report: whether it worked depended on whether anyone was talking at the
  // moment the share began. INCLUDE never records anything that is not asked
  // for, and the cost of that is a newly started application being heard
  // after the next scan (RESCAN_MS) instead of at once — the right way round
  // for a setting whose promise is "this will not be in the stream".
  const needsPerApp = process.platform === "linux" || muted.size > 0;
  const apps = needsPerApp ? await listAudioApps() : [];
  // The listing is the first spawn of the helper, and the one that finds out
  // it cannot be started (see markHelperUnstartable). Answering false here is
  // what lets the renderer fall back to ordinary loopback audio instead of
  // starting a per-app capture with nothing that can ever feed it.
  if (!isSystemAudioExclusionSupported()) return false;
  // Reading that list is a process spawn, and a second share could have been
  // started across it. The stop above left this null, so anything here now is
  // someone else's capture — and taking it over would orphan their helpers.
  if (capture !== null) return false;

  const active: Capture = {
    target: webContents,
    detachTarget: () => { },
    mode: needsPerApp ? "include" : "exclude",
    muted: [...muted],
    sources: new Map(),
    rescan: null,
    stopping: false,
  };
  capture = active;
  active.detachTarget = watchTarget(active, webContents);

  // Settled by the first of: a helper reporting READY, every helper exiting,
  // or the timeout. Whichever wins, the others become no-ops.
  let settle!: (ready: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    let done = false;
    settle = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // A helper that is alive but never said READY is wedged, not working.
      // Left running it would hold an audio client open for the session.
      if (!value && capture === active) stopSystemAudioCapture();
      resolve(value);
    };
    const timer = setTimeout(() => settle(false), READY_TIMEOUT_MS);
    timer.unref?.();
  });

  if (active.mode === "exclude") {
    addSource(active, 0, ["--exclude-pid", String(process.pid)], settle);
  } else {
    const wanted = includablePids(apps, muted);
    for (const pid of wanted) addSource(active, pid, ["--include-pid", String(pid)], settle);
    // Nothing audible is left once the mute list is applied. That is a
    // perfectly valid state — silence is the correct output — so the capture
    // stays up and the scan below picks up whatever starts playing next.
    // Reported as success because the alternative reading, "fall back to
    // Electron's loopback", would put the muted application straight into
    // the share.
    if (wanted.length === 0) settle(true);
    active.rescan = setInterval(() => void rescanSources(active), RESCAN_MS);
    active.rescan.unref?.();
  }

  return ready;
}

// Applications never captured as a *tree*, whatever the mute list says.
//
// An INCLUDE capture takes its target and every process it started, and
// Explorer started nearly everything the user did — every app opened from
// the Start menu, the taskbar or a desktop shortcut, GoLive included. It holds
// an audio session of its own now and then (a video previewed in a folder),
// and the moment it did, including it put every one of those back into the
// share: GoLive's own output, the room's voices with it, and whatever the
// user had muted. Its own sounds are not worth that.
const NEVER_INCLUDE_AS_TREE = new Set(["explorer.exe"]);

// The applications to run an INCLUDE capture against: everything with an
// audio session that the user has not muted, and never GoLive itself — that
// exclusion is not a preference and is applied whatever the settings say.
function includablePids(apps: AudioApp[], muted: Set<string>): number[] {
  const pids: number[] = [];
  for (const entry of apps) {
    if (entry.self || muted.has(entry.key)) continue;
    if (process.platform === "win32" && NEVER_INCLUDE_AS_TREE.has(entry.key)) continue;
    pids.push(...entry.pids);
  }
  return pids;
}

function addSource(
  active: Capture,
  pid: number,
  args: string[],
  onReady?: (ready: boolean) => void
) {
  let child: ChildProcessWithoutNullStreams;
  try {
    if (process.platform === "linux") {
      // One application's playback stream, recorded on its own — `pid` is a
      // sink-input index here (see listLinuxAudioStreams). The format is
      // stated, as on Windows, so it is what the mixer and the renderer expect
      // whatever the stream itself plays at; the server resamples. Short
      // latency because parec's default buffers far more than a live share
      // can afford.
      //
      // This replaced pw-record: its "everything" mode recorded the default
      // monitor — GoLive's own output included, which is the exact echo this
      // file exists to prevent — and its per-app mode targeted playback
      // streams that WirePlumber does not link captures to.
      child = spawn(
        "parec",
        [
          "--raw",
          "--format=s16le",
          `--rate=${SYSTEM_AUDIO_FORMAT.sampleRate}`,
          `--channels=${SYSTEM_AUDIO_FORMAT.channels}`,
          "--latency-msec=20",
          `--monitor-stream=${pid}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] }
      );
      // parec prints nothing when it starts, and a stream that is quiet
      // delivers nothing either, so there is no readiness line to wait for.
      // A spawn that failed outright reports through "error" below instead.
      setTimeout(() => onReady?.(true), 100);
    } else {
      child = spawn(helperPath(), args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  } catch {
    onReady?.(false);
    return;
  }

  const source: CaptureSource = { pid, child, queue: [], queued: 0, lastDataAt: Date.now() };
  active.sources.set(pid, source);

  child.stdout.on("data", (data: Buffer) => {
    if (active.stopping) return;
    source.lastDataAt = Date.now();
    source.queue.push(data);
    source.queued += data.length;
    // Nobody is draining this one — see SOURCE_MAX_QUEUED_BYTES. The oldest
    // audio is what to drop.
    while (source.queued > SOURCE_MAX_QUEUED_BYTES && source.queue.length > 1) {
      source.queued -= source.queue.shift()!.length;
    }
    drain(active);
  });

  // stderr carries both the readiness signal and the diagnostics. The
  // diagnostics — an activation failure and its HRESULT — are the only clue
  // when this does not work, so they are forwarded rather than swallowed.
  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    if (text.includes(READY_LINE)) {
      onReady?.(true);
      return;
    }
    process.stderr.write(`[audiocap] ${text}`);
  });

  const finish = (code?: number | null) => {
    // An exit before READY is this machine's answer to "is process loopback
    // available here". Remembered so the rest of the session stops paying a
    // spawn to be told the same thing again — but only for that one exit
    // code, never for a crash, which may well be transient.
    if (code === EXIT_UNSUPPORTED) knownUnsupported = true;
    if (active.stopping || capture !== active) return;
    if (active.sources.get(pid) !== source) return;
    active.sources.delete(pid);

    // In per-application mode a helper exiting is routine rather than a
    // failure: the application it was capturing was closed. The capture
    // carries on with whatever is left — down to nothing at all, which is
    // simply silence — and the scan picks that application up again if it
    // comes back.
    //
    // The exception is a machine that cannot do process loopback, where
    // every other helper is about to exit exactly the same way and there is
    // nothing to carry on with.
    if (active.mode === "include" && code !== EXIT_UNSUPPORTED) {
      onReady?.(true);
      return;
    }

    // Otherwise this *was* the capture: the single EXCLUDE helper, or the
    // machine answering that it cannot do this at all.
    onReady?.(false);
    endCapture(active);
  };
  // "error" is the process failing to start at all (see markHelperUnstartable),
  // and it is fatal in every mode — including per-app, where an ordinary exit
  // is not. Finishing it as EXIT_UNSUPPORTED is exactly that path: the capture
  // ends, and the renderer is told so.
  child.on("error", (err: NodeJS.ErrnoException) => {
    markHelperUnstartable(err.code ?? err.message);
    finish(EXIT_UNSUPPORTED);
  });
  child.on("exit", (code) => finish(code));
}

// Reconciles the running helpers with what is playing right now: a helper for
// every audible, un-muted process and nothing else.
//
// Membership is taken from the scan rather than from whether a helper is
// still alive, because a process-loopback client outlives its target — an
// application that closes leaves a helper capturing silence from a tree that
// no longer exists. The other direction is cheap to get wrong safely: an
// application that merely released its audio session for a moment loses its
// helper and gets it back on the next scan, which costs nothing audible,
// since it was not playing anything at the time.
async function rescanSources(active: Capture) {
  if (capture !== active || active.stopping) return;
  const apps = await listAudioApps();
  if (capture !== active || active.stopping) return;
  // An empty answer is ambiguous — genuinely nothing playing, or a listing
  // that failed — and tearing every helper down on it would silence a share
  // for the four seconds until the next scan. Leaving them is the safe read.
  if (apps.length === 0) return;

  const muted = new Set(active.muted);
  const wanted = new Set(includablePids(apps, muted));
  for (const pid of wanted) {
    if (!active.sources.has(pid)) addSource(active, pid, ["--include-pid", String(pid)]);
  }
  for (const [pid, source] of active.sources) {
    if (wanted.has(pid)) continue;
    active.sources.delete(pid);
    endHelper(source.child);
  }
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

// Emits whole chunks for as long as every source that is still producing has
// one to contribute.
//
// The output clock is the audio engine's, not a timer's: this runs off the
// helpers' own packets, so there is no rate to drift against. A source that
// has gone quiet (see SOURCE_IDLE_MS) is skipped rather than waited for,
// which is what keeps one idle application from holding up the mix — process
// loopback delivers nothing at all for a stream that is not playing, so
// "silent" and "stalled" look identical from here and are treated the same.
function drain(active: Capture) {
  if (capture !== active || active.stopping) return;
  for (; ;) {
    const now = Date.now();
    const contributors: CaptureSource[] = [];
    for (const source of active.sources.values()) {
      if (source.queued >= CHUNK_BYTES) {
        contributors.push(source);
      } else if (now - source.lastDataAt < SOURCE_IDLE_MS) {
        // Still delivering, just not a full chunk ahead. Waiting for it is
        // the difference between mixing its audio in and dropping it.
        return;
      }
    }
    if (contributors.length === 0) return;

    const chunks = contributors.map((source) => take(source, CHUNK_BYTES));
    const mixed = chunks.length === 1 ? chunks[0] : mix(chunks);
    if (active.target.isDestroyed()) return;
    active.target.send(IPC.systemAudioData, mixed);
  }
}

// Pulls exactly `bytes` off the front of a source's queue. Slicing on a frame
// boundary is what keeps the stereo pairs aligned — half a frame in the wrong
// place swaps the channels for the rest of the session — and CHUNK_BYTES is a
// whole number of frames, so every cut lands on one.
function take(source: CaptureSource, bytes: number): Buffer {
  const joined = source.queue.length === 1 ? source.queue[0] : Buffer.concat(source.queue, source.queued);
  const head = joined.subarray(0, bytes);
  const rest = joined.subarray(bytes);
  source.queue = rest.length > 0 ? [rest] : [];
  source.queued = rest.length;
  return head;
}

// Sums the sources sample by sample, clamped to the 16-bit range.
//
// Summing rather than averaging: each source is the audio of one application
// at the level the user set for it, and averaging would make every
// application quieter the moment a second one started playing. Clipping only
// happens when several applications are loud at once, which is exactly when
// the endpoint mix would be clipping too.
function mix(chunks: Buffer[]): Buffer {
  const out = Buffer.allocUnsafe(CHUNK_BYTES);
  for (let offset = 0; offset < CHUNK_BYTES; offset += 2) {
    let sum = 0;
    for (const chunk of chunks) sum += chunk.readInt16LE(offset);
    out.writeInt16LE(sum > 32767 ? 32767 : sum < -32768 ? -32768 : sum, offset);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings changes, and shutdown
// ---------------------------------------------------------------------------

/**
 * Re-applies the picker's audio settings to a capture that is already
 * running.
 *
 * This exists because of the order the two halves happen in: the renderer
 * starts the capture *before* calling getDisplayMedia, which is what opens
 * the picker, so by the time the user touches these controls the helpers are
 * already streaming. Rather than reaching back into the renderer, the change
 * is made underneath it — restarting the capture swaps which processes are
 * being recorded without touching the track the share is built on, so the
 * renderer sees a brief gap in the PCM and nothing else.
 *
 * Switching system audio off mid-picker is the one case that cannot be
 * complete: the track exists by then and cannot be taken back out of a
 * granted stream, so the share carries a silent one. The next share honours
 * the setting properly and carries no audio track at all.
 */
export function applySystemAudioSettings(settings: SystemAudioSettings) {
  const active = capture;
  if (!active) return;
  if (!settings.enabled) {
    stopSystemAudioCapture();
    return;
  }
  const next = [...new Set(settings.mutedApps)].sort();
  if (next.join("\u0000") === [...active.muted].sort().join("\u0000")) return;
  const target = active.target;
  stopSystemAudioCapture();
  if (!target.isDestroyed()) void startSystemAudioCapture(target);
}

// A reload or a navigation replaces the page that asked for this, and its
// MediaStream goes with it — without this the helpers would keep capturing
// into a renderer that has forgotten they exist. The site reloads on every
// navigation (it is remote content, not an SPA shell), so this is a routine
// event rather than an edge case.
function watchTarget(active: Capture, webContents: WebContents): () => void {
  const onGone = () => {
    if (capture === active) stopSystemAudioCapture();
  };
  // The details object, not the deprecated positional arguments that still
  // follow it — those are typed as optional, so reading isMainFrame out of
  // the second parameter type-checks and is then always undefined at
  // runtime, which would silently turn this listener into a no-op.
  //
  // isSameDocument excluded because a fragment change or a history.pushState
  // does not tear the page down, and stopping a live share for one would be
  // a bug of its own.
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) onGone();
  };
  webContents.once("destroyed", onGone);
  webContents.on("render-process-gone", onGone);
  webContents.on("did-start-navigation", onNavigate);
  return () => {
    if (webContents.isDestroyed()) return;
    webContents.off("destroyed", onGone);
    webContents.off("render-process-gone", onGone);
    webContents.off("did-start-navigation", onNavigate);
  };
}

/** Stops the capture. Safe to call when nothing is running. */
export function stopSystemAudioCapture() {
  const active = capture;
  if (!active) return;
  // Cleared first, and `stopping` set with it, so the exits this is about to
  // cause are recognised as our own doing. Without that the last helper to go
  // would tell the renderer the capture "ended", which is a different event
  // with a different meaning — one the renderer answers by giving up on
  // audio for the rest of the share.
  active.stopping = true;
  capture = null;
  if (active.rescan) clearInterval(active.rescan);
  active.detachTarget();
  for (const source of active.sources.values()) endHelper(source.child);
  active.sources.clear();
}

// Stops the capture and tells the renderer no more audio is coming, so the
// share carries on silently instead of holding a dead track. Distinct from
// stopSystemAudioCapture, which is *us* ending it — a deliberate stop is
// followed by something else and must not look to the renderer like the
// capture died.
function endCapture(active: Capture) {
  const target = active.target;
  stopSystemAudioCapture();
  if (!target.isDestroyed()) target.send(IPC.systemAudioEnded);
}

function endHelper(child: ChildProcessWithoutNullStreams) {
  // Closing stdin is the helper's documented shutdown signal (see its
  // WatchStdin): it stops the audio client properly and exits on its own.
  // kill() is the backstop for a helper that is already wedged, not the
  // first resort — terminating it outright leaves WASAPI to clean up after
  // the fact.
  try {
    child.stdin.end();
  } catch {
    // Already closed — the exit handler has this covered.
  }
  const forceKill = setTimeout(() => {
    if (!child.killed) child.kill();
  }, 1000);
  // Node keeps the process alive for a pending timer, and a one-second delay
  // on quit is a visible hang.
  forceKill.unref?.();
  child.once("exit", () => clearTimeout(forceKill));
}
