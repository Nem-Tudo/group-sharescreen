import { decodeAvatarCode, renderAvatarSvg } from "@/lib/avatarBuilder";

// The picture behind a built avatar's path (see lib/avatarBuilder).
//
// A PNG rather than the SVG directly because this URL goes everywhere an
// avatar goes, and not all of those are browsers: Android's notification
// avatars, for one, cannot decode an SVG. If sharp is not available on this
// build (it comes with Next as an optional dependency) the SVG is sent under
// the same path, which every <img> still draws.
//
// The code is the whole picture, so an answer never changes and is cached for
// good. The few kept here spare the renderer a burst of the same face, like a
// room full of people joining at once with a cold CDN.

type Rendered = { body: Uint8Array<ArrayBuffer>; contentType: string };

const MAX_KEPT = 500;
const kept = new Map<string, Rendered>();

async function rasterize(svg: string): Promise<Rendered> {
  try {
    const { default: sharp } = await import("sharp");
    const png = await sharp(Buffer.from(svg)).png({ palette: true, quality: 90 }).toBuffer();
    return { body: new Uint8Array(png), contentType: "image/png" };
  } catch (err) {
    console.error("[avatar] Could not rasterize, sending the SVG:", err);
    return { body: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: file } = await params;
  const code = file.endsWith(".png") ? file.slice(0, -".png".length) : "";
  const config = decodeAvatarCode(code);
  if (!config) return new Response(null, { status: 404 });

  let rendered = kept.get(code);
  if (!rendered) {
    rendered = await rasterize(renderAvatarSvg(config));
    if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value as string);
    kept.set(code, rendered);
  }

  return new Response(rendered.body, {
    headers: {
      "Content-Type": rendered.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
