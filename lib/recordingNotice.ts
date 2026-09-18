"use client";

import { useEffect, useState } from "react";
import { signalingClient } from "./signalingClient";

// "Fulano está gravando a sua transmissão." The viewer who hits "gravar" on a
// tile tells that tile's broadcaster directly, over the API's ordinary
// peer-to-peer `signal` relay (which passes any payload through untouched — no
// API change). No `channel` on the payload, so useRoomMedia's WebRTC handler
// ignores it.
//
// While recording, the notice is repeated every REPEAT_MS; the broadcaster
// forgets it after EXPIRE_MS without one. That covers everything that can end
// a recording without a goodbye: a closed tab, a dropped connection, a crash.

const KIND = "recording-notice";
const REPEAT_MS = 15_000;
const EXPIRE_MS = 40_000;

export type RecordingChannel = string;

/** The viewer's side: announces the recording until the returned stop runs. */
export function announceRecording(broadcasterId: string, channel: RecordingChannel): () => void {
  const send = (on: boolean) => signalingClient.sendSignal(broadcasterId, { kind: KIND, on, recording: channel });
  send(true);
  const timer = setInterval(() => send(true), REPEAT_MS);
  return () => {
    clearInterval(timer);
    send(false);
  };
}

type Notice = { from: string; channels: Map<RecordingChannel, number> };

/** The broadcaster's side: who is recording which of my transmissions now. */
export function useRecordingNotices(): { from: string; channels: RecordingChannel[] }[] {
  const [notices, setNotices] = useState<Map<string, Notice>>(new Map());

  useEffect(() => {
    const off = signalingClient.onSignal((from, data) => {
      if (data.kind === "peer-left") {
        setNotices((prev) => {
          if (!prev.has(from)) return prev;
          const next = new Map(prev);
          next.delete(from);
          return next;
        });
        return;
      }
      if (data.kind !== KIND || typeof data.recording !== "string") return;
      const channel = data.recording;
      setNotices((prev) => {
        const next = new Map(prev);
        const notice = next.get(from) ?? { from, channels: new Map() };
        const channels = new Map(notice.channels);
        if (data.on) channels.set(channel, Date.now());
        else channels.delete(channel);
        if (channels.size) next.set(from, { from, channels });
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
          if (channels.size) next.set(id, { from: id, channels });
        }
        return changed ? next : prev;
      });
    }, 5_000);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, []);

  return [...notices.values()].map((n) => ({ from: n.from, channels: [...n.channels.keys()] }));
}
