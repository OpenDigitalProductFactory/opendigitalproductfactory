// GET /api/platform/status — platform status for active maintenance windows
// EP-CHG-MGMT-013: Returns in-progress RFCs so UIs can display maintenance banners.
// Public endpoint (no auth) so storefront and external consumers can check status.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
};

export async function GET() {
  try {
    const activeRFCs = await prisma.changeRequest.findMany({
      where: { status: "in-progress" },
      select: {
        rfcId: true,
        title: true,
        description: true,
        type: true,
        scope: true,
        riskLevel: true,
        plannedStartAt: true,
        plannedEndAt: true,
        startedAt: true,
        changeItems: {
          select: {
            title: true,
            itemType: true,
            status: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    const maintenanceActive = activeRFCs.length > 0;

    return NextResponse.json({
      status: maintenanceActive ? "maintenance" : "operational",
      maintenanceActive,
      activeMaintenanceWindows: activeRFCs.map((rfc) => ({
        rfcId: rfc.rfcId,
        title: rfc.title,
        description: rfc.description,
        type: rfc.type,
        scope: rfc.scope,
        riskLevel: rfc.riskLevel,
        plannedStartAt: rfc.plannedStartAt,
        plannedEndAt: rfc.plannedEndAt,
        startedAt: rfc.startedAt,
        affectedItems: rfc.changeItems.map((item) => ({
          title: item.title,
          type: item.itemType,
          status: item.status,
        })),
      })),
      checkedAt: new Date().toISOString(),
    }, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { status: "unknown", maintenanceActive: false, activeMaintenanceWindows: [], error: "Failed to check status" },
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
}
