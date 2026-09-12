import { NextResponse, type NextRequest } from "next/server";
import { translate } from "@/lib/i18n";

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_BASE_URL = "https://api.giphy.com/v1/gifs";
const RESULT_LIMIT = 24;
const QUERY_MAX_LEN = 100;

type GiphyImage = { url: string; width: string; height: string };
type GiphyGif = {
  id: string;
  title: string;
  images: {
    fixed_height: GiphyImage;
    fixed_height_small: GiphyImage;
  };
};

export type GifResult = {
  id: string;
  title: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  url: string;
  width: number;
  height: number;
};

// Proxies GIF search (and, for an empty query, trending) to the Giphy API
// so the key stays server-side (see .env.example) instead of shipping in
// the client bundle, and trims the response down to just what the picker
// needs — Giphy's raw payload carries a dozen renditions per GIF we don't
// use.
export async function GET(request: NextRequest) {
  if (!GIPHY_API_KEY) {
    return NextResponse.json({ error: translate("api.giphy.search.route.gifSearchNotConfigured") }, { status: 404 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, QUERY_MAX_LEN);

  const upstream = new URL(query ? `${GIPHY_BASE_URL}/search` : `${GIPHY_BASE_URL}/trending`);
  upstream.searchParams.set("api_key", GIPHY_API_KEY);
  upstream.searchParams.set("limit", String(RESULT_LIMIT));
  upstream.searchParams.set("rating", "pg-13");
  if (query) upstream.searchParams.set("q", query);

  let response: Response;
  try {
    response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
  } catch {
    return NextResponse.json({ error: translate("api.giphy.search.route.gifSearchUnavailable") }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: translate("api.giphy.search.route.gifSearchUnavailable") }, { status: 502 });
  }

  const body = (await response.json()) as { data?: GiphyGif[] };
  const results: GifResult[] = (body.data ?? [])
    .filter((gif) => gif.images?.fixed_height?.url && gif.images?.fixed_height_small?.url)
    .map((gif) => ({
      id: gif.id,
      title: gif.title || "GIF",
      previewUrl: gif.images.fixed_height_small.url,
      previewWidth: Number(gif.images.fixed_height_small.width) || 100,
      previewHeight: Number(gif.images.fixed_height_small.height) || 100,
      url: gif.images.fixed_height.url,
      width: Number(gif.images.fixed_height.width) || 200,
      height: Number(gif.images.fixed_height.height) || 200,
    }));

  return NextResponse.json({ results });
}
