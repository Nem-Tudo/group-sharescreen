"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";

// The API's /transcribe routes (see its transcribeRoutes.ts): Groq's Whisper
// for the audio, one of its chat models for translating and summarising.
// Pro Max only — the API checks, this only reports what it said.

export type TranscriptApiError =
  | "account-required"
  | "pro-max-required"
  | "not-configured"
  | "daily-limit"
  | "busy"
  | "bad-audio"
  | "upstream"
  | "network";

export type TranscribedSegment = { start: number; end: number; text: string };

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false; error: TranscriptApiError; retryAfter?: number };

async function call<T>(path: string, init: RequestInit): Promise<Ok<T> | Fail> {
  const token = getAccountToken();
  if (!token) return { ok: false, error: "account-required" };
  try {
    const res = await fetch(`${getSignalingHttpBase()}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string; retryAfter?: number }) | null;
    if (!res.ok) {
      // The route's own per-minute limit: same as Groq being busy.
      if (res.status === 429 && data?.error !== "daily-limit") return { ok: false, error: "busy", retryAfter: 5 };
      return {
        ok: false,
        error: (data?.error as TranscriptApiError | undefined) ?? "upstream",
        retryAfter: data?.retryAfter,
      };
    }
    return { ok: true, value: data as T };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function transcribeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/transcribe/status`);
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { available?: boolean }).available);
  } catch {
    return false;
  }
}

export function transcribeAudio(wav: Blob, language: string | null, prompt: string) {
  const query = new URLSearchParams();
  if (language) query.set("lang", language);
  if (prompt) query.set("prompt", prompt);
  return call<{ language: string | null; segments: TranscribedSegment[] }>(`/transcribe?${query}`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wav,
  });
}

export function translateLines(texts: string[], to: string) {
  return call<{ texts: string[] }>("/transcribe/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texts, to }),
  });
}

export function summarizeTranscript(transcript: string, language: string) {
  return call<{ summary: string }>("/transcribe/summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript, language }),
  });
}
