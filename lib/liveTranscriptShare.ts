"use client";

// One transcript for the whole room, shared. Every feature that needs to know
// what is being said — "Transcrição" (lib/useCallTranscript) and "Tradução ao
// vivo" (lib/useLiveTranslation) — asks this hub for lines instead of sending
// audio to Groq itself, and the hub makes sure each voice is transcribed by
// exactly one browser in the room:
//
//   - every browser that needs a voice says so (a "status" message through
//     the API's "live-transcript" relay, repeated every few seconds);
//   - from those, every browser picks the same owner for each voice: the
//     speaker's own browser when it is among them (its audio is the
//     original, not what the call compressed, and it reaches Groq without a
//     trip through the room first), otherwise the lowest connection id;
//   - the owner transcribes and sends each finished line to the room; the
//     rest only read them.
//
// So five people translating one call cost what one does, and whoever owns a
// voice pays for it out of their own daily budget. When an owner leaves, its
// status stops arriving, and the next one takes over within STATUS_TTL_MS.

import type { CallSource, CallSourceKind } from "./callRecording";
import {
  CallTranscriber,
  type TranscriberError,
  type TranscriberOptions,
  type TranscriptEntry,
} from "./callTranscript";
import { signalingClient, type LiveTranscriptMessage } from "./signalingClient";

const STATUS_EVERY_MS = 5_000;
const STATUS_TTL_MS = 12_000;
const SEEN_LINES = 2_000;

export type SharedLine = TranscriptEntry & {
  // The voice, the same in every browser: "voice:<connection id>".
  key: string;
  // Language Whisper heard, as a code when it is one of ours.
  language: string | null;
};

export type ConsumerSubject = { kind: CallSourceKind; ownerId: string; self: boolean };

export type HubConsumer = {
  // Which voices this consumer needs.
  wants: (subject: ConsumerSubject) => boolean;
  // Needs lines in real time (captions, translation).
  live: boolean;
  // "auto" or a code; see combined options.
  language: string;
  vocabulary: string;
  onLine: (line: SharedLine) => void;
  onFatal?: (error: TranscriberError) => void;
  onPending?: (pending: number) => void;
  onLost?: (lost: number) => void;
};

// Whisper answers the language it heard by name.
const LANGUAGE_NAMES: Record<string, string> = {
  portuguese: "pt",
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  dutch: "nl",
  polish: "pl",
  russian: "ru",
  ukrainian: "uk",
  turkish: "tr",
  arabic: "ar",
  hindi: "hi",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
  indonesian: "id",
  vietnamese: "vi",
  swedish: "sv",
};

export function languageCode(language: string | null | undefined): string | null {
  if (!language) return null;
  const lower = language.toLowerCase().trim();
  if (lower.length <= 3) return lower.slice(0, 2);
  return LANGUAGE_NAMES[lower] ?? null;
}

function prefixOf(source: CallSource): string {
  // CallSource ids are "<prefix>:<ownerId>" (see WatchRoom's callSources).
  return source.id.slice(0, Math.max(0, source.id.length - source.ownerId.length - 1)) || source.kind;
}

function kindOfPrefix(prefix: string): CallSourceKind {
  if (prefix === "voice") return "voice";
  if (prefix.startsWith("camera")) return "camera";
  if (prefix.startsWith("file")) return "file";
  return "screen";
}

function hasLiveAudio(source: CallSource): boolean {
  return source.stream.getAudioTracks().some((t) => t.readyState === "live");
}

type Registration = { consumer: HubConsumer };

class LiveTranscriptHub {
  private consumers = new Set<Registration>();
  private sources: CallSource[] = [];
  private selfId: string | null = null;
  private selfName = "";
  private peers = new Map<string, string>();
  private statuses = new Map<string, { candidates: Set<string>; at: number; live: boolean }>();
  private transcriber: CallTranscriber | null = null;
  private starting: Promise<void> | null = null;
  private fatal: TranscriberError | null = null;
  private announced = "";
  private announcedSignature = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private offSocket: (() => void) | null = null;
  private seen = new Set<string>();
  private nextId = 1;
  private owned = new Set<string>();

  /** The room as it is now; call on every change. */
  setRoom(room: { sources: CallSource[]; selfId: string | null; selfName: string; peers: Map<string, string> }) {
    this.sources = room.sources;
    this.selfId = room.selfId;
    this.selfName = room.selfName;
    this.peers = room.peers;
    this.transcriber?.update(room.sources);
    this.recompute();
  }

  register(consumer: HubConsumer) {
    const registration: Registration = { consumer };
    this.consumers.add(registration);
    this.ensureRunning();
    this.recompute();
    return {
      update: (patch: Partial<HubConsumer>) => {
        registration.consumer = { ...registration.consumer, ...patch };
        this.recompute();
      },
      /** Stops needing lines; waits for this browser's own lines in flight. */
      unregister: async (): Promise<void> => {
        const pending = this.transcriber?.pending ?? 0;
        if (pending) await this.drain(20_000);
        this.consumers.delete(registration);
        this.recompute();
        if (!this.consumers.size) this.shutdown();
      },
      pending: () => this.transcriber?.pending ?? 0,
    };
  }

  private async drain(timeoutMs: number) {
    const started = Date.now();
    while ((this.transcriber?.pending ?? 0) > 0 && Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private ensureRunning() {
    if (!this.offSocket) this.offSocket = signalingClient.onLiveTranscript((m) => this.onMessage(m));
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.recompute();
        if (this.announced) signalingClient.sendLiveTranscriptStatus(this.announced.split("\n"), true, this.localLive());
      }, STATUS_EVERY_MS);
    }
    if (!this.transcriber && !this.starting) {
      const transcriber = new CallTranscriber(this.options(), {
        onEntry: (entry, language) => this.onOwnEntry(entry, language),
        onPending: (n) => this.each((c) => c.onPending?.(n)),
        onLost: (n) => this.each((c) => c.onLost?.(n)),
        onFatal: (error) => {
          // This browser stops offering to transcribe; somebody else in the
          // room (if anybody) takes its voices over.
          this.fatal = error;
          this.each((c) => c.onFatal?.(error));
          this.recompute();
        },
      });
      this.transcriber = transcriber;
      this.fatal = null;
      this.starting = transcriber
        .start(this.sources)
        .catch(() => {
          this.fatal = "unsupported";
          this.each((c) => c.onFatal?.("unsupported"));
        })
        .finally(() => {
          this.starting = null;
          this.recompute();
        });
    }
  }

  private shutdown() {
    if (this.announced) signalingClient.sendLiveTranscriptStatus([], false, false);
    this.announced = "";
    this.announcedSignature = "";
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.offSocket?.();
    this.offSocket = null;
    const transcriber = this.transcriber;
    this.transcriber = null;
    void transcriber?.stop(20_000);
    this.statuses.clear();
    this.owned.clear();
  }

  private each(fn: (consumer: HubConsumer) => void) {
    for (const r of this.consumers) fn(r.consumer);
  }

  private localLive(): boolean {
    for (const r of this.consumers) if (r.consumer.live) return true;
    return false;
  }

  private options(): TranscriberOptions {
    const consumers = [...this.consumers].map((r) => r.consumer);
    const fixed = [...new Set(consumers.map((c) => c.language))];
    // Real time when we need it, or when somebody we transcribe for does.
    let remoteLive = false;
    for (const status of this.statuses.values()) {
      if (status.live && [...status.candidates].some((key) => this.owned.has(key))) remoteLive = true;
    }
    return {
      live: this.localLive() || remoteLive,
      // One language only when everybody asked for the same one.
      language: fixed.length === 1 ? fixed[0] : "auto",
      vocabulary: [...new Set(consumers.map((c) => c.vocabulary.trim()).filter(Boolean))].join(", ").slice(0, 400),
    };
  }

  keyOf(source: CallSource): string | null {
    const conn = source.self ? this.selfId : source.ownerId;
    return conn ? `${prefixOf(source)}:${conn}` : null;
  }

  private subjectOf(source: CallSource): ConsumerSubject {
    return { kind: source.kind, ownerId: source.ownerId, self: source.self };
  }

  private wanted(subject: ConsumerSubject): boolean {
    for (const r of this.consumers) if (r.consumer.wants(subject)) return true;
    return false;
  }

  private recompute() {
    if (!this.consumers.size || !this.selfId) return;
    const now = Date.now();
    for (const [conn, status] of this.statuses) {
      if (now - status.at > STATUS_TTL_MS || !this.peers.has(conn)) this.statuses.delete(conn);
    }
    // Everything we need, plus our own voice whenever somebody else needs
    // it: the speaker is always the best one to transcribe it.
    const requested = new Set<string>();
    for (const status of this.statuses.values()) for (const key of status.candidates) requested.add(key);
    const mine = new Set<string>();
    if (!this.fatal) {
      for (const source of this.sources) {
        const key = this.keyOf(source);
        if (!key || !hasLiveAudio(source)) continue;
        if (this.wanted(this.subjectOf(source)) || (source.self && requested.has(key))) mine.add(key);
      }
    }
    const owned = new Set<string>();
    const selfId: string = this.selfId;
    for (const key of mine) {
      const speaker = key.slice(key.indexOf(":") + 1);
      const candidates: string[] = [selfId];
      for (const [conn, status] of this.statuses) if (status.candidates.has(key)) candidates.push(conn);
      const owner: string = candidates.includes(speaker) ? speaker : candidates.sort()[0];
      if (owner === selfId) owned.add(key);
    }
    this.owned = owned;
    this.transcriber?.configure(this.options());
    this.transcriber?.setFilter((source) => {
      const key = this.keyOf(source);
      return key !== null && owned.has(key);
    });
    const list = [...mine].sort().join("\n");
    const signature = `${list}|${this.localLive()}`;
    if (signature !== this.announcedSignature) {
      this.announced = list;
      this.announcedSignature = signature;
      signalingClient.sendLiveTranscriptStatus(list ? list.split("\n") : [], Boolean(list), this.localLive());
    }
  }

  private onMessage(message: LiveTranscriptMessage) {
    if (message.kind === "status") {
      if (message.on && message.candidates.length) {
        this.statuses.set(message.from, { candidates: new Set(message.candidates), at: Date.now(), live: message.live });
      } else {
        this.statuses.delete(message.from);
      }
      this.recompute();
      return;
    }
    // Our own voices come from our own transcriber, not back from the room.
    if (this.owned.has(message.speaker)) return;
    if (!message.lineId || this.seen.has(message.lineId)) return;
    this.remember(message.lineId);
    const prefix = message.speaker.slice(0, message.speaker.indexOf(":"));
    const conn = message.speaker.slice(message.speaker.indexOf(":") + 1);
    const self = conn === this.selfId;
    const local = this.sources.find((s) => this.keyOf(s) === message.speaker);
    const subject: ConsumerSubject = local
      ? this.subjectOf(local)
      : { kind: kindOfPrefix(prefix), ownerId: self ? "self" : conn, self };
    const at = Date.now() - message.ageMs;
    const line: SharedLine = {
      id: this.nextId++,
      key: message.speaker,
      sourceId: local?.id ?? message.speaker,
      ownerId: subject.ownerId,
      name: local?.name ?? (self ? this.selfName : this.peers.get(conn) ?? "?"),
      self,
      kind: subject.kind,
      at,
      end: at + message.durMs,
      text: message.text,
      language: languageCode(message.lang),
    };
    this.deliver(line, subject);
  }

  private remember(lineId: string) {
    this.seen.add(lineId);
    if (this.seen.size > SEEN_LINES) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
  }

  private onOwnEntry(entry: TranscriptEntry, language: string | null) {
    const source = this.sources.find((s) => s.id === entry.sourceId);
    const key = source ? this.keyOf(source) : null;
    if (!key || !this.selfId) return;
    const lineId = `${this.selfId}-${entry.id}`;
    this.remember(lineId);
    const code = languageCode(language);
    const line: SharedLine = { ...entry, id: this.nextId++, key, language: code };
    this.deliver(line, this.subjectOf(source!));
    signalingClient.sendLiveTranscriptLine({
      speaker: key,
      source: prefixOf(source!),
      lineId,
      text: entry.text,
      lang: code,
      ageMs: Math.max(0, Date.now() - entry.at),
      durMs: Math.max(0, entry.end - entry.at),
    });
  }

  private deliver(line: SharedLine, subject: ConsumerSubject) {
    for (const r of this.consumers) if (r.consumer.wants(subject)) r.consumer.onLine(line);
  }
}

export const liveTranscriptHub = new LiveTranscriptHub();
