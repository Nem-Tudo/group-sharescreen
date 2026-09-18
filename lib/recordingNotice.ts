"use client";

import { useEffect, useState } from "react";
import { signalingClient } from "./signalingClient";

// "Fulano está gravando a sua transmissão." The viewer who hits "gravar" on a
// tile tells that tile's broadcaster through the API's `recording-notice`
// message, which the server hands to that one member of the room with the
// recorder's name stamped on it (see the API's signaling.ts).
//
// While recording, the notice is repeated every REPEAT_MS; the broadcaster
// forgets it after EXPIRE_MS without one. That covers everything that can end
// a recording without a goodbye: a closed tab, a dropped connection, a crash.
// Shown to every broadcaster, whether or not they are in the recording
// experiment themselves.

const REPEAT_MS = 15_000;
const EXPIRE_MS = 40_000;

/** The viewer's side: announces the recording until the returned stop runs. */
export function announceRecording(broadcasterId: string, channel: string): () => void {
  signalingClient.sendRecordingNotice(broadcasterId, channel, true);
  const timer = setInterval(() => signalingClient.sendRecordingNotice(broadcasterId, channel, true), REPEAT_MS);
  return () => {
    clearInterval(timer);
    signalingClient.sendRecordingNotice(broadcasterId, channel, false);
  };
}

type Notice = { from: string; name: string | null; channels: Map<string, number> };

/** The broadcaster's side: who is recording which of my transmissions now. */
export function useRecordingNotices(): { from: string; name: string | null; channels: string[] }[] {
  const [notices, setNotices] = useState<Map<string, Notice>>(new Map());

  useEffect(() => {
    const off = signalingClient.onRecordingNotice(({ from, name, channel, on }) => {
      setNotices((prev) => {
        const next = new Map(prev);
        const notice = next.get(from);
        const channels = new Map(notice?.channels);
        if (on) channels.set(channel, Date.now());
        else channels.delete(channel);
        if (channels.size) next.set(from, { from, name: name ?? notice?.name ?? null, channels });
        else next.delete(from);
        return next;
      });
    });
    const sweep = setInterval(() => {
      const now = Date.now();
      setNotices((prev) => {
        let changed = false;
        const next = new Map<string, Notice>();
        for (const [id, notice] of prev) {
          const channels = new Map([...notice.channels].filter(([, at]) => now - at < EXPIRE_MS));
          if (channels.size !== notice.channels.size) changed = true;
          if (channels.size) next.set(id, { ...notice, channels });
        }
        return changed ? next : prev;
      });
    }, 5_000);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, []);

  return [...notices.values()].map((n) => ({ from: n.from, name: n.name, channels: [...n.channels.keys()] }));
}
