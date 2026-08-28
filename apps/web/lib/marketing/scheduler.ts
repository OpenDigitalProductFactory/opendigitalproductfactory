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
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

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
      const message = getErrorMessage(err);
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
  /**
   * Resolved marketing-campaign proactivity posture (BI-C26FE785). Omitted by
   * callers that are not cadence-driven, which keeps the pre-posture behaviour.
   */
  proactivity?: { level: ProactivityLevel; policyId: string } | null;
}): Promise<{
  scheduled: number;
  skipped: number;
  advanceDays?: number;
  suppressedByPosture?: boolean;
}> {
  // Quiet means exactly that: produce marketing when asked and never volunteer
  // it. Planning drafter runs anyway and merely staying silent about them would
  // still spend model budget and fill the outbound queue behind the owner's
  // back, so quiet suppresses the planning itself rather than its output.
  if (input.proactivity?.level === "quiet") {
    return { scheduled: 0, skipped: 0, suppressedByPosture: true };
  }

  const tasks = await prisma.marketingAssetTask.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  let scheduled = 0;
  let skipped = 0;
  // An assertive posture starts creative earlier so a dated campaign has slack
  // to be reviewed and redone; balanced keeps the standard lead time.
  const advanceDays =
    input.proactivity?.level === "assertive"
      ? ADVANCE_DAYS_FOR_DUE_WINDOW * 2
      : ADVANCE_DAYS_FOR_DUE_WINDOW;
  const advanceMs = advanceDays * 24 * 60 * 60 * 1000;

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
    // A longer assertive lead time must never make the coworker do LESS. Taken
    // naively, doubling the advance pushes the run further into the past and
    // skips tasks a balanced posture would have scheduled — the opposite of
    // what assertive means. So fall back to the standard lead time before
    // giving up, and only skip when even that lands in the past.
    let scheduledFor = new Date(dueDate.getTime() - advanceMs);
    if (scheduledFor.getTime() < Date.now() && advanceDays !== ADVANCE_DAYS_FOR_DUE_WINDOW) {
      scheduledFor = new Date(dueDate.getTime() - ADVANCE_DAYS_FOR_DUE_WINDOW * 24 * 60 * 60 * 1000);
    }
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
        notes: `Auto-planned ${Math.round((dueDate.getTime() - scheduledFor.getTime()) / (24 * 60 * 60 * 1000))} days before due window: ${task.dueWindow}`,
      },
    });
    scheduled++;
  }

  return { scheduled, skipped, advanceDays };
}

/**
 * Parse a free-form due-window string into an approximate Date. Supports:
 *   - "week 1", "week 2" → N-1 weeks after createdAt
 *   - "next 14 days" → createdAt + 14 days
 *   - ISO date strings → that date
 *   - YYYY-MM-DD → that date
 * Returns null when the format isn't recognizable.
 */
export function parseDueWindowToDate(dueWindow: string, createdAt: Date): Date | null {
  // Never hand back an Invalid Date: a huge "week N"/"next N days" overflows the
  // valid Date range, and an Invalid Date is truthy — it would slip past a
  // `!due` guard in callers and later throw RangeError on toISOString() (which
  // would crash get_content_calendar for the whole workspace). Return null so
  // callers route the task to `unscheduled` instead.
  const finiteOrNull = (d: Date): Date | null => (Number.isNaN(d.getTime()) ? null : d);

  const trimmed = dueWindow.trim().toLowerCase();
  const weekMatch = /^week\s+(\d+)/.exec(trimmed);
  if (weekMatch) {
    // Week numbering is 1-based ("week 1" → createdAt); clamp 0/overflow-parsed.
    const weeks = Math.max(1, parseInt(weekMatch[1]!, 10));
    return finiteOrNull(new Date(createdAt.getTime() + (weeks - 1) * 7 * 24 * 60 * 60 * 1000));
  }
  const daysMatch = /^next\s+(\d+)\s+days?/.exec(trimmed);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]!, 10);
    return finiteOrNull(new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000));
  }
  // Explicit calendar date: accept ONLY a leading YYYY-MM-DD and parse it as
  // UTC. `new Date("2")` → year 2001 and `new Date("July 15 2026")` → server
  // LOCAL time both silently misbucket a task; requiring an ISO date parsed as
  // UTC keeps the calendar's all-UTC contract and sends anything ambiguous to
  // `unscheduled` (the honest, visible outcome) rather than a wrong week.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dueWindow.trim());
  if (isoMatch) {
    return finiteOrNull(new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`));
  }
  return null;
}
