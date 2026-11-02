// Builds public/workers/native-video-sink.js from lib/nativeVideoSink.worker.ts:
//
//   npm run workers:build
//
// Workers here are served from public/workers, where nothing compiles them, and
// this one shares its rules with what the tests cover (lib/nativeVideoSink.ts), so
// it is generated rather than written by hand. The output is committed, like the
// other workers, so that a deploy needs no extra step; lib/nativeVideoSink.test.mts
// fails when it is out of date. Bump SINK_WORKER_VERSION in lib/nativeVideoCapture.ts
// whenever it changes: a browser would go on using the one it has cached.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT = join(here, "..", "public", "workers", "native-video-sink.js");

const HEADER = `// Generated from lib/nativeVideoSink.worker.ts by "npm run workers:build". Do not edit.\n`;

/** The worker as it should be on disk. */
export async function buildSinkWorker() {
  const result = await build({
    entryPoints: [join(here, "nativeVideoSink.worker.ts")],
    bundle: true,
    format: "iife",
    target: "chrome94",
    write: false,
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  return HEADER + result.outputFiles[0].text;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUTPUT, await buildSinkWorker());
  console.log(`wrote ${OUTPUT}`);
}
