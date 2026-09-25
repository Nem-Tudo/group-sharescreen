"use client";

import { useEffect, useState } from "react";

// Reads the live translation aloud with the browser's own voices
// (speechSynthesis): free, local and instant, which is what makes it usable
// in real time. A natural (paid) voice is a later step — see
// lib/useLiveTranslation.
//
// The queue never falls behind the conversation: a line older than
// MAX_AGE_MS is dropped instead of read, only the newest MAX_QUEUED wait,
// and the reading speeds up while there is a line waiting. Being seconds
// late with a sentence is useful; being a minute late is not.

const MAX_AGE_MS = 10_000;
const MAX_QUEUED = 3;

type Item = { text: string; key: string; at: number };

export type SpeechOptions = {
  lang: string;
  // A voice's voiceURI, or "" for the best one for `lang`.
  voiceURI: string;
  rate: number;
  // Who is being read now (the line's owner), or null when quiet — so the
  // room can turn that person's own voice down meanwhile.
  onSpeaking: (key: string | null) => void;
};

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** The browser's voices; they arrive asynchronously in Chrome. */
export function useBrowserVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported()) return;
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, []);
  return voices;
}

export function voicesFor(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const prefix = lang.toLowerCase().slice(0, 2);
  return voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix));
}

// The neural voices Edge ("Online (Natural)") and Chrome ("Google …") ship
// sound far better than the old system ones; prefer them.
function score(voice: SpeechSynthesisVoice, lang: string): number {
  let s = 0;
  if (/natural|neural|online/i.test(voice.name)) s += 4;
  if (/google/i.test(voice.name)) s += 3;
  if (voice.lang.toLowerCase() === lang.toLowerCase()) s += 1;
  if (lang.toLowerCase().startsWith("pt") && /br/i.test(voice.lang)) s += 1;
  if (voice.default) s += 0.5;
  return s;
}

export function pickVoice(lang: string, voiceURI: string): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const candidates = voicesFor(window.speechSynthesis.getVoices(), lang);
  if (voiceURI) {
    const chosen = candidates.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  return [...candidates].sort((a, b) => score(b, lang) - score(a, lang))[0] ?? null;
}

export class SpeechQueue {
  private queue: Item[] = [];
  private speaking = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private options: SpeechOptions) {}

  configure(options: Partial<Omit<SpeechOptions, "onSpeaking">>) {
    this.options = { ...this.options, ...options };
  }

  say(text: string, key: string) {
    if (this.stopped || !speechSupported() || !text.trim()) return;
    this.queue.push({ text, key, at: Date.now() });
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
    this.next();
  }

  /** One sentence now, whatever is queued (the "testar voz" button). */
  test(text: string) {
    if (!speechSupported()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.options.lang;
    utterance.voice = pickVoice(this.options.lang, this.options.voiceURI);
    utterance.rate = this.options.rate;
    window.speechSynthesis.speak(utterance);
  }

  private next() {
    if (this.speaking || this.stopped) return;
    const now = Date.now();
    this.queue = this.queue.filter((item) => now - item.at < MAX_AGE_MS);
    const item = this.queue.shift();
    if (!item) {
      this.options.onSpeaking(null);
      return;
    }
    this.speaking = true;
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = this.options.lang;
    utterance.voice = pickVoice(this.options.lang, this.options.voiceURI);
    // Faster while something else is waiting.
    const hurry = this.queue.length >= 2 ? 1.35 : this.queue.length === 1 ? 1.15 : 1;
    utterance.rate = Math.min(2, this.options.rate * hurry);
    const done = () => {
      if (!this.speaking) return;
      this.speaking = false;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.next();
    };
    utterance.onstart = () => this.options.onSpeaking(item.key);
    utterance.onend = done;
    utterance.onerror = done;
    // Chrome sometimes never fires "end"; do not let one sentence jam the rest.
    this.watchdog = setTimeout(
      () => {
        window.speechSynthesis.cancel();
        done();
      },
      (item.text.length * 90) / utterance.rate + 4_000,
    );
    window.speechSynthesis.speak(utterance);
  }

  /** Silence now — the sentence being read and all that wait — but keep going. */
  clear() {
    this.queue = [];
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.speaking = false;
    if (speechSupported()) window.speechSynthesis.cancel();
    this.options.onSpeaking(null);
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.speaking = false;
    if (speechSupported()) window.speechSynthesis.cancel();
    this.options.onSpeaking(null);
  }
}
