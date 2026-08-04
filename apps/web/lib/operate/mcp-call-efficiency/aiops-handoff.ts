/**
 * AI Ops closed loop for MCP call efficiency (BI-A08EBAEC slice 2).
 *
 * After the daily scan (or an on-demand run with dispatchAiOps), critical
 * findings become backlog items immediately, every warning+ finding is recorded
 * as an ImprovementSignal, the full report is persisted as a TaskArtifact under
 * a proactive TaskRun owned by platform-engineer, and a one-shot ScheduledAgentTask
 * dispatches the AI Ops coworker to review remaining findings and file any gaps.
 */

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";
import type { BacklogWorkType } from "@/lib/explore/backlog";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { isOneShotCron } from "@/lib/operate/cron-next-run";

import type {
  CallEfficiencyReport,
  EfficiencyActionKind,
  EfficiencyFinding,
} from "./analysis";

export const EFFICIENCY_REPORT_KIND = "mcp-call-efficiency-report";
export const AIOPS_AGENT_ID = "platform-engineer";
export const AIOPS_ROUTE = "/platform/ai";
export const SIGNAL_SOURCE_TYPE = "mcp-call-efficiency";

/** Max findings filed/dispatched per run (noise ceiling). */
const MAX_ACTIONABLE = 10;

export type AiOpsHandoffResult = {
  skipped: boolean;
  reason?: string;
  taskRunPublicId: string | null;
  reportArtifactId: string | null;
  signalsTouched: number;
  backlogItemsFiled: string[];
  agentTaskId: string | null;
  agentTaskCreated: boolean;
};

export type DispatchMcpEfficiencyAiOpsInput = {
  report: CallEfficiencyReport;
  /** Real User.id that owns the TaskRun / ScheduledAgentTask (superuser). */
  ownerUserId: string;
  now?: Date;
};

export function findingSourceId(f: Pick<EfficiencyFinding, "kind" | "toolName">): string {
  return `${f.kind}:${f.toolName}`;
}

export function actionToWorkType(action: EfficiencyActionKind): BacklogWorkType {
  if (action === "add_skill") return "skill";
  if (action === "merge_tools" || action === "webhook_or_event") return "tool";
  if (action === "fix_instructions") return "doc";
  return "chore";
}

export function actionableFindings(findings: EfficiencyFinding[]): EfficiencyFinding[] {
  return findings
    .filter((f) => f.severity === "warning" || f.severity === "critical")
    .slice(0, MAX_ACTIONABLE);
}

export function dailyAiOpsTaskId(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `mcp-efficiency-aiops-${y}${m}${d}`;
}

/** One-shot cron for "today UTC" so the task deactivates after a single fire. */
export function oneShotCronFor(now: Date): string {
  // minute hour day-of-month month day-of-week — concrete mon+dom ⇒ one-shot
  return `${now.getUTCMinutes()} ${now.getUTCHours()} ${now.getUTCDate()} ${now.getUTCMonth() + 1} *`;
}

export function buildAiOpsReviewPrompt(
  report: CallEfficiencyReport,
  opts: {
    taskRunPublicId: string | null;
    backlogItemsFiled: string[];
    findings: EfficiencyFinding[];
  },
): string {
  const lines = opts.findings.map(
    (f, i) =>
      `${i + 1}. [${f.severity}] ${f.kind} on \`${f.toolName}\` → ${f.recommendedAction}\n` +
      `   ${f.title}\n` +
      `   ${f.detail}\n` +
      `   wasteCalls≈${f.wasteCallEstimate}; sourceId=${findingSourceId(f)}`,
  );

  const already = opts.backlogItemsFiled.length
    ? opts.backlogItemsFiled.join(", ")
    : "(none yet — file critical and durable warning findings)";

  return [
    "You are the AI Ops Engineer (platform-engineer). A governed MCP call-efficiency scan just completed.",
    "",
    `Window: ${report.windowStart} → ${report.windowEnd}`,
    `Total calls: ${report.totalCalls}; success rate: ${(report.successRate * 100).toFixed(0)}%`,
    `Ledger usable: ${report.ledgerSufficiency.usable} — ${report.ledgerSufficiency.note}`,
    opts.taskRunPublicId
      ? `Report TaskRun: ${opts.taskRunPublicId} (artifact kind=${EFFICIENCY_REPORT_KIND})`
      : null,
    "",
    "Actionable findings:",
    lines.length ? lines.join("\n") : "(none)",
    "",
    `Backlog items already auto-filed this run: ${already}`,
    "",
    "Your mandate:",
    "1. Review each finding. Prefer skills, tool merges, webhooks/events, or instruction fixes over vague chores.",
    "2. For any CRITICAL finding without a filed BI, create a backlog item via create_backlog_item (workType skill|tool|doc|chore from the recommended action). Include origin marker and sourceId in the body.",
    "3. For WARNING findings that recur or clearly waste tokens, file or update BIs; skip one-off noise.",
    "4. Do NOT re-file a finding whose sourceId already has an open BI from this scan.",
    "5. Summarize what you filed and what you deferred, with tool names and recommended actions.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

function findingBody(f: EfficiencyFinding): string {
  return [
    f.detail,
    `Recommended action: ${f.recommendedAction}`,
    `Severity: ${f.severity}; kind: ${f.kind}; tool: ${f.toolName}`,
    `Waste call estimate: ${f.wasteCallEstimate}`,
    f.evidence.threadId ? `Sample thread: ${f.evidence.threadId}` : null,
    f.evidence.agentId ? `Sample agent: ${f.evidence.agentId}` : null,
    `Evidence count: ${f.evidence.count}` +
      (f.evidence.failCount != null ? `; fails: ${f.evidence.failCount}` : ""),
    `Source: MCP call efficiency scan (BI-A08EBAEC); sourceId=${findingSourceId(f)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Persist report + signals + critical BIs + one-shot AI Ops coworker task.
 */
export async function dispatchMcpEfficiencyAiOps(
  input: DispatchMcpEfficiencyAiOpsInput,
): Promise<AiOpsHandoffResult> {
  const now = input.now ?? new Date();
  const findings = actionableFindings(input.report.findings);

  if (findings.length === 0) {
    return {
      skipped: true,
      reason: "no-warning-or-critical-findings",
      taskRunPublicId: null,
      reportArtifactId: null,
      signalsTouched: 0,
      backlogItemsFiled: [],
      agentTaskId: null,
      agentTaskCreated: false,
    };
  }

  const taskRunPublicId = `TR-MCP-EFF-${randomUUID().slice(0, 8).toUpperCase()}`;
  const taskRun = await prisma.taskRun.create({
    data: {
      taskRunId: taskRunPublicId,
      userId: input.ownerUserId,
      title: "MCP call efficiency scan — AI Ops handoff",
      objective:
        "Review ToolExecution thrash/volume findings; ensure critical token-waste issues have backlog items.",
      source: "proactive",
      status: "completed",
      authorityScope: [],
      a2aMetadata: {
        trigger: "mcp-call-efficiency-scan",
        findingCount: findings.length,
      } as Prisma.InputJsonValue,
      currentAgentId: AIOPS_AGENT_ID,
      initiatingAgentId: AIOPS_AGENT_ID,
      routeContext: AIOPS_ROUTE,
      completedAt: now,
    },
    select: { id: true, taskRunId: true },
  });

  const artifactId = `ta_${randomUUID()}`;
  await prisma.taskArtifact.create({
    data: {
      id: randomUUID(),
      artifactId,
      taskRunId: taskRun.id,
      name: "MCP call efficiency report",
      description: `${input.report.totalCalls} calls; ${findings.length} actionable finding(s)`,
      parts: [
        {
          type: EFFICIENCY_REPORT_KIND,
          mimeType: "application/json",
          data: input.report,
        },
      ] as unknown as Prisma.InputJsonValue,
      metadata: { kind: EFFICIENCY_REPORT_KIND } as Prisma.InputJsonValue,
    },
  });

  let signalsTouched = 0;
  const backlogItemsFiled: string[] = [];

  for (const f of findings) {
    const sourceId = findingSourceId(f);
    const signal = await createOrTouchImprovementSignal({
      sourceType: SIGNAL_SOURCE_TYPE,
      sourceId,
      title: `[MCP efficiency] ${f.title}`,
      description: f.detail,
      evidence: {
        kind: f.kind,
        severity: f.severity,
        toolName: f.toolName,
        recommendedAction: f.recommendedAction,
        wasteCallEstimate: f.wasteCallEstimate,
        count: f.evidence.count,
        failCount: f.evidence.failCount ?? null,
        sampleIds: f.evidence.sampleIds.slice(0, 5),
      },
      routeContext: AIOPS_ROUTE,
      agentId: AIOPS_AGENT_ID,
      toolName: f.toolName,
      suspectedRootCause: `${f.kind} on ${f.toolName}`,
      objectiveImpactHypothesis: `Recommended: ${f.recommendedAction}; wasteCalls≈${f.wasteCallEstimate}`,
    });
    signalsTouched += 1;

    // Critical findings file immediately (do not wait for recurrence threshold).
    if (f.severity === "critical" && !signal.backlogItemId) {
      try {
        const res = await ingestBacklogItem({
          title: `[MCP efficiency] ${f.title}`,
          body: findingBody(f),
          workType: actionToWorkType(f.recommendedAction),
          source: "automated-detection",
          type: "portfolio",
          status: "triaging",
          priority: 1,
          agentId: AIOPS_AGENT_ID,
          itemIdPrefix: "MCP-EFF",
          origin: { kind: SIGNAL_SOURCE_TYPE, id: sourceId },
        });
        backlogItemsFiled.push(res.itemId);
        await prisma.improvementSignal.update({
          where: {
            sourceType_sourceId: {
              sourceType: SIGNAL_SOURCE_TYPE,
              sourceId,
            },
          },
          data: { backlogItemId: res.itemId },
        });
      } catch (err) {
        console.warn(
          "[mcp-call-efficiency] critical BI file failed for",
          sourceId,
          err,
        );
      }
    } else if (signal.backlogItemId) {
      backlogItemsFiled.push(signal.backlogItemId);
    }
  }

  // One-shot coworker dispatch (picked up by agent/task-dispatch within ~5 min).
  const agentTaskId = dailyAiOpsTaskId(now);
  const schedule = oneShotCronFor(now);
  if (!isOneShotCron(schedule)) {
    // Defensive: never leave a misclassified recurring task.
    console.warn(
      "[mcp-call-efficiency] one-shot cron classification failed:",
      schedule,
    );
  }

  const prompt = buildAiOpsReviewPrompt(input.report, {
    taskRunPublicId,
    backlogItemsFiled: [...new Set(backlogItemsFiled)],
    findings,
  });

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: agentTaskId },
    select: { taskId: true, isActive: true },
  });

  let agentTaskCreated = false;
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: agentTaskId },
      data: {
        isActive: true,
        nextRunAt: now,
        prompt,
        title: "MCP call efficiency — AI Ops review",
        agentId: AIOPS_AGENT_ID,
        routeContext: AIOPS_ROUTE,
        schedule,
        timezone: "UTC",
        ownerUserId: input.ownerUserId,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: agentTaskId,
        agentId: AIOPS_AGENT_ID,
        title: "MCP call efficiency — AI Ops review",
        prompt,
        routeContext: AIOPS_ROUTE,
        schedule,
        timezone: "UTC",
        ownerUserId: input.ownerUserId,
        nextRunAt: now,
        isActive: true,
      },
    });
    agentTaskCreated = true;
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: agentTaskId },
    create: {
      jobId: agentTaskId,
      name: "Agent: MCP call efficiency — AI Ops review",
      schedule,
      nextRunAt: now,
    },
    update: {
      name: "Agent: MCP call efficiency — AI Ops review",
      schedule,
      nextRunAt: now,
    },
  });

  return {
    skipped: false,
    taskRunPublicId,
    reportArtifactId: artifactId,
    signalsTouched,
    backlogItemsFiled: [...new Set(backlogItemsFiled)],
    agentTaskId,
    agentTaskCreated,
  };
}
