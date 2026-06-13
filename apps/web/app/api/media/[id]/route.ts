// GET /api/media/:id — stream a stored image asset.
//
// Assets are addressed by an unguessable cuid (a capability URL) and storefront
// imagery is public by design, so this serves `ready` image assets without a
// session; the content-addressed bytes are immutable, hence the long, immutable
// cache. A `?w=` width hint is accepted for forward-compatibility with Phase-2
// responsive renditions; today it is ignored and the original is served.
// Tightening to published-storefront scope is tracked in the Phase-2 plan.

import { prisma } from "@dpf/db";
import { getMediaStorageDriver } from "@/lib/media";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { storageKey: true, storageDriver: true, mimeType: true, status: true, kind: true },
  });
  if (!asset || asset.status !== "ready" || asset.kind !== "image") {
    return new Response("Not found", { status: 404 });
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
