"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

const ROUTE_PORTFOLIO_MAP: Record<string, string> = {
  "/portfolio": "foundational",
  "/ea": "foundational",
  "/inventory": "foundational",
  "/platform": "foundational",
  "/admin": "foundational",
  "/ops": "manufacturing_and_delivery",
  "/employee": "for_employees",
  "/customer": "products_and_services_sold",
};

function resolvePortfolioSlug(routeContext: string): string | null {
  for (const [prefix, slug] of Object.entries(ROUTE_PORTFOLIO_MAP)) {
    if (routeContext === prefix || routeContext.startsWith(prefix + "/")) {
      return slug;
    }
  }
  return null;
}

export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
}): Promise<{ reportId: string } | { error: string }> {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const reportId = "PIR-" + Math.random().toString(36).substring(2, 7).toUpperCase();

  // Best-effort route-to-owner resolution
  let portfolioId: string | null = null;
  const slug = resolvePortfolioSlug(input.routeContext);
  if (slug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug },
      select: { id: true },
    });
    portfolioId = portfolio?.id ?? null;
  }

  // All platform issue reports belong to the dpf-portal product
  let digitalProductId: string | null = null;
  const dpfPortal = await prisma.digitalProduct.findUnique({
    where: { productId: "dpf-portal" },
    select: { id: true },
  });
  digitalProductId = dpfPortal?.id ?? null;

  try {
    await prisma.platformIssueReport.create({
      data: {
        reportId,
        type: input.type,
        severity: input.severity ?? "medium",
        title: input.title.slice(0, 500),
        description: input.description?.slice(0, 10000) ?? null,
        routeContext: input.routeContext,
        errorStack: input.errorStack?.slice(0, 20000) ?? null,
        reportedById: userId,
        source: input.source ?? "ai_assisted",
        portfolioId,
        digitalProductId,
      },
    });
    return { reportId };
  } catch {
    return { error: "Failed to create report" };
  }
}

// ─── Admin Queries ──────────────────────────────────────────────────────────

export async function getIssueReports(filters?: {
  status?: string;
  severity?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.severity) where.severity = filters.severity;

  const [items, total] = await Promise.all([
    prisma.platformIssueReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { reportedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.platformIssueReport.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function updateIssueReportStatus(
  reportId: string,
  status: "acknowledged" | "resolved",
) {
  return prisma.platformIssueReport.update({
    where: { reportId },
    data: { status },
  });
}

export async function getIssueReportStats() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [byStatus, bySeverity, last24h, last7d, topRoutes] = await Promise.all([
    prisma.platformIssueReport.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.platformIssueReport.groupBy({ by: ["severity"], _count: { _all: true } }),
    prisma.platformIssueReport.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.platformIssueReport.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.platformIssueReport.groupBy({
      by: ["routeContext"],
      _count: { _all: true },
      orderBy: { _count: { routeContext: "desc" } },
      take: 5,
      where: { routeContext: { not: null } },
    }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count._all])),
    last24h,
    last7d,
    topRoutes: topRoutes.map((r) => ({ route: r.routeContext, count: r._count._all })),
  };
}
