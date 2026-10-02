// @exposure authenticated
// GET /api/v1/map/customer-sites — the customer-sites map scene for the phone
// (BI-3DAE2169): placements, service areas, the not-on-the-map count and the
// installed pack covering them. Needs view_customer, like the web customer map.

import { NextResponse } from "next/server";

import { authenticateRequest, requireCapability } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { loadCustomerMap } from "@/lib/crm/customer-map.server";
import { buildCustomerSitesMapPayload } from "@/lib/crm/customer-map-api";
import { listInstalledMapPacks } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { capabilities } = await authenticateRequest(request);
    requireCapability(capabilities, "view_customer");
    const [map, packs] = await Promise.all([loadCustomerMap(), listInstalledMapPacks()]);
    return apiSuccess(
      buildCustomerSitesMapPayload(
        map,
        packs.map((pack) => ({ packId: pack.packId, attribution: pack.attribution, bounds: pack.bounds })),
      ),
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
