/**
 * AI Ops closed loop for A2A collaboration health (BI-3003EE63 slice 2).
 *
 * Critical findings → backlog items; warning+ → ImprovementSignal; full report
 * as TaskArtifact; one-shot platform-engineer review task.
 * Pattern mirrored from mcp-call-efficiency/aiops-handoff.ts (BI-A08EBAEC).
 */

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";
import type { BacklogWorkType } from "@/lib/explore/backlog";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import { isOneShotCron } from "@/lib/operate/cron-next-run";

import type {
  CollaborationActionKind,
  CollaborationFinding,
  CollaborationHealthReport,
} from "./analysis";

export const A2A_HEALTH_REPORT_KIND = "a2a-collaboration-health-report";
export const AIOPS_AGENT_ID = "platform-engineer";
export const AIOPS_ROUTE = "/platform/ai/operations-map";
export const SIGNAL_SOURCE_TYPE = "a2a-collaboration-health";

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

export type DispatchA2aHealthAiOpsInput = {
  report: CollaborationHealthReport;
  ownerUserId: string;
  now?: Date;
};

export function findingSourceId(
  f: Pick<CollaborationFinding, "kind" | "edgeKind" | "evidence">,
): string {
  const pair =
    f.evidence.fromAgentId && f.evidence.toAgentId
      ? `${f.evidence.fromAgentId}→${f.evidence.toAgentId}`
      : "any";
  return `${f.kind}:${f.edgeKind}:${pair}`;
}

export function actionToWorkType(action: CollaborationActionKind): BacklogWorkType {
  if (action === "fix_capture") return "feature";
  if (action === "improve_gate") return "bug";
  if (action === "clear_stuck_delegation") return "chore";
  if (action === "investigate_handoff") return "chore";
  return "chore";
}

export function actionableFindings(
  findings: CollaborationFinding[],
): CollaborationFinding[] {
  return findings
    .filter((f) => f.severity === "warning" || f.severity === "critical")
    .slice(0, MAX_ACTIONABLE);
}

export function dailyAiOpsTaskId(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `a2a-health-aiops-${y}${m}${d}`;
}

export function oneShotCronFor(now: Date): string {
  return `${now.getUTCMinutes()} ${now.getUTCHours()} ${now.getUTCDate()} ${now.getUTCMonth() + 1} *`;
}

export function buildAiOpsReviewPrompt(
  report: CollaborationHealthReport,
  opts: {
    taskRunPublicId: string | null;
    backlogItemsFiled: string[];
    findings: CollaborationFinding[];
  },
): string {
  const lines = opts.findings.map(
    (f, i) =>
      `${i + 1}. [${f.severity}] ${f.kind} (${f.edgeKind}) → ${f.recommendedAction}\n` +
      `   ${f.title}\n` +
      `   ${f.detail}\n` +
      `   wasteEdges≈${f.wasteEdgeEstimate}; sourceId=${findingSourceId(f)}`,
  );

  const already = opts.backlogItemsFiled.length
    ? opts.backlogItemsFiled.join(", ")
    : "(none yet — file critical and durable warning findings)";

  return [
    "You are the AI Ops Engineer (platform-engineer). A governed A2A collaboration-health scan just completed.",
    "",
    `Window: ${report.windowStart} → ${report.windowEnd}`,
    `Total edges: ${report.totalEdges}; completed-rate: ${(report.successRate * 100).toFixed(0)}%`,
    `Ledger usable: ${report.ledgerSufficiency.usable} — ${report.ledgerSufficiency.note}`,
    opts.taskRunPublicId
      ? `Report TaskRun: ${opts.taskRunPublicId} (artifact kind=${A2A_HEALTH_REPORT_KIND})`
      : null,
    "Ops map: /platform/ai/operations-map (A2A dimension)",
    "",
    "Actionable findings:",
    lines.length ? lines.join("\n") : "(none)",
    "",
    `Backlog items already auto-filed this run: ${already}`,
    "",
    "Your mandate:",
    "1. Review each finding. Prefer capture fixes (from/to agents, a2aMetadata), gate repairs, or clearing stuck delegations.",
    "2. For any CRITICAL finding without a filed BI, create_backlog_item with itemIdPrefix-style body origin marker and sourceId.",
    "3. For WARNING findings that recur, file or update BIs; skip one-off noise on empty-capture installs.",
    "4. Do NOT re-file a finding whose sourceId already has an open BI from this scan.",
    "5. Do NOT invent deliberation agent-to-agent edges without durable branch agentId.",
    "6. Summarize what you filed and deferred.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

function findingBody(f: CollaborationFinding): string {
  return [
    f.detail,
    `Recommended action: ${f.recommendedAction}`,
    `Severity: ${f.severity}; kind: ${f.kind}; edgeKind: ${f.edgeKind}`,
    `Waste edge estimate: ${f.wasteEdgeEstimate}`,
    f.evidence.fromAgentId ? `From agent: ${f.evidence.fromAgentId}` : null,
    f.evidence.toAgentId ? `To agent: ${f.evidence.toAgentId}` : null,
    `Evidence count: ${f.evidence.count}`,
    `Source: A2A collaboration health scan (BI-3003EE63); sourceId=${findingSourceId(f)}`,
    `Ops map: /platform/ai/operations-map`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function dispatchA2aHealthAiOps(
  input: DispatchA2aHealthAiOpsInput,
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

  const taskRunPublicId = `TR-A2A-HLTH-${randomUUID().slice(0, 8).toUpperCase()}`;
  const taskRun = await prisma.taskRun.create({
    data: {
      taskRunId: taskRunPublicId,
      userId: input.ownerUserId,
      title: "A2A collaboration health scan — AI Ops handoff",
      objective:
        "Review coworker↔coworker edge failures, stuck delegations, and orphan lineage; ensure critical collaboration issues have backlog items.",
      source: "proactive",
      status: "completed",
      authorityScope: [],
      a2aMetadata: {
        trigger: "a2a-collaboration-health-scan",
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
      name: "A2A collaboration health report",
      description: `${input.report.totalEdges} edges; ${findings.length} actionable finding(s)`,
      parts: [
        {
          type: A2A_HEALTH_REPORT_KIND,
          mimeType: "application/json",
          data: input.report,
        },
      ] as unknown as Prisma.InputJsonValue,
      metadata: { kind: A2A_HEALTH_REPORT_KIND } as Prisma.InputJsonValue,
    },
  });

  let signalsTouched = 0;
  const backlogItemsFiled: string[] = [];

  for (const f of findings) {
    const sourceId = findingSourceId(f);
    const signal = await createOrTouchImprovementSignal({
      sourceType: SIGNAL_SOURCE_TYPE,
      sourceId,
      title: `[A2A health] ${f.title}`,
      description: f.detail,
      evidence: {
        kind: f.kind,
        severity: f.severity,
        edgeKind: f.edgeKind,
        recommendedAction: f.recommendedAction,
        wasteEdgeEstimate: f.wasteEdgeEstimate,
        count: f.evidence.count,
        fromAgentId: f.evidence.fromAgentId ?? null,
        toAgentId: f.evidence.toAgentId ?? null,
        sampleIds: f.evidence.sampleIds.slice(0, 5),
      },
      routeContext: AIOPS_ROUTE,
      agentId: AIOPS_AGENT_ID,
      toolName: f.edgeKind,
      suspectedRootCause: `${f.kind} on ${f.edgeKind}`,
      objectiveImpactHypothesis: `Recommended: ${f.recommendedAction}; wasteEdges≈${f.wasteEdgeEstimate}`,
    });
    signalsTouched += 1;

    if (f.severity === "critical" && !signal.backlogItemId) {
      try {
        const res = await ingestBacklogItem({
          title: `[A2A health] ${f.title}`,
          body: findingBody(f),
          workType: actionToWorkType(f.recommendedAction),
          source: "automated-detection",
          type: "portfolio",
          status: "triaging",
          priority: 1,
          agentId: AIOPS_AGENT_ID,
          itemIdPrefix: "A2A-EFF",
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
          "[a2a-collaboration-health] critical BI file failed for",
          sourceId,
          err,
        );
      }
    } else if (signal.backlogItemId) {
      backlogItemsFiled.push(signal.backlogItemId);
    }
  }

  const agentTaskId = dailyAiOpsTaskId(now);
  const schedule = oneShotCronFor(now);
  if (!isOneShotCron(schedule)) {
    console.warn(
      "[a2a-collaboration-health] one-shot cron classification failed:",
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
        title: "A2A collaboration health — AI Ops review",
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
        title: "A2A collaboration health — AI Ops review",
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
      name: "Agent: A2A collaboration health — AI Ops review",
      schedule,
      nextRunAt: now,
    },
    update: {
      name: "Agent: A2A collaboration health — AI Ops review",
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
