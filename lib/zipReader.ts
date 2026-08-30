"use client";

// A minimal ZIP reader, written here rather than pulled in as a dependency.
// What it has to do is narrow — list the entries of a zip someone picked off
// their own disk and hand back the media files inside as Blobs — and the two
// compression methods that covers are "stored" (no compression, which is what
// zipping already-compressed video and audio produces) and "deflate", which
// the browser itself can undo via DecompressionStream. That is a couple of
// header structs and no third-party code in the path of a file the user chose.
//
// Not supported, and refused rather than half-read: encrypted entries, and
// anything compressed with a method other than those two (bzip2, LZMA, zstd —
// vanishingly rare for a zip of media files, and a wrong answer here would be
// a corrupt track rather than an error).

// End of Central Directory record, and its ZIP64 counterparts. The EOCD is at
// the very end of the file, after a comment of up to 64KB — so it is found by
// scanning backwards for its signature rather than by seeking to a fixed spot.
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
// Any 32-bit field holding this means "the real value is in the ZIP64 extra
// field", which is how a zip larger than 4GB (or with more than 65535 entries)
// stores its numbers.
const ZIP64_MARKER_32 = 0xffffffff;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_EXTRA_HEADER_ID = 0x0001;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export type ZipEntry = {
  // The path as recorded in the zip, e.g. "Album/01 - faixa.mp3".
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  // Byte offset of this entry's *local* header, which is where its data
  // actually starts (after a variable-length name and extra field).
  localHeaderOffset: number;
  encrypted: boolean;
};

export class ZipError extends Error {}

// Reads a slice of the file. Blob.slice is lazy — nothing is read from disk
// until arrayBuffer() is awaited — so a 4GB zip costs only the bytes actually
// asked for, which is what makes reading the directory cheap.
async function readSlice(blob: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await blob.slice(start, end).arrayBuffer();
  return new DataView(buffer);
}

// The filename field is UTF-8 when the entry's general-purpose bit 11 is set,
// and otherwise nominally CP437. Everything modern sets that bit, and TextDecoder
// has no CP437 — so the fallback is latin1, which at least gets ASCII right and
// never throws, rather than a mojibake-or-error choice.
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: false }).decode(bytes);
}

// Walks the ZIP64 extra field, which only carries the values whose 32-bit
// counterparts were maxed out — in that order, and with the ones that weren't
// simply absent. Reading it positionally without checking each marker is the
// classic way to get a plausible but wrong offset.
function readZip64Extra(
  extra: DataView,
  needs: { size: boolean; compressedSize: boolean; offset: boolean }
): { uncompressedSize?: number; compressedSize?: number; offset?: number } {
  let cursor = 0;
  while (cursor + 4 <= extra.byteLength) {
    const headerId = extra.getUint16(cursor, true);
    const size = extra.getUint16(cursor + 2, true);
    const body = cursor + 4;
    if (headerId === ZIP64_EXTRA_HEADER_ID) {
      const out: { uncompressedSize?: number; compressedSize?: number; offset?: number } = {};
      let at = body;
      const readU64 = () => {
        const value = Number(extra.getBigUint64(at, true));
        at += 8;
        return value;
      };
      if (needs.size && at + 8 <= body + size) out.uncompressedSize = readU64();
      if (needs.compressedSize && at + 8 <= body + size) out.compressedSize = readU64();
      if (needs.offset && at + 8 <= body + size) out.offset = readU64();
      return out;
    }
    cursor = body + size;
  }
  return {};
}

async function findCentralDirectory(
  file: Blob
): Promise<{ offset: number; entryCount: number }> {
  const tailSize = Math.min(file.size, EOCD_MIN_SIZE + MAX_COMMENT_SIZE);
  const tail = await readSlice(file, file.size - tailSize, file.size);
  // Backwards, so a zip whose *comment* happens to contain the signature
  // doesn't win over the real record at the end.
  for (let i = tail.byteLength - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) !== EOCD_SIGNATURE) continue;
    const entryCount = tail.getUint16(i + 10, true);
    const offset = tail.getUint32(i + 16, true);
    if (offset !== ZIP64_MARKER_32 && entryCount !== ZIP64_MARKER_16) {
      return { offset, entryCount };
    }
    // ZIP64: the locator sits immediately before the EOCD and points at the
    // real record, which holds the 64-bit values.
    const locatorAt = file.size - tailSize + i - 20;
    if (locatorAt < 0) throw new ZipError("Zip inválido: diretório não encontrado.");
    const locator = await readSlice(file, locatorAt, locatorAt + 20);
    if (locator.getUint32(0, true) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new ZipError("Zip inválido: diretório não encontrado.");
    }
    const zip64At = Number(locator.getBigUint64(8, true));
    const zip64 = await readSlice(file, zip64At, zip64At + 56);
    if (zip64.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
      throw new ZipError("Zip inválido: diretório não encontrado.");
    }
    return {
      entryCount: Number(zip64.getBigUint64(32, true)),
      offset: Number(zip64.getBigUint64(48, true)),
    };
  }
  throw new ZipError("Isso não parece ser um arquivo .zip.");
}

// The entry list, read from the central directory alone — no entry data is
// touched, so this stays fast on a zip of any size.
export async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  const { offset, entryCount } = await findCentralDirectory(file);
  const directory = await readSlice(file, offset, file.size);
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > directory.byteLength) break;
    if (directory.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE) break;
    const flags = directory.getUint16(cursor + 8, true);
    const method = directory.getUint16(cursor + 10, true);
    let compressedSize = directory.getUint32(cursor + 20, true);
    let uncompressedSize = directory.getUint32(cursor + 24, true);
    const nameLength = directory.getUint16(cursor + 28, true);
    const extraLength = directory.getUint16(cursor + 30, true);
    const commentLength = directory.getUint16(cursor + 32, true);
    let localHeaderOffset = directory.getUint32(cursor + 42, true);
    const nameAt = cursor + 46;
    const nameBytes = new Uint8Array(
      directory.buffer,
      directory.byteOffset + nameAt,
      Math.min(nameLength, directory.byteLength - nameAt)
    );
    const name = decodeName(nameBytes, (flags & 0x800) !== 0);
    if (extraLength > 0) {
      const extraAt = nameAt + nameLength;
      const zip64 = readZip64Extra(
        new DataView(
          directory.buffer,
          directory.byteOffset + extraAt,
          Math.min(extraLength, directory.byteLength - extraAt)
        ),
        {
          size: uncompressedSize === ZIP64_MARKER_32,
          compressedSize: compressedSize === ZIP64_MARKER_32,
          offset: localHeaderOffset === ZIP64_MARKER_32,
        }
      );
      if (zip64.uncompressedSize !== undefined) uncompressedSize = zip64.uncompressedSize;
      if (zip64.compressedSize !== undefined) compressedSize = zip64.compressedSize;
      if (zip64.offset !== undefined) localHeaderOffset = zip64.offset;
    }
    cursor = nameAt + nameLength + extraLength + commentLength;
    // Directories are entries too, recorded with a trailing slash and no data.
    if (name.endsWith("/")) continue;
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      method,
      localHeaderOffset,
      // General-purpose bit 0. Nothing here can decrypt, so these are refused
      // at read time rather than handed over as noise.
      encrypted: (flags & 0x1) !== 0,
    });
  }
  return entries;
}

// Pulls one entry out as a Blob of `type`. The local header has to be read
// first: its name/extra lengths are what say where the data actually begins,
// and they are allowed to differ from the central directory's.
export async function readZipEntryBlob(
  file: Blob,
  entry: ZipEntry,
  type: string
): Promise<Blob> {
  if (entry.encrypted) throw new ZipError(`"${entry.name}" está protegido por senha.`);
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`"${entry.name}" usa uma compressão que o navegador não abre.`);
  }
  const header = await readSlice(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_FILE_SIGNATURE) {
    throw new ZipError(`"${entry.name}" está corrompido dentro do zip.`);
  }
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const data = file.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === METHOD_STORED) return data.slice(0, data.size, type);
  if (typeof DecompressionStream === "undefined") {
    throw new ZipError("Este navegador não sabe descompactar zip. Extraia a pasta e escolha ela.");
  }
  // "deflate-raw" and not "deflate": a zip entry holds the bare deflate
  // stream, with none of the zlib header/checksum that "deflate" expects.
  const stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).blob().then((blob) => blob.slice(0, blob.size, type));
}
