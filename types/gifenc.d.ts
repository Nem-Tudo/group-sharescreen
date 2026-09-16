// gifenc ships no types. Only the three entry points this project uses are
// declared — see node_modules/gifenc/README.md for the rest of the API.
declare module "gifenc" {
  /** RGB or RGBA entries, depending on the format the caller asked for. */
  export type GifPalette = number[][];

  export type GifQuantizeOptions = {
    format?: "rgb565" | "rgb444" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  };

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: GifQuantizeOptions
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444"
  ): Uint8Array;

  export type GifFrameOptions = {
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Milliseconds. */
    delay?: number;
    /** 0 forever, -1 once, otherwise the repeat count. */
    repeat?: number;
    dispose?: number;
  };

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  };
}
