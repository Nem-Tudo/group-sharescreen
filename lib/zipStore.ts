// A .zip with every file "stored" (no compression), built from Blobs without
// holding them in memory — for "Gravar chamada" (see lib/callRecording.ts).
//
// Stored because everything that goes in is already MP3 or MP4: deflate would
// spend the CPU and save next to nothing. And written here rather than pulled
// in as a dependency because stored ZIP is a header per file and a directory
// at the end; the only real work is the CRC, which has to read every byte.
//
// Plain ZIP, not ZIP64: past 4 GB this throws and the caller hands the files
// over one by one instead.

const LIMIT = 0xffffffff;

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

async function crc32(blob: Blob, onBytes: (n: number) => void): Promise<number> {
  const t = table();
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) crc = t[(crc ^ value[i]) & 0xff] ^ (crc >>> 8);
    onBytes(value.length);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export class ZipTooLargeError extends Error {}

export async function buildZip(
  files: { name: string; blob: Blob }[],
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const total = files.reduce((sum, f) => sum + f.blob.size, 0) || 1;
  let read = 0;
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const size = file.blob.size;
    if (size > LIMIT || offset > LIMIT) throw new ZipTooLargeError();
    const crc = await crc32(file.blob, (n) => {
      read += n;
      onProgress?.(read / total);
    });

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);

    parts.push(local, file.blob);
    offset += local.length + size;
  }
  if (offset > LIMIT) throw new ZipTooLargeError();

  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  onProgress?.(1);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
