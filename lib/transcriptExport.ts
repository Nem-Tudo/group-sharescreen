"use client";

import type { TranscriptEntry, TranscriptSettings } from "./callTranscript";
import { formatLocale, translate } from "./i18n";

// The files a transcript turns into (see lib/callTranscript). Every time in
// them is counted from `origin` — the start of the transcript, or of the
// recording it goes with, so the .srt lines up with that recording's video.

export type TranscriptFile = { name: string; blob: Blob };

const MERGE_GAP_MS = 2_000;
const MERGE_MAX_MS = 30_000;

function pad(n: number, size = 2): string {
  return String(Math.floor(n)).padStart(size, "0");
}

function relative(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

function cueTime(ms: number, separator: "," | "."): string {
  const clamped = Math.max(0, ms);
  return `${relative(clamped)}${separator}${pad(clamped % 1000, 3)}`;
}

function clock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return new Date(ms).toISOString().slice(11, 19);
  }
}

function speaker(entry: TranscriptEntry): string {
  return entry.self ? `${entry.name} (${translate("common.you")})` : entry.name;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "?";
}

/** The lines to write: from `origin` on, merged when asked. */
export function transcriptLines(
  entries: TranscriptEntry[],
  settings: Pick<TranscriptSettings, "mergeLines">,
  origin: number,
  end = Infinity,
): TranscriptEntry[] {
  const inRange = entries.filter((e) => e.end > origin - 500 && e.at < end).sort((a, b) => a.at - b.at);
  if (!settings.mergeLines) return inRange;
  const out: TranscriptEntry[] = [];
  for (const entry of inRange) {
    const last = out[out.length - 1];
    if (
      last &&
      last.sourceId === entry.sourceId &&
      entry.at - last.end < MERGE_GAP_MS &&
      entry.end - last.at < MERGE_MAX_MS
    ) {
      out[out.length - 1] = {
        ...last,
        end: Math.max(last.end, entry.end),
        text: `${last.text} ${entry.text}`,
        translation:
          last.translation || entry.translation
            ? `${last.translation ?? last.text} ${entry.translation ?? entry.text}`
            : undefined,
      };
    } else {
      out.push({ ...entry });
    }
  }
  return out;
}

function lineText(entry: TranscriptEntry, settings: TranscriptSettings, indent: string): string {
  const translated = settings.translateTo !== "none" && entry.translation;
  if (!translated) return entry.text;
  return settings.keepOriginal ? `${entry.text}\n${indent}→ ${entry.translation}` : entry.translation!;
}

function stamp(entry: TranscriptEntry, settings: TranscriptSettings, origin: number): string {
  if (settings.timestamps === "none") return "";
  return `[${settings.timestamps === "clock" ? clock(entry.at) : relative(entry.at - origin)}] `;
}

function header(lines: TranscriptEntry[], origin: number, end: number, title: string): string {
  const people = [...new Set(lines.map(speaker))];
  let date: string;
  try {
    date = new Date(origin).toLocaleString(formatLocale());
  } catch {
    date = new Date(origin).toISOString();
  }
  return [
    title,
    `${translate("callTranscript.fileDate")}: ${date}`,
    `${translate("callTranscript.fileDuration")}: ${relative(end - origin)}`,
    `${translate("callTranscript.fileParticipants")}: ${people.join(", ") || "—"}`,
    "",
    "",
  ].join("\n");
}

function text(content: string, type = "text/plain"): Blob {
  // With a BOM, so Notepad on an older Windows opens accents right.
  return new Blob([String.fromCharCode(0xfeff), content], { type: `${type};charset=utf-8` });
}

/** Plain text of the whole thing — also what the summary is made from. */
export function transcriptText(
  entries: TranscriptEntry[],
  settings: TranscriptSettings,
  origin: number,
  end: number,
): string {
  const lines = transcriptLines(entries, settings, origin, end);
  const body = lines
    .map((e) => {
      const prefix = `${stamp(e, settings, origin)}${speaker(e)}: `;
      return `${prefix}${lineText(e, settings, " ".repeat(prefix.length))}`;
    })
    .join("\n");
  return header(lines, origin, end, translate("callTranscript.fileTitle")) + body + "\n";
}

export function buildTranscriptFiles(
  entries: TranscriptEntry[],
  settings: TranscriptSettings,
  options: { origin: number; end: number; summary?: string | null; folder?: string },
): TranscriptFile[] {
  const { origin, end } = options;
  const folder = options.folder ? `${options.folder.replace(/\/+$/, "")}/` : "";
  const lines = transcriptLines(entries, settings, origin, end);
  const base = translate("callTranscript.fileBase");
  const files: TranscriptFile[] = [];

  files.push({ name: `${folder}${base}.txt`, blob: text(transcriptText(entries, settings, origin, end)) });

  if (options.summary) {
    files.push({
      name: `${folder}${translate("callTranscript.fileSummary")}.txt`,
      blob: text(`${translate("callTranscript.fileSummary")}\n\n${options.summary}\n`),
    });
  }

  if (settings.separateFiles) {
    const byPerson = new Map<string, TranscriptEntry[]>();
    for (const line of lines) {
      const key = speaker(line);
      byPerson.set(key, [...(byPerson.get(key) ?? []), line]);
    }
    const used = new Set<string>();
    for (const [person, own] of byPerson) {
      let name = `${base} - ${safeName(person)}`;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} - ${safeName(person)} (${i})`;
      used.add(name.toLowerCase());
      const body = own
        .map((e) => {
          const prefix = stamp(e, settings, origin);
          return `${prefix}${lineText(e, settings, " ".repeat(prefix.length))}`;
        })
        .join("\n");
      files.push({ name: `${folder}${name}.txt`, blob: text(header(own, origin, end, person) + body + "\n") });
    }
  }

  const cueBody = (e: TranscriptEntry) => {
    const translated = settings.translateTo !== "none" && e.translation;
    if (!translated) return e.text;
    return settings.keepOriginal ? `${e.text}\n${e.translation}` : e.translation!;
  };
  // Cues never overlap the next one of the same person, which some players
  // show stacked.
  const cueEnd = (e: TranscriptEntry, i: number) => {
    const next = lines.slice(i + 1).find((n) => n.sourceId === e.sourceId);
    return Math.max(e.at + 500, Math.min(e.end, next ? next.at : e.end));
  };

  if (settings.formats.srt) {
    const body = lines
      .map(
        (e, i) =>
          `${i + 1}\n${cueTime(e.at - origin, ",")} --> ${cueTime(cueEnd(e, i) - origin, ",")}\n${speaker(e)}: ${cueBody(e)}\n`,
      )
      .join("\n");
    files.push({ name: `${folder}${base}.srt`, blob: text(body, "application/x-subrip") });
  }

  if (settings.formats.vtt) {
    const body = lines
      .map((e, i) => `${cueTime(e.at - origin, ".")} --> ${cueTime(cueEnd(e, i) - origin, ".")}\n<v ${speaker(e)}>${cueBody(e)}\n`)
      .join("\n");
    files.push({ name: `${folder}${base}.vtt`, blob: new Blob([`WEBVTT\n\n${body}`], { type: "text/vtt;charset=utf-8" }) });
  }

  if (settings.formats.md) {
    const people = [...new Set(lines.map(speaker))];
    const body = lines
      .map((e) => {
        const time = settings.timestamps === "none" ? "" : `\`${stamp(e, settings, origin).trim()}\` `;
        const translated = settings.translateTo !== "none" && e.translation;
        const said = translated
          ? settings.keepOriginal
            ? `${e.text}  \n> ${e.translation}`
            : e.translation
          : e.text;
        return `${time}**${speaker(e)}:** ${said}`;
      })
      .join("\n\n");
    const summary = options.summary ? `## ${translate("callTranscript.fileSummary")}\n\n${options.summary}\n\n` : "";
    const md =
      `# ${translate("callTranscript.fileTitle")}\n\n` +
      `- ${translate("callTranscript.fileDuration")}: ${relative(end - origin)}\n` +
      `- ${translate("callTranscript.fileParticipants")}: ${people.join(", ") || "—"}\n\n` +
      summary +
      `## ${translate("callTranscript.fileConversation")}\n\n${body}\n`;
    files.push({ name: `${folder}${base}.md`, blob: text(md, "text/markdown") });
  }

  if (settings.formats.json) {
    const json = {
      startedAt: new Date(origin).toISOString(),
      durationSeconds: Math.round((end - origin) / 1000),
      language: settings.language,
      translatedTo: settings.translateTo === "none" ? null : settings.translateTo,
      participants: [...new Set(lines.map(speaker))],
      summary: options.summary ?? null,
      lines: lines.map((e) => ({
        start: Math.max(0, (e.at - origin) / 1000),
        end: Math.max(0, (e.end - origin) / 1000),
        speaker: speaker(e),
        source: e.kind,
        text: e.text,
        ...(e.translation ? { translation: e.translation } : {}),
      })),
    };
    files.push({ name: `${folder}${base}.json`, blob: new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }) });
  }

  return files;
}
