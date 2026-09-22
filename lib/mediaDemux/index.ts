import { BlobReader } from "./blobReader";
import { openMatroska } from "./matroska";
import { openMp4 } from "./mp4";
import type { AudioDemuxer } from "./types";

export type { AudioDemuxer, AudioPacket, AudioTrackInfo } from "./types";

const MATROSKA = ["mkv", "mka", "webm"];
const MP4 = ["mp4", "m4v", "m4a", "mov"];

/** Whether this reader understands the file's container at all. */
export function canDemux(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return MATROSKA.includes(ext) || MP4.includes(ext);
}

/**
 * The audio side of a local file, or null when the container is not one this
 * reads or the file is not what its name says. Never throws for a bad file.
 */
export async function openAudioDemuxer(blob: Blob, name: string): Promise<AudioDemuxer | null> {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const reader = new BlobReader(blob);
  try {
    if (MATROSKA.includes(ext)) return await openMatroska(reader);
    if (MP4.includes(ext)) return await openMp4(reader);
  } catch {
    // A truncated or mislabelled file: the <video> element plays what it can.
  }
  return null;
}
