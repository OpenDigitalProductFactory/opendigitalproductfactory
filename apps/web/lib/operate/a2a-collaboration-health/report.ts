/**
 * Load A2A edges and run collaboration health analysis (BI-3003EE63).
 * Slice 2: optional PlatformNotification + AI Ops closed loop.
 */
import { prisma } from "@dpf/db";
import {
  analyzeCollaborationHealth,
  type AnalyzeCollaborationHealthOptions,
  type CollaborationFinding,
  type CollaborationHealthReport,
} from "./analysis";
import type { AiOpsHandoffResult } from "./aiops-handoff";
import { loadCollaborationEdgeEvents } from "./load-events";

export type RunCollaborationHealthOptions = AnalyzeCollaborationHealthOptions & {
  windowHours?: number;
  limit?: number;
  notify?: boolean;
  dispatchAiOps?: boolean;
  ownerUserId?: string;
};

export type CollaborationHealthRunResult = {
  report: CollaborationHealthReport;
  notified: number;
  aiOps: AiOpsHandoffResult | null;
};

function clampWindowHours(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 24;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

async function notifyFindings(findings: CollaborationFinding[]): Promise<number> {
  const actionable = findings.filter(
    (f) => f.severity === "warning" || f.severity === "critical",
  );
  if (actionable.length === 0) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.platformNotification.findMany({
    where: {
      category: "a2a-collaboration-health",
      resolvedAt: null,
      createdAt: { gte: since },
    },
    select: { subjectId: true },
  });
  const already = new Set(
    existing.map((e) => e.subjectId).filter((s): s is string => Boolean(s)),
  );

  let created = 0;
  for (const f of actionable.slice(0, 10)) {
    const pair =
      f.evidence.fromAgentId && f.evidence.toAgentId
        ? `${f.evidence.fromAgentId}→${f.evidence.toAgentId}`
        : "any";
    const subjectId = `${f.kind}:${f.edgeKind}:${pair}`;
    if (already.has(subjectId)) continue;
    await prisma.platformNotification.create({
      data: {
        severity: f.severity === "critical" ? "critical" : "warning",
        category: "a2a-collaboration-health",
        subjectId,
        message:
          `[BI-3003EE63] ${f.title}\n${f.detail}\n` +
          `Recommended: ${f.recommendedAction}; wasteEdges≈${f.wasteEdgeEstimate}. ` +
          `Open /platform/ai/operations-map or run MCP tool analyze_a2a_collaboration_health.`,
      },
    });
    already.add(subjectId);
    created += 1;
  }
  return created;
}

export async function runCollaborationHealthReport(
  opts: RunCollaborationHealthOptions = {},
): Promise<CollaborationHealthRunResult> {
  const windowHours = clampWindowHours(opts.windowHours);
  const events = await loadCollaborationEdgeEvents(windowHours, opts.limit);
  const report = analyzeCollaborationHealth(events, opts);

  let notified = 0;
  if (opts.notify) {
    try {
      notified = await notifyFindings(report.findings);
    } catch (err) {
      console.warn("[a2a-collaboration-health] notify failed:", err);
    }
  }

  let aiOps: AiOpsHandoffResult | null = null;
  if (opts.dispatchAiOps) {
    if (!opts.ownerUserId) {
      console.warn(
        "[a2a-collaboration-health] dispatchAiOps requested without ownerUserId; skipping handoff",
      );
    } else {
      try {
        const { dispatchA2aHealthAiOps } = await import("./aiops-handoff");
        aiOps = await dispatchA2aHealthAiOps({
          report,
          ownerUserId: opts.ownerUserId,
        });
      } catch (err) {
        console.warn("[a2a-collaboration-health] AI Ops handoff failed:", err);
      }
    }
  }

  return { report, notified, aiOps };
}
