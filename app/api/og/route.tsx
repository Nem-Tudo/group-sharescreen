import { ImageResponse } from "next/og";
import { translate } from "@/lib/i18n";

// The picture on a shared link, drawn per page.
//
// One route rather than a file-convention `opengraph-image.tsx` per segment,
// and that is a decision this codebase already paid for once: the root layout
// sets `openGraph.images` explicitly, and a segment that *also* emits one
// through the file convention ends up advertising two pictures on the same
// link with the crawler picking (see the note in app/layout.tsx, where a
// generated route was deleted for exactly that). A plain endpoint that pages
// point at leaves one image per page, named by whoever named it.
//
// Everything is drawn rather than composited from assets: no font is loaded,
// no logo file is fetched. That keeps the route dependency-free — it cannot
// fail because a font CDN is slow while a crawler is waiting — at the cost of
// using whatever the renderer's default face is, which for a card that is 90%
// one line of large text is a trade worth making.

export const runtime = "nodejs";

/** How wide and tall every crawler expects this to be. */
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * The accent each kind of page is drawn in.
 *
 * Colour is the only thing that varies between them, on purpose: a shared link
 * is recognised in a chat by its *shape*, and a card that rearranges itself per
 * page would stop reading as "this is GoLive" at a glance. The stripe says
 * which part of it.
 */
const TONES: Record<string, { from: string; to: string; label: string }> = {
  // The site's own red, the one the icon and every Discord embed already use.
  default: { from: "#f43f5e", to: "#e11d48", get label() { return translate("common.golive"); } },
  room: { from: "#38bdf8", to: "#6366f1", get label() { return translate("api.og.route.liveRoom"); } },
  gift: { from: "#34d399", to: "#059669", get label() { return translate("common.gift"); } },
  pro: { from: "#60a5fa", to: "#2563eb", get label() { return translate("common.golivePro"); } },
  max: { from: "#fbbf24", to: "#f59e0b", get label() { return translate("common.goliveProMax"); } },
  theme: { from: "#a78bfa", to: "#7c3aed", get label() { return translate("common.themes"); } },
};

/** Long titles shrink rather than wrap into four lines nobody reads. */
function titleSize(title: string): number {
  if (title.length > 64) return 54;
  if (title.length > 40) return 66;
  return 80;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  // Clamped, because these arrive on a public URL and the only thing stopping
  // a novel from being rendered into a 1200-pixel card is this line.
  const title = (params.get("title") || translate("common.golive")).slice(0, 90);
  const subtitle = (params.get("subtitle") || "").slice(0, 140);
  const tone = TONES[params.get("tone") || "default"] ?? TONES.default;
  const badge = (params.get("badge") || tone.label).slice(0, 40);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          // The same page colour the app's dark theme paints (see
          // globals.css), so a card and the site it links to are the same
          // colour rather than two shades of nearly-black.
          backgroundColor: "#101014",
          padding: "72px 80px",
        }}
      >
        {/* The stripe: the one element that changes per kind. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 14,
            backgroundImage: `linear-gradient(90deg, ${tone.from}, ${tone.to})`,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundImage: `linear-gradient(135deg, ${tone.from}, ${tone.to})`,
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 600,
              color: "#e9e9ec",
              letterSpacing: -0.5,
            }}
          >
            {badge}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: titleSize(title),
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
              letterSpacing: -2,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                color: "#a1a1aa",
                lineHeight: 1.35,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 26,
            color: "#71717a",
          }}
        >
          golive.nemtudo.me
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );
}
