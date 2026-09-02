import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Which build of the site a browser is running, reported to the signaling
// server on register and counted there as sharescreen_clients_by_version
// (see lib/buildVersion.ts and the API's metrics.ts).
//
// `<versão do package>-<commit>`, e.g. "0.1.17-e6681e8". Each half answers a
// different question and neither is enough on its own: package.json's version
// says which release someone is on but only moves when a desktop release is
// cut, so every ordinary deploy between two releases would look identical —
// and the whole point of the metric is to see people still running the bundle
// from *before* the deploy that just went out. The commit moves with every
// commit, which is what makes "everyone is on the new one now" something you
// can watch happen; on its own, though, a bare hash tells you nothing about
// which release it belongs to.
function resolveBuildCommit(): string {
  // Docker needs the explicit one because .dockerignore excludes .git from
  // the build context (see the Dockerfile's build arg); `next build` and
  // `next dev` on a developer machine get git for free.
  const provided = process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim();
  if (provided) return provided;
  try {
    return execSync("git rev-parse --short HEAD", {
      // stderr silenced rather than inherited: outside a checkout this fails
      // every time, and a build log should not open with a git error for
      // something that has a perfectly good fallback.
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // A build from a tarball, or a container with no git. Says so rather than
    // guessing — an honest "unknown" half beats a hash that means nothing.
    return "unknown";
  }
}

function resolvePackageVersion(): string {
  try {
    // process.cwd() rather than a path relative to this file: Next always
    // evaluates the config with the project root as the working directory,
    // and that holds whether this file ends up loaded as ESM or CJS —
    // `import.meta.url` does not.
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Sanitised because it ends up as a Prometheus *label value* on the API (see
// its normalizeClientVersion, which rejects anything outside
// [A-Za-z0-9._-]). A prerelease like "0.2.0+build.5" would otherwise be
// dropped on the floor there and counted as "unknown" — better to send
// something the metric can actually hold.
const BUILD_VERSION = `${resolvePackageVersion()}-${resolveBuildCommit()}`
  .replace(/[^A-Za-z0-9._-]/g, "-")
  .slice(0, 32);

const nextConfig: NextConfig = {
  // Inlined into the bundle at build time, which is the only way this can be
  // right: the value describes the build, so resolving it at request time
  // would report whatever the *running container* happens to think rather
  // than what the browser actually downloaded.
  env: {
    NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION,
  },
  images: {
    // The Discord screenshots on /discord-bot live on the project's own CDN.
    // next/image refuses any remote host that is not declared here, so this
    // is what lets that page use it instead of a plain <img>.
    remotePatterns: [{ protocol: "https", hostname: "cdn.nemtudo.me" }],
  },
  async redirects() {
    return [
      {
        source: "/bot",
        destination: "https://discord.com/oauth2/authorize?client_id=1540460243270635600",
        permanent: true,
      },
      {
        source: "/stats",
        destination: "https://stats.nemtudo.me/public-dashboards/9be4846ec8774ff5888baa7d33862ccc",
        permanent: true,
      },
      {
        source: "/github",
        destination: "https://github.com/Nem-Tudo/group-sharescreen",
        permanent: true,
      },
    ];
  },
};
//deploy 1
export default nextConfig;