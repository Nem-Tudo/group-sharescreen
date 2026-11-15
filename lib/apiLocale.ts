// Tells the API which language to answer in, so its error messages ("This
// group is full.", "Wrong code.") reach people in the site's language rather
// than the server's English. The API translates on the way out — see
// sharescreen-api/server/apiLocale.ts — and falls back to English.
//
// HTTP: every fetch to the API gets `Accept-Language: <locale>` unless the
// caller set one. Done once by wrapping window.fetch, because API calls are
// spread over dozens of files with no shared wrapper. Accept-Language is a
// CORS-safelisted header, so this adds no preflight. It carries the language
// picked in the site, which can differ from the browser's own list.
//
// WebSocket: browsers can't set headers there, so the URL carries `?lang=`
// (withLocaleParam, used by signalingClient).

import { getRequestLocale } from "@/lib/i18n";
import { getSignalingHttpBase } from "@/lib/roomsApi";

let installed = false;
let apiOrigin: string | null = null;

function getApiOrigin(): string | null {
  if (apiOrigin === null) {
    try {
      apiOrigin = new URL(getSignalingHttpBase()).origin;
    } catch {
      apiOrigin = "";
    }
  }
  return apiOrigin || null;
}

function requestUrl(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.href).href;
    if (input instanceof URL) return input.href;
    return input.url;
  } catch {
    return null;
  }
}

/** Wraps window.fetch once. Safe to call more than once. */
export function installApiLocale(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const origin = getApiOrigin();
      const url = origin ? requestUrl(input) : null;
      if (origin && url && url.startsWith(origin + "/")) {
        const headers = new Headers(
          init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined)
        );
        if (!headers.has("accept-language")) {
          headers.set("accept-language", getRequestLocale());
          return original(input, { ...init, headers });
        }
      }
    } catch {
      // Anything odd about the request: send it exactly as it was.
    }
    return original(input, init);
  };
}

/** The WebSocket URL with `lang=<locale>` added. */
export function withLocaleParam(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    url.searchParams.set("lang", getRequestLocale());
    return url.toString();
  } catch {
    return wsUrl;
  }
}
