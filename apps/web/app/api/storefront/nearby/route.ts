// GET /api/storefront/nearby?lat=&lng=
//
// Public, anonymous geo-discovery for the walk-up consumer front door (first
// cut). Surfaces the businesses near the caller so a visitor with no account
// can find them and browse. Mounted under /api/storefront/* so it inherits the
// PublicApi route class (no auth). Spec: docs/superpowers/specs/2026-08-05-
// viral-walkup-consumer-front-door-design.md (BI-9FEB61B8).
//
// First cut: answers from the LOCAL install only (single-org-per-install). The
// hosted multi-install geo directory (Town M5) is the follow-on. A business
// that published coordinates in Organization.address is returned with a
// distance; one that didn't is still surfaced (distanceMeters: null) so the
// flow is demonstrable on any install.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { apiSuccess } from "@/lib/api/response";
import { getPublicStorefront } from "@/lib/storefront/storefront-data";
import {
  extractCoordinates,
  haversineMeters,
  parseQueryCoordinates,
} from "@/lib/storefront/geo";
import type { NearbyBusiness, NearbyBusinessesResponse } from "@dpf/types";

export const dynamic = "force-dynamic";

/** Build a one-line display address from the address JSON, best-effort. */
function addressLine(address: unknown): string | null {
  if (typeof address !== "object" || address === null) return null;
  const a = address as Record<string, unknown>;
  const parts = [a.line1, a.street, a.city, a.region, a.state, a.postalCode, a.postal]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return parts.length > 0 ? parts.slice(0, 3).join(", ") : null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const here = parseQueryCoordinates(
      url.searchParams.get("lat"),
      url.searchParams.get("lng"),
    );

    // Single-org-per-install today, but enumerate defensively so the shape is
    // already correct when the hosted directory federates many installs.
    const orgs = await prisma.organization.findMany({ select: { slug: true } });

    const businesses: NearbyBusiness[] = [];
    for (const { slug } of orgs) {
      const sf = await getPublicStorefront(slug);
      if (!sf) continue; // unpublished / not configured → not discoverable

      const coords = extractCoordinates(sf.orgAddress);
      const distanceMeters =
        here && coords ? haversineMeters(here, coords) : null;

      businesses.push({
        slug: sf.orgSlug,
        name: sf.orgName,
        category: sf.archetypeCategory || null,
        archetypeId: sf.archetypeId || null,
        distanceMeters,
        hasMenu: sf.items.length > 0,
        addressLine: addressLine(sf.orgAddress),
      });
    }

    // Nearest first; businesses with no known distance sort to the end.
    businesses.sort((a, b) => {
      if (a.distanceMeters === null && b.distanceMeters === null) return 0;
      if (a.distanceMeters === null) return 1;
      if (b.distanceMeters === null) return -1;
      return a.distanceMeters - b.distanceMeters;
    });

    return apiSuccess<NearbyBusinessesResponse>({ businesses });
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
