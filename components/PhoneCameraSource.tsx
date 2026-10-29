"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MdCameraswitch,
  MdFlashlightOff,
  MdFlashlightOn,
  MdMic,
  MdMicOff,
  MdPhoneIphone,
  MdStop,
  MdVideocam,
  MdVideocamOff,
} from "react-icons/md";
import { iceConfigFor } from "@/lib/iceConfig";
import { ensureIceServers } from "@/lib/iceServers";
import { phoneCameraSocketUrl } from "@/lib/phoneCamera";
import { useT } from "@/lib/useI18n";

// The phone's side of "Celular como câmera" (the computer's is
// lib/phoneCamera.ts): the page the QR code opens. It is a media source and
// nothing else — no room, no account, no chat. It sends its camera, its
// microphone or both to the one computer it belongs to — whichever that
// computer says it is using (the "use" message) — and has the few controls a
// camera and a mic need.
//
// The first time on a link it shows a code, typed on the computer. A saved
// phone keeps a secret in localStorage, so opening the same link (or /cam)
// again goes straight in. Opening the page is consent: it starts filming as
// soon as the computer is there, and later the computer choosing it is
// enough — a phone confirmed with the code is not asked again.

const DEVICES_KEY = "sharescreen:phoneCamDevices";
/** After the page opens, the computer's first ask needs no tap. */
const AUTOSTART_MS = 2 * 60 * 1000;

/** What the computer wants opened. Before it says, the camera (as always). */
type Use = { camera: boolean; mic: boolean };
const DEFAULT_USE: Use = { camera: true, mic: false };

type Phase =
  | { kind: "connecting" }
  | { kind: "code"; code: string; mode: "once" | "save" }
  | { kind: "standby" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "ended" }
  | { kind: "error"; reason: string };

function readSecrets(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEVICES_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function writeSecrets(secrets: string[]) {
  try {
    window.localStorage.setItem(DEVICES_KEY, JSON.stringify([...new Set(secrets)].slice(-10)));
  } catch {
    // Not saved — the code will be asked again next time.
  }
}

// What the computer lists this phone as, until somebody renames it.
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  const android = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  if (android && android[1] && !/^(K|wv)$/.test(android[1].trim())) return android[1].trim().slice(0, 40);
  if (/Android/.test(ua)) return "Android";
  return "Celular";
}

// The sender of one kind: each transceiver is made at the start (see start),
// so it is there whether or not that kind is going out yet.
function senderOf(pc: RTCPeerConnection, kind: "audio" | "video"): RTCRtpSender | null {
  return pc.getTransceivers().find((tr) => tr.receiver.track.kind === kind)?.sender ?? null;
}

export function PhoneCameraSource({ token }: { token: string | null }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [hostOnline, setHostOnline] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  // What is actually going out right now, and the mic's own control.
  const [sendingCamera, setSendingCamera] = useState(false);
  const [sendingMic, setSendingMic] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const controlRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(false);
  const micErrorRef = useRef(false);
  // The computer's latest "use", and the queue applying it (one at a time:
  // opening a camera or mic takes a moment, and asks can come in a row).
  const wantRef = useRef<Use>(DEFAULT_USE);
  const applyingRef = useRef<Promise<void>>(Promise.resolve());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  // Set when the page opens (see the first effect below).
  const autostartUntil = useRef(0);
  const phaseRef = useRef(phase);
  const onceRef = useRef(false);
  // Confirmed by the computer (code typed, or a saved pairing). Nothing films
  // before this — the code screen must come first.
  const boundRef = useRef(false);
  // The saved pairing this page came in with, if any.
  const secretRef = useRef<string | null>(null);
  const doneRef = useRef(false);
  const facingRef = useRef(facing);
  const cameraOnRef = useRef(cameraOn);
  const torchRef = useRef(torch);
  const torchSupportedRef = useRef(false);
  // The controls, for the computer's commands (see the control channel).
  const commandsRef = useRef<{ camera: () => void; flip: () => void; torch: () => void; mic: () => void } | null>(null);
  useEffect(() => {
    phaseRef.current = phase;
    facingRef.current = facing;
    cameraOnRef.current = cameraOn;
    torchRef.current = torch;
  });

  useEffect(() => {
    autostartUntil.current = Date.now() + AUTOSTART_MS;
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const sendState = useCallback(() => {
    // Everything the computer needs to draw the same controls the phone has.
    const state = {
      camera: cameraOnRef.current,
      torch: torchRef.current,
      torchSupported: torchSupportedRef.current,
      facing: facingRef.current,
      // This page knows the mic and "use" (an older one says neither).
      micCapable: true,
      sendingCamera: Boolean(streamRef.current?.getVideoTracks().some((t) => t.readyState === "live")),
      sendingMic: Boolean(micStreamRef.current?.getAudioTracks().some((t) => t.readyState === "live")),
      micMuted: micMutedRef.current,
      micError: micErrorRef.current,
    };
    try {
      if (controlRef.current?.readyState === "open") controlRef.current.send(JSON.stringify({ t: "state", ...state }));
    } catch {
      // The socket carries it too.
    }
    send({ t: "state", state });
  }, [send]);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Battery saver or no support: the screen may sleep, and the camera with it.
    }
  }, []);

  /** Stops filming. `tell`: let the computer know (it did not ask for it). */
  const stopStreaming = useCallback(
    (tell: boolean) => {
      if (tell) {
        try {
          if (controlRef.current?.readyState === "open") controlRef.current.send(JSON.stringify({ t: "bye" }));
        } catch {
          // Closing anyway.
        }
        send({ t: "stopped" });
      }
      controlRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      micErrorRef.current = false;
      setSendingCamera(false);
      setSendingMic(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      setTorch(false);
      releaseWakeLock();
    },
    [send, releaseWakeLock]
  );

  const openCamera = useCallback(async (which: "user" | "environment") => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: which }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    setTorchSupported(Boolean(caps.torch));
    torchSupportedRef.current = Boolean(caps.torch);
    return stream;
  }, []);

  const openMic = useCallback(
    () =>
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      }),
    []
  );

  /** Opens / closes the camera and mic to match what the computer uses. */
  const applyUse = useCallback(
    (use: Use) => {
      wantRef.current = use;
      applyingRef.current = applyingRef.current.then(async () => {
        const pc = pcRef.current;
        if (!pc) return;
        const want = wantRef.current;
        const video = streamRef.current?.getVideoTracks().find((t) => t.readyState === "live");
        if (want.camera && !video) {
          try {
            const stream = await openCamera(facingRef.current);
            if (pcRef.current !== pc) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            const next = stream.getVideoTracks()[0];
            next.enabled = cameraOnRef.current;
            await senderOf(pc, "video")?.replaceTrack(next).catch(() => {});
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
          } catch {
            // Left without video; the computer sees it is not being sent.
          }
        } else if (!want.camera && video) {
          await senderOf(pc, "video")?.replaceTrack(null).catch(() => {});
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          if (videoRef.current) videoRef.current.srcObject = null;
          setTorch(false);
          torchRef.current = false;
        }
        const audio = micStreamRef.current?.getAudioTracks().find((t) => t.readyState === "live");
        if (want.mic && !audio) {
          try {
            const stream = await openMic();
            if (pcRef.current !== pc) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            const next = stream.getAudioTracks()[0];
            next.enabled = !micMutedRef.current;
            await senderOf(pc, "audio")?.replaceTrack(next).catch(() => {});
            micStreamRef.current = stream;
            micErrorRef.current = false;
          } catch {
            micErrorRef.current = true;
          }
        } else if (!want.mic && audio) {
          await senderOf(pc, "audio")?.replaceTrack(null).catch(() => {});
          micStreamRef.current?.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
        }
        if (!want.mic) micErrorRef.current = false;
        setSendingCamera(Boolean(streamRef.current));
        setSendingMic(Boolean(micStreamRef.current));
        sendState();
      });
    },
    [openCamera, openMic, sendState]
  );

  const start = useCallback(async (use: Use = DEFAULT_USE) => {
    const current = phaseRef.current.kind;
    if (!boundRef.current || current === "starting" || current === "live") return;
    setPhase({ kind: "starting" });
    wantRef.current = use;
    // What was asked for opens before the connection, so it goes out from
    // the first frame; a later "use" opens or closes the rest.
    let stream: MediaStream | null = null;
    let micStream: MediaStream | null = null;
    if (use.camera) {
      try {
        stream = await openCamera(facingRef.current);
      } catch {
        if (!use.mic) {
          send({ t: "declined" });
          setPhase({ kind: "error", reason: "camera" });
          return;
        }
      }
    }
    if (use.mic) {
      try {
        micStream = await openMic();
      } catch {
        micErrorRef.current = true;
        if (!stream) {
          send({ t: "declined" });
          setPhase({ kind: "error", reason: "mic" });
          return;
        }
      }
    }
    streamRef.current = stream;
    micStreamRef.current = micStream;
    micMutedRef.current = false;
    setMicMuted(false);
    setCameraOn(true);
    cameraOnRef.current = true;
    setSendingCamera(Boolean(stream));
    setSendingMic(Boolean(micStream));
    if (videoRef.current) videoRef.current.srcObject = stream;
    ensureIceServers();
    const pc = new RTCPeerConnection(iceConfigFor(false));
    pcRef.current = pc;
    const control = pc.createDataChannel("control");
    controlRef.current = control;
    control.onopen = () => sendState();
    control.onmessage = (event) => {
      let data: { t?: string; action?: string; camera?: unknown; mic?: unknown };
      try {
        data = JSON.parse(String(event.data)) as { t?: string; action?: string; camera?: unknown; mic?: unknown };
      } catch {
        return;
      }
      if (pcRef.current !== pc) return;
      if (data.t === "bye") {
        stopStreaming(false);
        setPhase(onceRef.current ? { kind: "ended" } : { kind: "standby" });
      } else if (data.t === "cmd") {
        // The same buttons, pressed on the computer.
        const commands = commandsRef.current;
        if (data.action === "camera") commands?.camera();
        else if (data.action === "flip") commands?.flip();
        else if (data.action === "torch") commands?.torch();
        else if (data.action === "mic") commands?.mic();
      } else if (data.t === "use") {
        const use = data as { camera?: unknown; mic?: unknown };
        applyUse({ camera: use.camera === true, mic: use.mic === true });
      }
    };
    control.onclose = () => {
      if (pcRef.current !== pc) return;
      stopStreaming(false);
      setPhase(onceRef.current ? { kind: "ended" } : { kind: "standby" });
    };
    // Both kinds from the start, sending or not, so either can be switched
    // on later with a replaceTrack instead of a new negotiation.
    pc.addTransceiver(stream?.getVideoTracks()[0] ?? "video", { direction: "sendonly" });
    pc.addTransceiver(micStream?.getAudioTracks()[0] ?? "audio", { direction: "sendonly" });
    pc.onicecandidate = (event) => {
      if (event.candidate) send({ t: "signal", data: { candidate: event.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      if (pc.connectionState === "connected") {
        setPhase({ kind: "live" });
        void requestWakeLock();
      } else if (pc.connectionState === "failed") {
        stopStreaming(true);
        setPhase({ kind: "error", reason: "connection" });
      }
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ t: "signal", data: { type: "offer", sdp: offer.sdp } });
    } catch {
      stopStreaming(true);
      setPhase({ kind: "error", reason: "connection" });
    }
  }, [openCamera, openMic, applyUse, send, sendState, stopStreaming, requestWakeLock]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // The socket: hello, then whatever the computer and the server say.
  useEffect(() => {
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed || doneRef.current) return;
      const ws = new WebSocket(phoneCameraSocketUrl());
      socketRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        ws.send(JSON.stringify({ t: "cam", link: token ?? undefined, secrets: readSecrets(), name: deviceName() }));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "ping" })), 25_000);
      };
      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const kind = phaseRef.current.kind;
        switch (msg.t) {
          case "code":
            setPhase({ kind: "code", code: String(msg.code), mode: msg.mode === "save" ? "save" : "once" });
            return;
          case "bound":
            boundRef.current = true;
            onceRef.current = msg.once === true;
            setSaved(!onceRef.current);
            if (typeof msg.secret === "string") {
              secretRef.current = msg.secret;
              writeSecrets([...readSecrets(), msg.secret]);
            }
            // Confirming the code is consent too: the window starts over.
            if (kind === "code") autostartUntil.current = Date.now() + AUTOSTART_MS;
            if (kind === "connecting" || kind === "code") setPhase({ kind: "standby" });
            return;
          case "host": {
            const online = msg.online === true;
            setHostOnline(online);
            // Opening the page is for the camera, as it has always been; the
            // computer's "use" switches to the mic if that is what it wants.
            if (online && boundRef.current && Date.now() < autostartUntil.current && (kind === "standby" || kind === "connecting")) {
              void startRef.current();
            }
            return;
          }
          case "request":
            // A phone confirmed with the code once is this computer's camera:
            // the computer choosing it is enough, nobody is asked again.
            if (!boundRef.current || kind === "starting" || kind === "live") return;
            {
              // What the computer wants opened; an older server sends nothing.
              const data = msg.data as { camera?: unknown; mic?: unknown } | undefined;
              void startRef.current(
                data && typeof data === "object"
                  ? { camera: data.camera !== false, mic: data.mic === true }
                  : DEFAULT_USE
              );
            }
            return;
          case "stop":
            stopStreaming(false);
            setPhase(onceRef.current ? { kind: "ended" } : { kind: "standby" });
            return;
          case "signal": {
            const data = msg.data as { type?: string; sdp?: string; candidate?: RTCIceCandidateInit } | undefined;
            const pc = pcRef.current;
            if (!data || !pc) return;
            if (data.type === "answer" && data.sdp) {
              void pc.setRemoteDescription({ type: "answer", sdp: data.sdp }).catch(() => {});
            } else if (data.candidate) {
              void pc.addIceCandidate(data.candidate).catch(() => {});
            }
            return;
          }
          case "invalid":
            // A one-time phone already filming lost its socket: the link is
            // spent, but the video goes on peer to peer.
            if (onceRef.current && (kind === "live" || kind === "starting")) return;
            doneRef.current = true;
            setPhase({ kind: "error", reason: String(msg.reason ?? "link") });
            return;
          case "revoked":
            doneRef.current = true;
            // Removed on the computer: this pairing is gone for good.
            writeSecrets(readSecrets().filter((s) => s !== secretRef.current));
            stopStreaming(false);
            setPhase({ kind: "error", reason: "revoked" });
            return;
        }
      };
      ws.onclose = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (socketRef.current === ws) socketRef.current = null;
        if (disposed || doneRef.current) return;
        // A one-time phone cannot come back in through its spent link.
        if (onceRef.current) return;
        retry = Math.min(retry + 1, 5);
        timer = setTimeout(connect, 1000 * 2 ** retry);
      };
    };
    connect();
    // A phone that slept comes back to a dead socket: try again right away.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!socketRef.current && !disposed) {
        if (timer) clearTimeout(timer);
        retry = 0;
        connect();
      }
      if (phaseRef.current.kind === "live") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, stopStreaming, requestWakeLock]);

  // Leaving the page is stopping.
  useEffect(() => {
    const onHide = () => stopStreaming(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [stopStreaming]);

  const toggleCamera = () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
    cameraOnRef.current = track.enabled;
    sendState();
  };

  const flip = async () => {
    const pc = pcRef.current;
    const old = streamRef.current;
    if (!pc || !old) return;
    const current = facingRef.current;
    const next = current === "user" ? "environment" : "user";
    // Most phones cannot hold two cameras open: the old one goes first.
    old.getTracks().forEach((track) => track.stop());
    let stream: MediaStream;
    try {
      stream = await openCamera(next);
    } catch {
      try {
        stream = await openCamera(current);
      } catch {
        stopStreaming(true);
        setPhase({ kind: "error", reason: "camera" });
        return;
      }
    }
    const track = stream.getVideoTracks()[0];
    track.enabled = cameraOnRef.current;
    await senderOf(pc, "video")?.replaceTrack(track).catch(() => {});
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
    const facingNow = track.getSettings().facingMode === "user" ? "user" : next;
    setFacing(facingNow);
    facingRef.current = facingNow;
    setTorch(false);
    torchRef.current = false;
    sendState();
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    if (!torchSupportedRef.current) return;
    const next = !torchRef.current;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
      torchRef.current = next;
      sendState();
    } catch {
      setTorchSupported(false);
      torchSupportedRef.current = false;
      sendState();
    }
  };
  const toggleMic = () => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const muted = !micMutedRef.current;
    track.enabled = !muted;
    micMutedRef.current = muted;
    setMicMuted(muted);
    sendState();
  };
  useEffect(() => {
    commandsRef.current = {
      camera: toggleCamera,
      flip: () => void flip(),
      torch: () => void toggleTorch(),
      mic: toggleMic,
    };
  });

  const filming = phase.kind === "live" || phase.kind === "starting";
  const errorText =
    phase.kind === "error"
      ? phase.reason === "revoked"
        ? t("cam.errorRevoked")
        : phase.reason === "attempts"
          ? t("cam.errorAttempts")
          : phase.reason === "rejected"
            ? t("cam.errorRejected")
            : phase.reason === "camera"
              ? t("cam.errorCamera")
              : phase.reason === "mic"
                ? t("cam.errorMic")
              : phase.reason === "connection"
                ? t("cam.errorConnection")
                : phase.reason === "none"
                  ? t("cam.errorNone")
                  : t("cam.errorLink")
      : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          filming && cameraOn && sendingCamera ? "opacity-100" : "opacity-0"
        } ${facing === "user" ? "-scale-x-100" : ""}`}
      />

      <div className="relative z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <MdPhoneIphone className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t("cam.title")}</span>
        {phase.kind === "live" && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {t("cam.live")}
          </span>
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {phase.kind === "connecting" && <span className="text-sm text-white/70">{t("cam.connecting")}</span>}

        {phase.kind === "code" && (
          <>
            <span className="text-base text-white/80">{t("cam.typeCode")}</span>
            <span className="font-mono text-5xl font-bold tracking-[0.2em]">
              {phase.code.slice(0, 3)} {phase.code.slice(3)}
            </span>
            <span className="max-w-xs text-xs text-white/60">
              {phase.mode === "save" ? t("cam.codeSaveHint") : t("cam.codeOnceHint")}
            </span>
          </>
        )}

        {phase.kind === "standby" && (
          <>
            <MdVideocam className="h-12 w-12 text-white/50" />
            <span className="text-base">{hostOnline ? t("cam.readyHostOnline") : t("cam.readyHostOffline")}</span>
            {saved && <span className="max-w-xs text-xs text-white/60">{t("cam.savedHint")}</span>}
            {hostOnline && (
              <button
                type="button"
                onClick={() => void start()}
                className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold transition hover:bg-emerald-700"
              >
                {t("cam.startCamera")}
              </button>
            )}
          </>
        )}

        {phase.kind === "starting" && <span className="text-sm text-white/80">{t("cam.starting")}</span>}

        {phase.kind === "live" && !sendingCamera && sendingMic && (
          <>
            {micMuted ? <MdMicOff className="h-12 w-12 text-white/60" /> : <MdMic className="h-12 w-12 text-emerald-400" />}
            <span className="text-sm text-white/80">{micMuted ? t("cam.micMuted") : t("cam.usingAsMic")}</span>
          </>
        )}

        {phase.kind === "live" && sendingCamera && !cameraOn && (
          <>
            <MdVideocamOff className="h-12 w-12 text-white/60" />
            <span className="text-sm text-white/70">{t("cam.cameraPaused")}</span>
          </>
        )}

        {phase.kind === "ended" && <span className="text-base">{t("cam.ended")}</span>}

        {errorText && (
          <>
            <span className="text-base">{errorText}</span>
            {phase.kind === "error" && (phase.reason === "camera" || phase.reason === "connection") && (
              <button
                type="button"
                onClick={() => setPhase({ kind: "standby" })}
                className="rounded-full bg-white/15 px-6 py-3 text-sm font-semibold transition hover:bg-white/25"
              >
                {t("cam.back")}
              </button>
            )}
          </>
        )}
      </div>

      {filming && (
        <div className="relative z-10 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8">
          {sendingMic && (
            <ControlButton onClick={toggleMic} label={micMuted ? t("cam.micOn") : t("cam.micOff")} active={micMuted}>
              {micMuted ? <MdMicOff className="h-6 w-6" /> : <MdMic className="h-6 w-6" />}
            </ControlButton>
          )}
          {sendingCamera && (
            <>
              <ControlButton
                onClick={toggleCamera}
                label={cameraOn ? t("cam.cameraOff") : t("cam.cameraOn")}
                active={!cameraOn}
              >
                {cameraOn ? <MdVideocam className="h-6 w-6" /> : <MdVideocamOff className="h-6 w-6" />}
              </ControlButton>
              <ControlButton onClick={() => void flip()} label={t("cam.flip")}>
                <MdCameraswitch className="h-6 w-6" />
              </ControlButton>
            </>
          )}
          {sendingCamera && torchSupported && (
            <ControlButton onClick={() => void toggleTorch()} label={t("cam.flash")} active={torch}>
              {torch ? <MdFlashlightOn className="h-6 w-6" /> : <MdFlashlightOff className="h-6 w-6" />}
            </ControlButton>
          )}
          <ControlButton
            onClick={() => {
              stopStreaming(true);
              setPhase(onceRef.current ? { kind: "ended" } : { kind: "standby" });
              // Stopped by hand: the next ask from the computer asks first.
              autostartUntil.current = 0;
            }}
            label={t("cam.stop")}
            danger
          >
            <MdStop className="h-6 w-6" />
          </ControlButton>
        </div>
      )}
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  children,
  active = false,
  danger = false,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
        danger ? "bg-red-600 hover:bg-red-700" : active ? "bg-white text-black" : "bg-white/20 hover:bg-white/30"
      }`}
    >
      {children}
    </button>
  );
}
