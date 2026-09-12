import { NextResponse, type NextRequest } from "next/server";
import {
  detectDownloadPlatform,
  findReleaseAsset,
  parseDownloadPlatform,
  type ReleaseAsset,
} from "@/lib/downloadTargets";
import { translate } from "@/lib/i18n";

// Sends the visitor straight to the newest installer for whatever they are
// running, so a single link — golive.nemtudo.me/download — can be shared
// anywhere and never goes stale.
//
// The asset list is read from GitHub Releases (where electron-builder
// publishes, see electron-builder.yml) rather than hardcoded, which is what
// makes "latest" mean latest without anyone editing this file on every
// release. Filenames keep their version — they are what the user ends up
// with on disk, and a downloads folder full of identically-named installers
// is its own small cruelty — so the version is resolved at request time
// instead of being pinned into a URL.
//
// Which platform gets which file lives in lib/downloadTargets.ts, where it
// can be tested.

const GITHUB_OWNER = translate("download.route.nemTudo");
const GITHUB_REPO = "group-sharescreen";

const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// GitHub's unauthenticated API allows 60 requests an hour *per IP* — which
// here is the server's, shared by every visitor. Caching the release list
// turns any amount of traffic into at most one call per window, and the data
// changes only when a release is cut, so this is generous rather than tight.
const CACHE_SECONDS = 600;

type LatestRelease = { tag_name?: string; assets?: ReleaseAsset[] };

export async function GET(request: NextRequest) {
  // An explicit ?platform= always wins over sniffing: it is what a "baixar
  // para macOS" link on a Windows machine needs, and it is how someone whose
  // user agent we read wrong can still get the right file.
  const requested = parseDownloadPlatform(request.nextUrl.searchParams.get("platform"));
  const platform = requested ?? detectDownloadPlatform(request.headers.get("user-agent") ?? "");

  // A phone, or something unrecognised. The releases page lists every asset,
  // which is a far better answer than guessing and being wrong.
  if (!platform) return redirectToReleases();

  let release: LatestRelease | null = null;
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub rejects API requests without one.
        "User-Agent": `${GITHUB_REPO}-download-route`,
      },
      next: { revalidate: CACHE_SECONDS },
    });
    if (res.ok) release = (await res.json()) as LatestRelease;
  } catch {
    // Network trouble, or GitHub being slow. Falls through to the releases
    // page below — the one thing this route must never do is fail closed
    // with an error page when a perfectly good download is one hop away.
  }

  const asset = findReleaseAsset(release?.assets, platform);
  // No release yet, rate-limited, or this platform's build simply is not in
  // the newest release: the releases page is always a correct answer.
  if (!asset) return redirectToReleases();

  return noStore(NextResponse.redirect(asset.browser_download_url, 302));
}

function redirectToReleases() {
  return noStore(NextResponse.redirect(RELEASES_PAGE, 302));
}

// Browsers and CDNs must not remember this redirect: its target changes with
// every release, and a cached one would keep handing out the old installer
// long after it stopped being the latest — which is the entire thing this
// route exists to prevent. Applied to the fallback too, or a visit made
// before the first release would pin someone to the releases page forever.
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}
