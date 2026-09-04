/**
 * Load ToolExecution rows and run call-efficiency analysis (BI-A08EBAEC).
 */
import { prisma } from "@dpf/db";
import {
  analyzeCallEfficiency,
  type AnalyzeCallEfficiencyOptions,
  type CallEfficiencyEvent,
  type CallEfficiencyReport,
  type EfficiencyFinding,
} from "./analysis";
import type { AiOpsHandoffResult } from "./aiops-handoff";
import { isGovernedRefusal } from "./refusal-codes";

export type LoadCallEfficiencyOptions = AnalyzeCallEfficiencyOptions & {
  /** Lookback hours (default 24, max 168). */
  windowHours?: number;
  /** Cap rows loaded (default 5000). */
  limit?: number;
  /** When true, create PlatformNotification for warning+ findings. */
  notify?: boolean;
  /**
   * When true, run the AI Ops closed loop: ImprovementSignals, critical BIs,
   * TaskRun report artifact, and one-shot platform-engineer review task.
   * Requires `ownerUserId` (scheduled owner). Cron enables this daily.
   */
  dispatchAiOps?: boolean;
  /** Real User.id owning proactive TaskRun / ScheduledAgentTask. */
  ownerUserId?: string;
};

export type CallEfficiencyRunResult = {
  report: CallEfficiencyReport;
  notified: number;
  aiOps: AiOpsHandoffResult | null;
};

function clampWindowHours(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 24;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

export async function loadCallEfficiencyEvents(
  windowHours = 24,
  limit = 5000,
): Promise<CallEfficiencyEvent[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await prisma.toolExecution.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      toolName: true,
      threadId: true,
      agentId: true,
      userId: true,
      success: true,
      result: true,
      executionMode: true,
      durationMs: true,
      createdAt: true,
      routeContext: true,
      apiTokenId: true,
      skillId: true,
      parameters: true,
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(20_000, Math.max(100, limit)),
  });

  return rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    threadId: r.threadId ?? "",
    agentId: r.agentId,
    userId: r.userId,
    success: r.success,
    governedRefusal: !r.success && isGovernedRefusal(r.result),
    executionMode: r.executionMode,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    routeContext: r.routeContext,
    apiTokenId: r.apiTokenId,
    skillId: r.skillId,
    parameters: r.parameters,
  }));
}

async function notifyFindings(findings: EfficiencyFinding[]): Promise<number> {
  const actionable = findings.filter(
    (f) => f.severity === "warning" || f.severity === "critical",
  );
  if (actionable.length === 0) return 0;

  // Dedupe: one open notification per category subject (toolName) in last 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.platformNotification.findMany({
    where: {
      category: "mcp-call-efficiency",
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
    const subjectId = `${f.kind}:${f.toolName}`;
    if (already.has(subjectId)) continue;
    await prisma.platformNotification.create({
      data: {
        severity: f.severity === "critical" ? "critical" : "warning",
        category: "mcp-call-efficiency",
        subjectId,
        message:
          `[BI-A08EBAEC] ${f.title}\n${f.detail}\n` +
          `Recommended: ${f.recommendedAction}; wasteCalls≈${f.wasteCallEstimate}. ` +
          `Run MCP tool analyze_mcp_call_efficiency for full report.`,
      },
    });
    already.add(subjectId);
    created += 1;
  }
  return created;
}

/**
 * Full report load + optional platform notifications + AI Ops handoff.
 */
export async function runCallEfficiencyReport(
  opts: LoadCallEfficiencyOptions = {},
): Promise<CallEfficiencyRunResult> {
  const windowHours = clampWindowHours(opts.windowHours);
  const events = await loadCallEfficiencyEvents(windowHours, opts.limit ?? 5000);
  const report = analyzeCallEfficiency(events, opts);
  let notified = 0;
  if (opts.notify) {
    try {
      notified = await notifyFindings(report.findings);
    } catch (err) {
      console.warn("[mcp-call-efficiency] notify failed:", err);
    }
  }

  let aiOps: AiOpsHandoffResult | null = null;
  if (opts.dispatchAiOps) {
    if (!opts.ownerUserId) {
      console.warn(
        "[mcp-call-efficiency] dispatchAiOps requested without ownerUserId; skipping handoff",
      );
    } else {
      try {
        const { dispatchMcpEfficiencyAiOps } = await import("./aiops-handoff");
        aiOps = await dispatchMcpEfficiencyAiOps({
          report,
          ownerUserId: opts.ownerUserId,
        });
      } catch (err) {
        console.warn("[mcp-call-efficiency] AI Ops handoff failed:", err);
      }
    }
  }

  return { report, notified, aiOps };
}
