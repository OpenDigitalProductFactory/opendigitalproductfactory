// GET /api/v1/workspace/dashboard
//
// Returns workspace dashboard data: summary tiles and calendar items.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export type DashboardTile = {
  area: string;
  label: string;
  value: number;
  trend: string | null;
};

export type CalendarItem = {
  id: string;
  title: string;
  date: string;
  type: string;
};

export type DashboardResponse = {
  tiles: DashboardTile[];
  calendarItems: CalendarItem[];
};

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    // Assemble dashboard counts in parallel
    const [
      epicsByStatus,
      backlogByStatus,
      portfolioCount,
      productCount,
    ] = await Promise.all([
      prisma.epic.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.backlogItem.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.portfolio.count(),
      prisma.digitalProduct.count(),
    ]);

    // Build epic status map
    const epicStatusMap: Record<string, number> = {};
    for (const row of epicsByStatus) {
      epicStatusMap[row.status] = row._count.id;
    }

    // Build backlog status map
    const backlogStatusMap: Record<string, number> = {};
    for (const row of backlogByStatus) {
      backlogStatusMap[row.status] = row._count.id;
    }

    const totalEpics = Object.values(epicStatusMap).reduce((a, b) => a + b, 0);
    const totalBacklog = Object.values(backlogStatusMap).reduce((a, b) => a + b, 0);

    const tiles: DashboardTile[] = [
      { area: "epics", label: "Total Epics", value: totalEpics, trend: null },
      { area: "epics", label: "Open Epics", value: epicStatusMap["open"] ?? 0, trend: null },
      { area: "backlog", label: "Total Backlog Items", value: totalBacklog, trend: null },
      { area: "backlog", label: "In Progress", value: backlogStatusMap["in-progress"] ?? 0, trend: null },
      { area: "backlog", label: "Done", value: backlogStatusMap["done"] ?? 0, trend: null },
      { area: "portfolio", label: "Portfolios", value: portfolioCount, trend: null },
      { area: "products", label: "Digital Products", value: productCount, trend: null },
    ];

    // Calendar items: upcoming backlog items with recent activity
    const upcomingItems = await prisma.backlogItem.findMany({
      where: {
        status: { in: ["open", "in-progress"] },
      },
      select: { id: true, itemId: true, title: true, updatedAt: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    const calendarItems: CalendarItem[] = upcomingItems.map((item) => ({
      id: item.id,
      title: item.title,
      date: item.updatedAt.toISOString(),
      type: item.status,
    }));

    return apiSuccess<DashboardResponse>({ tiles, calendarItems });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
