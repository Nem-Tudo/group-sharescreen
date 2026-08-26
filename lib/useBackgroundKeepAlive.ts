"use client";

import { useEffect } from "react";

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function createSilentWavUrl(): string {
  const sampleRate = 8000;
  const durationSeconds = 1;
  const dataSize = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, text: string) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < dataSize; i++) view.setUint8(44 + i, 128);

  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

// Plays a silent, looping audio track so the browser treats this tab as
// "still active" and doesn't throttle or suspend it. Works on desktop
// Chrome/Firefox/Edge and Android. Skipped on iOS Safari which suspends
// background media tabs regardless.
export function useBackgroundKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active || isIOSSafari()) return;

    const url = createSilentWavUrl();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.01;
    audio.play().catch(() => {});

    let wakeLock: WakeLockSentinel | null = null;
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then((lock) => {
        wakeLock = lock;
        lock.addEventListener("release", () => { wakeLock = null; });
      }).catch(() => {});
    }

    return () => {
      audio.pause();
      URL.revokeObjectURL(url);
      wakeLock?.release();
    };
  }, [active]);
}
