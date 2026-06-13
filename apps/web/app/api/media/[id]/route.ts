// GET /api/media/:id — stream a stored image asset.
//
// Assets are addressed by an unguessable cuid (a capability URL) and storefront
// imagery is public by design, so this serves `ready` image assets without a
// session; the content-addressed bytes are immutable, hence the long, immutable
// cache. `?w=` requests a width-constrained webp rendition (resized + cached with
// sharp when present); if rendition generation is unavailable it transparently
// falls back to the original. Tightening to published-storefront scope is tracked
// in the Phase-2 plan.

import { prisma } from "@dpf/db";
import { getMediaStorageDriver, getRendition } from "@/lib/media";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      sha256: true,
      storageKey: true,
      storageDriver: true,
      mimeType: true,
      status: true,
      kind: true,
    },
  });
  if (!asset || asset.status !== "ready" || asset.kind !== "image") {
    return new Response("Not found", { status: 404 });
  }

  const widthParam = new URL(request.url).searchParams.get("w");
  const width = widthParam ? Number.parseInt(widthParam, 10) : null;

  // Try a width-constrained rendition first; null means "serve the original".
  if (width) {
    const rendition = await getRendition({
      sha256: asset.sha256,
      storageKey: asset.storageKey,
      storageDriver: asset.storageDriver,
      width,
    });
    if (rendition) {
      return new Response(new Uint8Array(rendition.bytes), {
        status: 200,
        headers: {
          "Content-Type": rendition.mimeType,
          "Content-Length": String(rendition.bytes.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  let bytes: Buffer;
  try {
    bytes = await getMediaStorageDriver(asset.storageDriver).get(asset.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
