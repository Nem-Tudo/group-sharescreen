import { NextResponse, type NextRequest } from "next/server";
import { translate } from "@/lib/i18n";

const UMAMI_URL = process.env.UMAMI_URL;

// Proxies every request under /api/umami/* to the real Umami server so the
// tracker script and its collect requests are same-origin with the app
// (avoids ad blockers and third-party-cookie restrictions targeting
// analytics domains). The tracker computes its collect endpoint relative to
// its own script src, so serving it from here also routes /api/umami/api/send
// through this same handler automatically.
async function proxy(request: NextRequest, path: string[]) {
  if (!UMAMI_URL) {
    return NextResponse.json({ error: translate("api.umami.route.umamiProxyNotConfigured") }, { status: 404 });
  }

  const base = UMAMI_URL.endsWith("/") ? UMAMI_URL : `${UMAMI_URL}/`;
  const target = new URL(path.join("/"), base);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  const responseHeaders = new Headers(upstream.headers);
  // The upstream body below is already decompressed by fetch, so forwarding
  // these would make the client try to decode plain content as gzip/br.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxy(request, path);
}
