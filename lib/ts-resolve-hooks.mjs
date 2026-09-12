import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// The project root, which is what "@/*" resolves to (see tsconfig's paths).
// This file lives in lib/, so the root is one level up.
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".json"];

/** Tries `base` as-is, then with each extension, and returns the first hit. */
function firstExisting(baseUrl) {
  if (existsSync(fileURLToPath(baseUrl))) return baseUrl;
  for (const ext of EXTENSIONS) {
    const candidate = new URL(baseUrl.href + ext);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

// Node insists on `with { type: "json" }`; the bundler the app is built with
// does not use it and would choke on it. The tests are the only place both
// have to agree, so the attribute is added here rather than in the source.
function withJsonAttribute(url, context, nextResolve) {
  if (!url.endsWith(".json")) return nextResolve(url, context);
  return {
    url,
    format: "json",
    importAttributes: { type: "json" },
    shortCircuit: true,
  };
}

export async function resolve(specifier, context, nextResolve) {
  // "@/lib/i18n" and friends. Node knows nothing about tsconfig paths, and
  // lib/ now imports the translation catalog that way, same as the rest of
  // the app does.
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(path.join(ROOT, specifier.slice(2)));
    const hit = firstExisting(target);
    if (hit) return withJsonAttribute(hit.href, context, nextResolve);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Only rewrite relative specifiers that simply lack an extension.
    if (!specifier.startsWith(".") || /\.[a-z]+$/i.test(specifier)) throw err;
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const base = new URL(specifier, pathToFileURL(parentPath));
    for (const ext of [".ts", ".tsx", ".mts"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    throw err;
  }
}
