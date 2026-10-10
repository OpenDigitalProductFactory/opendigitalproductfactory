// @exposure authenticated
// GET /api/map-assets/recommendation — which street-map regions this business
// needs and whether installed packs cover them (BI-C318C227 §2.3). Read-only;
// tooling that fetches packs consumes it, so the operator never picks a region.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadMapRegionRecommendation } from "@/lib/twin/map-region-recommendation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(await loadMapRegionRecommendation());
}
