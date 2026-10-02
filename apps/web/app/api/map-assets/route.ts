// @exposure authenticated
// GET /api/map-assets — the valid installed map packs, so a client can pick one
// covering its scene (BI-814F86E1). Manifests only; never a file path. Web
// session or the phone's bearer token (BI-3DAE2169).

import { hasMapAssetAccess } from "@/lib/twin/map-asset-access.server";
import { listInstalledMapPacks } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await hasMapAssetAccess(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ packs: await listInstalledMapPacks() });
}
