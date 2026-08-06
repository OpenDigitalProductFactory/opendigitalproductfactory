// GET /api/storefront/:slug/menu
//
// Public, anonymous menu for one storefront — the walk-up visitor's menu view
// (first cut). Projects the storefront's active items (via the canonical
// getPublicStorefront read) into categories. Mounted under /api/storefront/*
// so it inherits the PublicApi route class (no auth). BI-9FEB61B8.

import { NextResponse } from "next/server";
import { apiSuccess } from "@/lib/api/response";
import { getPublicStorefront } from "@/lib/release/storefront-data";
import { groupMenu } from "@/lib/storefront/menu";
import type { PublicMenu } from "@dpf/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const sf = await getPublicStorefront(slug);
    if (!sf) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Storefront not found or not published" },
        { status: 404 },
      );
    }

    const menu: PublicMenu = {
      slug: sf.orgSlug,
      name: sf.orgName,
      category: sf.archetypeCategory || null,
      categories: groupMenu(sf.items),
    };
    return apiSuccess<PublicMenu>(menu);
  } catch {
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
