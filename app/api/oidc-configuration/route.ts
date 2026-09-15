import { NextResponse } from "next/server";

// The OpenID Connect discovery document, served at
// /.well-known/openid-configuration (see the rewrite in next.config.ts, which
// is what maps that dotted path onto this route).
//
// This site is the *issuer*: "https://golive.nemtudo.me" is the address a
// developer configures in NextAuth or Keycloak, and OpenID Connect ties that
// to where discovery lives — the document has to be served at
// <issuer>/.well-known/openid-configuration and report that same issuer back,
// or a conforming client rejects it. The endpoints it lists stay on the API;
// an issuer names the provider, it does not locate it.
//
// Proxied rather than written out here, and that is the point: the document
// describes what the API can do — which scopes exist, which signing
// algorithm, which PKCE methods — and a second copy on this side would be a
// second thing to remember to change. The API writes it (see its
// GET /oauth2/openid-configuration); this hands it over under the URL that
// makes it valid.

/** The API, derived from the signaling URL the rest of the site already uses. */
function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";
  return configured.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}

// An hour, matching what the API says about its own copy. A client caches
// discovery and re-reads it rarely; this is not a hot path, and it must not
// be a stale one either.
export const revalidate = 3600;

export async function GET() {
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/oauth2/openid-configuration`, {
      next: { revalidate },
    });
  } catch {
    // The API being unreachable means the whole flow is down anyway. Saying
    // so with a 503 is better than serving a cached promise about endpoints
    // that are not answering.
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "The GoLive API is unreachable." },
      { status: 503 }
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "temporarily_unavailable",
        error_description: "Sign in with GoLive is not configured on this server.",
      },
      { status: 503 }
    );
  }
  const document = (await upstream.json()) as Record<string, unknown>;
  return NextResponse.json(document, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      // Discovery is meant to be read by other origins' JavaScript too — a
      // browser-side OIDC client fetches it directly.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
