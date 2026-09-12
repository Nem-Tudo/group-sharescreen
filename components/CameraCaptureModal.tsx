"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MdCameraAlt, MdCheck, MdClose, MdFlipCameraAndroid, MdVideocam } from "react-icons/md";
import { isMobileDevice } from "@/lib/announcement";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";

const subscribeNothing = () => () => {};

// What the picture is encoded as on the way out. JPEG rather than PNG because
// this is a photograph, and the chat's own downscale (prepareChatImage) will
// re-encode it anyway — this only has to be small enough not to be silly and
// good enough that the re-encode has something to work with.
const CAPTURE_MIME = "image/jpeg";
const CAPTURE_QUALITY = 0.92;

function describeCameraError(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as Error).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return translate("cameraCaptureModal.cameraPermissionDeniedAllowAccessIn");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return translate("cameraCaptureModal.noCameraFoundOnThisDevice");
  }
  if (name === "NotReadableError") {
    return translate("cameraCaptureModal.theCameraIsAlreadyInUse");
  }
  return translate("cameraCaptureModal.couldNotOpenTheCamera");
}

// Takes a picture with the device's camera and hands it back as a File, so the
// caller can treat it exactly like something picked from disk. Live preview
// rather than a bare `capture` attribute on the file input: that attribute is
// ignored on desktop, where a webcam is just as much a camera as a phone's is.
export function CameraCaptureModal({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  // Fired once, with the still. The modal closes itself right after.
  onCapture: (file: File) => void;
}) {
  const t = useT();
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const videoRef = useRef<HTMLVideoElement>(null);
  // The live stream, kept in a ref rather than state: nothing renders from it,
  // and the cleanup below has to be able to stop whichever stream is current
  // without waiting for a re-render.
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  // The camera asked for by name, once somebody has picked one from the list.
  // Null means "whichever one `facingMode` gets us", which is how it starts
  // and the only mode a phone ever uses.
  const [deviceId, setDeviceId] = useState<string | null>(null);
  // What the running stream actually settled on — not necessarily what was
  // asked for, since `facingMode` is a preference the browser is free to
  // resolve however it likes. It's what the list ticks.
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  // Every camera attached to this machine. Empty until permission is granted:
  // before that the browser hands back an unusable, label-less list.
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraListOpen, setCameraListOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // A phone gets the front/back toggle it already had — its two cameras are
  // "the one facing you" and "the other one", and a list of them by name says
  // less than the toggle does. A computer gets the actual list: "HD Webcam",
  // "Câmera USB", a capture card — things `facingMode` cannot choose between,
  // since desktop browsers ignore it entirely.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Opens the camera while the modal is up, and — just as importantly — puts
  // the light out again the moment it isn't. Re-runs on a flip, which is what
  // swaps the front camera for the back one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setError(null);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("unsupported"), { name: "NotFoundError" });
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // `exact`, so picking a camera by name either gets that camera or
            // fails loudly — a silent fall back to another one would look
            // like the list simply doesn't work.
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        stopStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {}
        }
        if (!cancelled) {
          setReady(true);
          setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
        }

        // Only after permission has been granted: before that, labels and
        // even the device list are withheld, so listing cameras first would
        // undercount and hide the button on the machines that need it.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) {
            setCameras(devices.filter((d) => d.kind === "videoinput"));
          }
        } catch {}
      } catch (err) {
        if (!cancelled) {
          setError(describeCameraError(err));
          setReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, facingMode, deviceId, stopStream]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // The camera list is the innermost thing open, so it's the first thing
      // Escape takes back.
      setCameraListOpen((listOpen) => {
        if (!listOpen) onClose();
        return false;
      });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
      setCameraListOpen(false);
    };
  }, [open]);

  // The front camera is shown mirrored, the way every camera app shows it —
  // so the still is mirrored too, otherwise the picture taken is not the
  // picture that was framed.
  const mirrored = facingMode === "user";

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    setCapturing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError(t("cameraCaptureModal.couldNotTakeThePhoto"));
        return;
      }
      if (mirrored) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, CAPTURE_MIME, CAPTURE_QUALITY)
      );
      if (!blob) {
        setError(t("cameraCaptureModal.couldNotTakeThePhoto"));
        return;
      }
      const file = new File([blob], `foto-${Date.now()}.jpg`, { type: CAPTURE_MIME });
      onCapture(file);
      onClose();
    } finally {
      setCapturing(false);
    }
  }

  if (!onClient || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("cameraCaptureModal.takeAPhoto")}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col gap-3"
        // Stops the backdrop's own close, and doubles as the camera list's
        // "clicked somewhere else" — the list and its trigger keep their
        // clicks to themselves.
        onClick={(e) => {
          e.stopPropagation();
          setCameraListOpen(false);
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{t("cameraCaptureModal.takeAPhoto")}</h2>
          <button
            type="button"
            onClick={onClose}
            title={t("common.closeEsc")}
            aria-label={t("common.close")}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-200 backdrop-blur transition hover:bg-zinc-800 hover:text-white"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-contain ${mirrored ? "-scale-x-100" : ""}`}
          />
          {!ready && !error && (
            <span
              aria-hidden
              className="absolute h-8 w-8 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
            />
          )}
          {error && (
            <p className="absolute max-w-sm px-6 text-center text-sm text-red-300">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          {cameras.length > 1 &&
            (isMobile ? (
              <button
                type="button"
                onClick={() => setFacingMode((mode) => (mode === "user" ? "environment" : "user"))}
                title={t("cameraCaptureModal.switchCamera")}
                aria-label={t("cameraCaptureModal.switchCamera")}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-200 backdrop-blur transition hover:bg-zinc-800 hover:text-white"
              >
                <MdFlipCameraAndroid className="h-5 w-5" />
              </button>
            ) : (
              // `relative` so the list hangs above the button instead of
              // pushing the controls row around as it opens.
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCameraListOpen((listOpen) => !listOpen);
                  }}
                  title={t("common.chooseCamera")}
                  aria-label={t("common.chooseCamera")}
                  aria-haspopup="listbox"
                  aria-expanded={cameraListOpen}
                  className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-200 backdrop-blur transition hover:bg-zinc-800 hover:text-white"
                >
                  <MdFlipCameraAndroid className="h-5 w-5" />
                </button>
                {cameraListOpen && (
                  <div
                    role="listbox"
                    aria-label={t("cameraCaptureModal.availableCameras")}
                    className="absolute bottom-full left-1/2 mb-2 flex max-h-56 w-64 -translate-x-1/2 flex-col overflow-y-auto rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-xl"
                  >
                    {cameras.map((camera, index) => {
                      // A label needs permission for *that* camera, which a
                      // machine with several does not necessarily give all at
                      // once — so an unnamed one is still listed, by position.
                      const label = camera.label || t("common.cameraValue", { value: index + 1 });
                      const isActive = camera.deviceId === activeDeviceId;
                      return (
                        <button
                          key={camera.deviceId || index}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraListOpen(false);
                            setDeviceId(camera.deviceId);
                          }}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition ${
                            isActive
                              ? "bg-zinc-800 font-medium text-white"
                              : "text-zinc-300 hover:bg-zinc-800/70 hover:text-white"
                          }`}
                        >
                          <MdVideocam className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          {isActive && (
                            <MdCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          <button
            type="button"
            onClick={takePhoto}
            disabled={!ready || capturing}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MdCameraAlt className="h-5 w-5" aria-hidden />
            {t("cameraCaptureModal.takeAPhoto2")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
