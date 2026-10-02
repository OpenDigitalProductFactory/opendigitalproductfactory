// GET/HEAD /api/map-assets/:packId — one byte range of an installed PMTiles
// pack (BI-814F86E1). Pack ids only; see lib/twin/map-assets.server.ts.

import { auth } from "@/lib/auth";
import { handleMapPackRequest } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ packId: string }> };

async function serve(request: Request, context: RouteContext, method: "GET" | "HEAD") {
  const [{ packId }, session] = await Promise.all([context.params, auth()]);
  return handleMapPackRequest(
    { method, rangeHeader: request.headers.get("range"), authenticated: Boolean(session?.user) },
    packId,
  );
}

export const GET = (request: Request, context: RouteContext) => serve(request, context, "GET");
export const HEAD = (request: Request, context: RouteContext) => serve(request, context, "HEAD");
