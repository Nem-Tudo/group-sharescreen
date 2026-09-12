// Builds the desktop shell's four entrypoints.
//
// esbuild rather than plain `tsc` for one specific reason, learned the hard
// way: a preload script running with `sandbox: true` gets a *crippled*
// `require` that can only resolve "electron" and a couple of Node builtins —
// a relative `require("./channels")` throws "module not found" at load time,
// the preload never runs, and the bridge silently never appears in the
// renderer. Bundling each entrypoint into one self-contained file is the
// standard answer, and it is why channels.ts can stay a shared module
// instead of having its constants copy-pasted into both preloads.
//
// Type checking is not esbuild's job and it does none — `npm run
// electron:typecheck` runs tsc over the same sources for that.

import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "dist");

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: [
    path.join(here, "main.ts"),
    path.join(here, "preload.ts"),
    path.join(here, "picker-preload.ts"),
    path.join(here, "call-overlay-preload.ts"),
    path.join(here, "toast-preload.ts"),
  ],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  // Electron 38 ships Node 22.
  target: "node22",
  sourcemap: true,
  // Provided by the runtime, never bundled — pulling Electron's own module
  // into the output would produce a file that cannot load at all.
  external: ["electron"],
});
