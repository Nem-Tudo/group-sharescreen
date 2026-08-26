"use client";

import { useEffect, useState } from "react";

export type MediaDeviceOption = { deviceId: string; label: string };

// A minimal, non-standard part of HTMLMediaElement not yet in lib.dom.d.ts —
// only Chromium-based browsers implement it (Firefox/Safari don't), which is
// why callers must feature-detect via `canSelectSpeaker` before offering an
// output-device picker.
type SinkableMediaElement = HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> };

export function elementSupportsSinkId(el: HTMLMediaElement): el is Required<Pick<SinkableMediaElement, "setSinkId">> & HTMLMediaElement {
  return typeof (el as SinkableMediaElement).setSinkId === "function";
}

export function setElementSinkId(el: HTMLMediaElement, sinkId: string): Promise<void> {
  const sinkable = el as SinkableMediaElement;
  return sinkable.setSinkId ? sinkable.setSinkId(sinkId) : Promise.resolve();
}

// Lists the mic (audioinput), speaker (audiooutput) and camera (videoinput)
// devices available to the browser, refreshing on the standard
// `devicechange` event (a device plugged/unplugged, or a permission grant
// that just revealed device labels). Device labels are blank until the user
// has granted the matching permission at least once — falls back to
// "Microfone N" / "Saída N" / "Câmera N" so the picker still has something
// to show before that.
export function useMediaDevices() {
  const [mics, setMics] = useState<MediaDeviceOption[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceOption[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [canSelectSpeaker] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.HTMLMediaElement !== "undefined" &&
      elementSupportsSinkId(document.createElement("audio"))
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const nextMics: MediaDeviceOption[] = [];
        const nextSpeakers: MediaDeviceOption[] = [];
        const nextCameras: MediaDeviceOption[] = [];
        for (const d of devices) {
          if (d.kind === "audioinput") {
            nextMics.push({ deviceId: d.deviceId, label: d.label || `Microfone ${nextMics.length + 1}` });
          } else if (d.kind === "audiooutput") {
            nextSpeakers.push({ deviceId: d.deviceId, label: d.label || `Saída ${nextSpeakers.length + 1}` });
          } else if (d.kind === "videoinput") {
            nextCameras.push({ deviceId: d.deviceId, label: d.label || `Câmera ${nextCameras.length + 1}` });
          }
        }
        setMics(nextMics);
        setSpeakers(nextSpeakers);
        setCameras(nextCameras);
      } catch {
        // ignored - enumeration can fail (unsupported browser, blocked permissions)
      }
    };

    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);

  return { mics, speakers, cameras, canSelectSpeaker };
}
