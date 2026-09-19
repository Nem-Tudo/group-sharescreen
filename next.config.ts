import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Which build of the site a browser is running, reported to the signaling
// server on register and counted there as sharescreen_clients_by_version
// (see lib/buildVersion.ts and the API's metrics.ts).
//
// `<versão do package>.<número do build>.<commit>`, e.g. "0.1.17.842.e6681e8".
// The build number is how many commits the history has up to this one (`git
// rev-list --count HEAD`), so it goes up by one with every commit on its own
// and, unlike the hash, says at a glance which of two builds is newer. The
// other two parts answer different questions and neither is enough alone: package.json's version
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

// Same sourcing as the commit: CI passes it in (the deploy uploads files, not
// a checkout, so the build machine has no history to count), and a local build
// counts its own checkout.
function resolveBuildNumber(): string {
  const provided = process.env.NEXT_PUBLIC_BUILD_NUMBER?.trim();
  if (provided && /^\d+$/.test(provided)) return provided;
  try {
    return execSync("git rev-list --count HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "0";
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
const BUILD_COMMIT = resolveBuildCommit();

// The commit shortened to git's usual 7: CI hands over the full 40-character
// sha, which would crowd the rest out of the 32-character cap below.
const BUILD_VERSION = `${resolvePackageVersion()}.${resolveBuildNumber()}.${BUILD_COMMIT.slice(0, 7)}`
  .replace(/[^A-Za-z0-9._-]/g, "-")
  .slice(0, 32);

// Which build this is, as Next itself sees it — one answer for every instance
// built from the same commit.
//
// Production is two apps behind a load balancer (see .github/workflows/
// deploy.yml), and each runs its own `next build`. Left to itself Next mints a
// random build id per build, so the two disagreed, and a client-side
// navigation answered by the *other* instance looked to the router like a
// server from a different deploy. Its answer to that is a full page reload
// (see next/dist/client/components/router-reducer/fetch-server-response.js),
// and a reload is the one thing a call cannot survive: it is what dropped
// people out of a call carried around the site (see components/RoomCallHost)
// on a coin flip of which instance answered, and what made "back to the call"
// rejoin it from scratch.
//
// Only when the commit is actually known. A build that could not tell
// ("unknown") keeps Next's random id: pinning every such build to the same
// value would make two genuinely different deploys look identical, and hide
// the skew Next is right to reload for.
const STABLE_BUILD_ID =
  BUILD_COMMIT !== "unknown" ? BUILD_COMMIT.replace(/[^A-Za-z0-9_-]/g, "-") : null;

// The API, derived from the signaling URL like lib/roomsApi does — one
// variable for what is really one server.
const API_BASE = (process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws")
  .replace(/^ws/, "http")
  .replace(/\/ws\/?$/, "");

// Where the developer portal app actually runs — reached by the rewrite below,
// never by the browser. Server-side only, read at build time.
const DEVELOPERS_ORIGIN = (
  process.env.DEVELOPERS_ORIGIN || "https://golive-developers.nemtudo.me"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(STABLE_BUILD_ID
    ? {
        generateBuildId: async () => STABLE_BUILD_ID,
        // What the router actually compares on navigation when it is set (see
        // deploymentId in the Next docs), so it has to agree across instances
        // just the same.
        deploymentId: STABLE_BUILD_ID,
      }
    : {}),
  // Memoizes components and hook results automatically, which this app had
  // none of by hand — a single chat message used to re-render the whole watch
  // room because its state comes from one big useSyncExternalStore snapshot.
  // The compiler cannot fix that subscription (see lib/useSignalingSelector),
  // but it does make the subtrees that did not actually change bail out.
  reactCompiler: false,
  experimental: {
    // The Rust port runs natively inside Turbopack instead of through Babel
    // in Node, which is both faster and the reason there is no
    // babel-plugin-react-compiler in package.json: this build does not need
    // it. Requires Next >= 16.3 and Turbopack (the default here).
    turbopackRustReactCompiler: false,
  },
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
    remotePatterns: [{ protocol: "https", hostname: "cdn.nemtudo.me" },{ protocol: "https", hostname: "public-blob.squarecloud.dev" }],
  },
  async rewrites() {
    return [
      // The developer portal (its own repo, sharescreen-developers, deployed
      // as its own app with basePath "/developers"). Served from this origin
      // rather than its own domain so it shares this site's localStorage —
      // whoever is signed in here is signed in there, no second login. The
      // basePath keeps its /developers/_next assets apart from ours.
      {
        source: "/developers",
        destination: `${DEVELOPERS_ORIGIN}/developers`,
      },
      {
        source: "/developers/:path*",
        destination: `${DEVELOPERS_ORIGIN}/developers/:path*`,
      },
      // OpenID Connect discovery. This site is the issuer (see app/api/
      // oidc-configuration), and the specification requires the document to
      // sit at exactly this path under it.
      //
      // A rewrite onto a normal route rather than an app/.well-known folder:
      // a directory whose name starts with a dot is not something to rely on
      // the file-system router picking up, and this keeps the served URL
      // exact either way.
      {
        source: "/.well-known/openid-configuration",
        destination: "/api/oidc-configuration",
      },
    ];
  },
  async redirects() {
    return [
      // The routes these replaced were Portuguese, and they were renamed once
      // the site stopped being a Portuguese-only site (see locales/). They are
      // kept here because the old ones are not only bookmarks: /tema/<id> is
      // the link a theme's author shares, /anuncio/<token> is the report link
      // handed to an advertiser, and /termos is linked from other people's
      // pages. A 308 keeps every one of those working and tells a crawler the
      // new address is the real one.
      //
      // The deeper path goes first. A `:param` never matches across a slash,
      // so /tema/:id could not swallow /tema/:id/painel anyway — but the two
      // read as a pair, and the order is what makes that obvious to whoever
      // adds the third.
      // The other half of OpenID Connect discovery. The document above points
      // `jwks_uri` at the API, which is where the key actually is — this is
      // only for whoever guesses that it sits next to the configuration.
      {
        source: "/.well-known/jwks.json",
        destination: `${API_BASE}/.well-known/jwks.json`,
        permanent: false,
      },
      { source: "/tema/:id/painel", destination: "/theme/:id/panel", permanent: true },
      { source: "/tema/:id", destination: "/theme/:id", permanent: true },
      { source: "/anuncio/:token", destination: "/ad/:token", permanent: true },
      { source: "/amigos", destination: "/friends", permanent: true },
      { source: "/termos", destination: "/terms", permanent: true },
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
      // The blog is its own app (golive-blog repos: a Sanity Studio and the
      // frontend). /blog/:path* rather than just /blog so a shared link to a
      // post on this domain lands on that post, not on the blog's front page.
      {
        source: "/blog/:path*",
        destination: "https://golive-blog.nemtudo.me/:path*",
        permanent: true,
      },
    ];
  },
};
//deploy 1
export default nextConfig;