import { app, dialog, shell } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SOUNDBOARD_MAX_BYTES,
  SOUNDBOARD_MAX_DURATION_MS,
  isSoundboardFileWithinLimits,
} from "../lib/soundboardRules";

const MANIFEST_NAME = ".golive-soundboard.json";
const MAX_STORED_SOUNDS = 256;
const SUPPORTED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".webm", ".m4a", ".aac"]);

export interface StoredSoundboardSound {
  id: string;
  name: string;
  emoji: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  hash: string;
}

export type SoundboardPickResult =
  | { ok: true; fileName: string; data: Uint8Array }
  | { ok: false; error: "file-too-large" | "unsupported" };

function soundboardDirectory(): string {
  // User media must survive app updates. Keeping it in Documents also avoids
  // trying to write beside the installed executable under Program Files.
  return path.join(app.getPath("documents"), "GoLive", "Soundboard");
}

function manifestPath(): string {
  return path.join(soundboardDirectory(), MANIFEST_NAME);
}

async function ensureDirectory(): Promise<void> {
  await fs.mkdir(soundboardDirectory(), { recursive: true });
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return name || null;
}

function cleanEmoji(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const emoji = value.trim().slice(0, 16);
  return emoji || null;
}

function supportedExtension(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext) ? ext : null;
}

function safeStoredFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (path.basename(value) !== value) return null;
  if (!supportedExtension(value)) return null;
  return value;
}

function cleanStoredSound(value: unknown): StoredSoundboardSound | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && /^[a-f0-9-]{16,64}$/i.test(raw.id) ? raw.id : null;
  const name = cleanName(raw.name);
  const emoji = cleanEmoji(raw.emoji);
  const fileName = safeStoredFileName(raw.fileName);
  const durationMs = typeof raw.durationMs === "number" ? raw.durationMs : Number.NaN;
  const sizeBytes = typeof raw.sizeBytes === "number" ? raw.sizeBytes : Number.NaN;
  const hash = typeof raw.hash === "string" && /^[a-f0-9]{64}$/i.test(raw.hash) ? raw.hash.toLowerCase() : null;
  if (!id || !name || !emoji || !fileName || !hash) return null;
  if (!isSoundboardFileWithinLimits(sizeBytes, durationMs)) return null;
  return { id, name, emoji, fileName, durationMs, sizeBytes, hash };
}

async function readManifest(): Promise<StoredSoundboardSound[]> {
  await ensureDirectory();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath(), "utf8"));
  } catch {
    return [];
  }
  const rawSounds =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { sounds?: unknown }).sounds)
      ? ((parsed as { sounds: unknown[] }).sounds)
      : [];
  const sounds: StoredSoundboardSound[] = [];
  for (const raw of rawSounds.slice(0, MAX_STORED_SOUNDS)) {
    const sound = cleanStoredSound(raw);
    if (!sound) continue;
    try {
      const stat = await fs.stat(path.join(soundboardDirectory(), sound.fileName));
      if (!stat.isFile() || stat.size !== sound.sizeBytes) continue;
    } catch {
      continue;
    }
    sounds.push(sound);
  }
  return sounds;
}

async function writeManifest(sounds: StoredSoundboardSound[]): Promise<void> {
  await ensureDirectory();
  await fs.writeFile(
    manifestPath(),
    JSON.stringify({ version: 1, sounds: sounds.slice(0, MAX_STORED_SOUNDS) }, null, 2) + "\n",
    "utf8"
  );
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function generatedFileName(original: string, id: string): string | null {
  const ext = supportedExtension(original);
  if (!ext) return null;
  const rawBase = path.basename(original, path.extname(original));
  const base =
    rawBase
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "sound";
  return `${base}-${id.slice(0, 8)}${ext}`;
}

export async function listSoundboardSounds(): Promise<StoredSoundboardSound[]> {
  return readManifest();
}

export async function pickSoundboardFile(): Promise<SoundboardPickResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Adicionar som ao Soundboard",
    properties: ["openFile"],
    filters: [
      {
        name: "Áudio",
        extensions: ["mp3", "wav", "ogg", "webm", "m4a", "aac"],
      },
    ],
  });
  if (result.canceled || result.filePaths.length !== 1) return null;
  const selected = result.filePaths[0];
  if (!supportedExtension(selected)) return { ok: false, error: "unsupported" };
  const stat = await fs.stat(selected).catch(() => null);
  if (!stat?.isFile()) return { ok: false, error: "unsupported" };
  if (stat.size <= 0 || stat.size > SOUNDBOARD_MAX_BYTES) {
    return { ok: false, error: "file-too-large" };
  }
  const data = await fs.readFile(selected);
  return { ok: true, fileName: path.basename(selected), data: new Uint8Array(data) };
}

export async function saveSoundboardSound(raw: unknown): Promise<StoredSoundboardSound | null> {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const name = cleanName(input.name);
  const emoji = cleanEmoji(input.emoji);
  const originalFileName = typeof input.fileName === "string" ? path.basename(input.fileName) : "";
  const durationMs =
    typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
      ? Math.round(input.durationMs)
      : Number.NaN;
  const data = bytesOf(input.data);
  if (!name || !emoji || !data) return null;
  if (!isSoundboardFileWithinLimits(data.byteLength, durationMs)) return null;

  const id = randomUUID();
  const fileName = generatedFileName(originalFileName, id);
  if (!fileName) return null;

  const sounds = await readManifest();
  if (sounds.length >= MAX_STORED_SOUNDS) return null;

  const hash = createHash("sha256").update(data).digest("hex");
  const sound: StoredSoundboardSound = {
    id,
    name,
    emoji,
    fileName,
    durationMs,
    sizeBytes: data.byteLength,
    hash,
  };

  await ensureDirectory();
  const destination = path.join(soundboardDirectory(), fileName);
  await fs.writeFile(destination, data);
  try {
    await writeManifest([...sounds, sound]);
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  return sound;
}

export async function readSoundboardSound(id: unknown): Promise<Uint8Array | null> {
  if (typeof id !== "string") return null;
  const sound = (await readManifest()).find((entry) => entry.id === id);
  if (!sound) return null;
  const data = await fs.readFile(path.join(soundboardDirectory(), sound.fileName)).catch(() => null);
  if (!data || data.byteLength !== sound.sizeBytes || data.byteLength > SOUNDBOARD_MAX_BYTES) return null;
  return new Uint8Array(data);
}

export async function removeSoundboardSound(id: unknown): Promise<boolean> {
  if (typeof id !== "string") return false;
  const sounds = await readManifest();
  const sound = sounds.find((entry) => entry.id === id);
  if (!sound) return false;
  await fs.rm(path.join(soundboardDirectory(), sound.fileName), { force: true }).catch(() => {});
  await writeManifest(sounds.filter((entry) => entry.id !== id));
  return true;
}

export async function openSoundboardFolder(): Promise<void> {
  await ensureDirectory();
  await shell.openPath(soundboardDirectory());
}

export const SOUNDBOARD_DURATION_LIMIT_MS = SOUNDBOARD_MAX_DURATION_MS;
