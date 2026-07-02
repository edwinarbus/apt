/**
 * Same-origin proxy for the public terrarium elevation tiles.
 *
 * The map lifts a neighborhood by reading elevation pixels back from a canvas
 * and re-encoding them with a boost — which requires the tile bytes to be
 * readable. The upstream terrarium bucket sends NO `Access-Control-Allow-Origin`
 * header, so a direct browser fetch is CORS-blocked (and the lift silently
 * fails). Fetching through this route makes it same-origin: the browser never
 * makes a cross-origin request, and the canvas is never tainted.
 */

const UPSTREAM = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tile: string[] }> },
) {
  const { tile } = await params;
  const [z, x, yRaw] = tile;
  const y = (yRaw ?? "").replace(/\.png$/, "");
  // Validate as tile integers before building the upstream URL (no SSRF).
  // z ≤ 13 (1–2 digits); x/y up to 2^13-1 = 8191 (up to 4 digits).
  if (![z, x, y].every((v) => /^\d{1,5}$/.test(v))) {
    return new Response("bad tile", { status: 400 });
  }

  try {
    const res = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
      // Long-lived, immutable terrain — let the CDN/browser cache hard.
      cache: "force-cache",
    });
    if (!res.ok) return new Response("tile unavailable", { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
}
