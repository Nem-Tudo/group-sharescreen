import { NextResponse, type NextRequest } from "next/server";
import {
  isRestorablePath,
  LAST_SCREEN_COOKIE,
  LAST_SCREEN_SESSION_COOKIE,
} from "@/lib/lastScreenInit";

// Reopening the app on its last screen, decided before the home page is sent.
//
// The shells (Android, iOS, desktop) always load "/". The site used to answer
// with the whole home page, which then read the saved screen and replaced
// itself with it (LAST_SCREEN_INIT_SCRIPT) — two documents, the first one
// downloaded only to be thrown away: about a second on a phone. The saved
// screen is also a cookie now (see lib/lastScreen's write), so the first
// request is answered with a redirect straight to it.
//
// Only "/", and only for what is a launch:
// - the cookie exists only in an app shell, and only while "reopen the last
//   screen" is on;
// - no LAST_SCREEN_SESSION_COOKIE: every page of a running app sets it, and it
//   dies with the app's process;
// - a document load with no referrer and no query — a link to "/" from inside
//   the site, a client-side navigation or a prefetch is never a launch.
// Anything that misses here still has the inline script as before.

export function proxy(request: NextRequest) {
  if (request.method !== "GET" || request.nextUrl.search) return;
  const headers = request.headers;
  if (headers.get("rsc") || headers.get("next-router-prefetch") || headers.get("purpose") === "prefetch") return;
  const dest = headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return;
  if (headers.get("referer")) return;
  if (request.cookies.has(LAST_SCREEN_SESSION_COOKIE)) return;

  const raw = request.cookies.get(LAST_SCREEN_COOKIE)?.value;
  if (!raw) return;
  let saved: string;
  try {
    saved = decodeURIComponent(raw);
  } catch {
    return;
  }
  if (!isRestorablePath(saved)) return;
  // Normalised against a throwaway origin: what goes out is a path on this
  // site and nothing else.
  let target: URL;
  try {
    target = new URL(saved, "http://golive.invalid");
  } catch {
    return;
  }
  if (target.origin !== "http://golive.invalid" || !isRestorablePath(target.pathname)) return;

  // Built on request.nextUrl, the address as the browser asked for it: Next
  // wants an absolute Location here, and writes a same-origin one back out as
  // a relative path.
  const destination = request.nextUrl.clone();
  destination.pathname = target.pathname;
  destination.search = target.search;
  destination.hash = target.hash;
  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(LAST_SCREEN_SESSION_COOKIE, "1", { path: "/", sameSite: "lax" });
  return response;
}

export const config = {
  matcher: "/",
};
