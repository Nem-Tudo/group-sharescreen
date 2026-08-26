import { NextResponse, type NextRequest } from "next/server";

const UMAMI_URL = process.env.UMAMI_URL;

// Only allow proxying these specific paths to prevent abuse.
const ALLOWED_PATHS = new Set(["script.js", "api/send"]);

async function proxy(request: NextRequest, path: string[]) {
  if (!UMAMI_URL) {
    return NextResponse.json({ error: "Umami proxy not configured" }, { status: 404 });
  }

  const joinedPath = path.join("/");
  if (!ALLOWED_PATHS.has(joinedPath)) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
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
