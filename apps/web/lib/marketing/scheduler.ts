// Marketing execution loop — scheduler.
//
// Phase 5: schedule a Phase 1-4 service to fire at a future time and run
// the dispatcher loop. Three kinds:
//   draft-marketing-asset  → targetId = MarketingAssetTask.taskId
//   publish-approved-draft → targetId = OutboundDraft.draftId
//   pull-channel-kpis      → targetId = channelId string
//
// The dispatcher is called via the tick_marketing_scheduler MCP tool +
// (later) wired to inngest cron. Failure on one row never blocks others;
// each schedule's failure goes to status=failed with the error message.

import { prisma } from "@dpf/db";
import {
  isAllowedScheduledTransition,
  type ScheduledActionKind,
  type ScheduledActionStatus,
} from "./execution";

const ADVANCE_DAYS_FOR_DUE_WINDOW = 3;

export type ScheduleActionInput = {
  organizationId: string;
  kind: ScheduledActionKind;
  targetId: string;
  scheduledFor: Date;
  scheduledByUserId?: string;
  autopilotPolicyId?: string;
  notes?: string;
};

export async function scheduleAction(
  input: ScheduleActionInput,
): Promise<{ scheduleId: string }> {
  const row = await prisma.scheduledOutboundAction.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      targetId: input.targetId,
      scheduledFor: input.scheduledFor,
      scheduledByUserId: input.scheduledByUserId ?? null,
      autopilotPolicyId: input.autopilotPolicyId ?? null,
      notes: input.notes ?? null,
    },
    select: { scheduleId: true },
  });
  return { scheduleId: row.scheduleId };
}

export async function transitionSchedule(
  scheduleId: string,
  to: ScheduledActionStatus,
  extras?: { lastError?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await prisma.scheduledOutboundAction.findUnique({
    where: { scheduleId },
    select: { status: true },
  });
  if (!row) return { ok: false, error: "schedule_not_found" };
  if (!isAllowedScheduledTransition(row.status as ScheduledActionStatus, to)) {
    return {
      ok: false,
      error: `Illegal transition ${JSON.stringify(row.status)} -> ${JSON.stringify(to)}`,
    };
  }
  await prisma.scheduledOutboundAction.update({
    where: { scheduleId },
    data: {
      status: to,
      ...(to === "fired" ? { firedAt: new Date() } : {}),
      ...(extras?.lastError ? { lastError: extras.lastError } : {}),
    },
  });
  return { ok: true };
}

export type TickResult = {
  pendingScanned: number;
  fired: number;
  failed: number;
  failures: Array<{ scheduleId: string; error: string }>;
};

export async function tickScheduler(input: { now?: Date } = {}): Promise<TickResult> {
  const now = input.now ?? new Date();
  const pending = await prisma.scheduledOutboundAction.findMany({
    where: { status: "pending", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  let fired = 0;
  let failed = 0;
  const failures: Array<{ scheduleId: string; error: string }> = [];

  for (const row of pending) {
    try {
      await dispatchAction(row.kind as ScheduledActionKind, row.targetId);
      await prisma.scheduledOutboundAction.update({
        where: { scheduleId: row.scheduleId },
        data: { status: "fired", firedAt: new Date() },
      });
      fired++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.scheduledOutboundAction.update({
        where: { scheduleId: row.scheduleId },
        data: { status: "failed", lastError: message },
      });
      failed++;
      failures.push({ scheduleId: row.scheduleId, error: message });
    }
  }

  return { pendingScanned: pending.length, fired, failed, failures };
}

async function dispatchAction(kind: ScheduledActionKind, targetId: string): Promise<void> {
  if (kind === "draft-marketing-asset") {
    const { draftMarketingAsset } = await import("./draft-builder");
    const result = await draftMarketingAsset({
      assetTaskId: targetId,
      createdByAgentId: "marketing-specialist",
    });
    if (!result.success) throw new Error(result.error);
    return;
  }
  if (kind === "publish-approved-draft") {
    const { publishApprovedDraft } = await import("./publish");
    const result = await publishApprovedDraft({
      draftId: targetId,
      publishedByUserId: "scheduler",
    });
    if (!result.ok) throw new Error(result.error);
    return;
  }
  if (kind === "pull-channel-kpis") {
    const { pullChannelKpis } = await import("./kpi-pullback");
    const result = await pullChannelKpis({ channelId: targetId });
    if (!result.ok && result.snapshotsWritten === 0) {
      throw new Error(`No snapshots written: ${result.failures.map((f) => f.error).join("; ")}`);
    }
    return;
  }
  throw new Error(`unknown_kind: ${kind}`);
}

/**
 * Idempotently plan a `draft-marketing-asset` schedule N days before each
 * MarketingAssetTask's dueWindow date that doesn't already have one in
 * status=pending. Best-effort: tasks with non-parseable due windows are
 * skipped silently — the operator can still trigger draft_marketing_asset
 * manually.
 */
export async function planUpcomingForAssetTasks(input: {
  organizationId: string;
}): Promise<{ scheduled: number; skipped: number }> {
  const tasks = await prisma.marketingAssetTask.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  let scheduled = 0;
  let skipped = 0;
  const advanceMs = ADVANCE_DAYS_FOR_DUE_WINDOW * 24 * 60 * 60 * 1000;

  for (const task of tasks) {
    if (!task.dueWindow) {
      skipped++;
      continue;
    }
    const dueDate = parseDueWindowToDate(task.dueWindow, task.createdAt);
    if (!dueDate) {
      skipped++;
      continue;
    }
    const scheduledFor = new Date(dueDate.getTime() - advanceMs);
    if (scheduledFor.getTime() < Date.now()) {
      skipped++;
      continue;
    }
    const existing = await prisma.scheduledOutboundAction.findFirst({
      where: {
        kind: "draft-marketing-asset",
        targetId: task.taskId,
        status: { in: ["pending", "fired"] },
      },
      select: { scheduleId: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.scheduledOutboundAction.create({
      data: {
        organizationId: input.organizationId,
        kind: "draft-marketing-asset",
        targetId: task.taskId,
        scheduledFor,
        notes: `Auto-planned ${ADVANCE_DAYS_FOR_DUE_WINDOW} days before due window: ${task.dueWindow}`,
      },
    });
    scheduled++;
  }

  return { scheduled, skipped };
}

/**
 * Parse a free-form due-window string into an approximate Date. Supports:
 *   - "week 1", "week 2" → N-1 weeks after createdAt
 *   - "next 14 days" → createdAt + 14 days
 *   - ISO date strings → that date
 *   - YYYY-MM-DD → that date
 * Returns null when the format isn't recognizable.
 */
function parseDueWindowToDate(dueWindow: string, createdAt: Date): Date | null {
  const trimmed = dueWindow.trim().toLowerCase();
  const weekMatch = /^week\s+(\d+)/.exec(trimmed);
  if (weekMatch) {
    const weeks = parseInt(weekMatch[1]!, 10);
    return new Date(createdAt.getTime() + (weeks - 1) * 7 * 24 * 60 * 60 * 1000);
  }
  const daysMatch = /^next\s+(\d+)\s+days?/.exec(trimmed);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]!, 10);
    return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
  }
  const isoCandidate = new Date(dueWindow);
  if (!Number.isNaN(isoCandidate.getTime())) {
    return isoCandidate;
  }
  return null;
}
