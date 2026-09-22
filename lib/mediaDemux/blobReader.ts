// Random access into a File without loading it: Blob.slice is lazy, so a
// 20 GB film costs only the bytes asked for. Reads go through a small block
// cache, because both demuxers read in many small steps (an element header
// here, a block header there) that mostly land in the same megabyte.

const BLOCK = 1 << 20;
const MAX_BLOCKS = 12;

export class BlobReader {
  private blocks = new Map<number, Promise<Uint8Array>>();

  readonly blob: Blob;

  constructor(blob: Blob) {
    this.blob = blob;
  }

  get size(): number {
    return this.blob.size;
  }

  private block(index: number): Promise<Uint8Array> {
    const held = this.blocks.get(index);
    if (held) {
      // Most recently used goes to the back of the eviction order.
      this.blocks.delete(index);
      this.blocks.set(index, held);
      return held;
    }
    const start = index * BLOCK;
    const read = this.blob
      .slice(start, Math.min(start + BLOCK, this.blob.size))
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer));
    this.blocks.set(index, read);
    while (this.blocks.size > MAX_BLOCKS) {
      const oldest = this.blocks.keys().next().value as number;
      this.blocks.delete(oldest);
    }
    // A failed read must not stay cached as the answer for that block.
    read.catch(() => {
      if (this.blocks.get(index) === read) this.blocks.delete(index);
    });
    return read;
  }

  /** Up to `length` bytes from `offset` (fewer at the end of the file). */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(offset + length, this.blob.size);
    if (offset >= end) return new Uint8Array(0);
    // Big reads (an MP4 moov, a run of samples) go straight to the file
    // rather than through, and out of, the cache.
    if (end - offset > BLOCK * 2) {
      return new Uint8Array(await this.blob.slice(offset, end).arrayBuffer());
    }
    const first = Math.floor(offset / BLOCK);
    const last = Math.floor((end - 1) / BLOCK);
    if (first === last) {
      const block = await this.block(first);
      return block.subarray(offset - first * BLOCK, end - first * BLOCK);
    }
    const out = new Uint8Array(end - offset);
    let written = 0;
    for (let index = first; index <= last; index += 1) {
      const block = await this.block(index);
      const from = index === first ? offset - first * BLOCK : 0;
      const to = index === last ? end - last * BLOCK : block.length;
      out.set(block.subarray(from, to), written);
      written += to - from;
    }
    return out;
  }
}
