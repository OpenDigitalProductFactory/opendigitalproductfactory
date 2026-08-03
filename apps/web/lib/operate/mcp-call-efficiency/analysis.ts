/**
 * Pure MCP / governed-tool call efficiency analysis (BI-A08EBAEC).
 *
 * Operates on in-memory execution events (no I/O) so unit tests stay hermetic
 * and the same core can be driven by a DB loader, MCP tool, or cron.
 *
 * Aligns with OpenTelemetry GenAI "execute_tool" thinking without requiring
 * an OTel exporter: tool name, success, duration, session (thread), surface.
 */

export type CallEfficiencyEvent = {
  id: string;
  toolName: string;
  threadId: string;
  agentId: string;
  userId: string;
  success: boolean;
  /** GovernedExecuteSource / ToolExecution.executionMode */
  executionMode: string;
  durationMs: number | null;
  createdAt: Date;
  routeContext: string | null;
  apiTokenId: string | null;
  skillId: string | null;
};

export type EfficiencyActionKind =
  | "add_skill"
  | "merge_tools"
  | "webhook_or_event"
  | "fix_instructions"
  | "investigate";

export type EfficiencyFindingKind =
  | "thrash"
  | "retry_storm"
  | "high_volume"
  | "high_failure";

export type EfficiencyFinding = {
  kind: EfficiencyFindingKind;
  severity: "info" | "warning" | "critical";
  toolName: string;
  title: string;
  detail: string;
  evidence: {
    count: number;
    failCount?: number;
    threadId?: string;
    agentId?: string;
    surface?: string;
    sampleIds: string[];
  };
  recommendedAction: EfficiencyActionKind;
  /** Rough token-waste heuristic: extra calls beyond a healthy baseline. */
  wasteCallEstimate: number;
};

export type CallEfficiencyReport = {
  windowStart: string;
  windowEnd: string;
  totalCalls: number;
  successRate: number;
  bySurface: Array<{ surface: string; count: number; failCount: number }>;
  topTools: Array<{
    toolName: string;
    count: number;
    failCount: number;
    successRate: number;
    avgDurationMs: number | null;
  }>;
  findings: EfficiencyFinding[];
  /** Operator-facing summary of whether ledger is usable for optimization. */
  ledgerSufficiency: {
    usable: boolean;
    note: string;
  };
};

export type AnalyzeCallEfficiencyOptions = {
  /** Same tool count in one thread to flag thrash. Default 8. */
  thrashThreshold?: number;
  /** Absolute min calls for high_volume. Default 25. */
  highVolumeFloor?: number;
  /** Fail rate (0–1) for high_failure. Default 0.35. */
  highFailureRate?: number;
  /** Min samples for high_failure. Default 8. */
  highFailureMinSamples?: number;
  /** Max ms between fail and same-tool retry. Default 120_000. */
  retryWindowMs?: number;
  /** Min fail→retry pairs for retry_storm. Default 3. */
  retryStormMin?: number;
  /** Max findings returned (sorted by severity then waste). Default 25. */
  maxFindings?: number;
};

const POLL_HINT =
  /^(get_|list_|query_|search_|read_|status|watch|poll|check_)/i;

function surfaceLabel(e: CallEfficiencyEvent): string {
  if (e.apiTokenId) return `external-pat:${e.executionMode}`;
  return e.executionMode || "unknown";
}

function severityRank(s: EfficiencyFinding["severity"]): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}

function recommendForTool(toolName: string, kind: EfficiencyFindingKind): EfficiencyActionKind {
  if (kind === "retry_storm" || kind === "high_failure") return "fix_instructions";
  if (kind === "thrash") {
    if (POLL_HINT.test(toolName)) return "webhook_or_event";
    return "add_skill";
  }
  if (kind === "high_volume") {
    if (POLL_HINT.test(toolName)) return "webhook_or_event";
    if (/^list_|^search_|^query_/.test(toolName)) return "merge_tools";
    return "investigate";
  }
  return "investigate";
}

/**
 * Analyze a bag of call events and produce ranked efficiency findings.
 */
export function analyzeCallEfficiency(
  events: CallEfficiencyEvent[],
  opts: AnalyzeCallEfficiencyOptions = {},
): CallEfficiencyReport {
  const thrashThreshold = opts.thrashThreshold ?? 8;
  const highVolumeFloor = opts.highVolumeFloor ?? 25;
  const highFailureRate = opts.highFailureRate ?? 0.35;
  const highFailureMinSamples = opts.highFailureMinSamples ?? 8;
  const retryWindowMs = opts.retryWindowMs ?? 120_000;
  const retryStormMin = opts.retryStormMin ?? 3;
  const maxFindings = opts.maxFindings ?? 25;

  const sorted = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const windowStart =
    sorted[0]?.createdAt.toISOString() ?? new Date(0).toISOString();
  const windowEnd =
    sorted[sorted.length - 1]?.createdAt.toISOString() ??
    new Date(0).toISOString();

  const totalCalls = sorted.length;
  const successCount = sorted.filter((e) => e.success).length;
  const successRate = totalCalls > 0 ? successCount / totalCalls : 1;

  // Surface rollup
  const surfaceMap = new Map<string, { count: number; failCount: number }>();
  for (const e of sorted) {
    const s = surfaceLabel(e);
    const row = surfaceMap.get(s) ?? { count: 0, failCount: 0 };
    row.count += 1;
    if (!e.success) row.failCount += 1;
    surfaceMap.set(s, row);
  }
  const bySurface = Array.from(surfaceMap.entries())
    .map(([surface, v]) => ({ surface, ...v }))
    .sort((a, b) => b.count - a.count);

  // Per-tool rollup
  const toolMap = new Map<
    string,
    { count: number; failCount: number; durationSum: number; durationN: number }
  >();
  for (const e of sorted) {
    const row = toolMap.get(e.toolName) ?? {
      count: 0,
      failCount: 0,
      durationSum: 0,
      durationN: 0,
    };
    row.count += 1;
    if (!e.success) row.failCount += 1;
    if (e.durationMs != null) {
      row.durationSum += e.durationMs;
      row.durationN += 1;
    }
    toolMap.set(e.toolName, row);
  }
  const topTools = Array.from(toolMap.entries())
    .map(([toolName, v]) => ({
      toolName,
      count: v.count,
      failCount: v.failCount,
      successRate: v.count > 0 ? (v.count - v.failCount) / v.count : 1,
      avgDurationMs: v.durationN > 0 ? v.durationSum / v.durationN : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const findings: EfficiencyFinding[] = [];

  // Thrash: per (threadId, toolName)
  const thrashMap = new Map<string, CallEfficiencyEvent[]>();
  for (const e of sorted) {
    if (!e.threadId) continue;
    const key = `${e.threadId}::${e.toolName}`;
    const list = thrashMap.get(key) ?? [];
    list.push(e);
    thrashMap.set(key, list);
  }
  for (const [, list] of thrashMap) {
    if (list.length < thrashThreshold) continue;
    const head = list[0]!;
    const waste = list.length - Math.max(2, Math.floor(thrashThreshold / 2));
    findings.push({
      kind: "thrash",
      severity: list.length >= thrashThreshold * 2 ? "critical" : "warning",
      toolName: head.toolName,
      title: `Thrash: ${head.toolName} ×${list.length} in one thread`,
      detail:
        `Thread ${head.threadId} called ${head.toolName} ${list.length} times ` +
        `(threshold ${thrashThreshold}). Likely missing skill, over-broad tool, or poll loop.`,
      evidence: {
        count: list.length,
        threadId: head.threadId,
        agentId: head.agentId,
        surface: surfaceLabel(head),
        sampleIds: list.slice(0, 5).map((x) => x.id),
      },
      recommendedAction: recommendForTool(head.toolName, "thrash"),
      wasteCallEstimate: Math.max(0, waste),
    });
  }

  // Retry storm: fail then same tool within retryWindowMs (per thread)
  const byThread = new Map<string, CallEfficiencyEvent[]>();
  for (const e of sorted) {
    if (!e.threadId) continue;
    const list = byThread.get(e.threadId) ?? [];
    list.push(e);
    byThread.set(e.threadId, list);
  }
  for (const [threadId, list] of byThread) {
    const pairs = new Map<string, { n: number; ids: string[]; agentId: string }>();
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.success) continue;
      if (a.toolName !== b.toolName) continue;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      if (dt < 0 || dt > retryWindowMs) continue;
      const row = pairs.get(a.toolName) ?? {
        n: 0,
        ids: [],
        agentId: a.agentId,
      };
      row.n += 1;
      if (row.ids.length < 5) row.ids.push(a.id, b.id);
      pairs.set(a.toolName, row);
    }
    for (const [toolName, row] of pairs) {
      if (row.n < retryStormMin) continue;
      findings.push({
        kind: "retry_storm",
        severity: row.n >= retryStormMin * 2 ? "critical" : "warning",
        toolName,
        title: `Retry storm: ${toolName} (${row.n} fail→retry pairs)`,
        detail:
          `Thread ${threadId} retried ${toolName} after failure ${row.n} times ` +
          `within ${retryWindowMs / 1000}s windows. Fix tool errors or agent instructions.`,
        evidence: {
          count: row.n,
          threadId,
          agentId: row.agentId,
          sampleIds: row.ids.slice(0, 5),
        },
        recommendedAction: "fix_instructions",
        wasteCallEstimate: row.n,
      });
    }
  }

  // High volume / high failure from tool rollup
  for (const t of topTools) {
    if (t.count >= highVolumeFloor) {
      findings.push({
        kind: "high_volume",
        severity: t.count >= highVolumeFloor * 3 ? "critical" : "warning",
        toolName: t.toolName,
        title: `High volume: ${t.toolName} (${t.count} calls)`,
        detail:
          `${t.toolName} accounts for ${t.count} calls in the window ` +
          `(${(t.successRate * 100).toFixed(0)}% success). Candidate for skill packaging, ` +
          `richer tool, or event/webhook replacement if status-polling.`,
        evidence: {
          count: t.count,
          failCount: t.failCount,
          sampleIds: sorted
            .filter((e) => e.toolName === t.toolName)
            .slice(0, 5)
            .map((e) => e.id),
        },
        recommendedAction: recommendForTool(t.toolName, "high_volume"),
        wasteCallEstimate: Math.max(0, t.count - highVolumeFloor),
      });
    }
    if (
      t.count >= highFailureMinSamples &&
      t.failCount / t.count >= highFailureRate
    ) {
      findings.push({
        kind: "high_failure",
        severity: t.failCount / t.count >= 0.6 ? "critical" : "warning",
        toolName: t.toolName,
        title: `High failure: ${t.toolName} (${(t.failCount / t.count * 100).toFixed(0)}%)`,
        detail:
          `${t.failCount}/${t.count} calls failed. Agents may be retrying blindly — ` +
          `fix tool contract, grants, or skill guidance.`,
        evidence: {
          count: t.count,
          failCount: t.failCount,
          sampleIds: sorted
            .filter((e) => e.toolName === t.toolName && !e.success)
            .slice(0, 5)
            .map((e) => e.id),
        },
        recommendedAction: "fix_instructions",
        wasteCallEstimate: t.failCount,
      });
    }
  }

  findings.sort((a, b) => {
    const sr = severityRank(a.severity) - severityRank(b.severity);
    if (sr !== 0) return sr;
    return b.wasteCallEstimate - a.wasteCallEstimate;
  });

  const usable = totalCalls >= 10;
  return {
    windowStart,
    windowEnd,
    totalCalls,
    successRate,
    bySurface,
    topTools,
    findings: findings.slice(0, maxFindings),
    ledgerSufficiency: {
      usable,
      note: usable
        ? "ToolExecution volume is sufficient for thrash/volume/failure findings. tools/list and pre-auth denials remain unlogged gaps."
        : "Too few ToolExecution rows in window for reliable optimization; collect more traffic or widen the window.",
    },
  };
}
