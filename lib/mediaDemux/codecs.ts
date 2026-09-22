// Container codec ids → WebCodecs codec strings, shared by both demuxers.
// Whether the browser can actually decode one is a separate question, asked
// at run time with AudioDecoder.isConfigSupported (see multiAudioEngine).

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** "mp4a.40.N" from an AudioSpecificConfig's audio object type. */
export function aacCodecString(asc: Uint8Array | undefined): string {
  if (!asc || asc.length < 2) return "mp4a.40.2";
  let objectType = asc[0] >> 3;
  if (objectType === 31) objectType = 32 + (((asc[0] & 0x07) << 3) | (asc[1] >> 5));
  return `mp4a.40.${objectType || 2}`;
}

/**
 * An AudioSpecificConfig for a Matroska AAC track that came without one (the
 * old "A_AAC/MPEG4/LC" style ids carry the profile in the name instead).
 */
export function buildAsc(objectType: number, sampleRate: number, channels: number): Uint8Array | null {
  const index = AAC_SAMPLE_RATES.indexOf(sampleRate);
  if (index < 0 || channels < 1 || channels > 7) return null;
  return new Uint8Array([(objectType << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3)]);
}

/** Samples in one frame, for codecs where it is fixed — to space laced frames. */
export function fixedFrameSamples(codec: string | null): number | null {
  if (!codec) return null;
  if (codec.startsWith("mp4a")) return 1024;
  if (codec === "mp3") return 1152;
  if (codec === "ac-3" || codec === "ec-3") return 1536;
  return null;
}

/** Matroska CodecID + CodecPrivate → codec string and description. */
export function matroskaAudioCodec(
  codecId: string,
  codecPrivate: Uint8Array | undefined,
  sampleRate: number,
  channels: number
): { codec: string | null; description?: Uint8Array } {
  if (codecId === "A_AAC") return { codec: aacCodecString(codecPrivate), description: codecPrivate };
  if (codecId.startsWith("A_AAC/")) {
    // A_AAC/MPEG2/LC, A_AAC/MPEG4/MAIN, .../LC/SBR: no CodecPrivate by design.
    if (codecPrivate && codecPrivate.length >= 2) return { codec: aacCodecString(codecPrivate), description: codecPrivate };
    const profile = codecId.endsWith("/MAIN") ? 1 : codecId.endsWith("/SSR") ? 3 : 2;
    // SBR (HE-AAC) is signalled implicitly; the core runs at half the rate.
    const coreRate = codecId.endsWith("/SBR") ? sampleRate / 2 : sampleRate;
    const asc = buildAsc(profile, coreRate, channels);
    return asc ? { codec: `mp4a.40.${profile}`, description: asc } : { codec: null };
  }
  if (codecId === "A_OPUS") return { codec: "opus", description: codecPrivate };
  if (codecId === "A_VORBIS") return { codec: "vorbis", description: codecPrivate };
  if (codecId === "A_FLAC") return { codec: "flac", description: codecPrivate };
  if (codecId === "A_MPEG/L3") return { codec: "mp3" };
  // Layer II is not something the "mp3" decoder takes; left unmapped.
  if (codecId === "A_AC3") return { codec: "ac-3" };
  if (codecId === "A_EAC3") return { codec: "ec-3" };
  if (codecId.startsWith("A_DTS")) return { codec: "dts" };
  if (codecId === "A_TRUEHD") return { codec: "mlp" };
  return { codec: null };
}

/** What to call a codec in the track list — the name people know it by. */
export function codecLabel(codecId: string, codec: string | null): string {
  if (codec?.startsWith("mp4a")) return "AAC";
  if (codec === "opus") return "Opus";
  if (codec === "vorbis") return "Vorbis";
  if (codec === "flac") return "FLAC";
  if (codec === "mp3") return "MP3";
  if (codec === "ac-3") return "AC3";
  if (codec === "ec-3") return "E-AC3";
  if (codec === "dts") return "DTS";
  if (codec === "mlp") return "TrueHD";
  return codecId.replace(/^A_/, "");
}
