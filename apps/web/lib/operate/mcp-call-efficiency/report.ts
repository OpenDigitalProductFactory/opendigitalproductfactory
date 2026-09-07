/**
 * Load ToolExecution rows and run call-efficiency analysis (BI-A08EBAEC).
 */
import { prisma, type PrismaClient } from "@dpf/db";
import {
  createCallEfficiencyAccumulator,
  efficiencyBudget,
  MAX_EFFICIENCY_FIELD_CHARS,
  type AnalyzeCallEfficiencyOptions,
  type CallEfficiencyReport,
  type EfficiencyCheckpoint,
  type EfficiencyStateStopReason,
  type EfficiencyFinding,
} from "./analysis";
import type { AiOpsHandoffResult } from "./aiops-handoff";
import { isGovernedRefusal } from "./refusal-codes";

export type LoadCallEfficiencyOptions = AnalyzeCallEfficiencyOptions & {
  /** Lookback hours (default 24, max 168). */
  windowHours?: number;
  /** Explicit diagnostic row budget (default/ceiling 250,000); never implies completeness. */
  limit?: number;
  /** Internal safety budgets; the MCP boundary does not accept overrides. */
  maxDurationMs?: number;
  maxStateEntries?: number;
  maxRetainedBytes?: number;
  pageSize?: number;
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
  report: WindowCallEfficiencyReport;
  notified: number;
  aiOps: AiOpsHandoffResult | null;
};

export type CallEfficiencyCoverage = {
  requestedStart: string;
  requestedEnd: string;
  observedStart: string | null;
  observedEnd: string | null;
  includedCount: number;
  populationCount: number;
  complete: boolean;
  stopReason: EfficiencyStateStopReason | "row-budget" | "time-budget" | null;
  snapshotEstablishedAt: string;
  snapshotSemantics: "repeatable-read-transaction";
  scanDurationMs: number;
  queryDurationMs: number;
  pagesRead: number;
  stateEntries: number;
  estimatedRetainedBytes: number;
  lastProcessed: EfficiencyCheckpoint | null;
  budgets: { rows: number; durationMs: number; stateEntries: number; retainedBytes: number; pageRows: number; scalarChars: number };
  recovery: string | null;
};
export type WindowCallEfficiencyReport = CallEfficiencyReport & { coverage: CallEfficiencyCoverage };

type ProjectedExecution = {
  id: string; toolName: string; threadId: string; agentId: string; executionMode: string;
  success: boolean; durationMs: number | null; createdAt: Date;
  hasApiToken: boolean; ownerSessionId: string | null; errorCode: string | null;
};

function clampWindowHours(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 24;
  return Math.min(168, Math.max(1, Math.floor(n)));
}

export async function scanCallEfficiencyWindow(
  opts: LoadCallEfficiencyOptions = {},
  db: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<WindowCallEfficiencyReport> {
  const started = performance.now();
  const requestedEnd = new Date();
  const requestedStart = new Date(requestedEnd.getTime() - clampWindowHours(opts.windowHours) * 3_600_000);
  const budgets = {
    rows: efficiencyBudget(opts.limit, 250_000, 250_000, 0),
    durationMs: efficiencyBudget(opts.maxDurationMs, 8_000, 15_000),
    stateEntries: efficiencyBudget(opts.maxStateEntries, 20_000, 20_000, 0),
    retainedBytes: efficiencyBudget(opts.maxRetainedBytes, 16 * 1024 * 1024, 16 * 1024 * 1024, 0),
    pageRows: efficiencyBudget(opts.pageSize, 500, 500),
    scalarChars: MAX_EFFICIENCY_FIELD_CHARS,
  };
  const accumulator = createCallEfficiencyAccumulator({ ...opts,
    maxStateEntries: budgets.stateEntries, maxRetainedBytes: budgets.retainedBytes });
  let queryDurationMs = 0;
  let pagesRead = 0;
  async function measured<T>(operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { return await operation(); }
    finally { queryDurationMs += performance.now() - start; }
  }

  const snapshot = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
    // The first data statement fixes visibility before count and every page.
    const [clock] = await measured(() => tx.$queryRaw<Array<{ snapshotEstablishedAt: Date }>>`
      SELECT clock_timestamp() AS "snapshotEstablishedAt"`);
    if (!clock) throw new Error("Efficiency snapshot could not be established");
    const populationCount = await measured(() => tx.toolExecution.count({
      where: { createdAt: { gte: requestedStart, lt: requestedEnd } },
    }));
    let stopReason: CallEfficiencyCoverage["stopReason"] = null;
    let afterTime = new Date(requestedStart.getTime() - 1);
    let afterId = "";
    while (accumulator.stats.includedCount < populationCount) {
      if (performance.now() - started >= budgets.durationMs) { stopReason = "time-budget"; break; }
      const remaining = budgets.rows - accumulator.stats.includedCount;
      if (remaining <= 0) { stopReason = "row-budget"; break; }
      const take = Math.min(budgets.pageRows, remaining);
      const scalarLimit = budgets.scalarChars + 1;
      // Scalar projection bounds network/page memory even for enormous JSON or
      // text fields. A clipped identity/correlation field exceeds the reducer's
      // field budget and stops BEFORE that row; it is never merged under a
      // truncated key. Raw request/result payloads never leave PostgreSQL.
      const rows = await measured(() => tx.$queryRaw<ProjectedExecution[]>`
        SELECT left(id, ${scalarLimit}) AS id,
          left("toolName", ${scalarLimit}) AS "toolName",
          left(coalesce("threadId", ''), ${scalarLimit}) AS "threadId",
          left("agentId", ${scalarLimit}) AS "agentId",
          left("executionMode", ${scalarLimit}) AS "executionMode",
          success, "durationMs", "createdAt",
          ("apiTokenId" IS NOT NULL AND "apiTokenId" <> '') AS "hasApiToken",
          CASE WHEN jsonb_typeof(parameters->'ownerSessionId') = 'string'
            THEN left(parameters->>'ownerSessionId', ${scalarLimit}) ELSE NULL END AS "ownerSessionId",
          CASE WHEN jsonb_typeof(result->'error') = 'string'
            THEN left(result->>'error', ${scalarLimit}) ELSE NULL END AS "errorCode"
        FROM "ToolExecution"
        WHERE "createdAt" >= ${requestedStart} AND "createdAt" < ${requestedEnd}
          AND ("createdAt", id COLLATE "C") > (${afterTime}, ${afterId} COLLATE "C")
        ORDER BY "createdAt" ASC, id COLLATE "C" ASC LIMIT ${take}`);
      pagesRead += 1;
      if (rows.length === 0) throw new Error("Efficiency snapshot count/page mismatch");
      for (const row of rows) {
        if (performance.now() - started >= budgets.durationMs) { stopReason = "time-budget"; break; }
        const accepted = accumulator.push({
          ...row, userId: "", routeContext: null, skillId: null,
          apiTokenId: row.hasApiToken ? "present" : null,
          governedRefusal: !row.success && isGovernedRefusal({ error: row.errorCode }),
          parameters: { ownerSessionId: row.ownerSessionId },
        });
        if (!accepted) { stopReason = accumulator.stats.stopReason; break; }
        afterTime = row.createdAt;
        afterId = row.id;
      }
      if (stopReason) break;
    }
    return { populationCount, snapshotEstablishedAt: clock.snapshotEstablishedAt.toISOString(), stopReason };
  }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: budgets.durationMs + 5_000 });

  const report = accumulator.finish();
  const complete = snapshot.stopReason === null && report.totalCalls === snapshot.populationCount;
  if (!complete) report.ledgerSufficiency = {
    usable: false,
    note: `Partial diagnostics: included ${report.totalCalls}/${snapshot.populationCount} calls; no complete-window conclusion or corrective action is available.`,
  };
  return { ...report, coverage: {
    ...snapshot, complete, requestedStart: requestedStart.toISOString(), requestedEnd: requestedEnd.toISOString(),
    observedStart: report.totalCalls ? report.windowStart : null,
    observedEnd: report.totalCalls ? report.windowEnd : null,
    includedCount: report.totalCalls, snapshotSemantics: "repeatable-read-transaction",
    scanDurationMs: performance.now() - started, queryDurationMs, pagesRead,
    stateEntries: accumulator.stats.stateEntries, estimatedRetainedBytes: accumulator.stats.estimatedRetainedBytes,
    lastProcessed: accumulator.stats.lastProcessed, budgets,
    recovery: complete ? null : "Narrow the requested window and restart with a new snapshot. The checkpoint is provenance, not a resumable snapshot cursor.",
  } };
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

async function notifyCoverage(coverage: CallEfficiencyCoverage): Promise<number> {
  const windowHours = (Date.parse(coverage.requestedEnd) - Date.parse(coverage.requestedStart)) / 3_600_000;
  const subjectId = `coverage:${windowHours}h`;
  const existing = await prisma.platformNotification.findMany({
    where: { category: "mcp-call-efficiency", subjectId, resolvedAt: null,
      createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
    select: { id: true },
  });
  if (existing.length) return 0;
  await prisma.platformNotification.create({ data: {
    severity: "warning", category: "mcp-call-efficiency", subjectId,
    message: `Partial MCP efficiency diagnostics: ${coverage.includedCount}/${coverage.populationCount} calls. ` +
      `Requested [${coverage.requestedStart}, ${coverage.requestedEnd}); observed ` +
      `${coverage.observedStart ?? "none"} to ${coverage.observedEnd ?? "none"}. ` +
      `Stopped at ${coverage.stopReason}. No corrective work was dispatched. ${coverage.recovery}`,
  } });
  return 1;
}

/**
 * Full report load + optional platform notifications + AI Ops handoff.
 */
export async function runCallEfficiencyReport(
  opts: LoadCallEfficiencyOptions = {},
): Promise<CallEfficiencyRunResult> {
  const report = await scanCallEfficiencyWindow(opts);
  let notified = 0;
  if (opts.notify) {
    try {
      notified = report.coverage.complete
        ? await notifyFindings(report.findings)
        : await notifyCoverage(report.coverage);
    } catch (err) {
      console.warn("[mcp-call-efficiency] notify failed:", err);
    }
  }

  let aiOps: AiOpsHandoffResult | null = null;
  if (report.coverage.complete && opts.dispatchAiOps) {
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
