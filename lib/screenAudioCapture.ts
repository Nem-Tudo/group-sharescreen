"use client";

import { useSyncExternalStore } from "react";

export type ShareAudioMode = "window" | "system" | "none";
export type CapturedDisplaySurface = "browser" | "window" | "monitor" | "unknown";

export type ShareAudioStatus = {
  kind: "isolated" | "system" | "none" | "unavailable";
  requestedMode: ShareAudioMode;
  displaySurface: CapturedDisplaySurface;
  message: string;
  videoTrackSettings: MediaTrackSettings;
  audioTrackSettings: MediaTrackSettings | null;
  videoTrackLabel: string | null;
  videoTrackEnabled: boolean | null;
  videoTrackReadyState: MediaStreamTrackState | null;
  audioTrackLabel: string | null;
  audioTrackEnabled: boolean | null;
  audioTrackMuted: boolean | null;
  audioTrackReadyState: MediaStreamTrackState | null;
  audioRemovedForSafety: boolean;
};

type WindowAudioPreference = "exclude" | "system" | "window";
type SystemAudioPreference = "exclude" | "include";

// windowAudio shipped separately from the TypeScript DOM definitions used by
// some projects. Keep the extension local instead of weakening the capture
// call to `any` or globally changing browser types.
type ModernDisplayMediaStreamOptions = DisplayMediaStreamOptions & {
  windowAudio?: WindowAudioPreference;
  systemAudio?: SystemAudioPreference;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>;
    platform: string;
  };
};

// Application-specific window audio was enabled by default in Chromium on
// Windows after the generic windowAudio option shipped. There is no
// standards-based feature probe for dictionary members (unknown members are
// silently ignored), so the privacy-safe choice is a deliberately narrow
// allow-list. Unknown browsers get video-only in isolated mode.
const MIN_CHROMIUM_APPLICATION_AUDIO_VERSION = 146;

export function hasIsolatedWindowAudioSupport(): boolean {
  if (typeof navigator === "undefined") return false;

  const nav = navigator as NavigatorWithUserAgentData;
  const ua = navigator.userAgent;
  const isWindows = nav.userAgentData
    ? nav.userAgentData.platform === "Windows"
    : /Windows/i.test(ua);
  if (!isWindows) return false;

  const brand = nav.userAgentData?.brands.find(
    ({ brand }) => brand === "Google Chrome" || brand === "Microsoft Edge"
  );
  const uaVersion = ua.match(/Edg\/(\d+)/)?.[1] ?? ua.match(/Chrome\/(\d+)/)?.[1];
  const major = Number.parseInt(brand?.version ?? uaVersion ?? "", 10);
  return Number.isFinite(major) && major >= MIN_CHROMIUM_APPLICATION_AUDIO_VERSION;
}

function noopSubscribe() {
  return () => {};
}

export function useIsolatedWindowAudioSupport(): boolean {
  return useSyncExternalStore(noopSubscribe, hasIsolatedWindowAudioSupport, () => false);
}

function getDisplaySurface(settings: MediaTrackSettings): CapturedDisplaySurface {
  const value = (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  return value === "browser" || value === "window" || value === "monitor" ? value : "unknown";
}

function stopAndRemoveAudio(stream: MediaStream) {
  for (const track of stream.getAudioTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
}

export type DisplayCaptureResult = {
  stream: MediaStream;
  audioStatus: ShareAudioStatus;
};

export interface DisplayCaptureProvider {
  capture(video: MediaTrackConstraints, audioMode: ShareAudioMode): Promise<DisplayCaptureResult>;
}

// Keeps browser-specific capture details outside the WebRTC hook.
export const browserDisplayCaptureProvider: DisplayCaptureProvider = {
  async capture(video, audioMode) {
    const isolatedSupported = hasIsolatedWindowAudioSupport();
    const options: ModernDisplayMediaStreamOptions = {
      video,
      audio: audioMode === "system" || (audioMode === "window" && isolatedSupported),
    };

    if (audioMode === "window" && isolatedSupported) {
      options.windowAudio = "window";
      options.systemAudio = "exclude";
    } else if (audioMode === "system") {
      options.windowAudio = "system";
      options.systemAudio = "include";
    }

    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrackSettings = videoTrack?.getSettings() ?? {};
    const audioTrackSettings = audioTrack?.getSettings() ?? null;
    const displaySurface = getDisplaySurface(videoTrackSettings);
    // Snapshot what the browser returned before a fail-safe branch can stop
    // and remove the audio track. These values stay local to the broadcaster
    // and exist only to make manual browser verification observable.
    const trackDiagnostics = {
      videoTrackSettings,
      audioTrackSettings,
      videoTrackLabel: videoTrack?.label.trim() || null,
      videoTrackEnabled: videoTrack?.enabled ?? null,
      videoTrackReadyState: videoTrack?.readyState ?? null,
      audioTrackLabel: audioTrack?.label.trim() || null,
      audioTrackEnabled: audioTrack?.enabled ?? null,
      audioTrackMuted: audioTrack?.muted ?? null,
      audioTrackReadyState: audioTrack?.readyState ?? null,
      audioRemovedForSafety: false,
    } satisfies Pick<
      ShareAudioStatus,
      | "videoTrackSettings"
      | "audioTrackSettings"
      | "videoTrackLabel"
      | "videoTrackEnabled"
      | "videoTrackReadyState"
      | "audioTrackLabel"
      | "audioTrackEnabled"
      | "audioTrackMuted"
      | "audioTrackReadyState"
      | "audioRemovedForSafety"
    >;

    if (audioMode === "none") {
      // Defensive: a conforming browser returns no audio for audio:false.
      stopAndRemoveAudio(stream);
      return {
        stream,
        audioStatus: {
          ...trackDiagnostics,
          audioRemovedForSafety: Boolean(audioTrack),
          kind: "none",
          requestedMode: audioMode,
          displaySurface,
          message: "Áudio: não compartilhado.",
        },
      };
    }

    if (audioMode === "window") {
      if (!isolatedSupported) {
        return {
          stream,
          audioStatus: {
            ...trackDiagnostics,
            kind: "unavailable",
            requestedMode: audioMode,
            displaySurface,
            message: "Áudio isolado indisponível neste navegador. O compartilhamento está somente com vídeo.",
          },
        };
      }

      if (!audioTrack) {
        return {
          stream,
          audioStatus: {
            ...trackDiagnostics,
            kind: "unavailable",
            requestedMode: audioMode,
            displaySurface,
            message: "O navegador não disponibilizou áudio para esta fonte.",
          },
        };
      }

      if (displaySurface !== "window" && displaySurface !== "browser") {
        stopAndRemoveAudio(stream);
        return {
          stream,
          audioStatus: {
            ...trackDiagnostics,
            audioRemovedForSafety: true,
            kind: "unavailable",
            requestedMode: audioMode,
            displaySurface,
            message: "Não foi possível confirmar uma janela ou aba isolada. O áudio foi removido por segurança.",
          },
        };
      }

      return {
        stream,
        audioStatus: {
          ...trackDiagnostics,
          kind: "isolated",
          requestedMode: audioMode,
          displaySurface,
          message:
            displaySurface === "browser"
              ? "Faixa de áudio recebida após solicitar isolamento da aba."
              : "Faixa de áudio recebida após solicitar isolamento da janela.",
        },
      };
    }

    if (!audioTrack) {
      return {
        stream,
        audioStatus: {
          ...trackDiagnostics,
          kind: "unavailable",
          requestedMode: audioMode,
          displaySurface,
          message: "O navegador não disponibilizou áudio para esta fonte.",
        },
      };
    }

    return {
      stream,
      audioStatus: {
        ...trackDiagnostics,
        kind: "system",
        requestedMode: audioMode,
        displaySurface,
        message: "Áudio: sistema inteiro solicitado.",
      },
    };
  },
};
