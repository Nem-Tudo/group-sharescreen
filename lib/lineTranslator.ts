"use client";

import { translateLines } from "./transcriptApi";

// Lines of a conversation into one language, a few at a time through the
// API's /transcribe/translate (Groq). Used by the transcript's "traduzir
// para" and by the live translation, which waits much less before sending.

const BATCH = 20;

export class LineTranslator {
  private queue: { id: number; text: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private to: string,
    private onTranslated: (id: number, text: string) => void,
    // How long a line waits for others to go with it.
    private delayMs = 1_500,
    // The account ran out of budget or plan: no more translation.
    private onRefused?: () => void,
  ) {}

  add(id: number, text: string) {
    if (this.stopped) return;
    this.queue.push({ id, text });
    if (this.queue.length >= BATCH) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  private flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) return this.running.then(() => (this.queue.length ? this.flush() : undefined));
    if (!this.queue.length || this.stopped) return Promise.resolve();
    const batch = this.queue.splice(0, BATCH);
    this.running = (async () => {
      const result = await translateLines(
        batch.map((l) => l.text),
        this.to,
      );
      if (result.ok) {
        batch.forEach((line, i) => {
          const text = result.value.texts[i]?.trim();
          if (text) this.onTranslated(line.id, text);
        });
      } else if (result.error === "daily-limit" || result.error === "pro-max-required") {
        this.stopped = true;
        this.queue = [];
        this.onRefused?.();
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running.then(() => (this.queue.length ? this.flush() : undefined));
  }

  /** Everything still waiting, translated (or given up on after `timeoutMs`). */
  async drain(timeoutMs = 30_000): Promise<void> {
    await Promise.race([this.flush(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Lines from now on go into `to`. */
  setTarget(to: string) {
    this.to = to;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
