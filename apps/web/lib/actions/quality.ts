"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";

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

  try {
    const { reportId } = await createPlatformIssueReport({
      type: input.type,
      title: input.title,
      source: input.source ?? "ai_assisted",
      severity: input.severity ?? "medium",
      description: input.description ?? null,
      routeContext: input.routeContext,
      errorStack: input.errorStack ?? null,
      reportedById: userId,
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
      include: { reportedBy: { select: { id: true, email: true } } },
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
