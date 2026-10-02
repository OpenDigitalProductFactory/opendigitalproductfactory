// @exposure authenticated
// GET /api/map-assets — the valid installed map packs, so a client can pick one
// covering its scene (BI-814F86E1). Manifests only; never a file path.

import { auth } from "@/lib/auth";
import { listInstalledMapPacks } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ packs: await listInstalledMapPacks() });
}
