// @exposure authenticated
// GET/HEAD /api/map-assets/:packId — one byte range of an installed PMTiles
// pack (BI-814F86E1). Pack ids only; see lib/twin/map-assets.server.ts. Web
// session or the phone's bearer token (BI-3DAE2169).

import { hasMapAssetAccess } from "@/lib/twin/map-asset-access.server";
import { handleMapPackRequest } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ packId: string }> };

async function serve(request: Request, context: RouteContext, method: "GET" | "HEAD") {
  const [{ packId }, authenticated] = await Promise.all([context.params, hasMapAssetAccess(request)]);
  return handleMapPackRequest(
    { method, rangeHeader: request.headers.get("range"), authenticated },
    packId,
  );
}

export const GET = (request: Request, context: RouteContext) => serve(request, context, "GET");
export const HEAD = (request: Request, context: RouteContext) => serve(request, context, "HEAD");
