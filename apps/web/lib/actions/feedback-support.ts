"use server";

import { auth } from "@/lib/auth";
import { isFeedbackEventDetail, type FeedbackEventDetail } from "@/lib/feedback/feedback-event";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import { createPlatformIssueReport } from "@/lib/quality/platform-issue-reports";
import { prisma } from "@dpf/db";

type StartFeedbackSupportInput = {
  detail: FeedbackEventDetail;
  featureBuildId?: string | null;
  threadId?: string | null;
  text?: string | null;
};

type ReconcileFeedbackSupportFallbackInput = {
  detail: FeedbackEventDetail;
  threadId: string;
};

type FeedbackSupportResult = {
  ok: true;
  status: "created" | "existing" | "reconciled" | "skipped";
  reportId: string;
  supportSessionId: string;
};

type AgentThreadDelegate = {
  findUnique: (args: {
    where: { id: string };
    select: { userId: true };
  }) => Promise<{ userId: string } | null>;
};

const SUPPORT_RATE_LIMIT_MINUTE_WINDOW_MS = 60 * 1000;
const SUPPORT_RATE_LIMIT_HOUR_WINDOW_MS = 60 * 60 * 1000;
const SUPPORT_RATE_LIMIT_PER_MINUTE = 3;
const SUPPORT_RATE_LIMIT_PER_HOUR = 10;
const MAX_SUPPORT_TEXT_LENGTH = 10_000;

type ExistingSupportReport = {
  id: string;
  reportId: string;
  supportSessionId: string | null;
  threadId: string | null;
};

function requireValidDetail(detail: unknown): FeedbackEventDetail {
  if (!isFeedbackEventDetail(detail)) {
    throw new Error("Invalid feedback support detail");
  }

  return detail;
}

async function requireAuthUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId;
}

function normalizeOptionalId(value: string | null | undefined, label: string): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > 191) {
    throw new Error(`Invalid ${label}`);
  }

  return trimmed;
}

function normalizeSupportText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_SUPPORT_TEXT_LENGTH) {
    throw new Error("Invalid support text");
  }

  return trimmed;
}

async function resolveFeatureBuildId(featureBuildId: string | null): Promise<string | null> {
  if (!featureBuildId) {
    return null;
  }

  if (!featureBuildId.startsWith("FB-")) {
    return featureBuildId;
  }

  const featureBuild = await prisma.featureBuild.findUnique({
    where: { buildId: featureBuildId },
    select: { id: true },
  });

  return featureBuild?.id ?? null;
}

async function assertThreadOwnership(threadId: string | null, userId: string): Promise<void> {
  if (!threadId) {
    return;
  }

  const agentThread = (prisma as unknown as { agentThread?: AgentThreadDelegate }).agentThread;
  if (!agentThread) {
    return;
  }

  const thread = await agentThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });

  if (!thread || thread.userId !== userId) {
    throw new Error("Unauthorized");
  }
}

function supportDescription(text: string | null): string {
  if (!text) {
    return "User opened coworker support mode from Feedback.";
  }

  return `User opened coworker support mode from Feedback.\n\n${text}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function findExistingSupportReport(
  reportedById: string,
  supportSessionId: string,
): Promise<ExistingSupportReport | null> {
  return prisma.platformIssueReport.findUnique({
    where: {
      reportedById_supportSessionId: {
        reportedById,
        supportSessionId,
      },
    },
    select: {
      id: true,
      reportId: true,
      supportSessionId: true,
      threadId: true,
    },
  });
}

async function returnOrReconcileExistingSupportReport(
  existing: ExistingSupportReport,
  supportSessionId: string,
  threadId: string | null,
): Promise<FeedbackSupportResult> {
  if (existing.threadId && threadId && existing.threadId !== threadId) {
    console.warn("Feedback support session threadId conflict", {
      reportId: existing.reportId,
      supportSessionId,
    });

    return {
      ok: true,
      status: "skipped",
      reportId: existing.reportId,
      supportSessionId,
    };
  }

  if (existing.threadId === null && threadId) {
    const updated = await prisma.platformIssueReport.update({
      where: { id: existing.id },
      data: {
        status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
        threadId,
      },
    });

    return {
      ok: true,
      status: "reconciled",
      reportId: updated.reportId,
      supportSessionId,
    };
  }

  return {
    ok: true,
    status: "existing",
    reportId: existing.reportId,
    supportSessionId,
  };
}

async function enforceSupportStartRateLimit(userId: string): Promise<void> {
  const now = Date.now();
  const minuteSince = new Date(now - SUPPORT_RATE_LIMIT_MINUTE_WINDOW_MS);
  const hourSince = new Date(now - SUPPORT_RATE_LIMIT_HOUR_WINDOW_MS);

  const [startsInMinute, startsInHour] = await Promise.all([
    prisma.platformIssueReport.count({
      where: {
        reportedById: userId,
        status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
        createdAt: { gte: minuteSince },
      },
    }),
    prisma.platformIssueReport.count({
      where: {
        reportedById: userId,
        status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
        createdAt: { gte: hourSince },
      },
    }),
  ]);

  if (startsInMinute >= SUPPORT_RATE_LIMIT_PER_MINUTE) {
    throw new Error("Too many support sessions started. Try again in a minute.");
  }

  if (startsInHour >= SUPPORT_RATE_LIMIT_PER_HOUR) {
    throw new Error("Too many support sessions started. Try again in an hour.");
  }
}

export async function startFeedbackSupport(input: StartFeedbackSupportInput): Promise<FeedbackSupportResult> {
  const userId = await requireAuthUserId();
  const detail = requireValidDetail(input.detail);
  const threadId = normalizeOptionalId(input.threadId, "threadId");
  const requestedFeatureBuildId = normalizeOptionalId(input.featureBuildId, "featureBuildId");
  const text = normalizeSupportText(input.text);

  await assertThreadOwnership(threadId, userId);

  const existing = await findExistingSupportReport(userId, detail.supportSessionId);

  if (existing?.reportId && existing.supportSessionId) {
    return returnOrReconcileExistingSupportReport(existing, detail.supportSessionId, threadId);
  }

  await enforceSupportStartRateLimit(userId);

  const featureBuildId = await resolveFeatureBuildId(requestedFeatureBuildId);
  let report: { reportId: string };

  try {
    report = await createPlatformIssueReport({
      type: "user_report",
      severity: "medium",
      status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
      title: "Support session started",
      description: supportDescription(text),
      routeContext: detail.routeContext,
      source: "support_mode",
      reportedById: userId,
      triggerKind: detail.triggerKind,
      supportSessionId: detail.supportSessionId,
      threadId,
      featureBuildId,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const racedExisting = await findExistingSupportReport(userId, detail.supportSessionId);
    if (!racedExisting?.reportId || !racedExisting.supportSessionId) {
      throw error;
    }

    return returnOrReconcileExistingSupportReport(racedExisting, detail.supportSessionId, threadId);
  }

  return {
    ok: true,
    status: "created",
    reportId: report.reportId,
    supportSessionId: detail.supportSessionId,
  };
}

export async function reconcileFeedbackSupportFallback(
  input: ReconcileFeedbackSupportFallbackInput,
): Promise<FeedbackSupportResult> {
  const userId = await requireAuthUserId();
  const detail = requireValidDetail(input.detail);
  const threadId = normalizeOptionalId(input.threadId, "threadId");

  if (!threadId) {
    throw new Error("Invalid threadId");
  }

  await assertThreadOwnership(threadId, userId);

  const existing = await prisma.platformIssueReport.findFirst({
    where: {
      reportedById: userId,
      supportSessionId: detail.supportSessionId,
    },
    select: {
      id: true,
      reportId: true,
      threadId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) {
    throw new Error("Support report not found");
  }

  if (existing.threadId && existing.threadId !== threadId) {
    console.warn("Feedback support fallback threadId conflict", {
      reportId: existing.reportId,
      supportSessionId: detail.supportSessionId,
    });

    return {
      ok: true,
      status: "skipped",
      reportId: existing.reportId,
      supportSessionId: detail.supportSessionId,
    };
  }

  const updated = await prisma.platformIssueReport.update({
    where: { id: existing.id },
    data: {
      status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
      threadId,
    },
  });

  return {
    ok: true,
    status: "reconciled",
    reportId: updated.reportId,
    supportSessionId: detail.supportSessionId,
  };
}
