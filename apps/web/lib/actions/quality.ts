"use server";

import * as crypto from "crypto";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import { startBacklogBuild } from "@/lib/actions/backlog-build";
import {
  ISSUE_REPORT_STATUS,
  type IssueReportStatus,
} from "@/lib/quality/issue-report-status";
import { LEGACY_ISSUE_REPORT_STATUS, type LegacyIssueReportStatus } from "@/lib/quality/issue-report-queue";

export async function reportQualityIssue(input: {
  type: "runtime_error" | "user_report" | "feedback";
  title: string;
  description?: string;
  severity?: string;
  routeContext: string;
  errorStack?: string;
  source?: string;
  triggerKind?: string;
  supportSessionId?: string;
  featureBuildId?: string;
  threadId?: string;
  taskRunId?: string;
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
      triggerKind: input.triggerKind ?? null,
      supportSessionId: input.supportSessionId ?? null,
      reportedById: userId,
      featureBuildId: input.featureBuildId ?? null,
      threadId: input.threadId ?? null,
      taskRunId: input.taskRunId ?? null,
      ...(input.supportSessionId ? { status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE } : {}),
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
  status: IssueReportStatus | LegacyIssueReportStatus,
) {
  return prisma.platformIssueReport.update({
    where: { reportId },
    data: { status },
  });
}

// ─── Send to Build Studio as a fix ────────────────────────────────────────────
// Manual intake affordance: turn an issue report into a fix-kind Build Studio
// build. Idempotent — repeated clicks never create duplicate backlog/build rows.
//   1. If the report is already linked to a build, return that build.
//   2. Else reuse an open bug backlog item already filed for this report.
//   3. Else create a source=bug, triageOutcome=build item seeded from the report.
//   4. Promote via startBacklogBuild() — the promote path derives kind="fix",
//      carries fixContext from the report, and back-links the report.
//   5. Transition the report to triaged_local.

const SEVERITY_PRIORITY: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };

export type SendIssueToFixResult =
  | { status: "created" | "existing"; buildId: string; href: string }
  | { status: "blocked"; error: string };

export async function sendIssueReportToBuildStudioAsFix(
  reportId: string,
): Promise<SendIssueToFixResult> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")
  ) {
    return { status: "blocked", error: "Unauthorized" };
  }

  const report = await prisma.platformIssueReport.findUnique({
    where: { reportId },
    select: {
      id: true,
      reportId: true,
      title: true,
      description: true,
      severity: true,
      routeContext: true,
      digitalProductId: true,
      featureBuildId: true,
    },
  });
  if (!report) {
    return { status: "blocked", error: `Issue report ${reportId} was not found.` };
  }

  // (1) Already linked to a build — return it (idempotent).
  if (report.featureBuildId) {
    const existingBuild = await prisma.featureBuild.findUnique({
      where: { id: report.featureBuildId },
      select: { buildId: true },
    });
    if (existingBuild) {
      return { status: "existing", buildId: existingBuild.buildId, href: `/build?buildId=${encodeURIComponent(existingBuild.buildId)}` };
    }
  }

  // (2) Reuse an open bug backlog item already filed for this report. The triage
  // cron and this action both embed the public report id in the BI body.
  let itemId: string | null = null;
  const existingItem = await prisma.backlogItem.findFirst({
    where: { workType: "bug", body: { contains: report.reportId } },
    orderBy: { createdAt: "desc" },
    select: { itemId: true, status: true, triageOutcome: true, effortSize: true, activeBuild: { select: { buildId: true } } },
  });
  if (existingItem?.activeBuild?.buildId) {
    await markReportTriaged(report.id, existingItem.activeBuild.buildId);
    return { status: "existing", buildId: existingItem.activeBuild.buildId, href: `/build?buildId=${encodeURIComponent(existingItem.activeBuild.buildId)}` };
  }
  if (existingItem) {
    // Ensure it is promotion-eligible (open + build + sized), then reuse it.
    await prisma.backlogItem.update({
      where: { itemId: existingItem.itemId },
      data: {
        status: "open",
        triageOutcome: "build",
        ...(existingItem.effortSize ? {} : { effortSize: "small" }),
      },
    });
    itemId = existingItem.itemId;
  }

  // (3) Otherwise create a fresh bug backlog item seeded from the report. The
  // body embeds the public report id so the promote path can resolve fixContext.
  if (!itemId) {
    const newItemId = `BI-PIR-${crypto.randomUUID().slice(0, 8)}`;
    const bodyParts = [
      report.description,
      report.routeContext ? `Route: ${report.routeContext}` : null,
      `Source report: ${report.reportId}`,
    ].filter(Boolean);
    await prisma.backlogItem.create({
      data: {
        itemId: newItemId,
        title: report.title,
        body: bodyParts.join("\n\n"),
        status: "open",
        type: report.digitalProductId ? "product" : "portfolio",
        // Operator clicked the admin "Send to Build Studio as a fix" action —
        // that is a human request acting on automated runtime evidence. The
        // originating PIR is linked via the body + back-link.
        source: "user-request",
        workType: "bug",
        triageOutcome: "build",
        effortSize: "small",
        priority: SEVERITY_PRIORITY[report.severity ?? "medium"] ?? 3,
        digitalProductId: report.digitalProductId ?? null,
      },
    });
    itemId = newItemId;
  }

  // (4) Promote — derives kind="fix", carries fixContext, back-links the report.
  const promote = await startBacklogBuild(itemId);
  if (promote.status === "blocked") {
    return { status: "blocked", error: promote.error };
  }

  // (5) Transition the report and ensure the back-link (promote sets it when the
  // body parse resolves the report; set it here defensively for the reuse path).
  await markReportTriaged(report.id, promote.buildId);
  revalidatePath("/admin/issue-reports");

  return { status: promote.status, buildId: promote.buildId, href: promote.href };
}

async function markReportTriaged(reportRowId: string, buildId: string): Promise<void> {
  const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { id: true } });
  await prisma.platformIssueReport.update({
    where: { id: reportRowId },
    data: {
      status: ISSUE_REPORT_STATUS.TRIAGED_LOCAL,
      ...(build ? { featureBuildId: build.id } : {}),
    },
  });
}

export async function getIssueReportStats() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const warmupNoiseWhere = {
    OR: [
      { source: "warmup" },
      { title: { in: ["Model warmup ping", "System warmup check"] } },
    ],
  };
  const activeStatusWhere = {
    status: {
      in: [
        ISSUE_REPORT_STATUS.OPEN,
        ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
        ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
        ISSUE_REPORT_STATUS.UPSTREAM_PENDING,
        ISSUE_REPORT_STATUS.UPSTREAM_FILED,
      ],
    },
  };

  const [
    byStatus,
    bySeverity,
    bySource,
    last24h,
    last7d,
    topRoutes,
    actionable,
    processGuard,
    warmupNoise,
    triaged,
    resolved,
    suppressed,
  ] = await Promise.all([
    prisma.platformIssueReport.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.platformIssueReport.groupBy({ by: ["severity"], _count: { _all: true } }),
    prisma.platformIssueReport.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.platformIssueReport.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.platformIssueReport.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.platformIssueReport.groupBy({
      by: ["routeContext"],
      _count: { _all: true },
      orderBy: { _count: { routeContext: "desc" } },
      take: 5,
      where: { routeContext: { not: null } },
    }),
    prisma.platformIssueReport.count({
      where: {
        ...activeStatusWhere,
        NOT: warmupNoiseWhere,
      },
    }),
    prisma.platformIssueReport.count({ where: { source: "agentic-loop-guard" } }),
    prisma.platformIssueReport.count({ where: warmupNoiseWhere }),
    prisma.platformIssueReport.count({
      where: {
        status: {
          in: [ISSUE_REPORT_STATUS.TRIAGED_LOCAL, LEGACY_ISSUE_REPORT_STATUS.ACKNOWLEDGED],
        },
      },
    }),
    prisma.platformIssueReport.count({
      where: {
        status: {
          in: [
            ISSUE_REPORT_STATUS.RESOLVED_LOCALLY,
            ISSUE_REPORT_STATUS.RESOLVED_UPSTREAM,
            LEGACY_ISSUE_REPORT_STATUS.RESOLVED,
          ],
        },
      },
    }),
    prisma.platformIssueReport.count({ where: { status: ISSUE_REPORT_STATUS.SUPPRESSED } }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count._all])),
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
    last24h,
    last7d,
    topRoutes: topRoutes.map((r) => ({ route: r.routeContext, count: r._count._all })),
    queueSummary: {
      actionable,
      processGuard,
      warmupNoise,
      triaged,
      resolved,
      suppressed,
    },
  };
}
