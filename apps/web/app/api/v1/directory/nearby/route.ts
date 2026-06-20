// GET /api/v1/directory/nearby?lat=…&lng=…&radiusKm=… — geo-discovery stub.
//
// Public (unauthenticated) endpoint that lets a mobile customer's "Nearby"
// surface discover the install IF its own seeded lat/long falls inside the
// query radius. This is the single-install path that validates the
// contract; the hosted federation directory across many installs (Town M5)
// is a separate epic and reuses this exact wire shape.
//
// PUBLIC_URL must be configured for the result row's `url` field to be a
// reachable target; when it isn't, the row is omitted so the client never
// sees an unreachable install in the results.
//
// Plan: docs/superpowers/plans/2026-06-18-ios-app-end-to-end-support.md (Slice 6).

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { apiSuccess } from "@/lib/api/response";
import {
  clampRadiusKm,
  extractOrgLatLng,
  haversineKm,
  parseQueryPoint,
  roundKm,
} from "@/lib/api/nearby-geo";
import type { NearbyInstance, NearbyResponse } from "@dpf/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = parseQueryPoint(url.searchParams);
    if (!query) {
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message:
            "Required query params: lat (-90..90), lng (-180..180). Optional: radiusKm.",
        },
        { status: 422 },
      );
    }
    const radiusKm = clampRadiusKm(
      url.searchParams.get("radiusKm")
        ? Number(url.searchParams.get("radiusKm"))
        : undefined,
    );

    const publicUrl =
      process.env.PUBLIC_URL?.trim() && process.env.PUBLIC_URL.trim().length > 0
        ? process.env.PUBLIC_URL.trim()
        : null;

    const org = await prisma.organization.findFirst({
      select: { orgId: true, name: true, address: true, industry: true },
    });
    const storefront = await prisma.storefrontConfig.findFirst({
      select: { archetypeId: true },
    });

    const results: NearbyInstance[] = [];

    const orgPoint = org ? extractOrgLatLng(org.address) : null;
    const distanceKm = haversineKm(query, orgPoint);

    if (publicUrl && org && orgPoint && distanceKm <= radiusKm) {
      const row: NearbyInstance = {
        instanceId: org.orgId,
        orgName: org.name,
        url: publicUrl,
        distanceKm: roundKm(distanceKm),
      };
      if (storefront?.archetypeId) row.archetype = storefront.archetypeId;
      // Locality is best-effort — only populate from the address blob; never
      // synthesize a label that misrepresents where the install actually is.
      if (
        org.address &&
        typeof org.address === "object" &&
        !Array.isArray(org.address)
      ) {
        const addr = org.address as Record<string, unknown>;
        const locality = [addr.city, addr.region]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(", ");
        if (locality) row.locality = locality;
      }
      results.push(row);
    }

    return apiSuccess<NearbyResponse>({ results });
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
