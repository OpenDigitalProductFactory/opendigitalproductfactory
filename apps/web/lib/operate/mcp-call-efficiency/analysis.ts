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
  /**
   * A failed call where a policy correctly declined the action, rather than the
   * tool breaking. Counted separately from failures so a working gate is never
   * reported as a misbehaving tool (see refusal-codes.ts).
   */
  governedRefusal?: boolean;
  /** GovernedExecuteSource / ToolExecution.executionMode */
  executionMode: string;
  durationMs: number | null;
  createdAt: Date;
  routeContext: string | null;
  apiTokenId: string | null;
  skillId: string | null;
  /** Tool arguments captured by ToolExecution; used only for safe correlation hints. */
  parameters: unknown;
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
    correlationId?: string;
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
    /** Calls a policy correctly declined; excluded from failCount and successRate. */
    refusalCount: number;
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
  /** Same tool count in one correlated execution to flag thrash. Default 8. */
  thrashThreshold?: number;
  /** Calls from one correlated execution for high_volume. Default 25. */
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

/**
 * Minimum healthy intervals for unattended edge routes. These are analysis
 * policy bounds, not runtime configuration: traffic faster than the bound is
 * still reported, while traffic at or below it is recognized as liveness.
 */
const ROUTINE_MACHINE_MIN_INTERVAL_MS: Readonly<Record<string, number>> = {
  "edge.heartbeat": 60_000,
  "edge.discovery_runs.submit": 300_000,
  "edge.federation_candidates.submit": 90_000,
  // The local-CI gate owns a two-minute lease and renews at TTL / 3. Thirty
  // seconds leaves room for scheduler jitter while still exposing tight polls.
  "renew_nonprod_environment_lease": 30_000,
};

function recordParameter(
  parameters: unknown,
  key: string,
): string | null {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return null;
  }
  const value = (parameters as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Best available execution correlation, ordered from task-specific to broad.
 * External JSON-RPC calls currently omit threadId and record agentId=unknown,
 * but lease tools carry the durable ownerSessionId in their arguments.
 */
function eventCorrelationId(event: CallEfficiencyEvent): string | null {
  if (event.threadId.trim().length > 0) return `thread:${event.threadId.trim()}`;
  const ownerSessionId = recordParameter(event.parameters, "ownerSessionId");
  if (ownerSessionId) return `owner-session:${ownerSessionId}`;
  const agentId = event.agentId.trim();
  if (agentId.length > 0 && agentId.toLowerCase() !== "unknown") {
    return `agent:${agentId}`;
  }
  return null;
}

function groupByCorrelation(
  events: readonly CallEfficiencyEvent[],
): Map<string, CallEfficiencyEvent[]> {
  const groups = new Map<string, CallEfficiencyEvent[]>();
  for (const event of events) {
    const correlationId = eventCorrelationId(event);
    if (!correlationId) continue;
    const rows = groups.get(correlationId) ?? [];
    rows.push(event);
    groups.set(correlationId, rows);
  }
  return groups;
}

function fitsRoutineMachineCadence(
  events: CallEfficiencyEvent[],
  minimumIntervalMs: number,
): boolean {
  const byPrincipal = groupByCorrelation(events);
  if (events.length > 0 && byPrincipal.size === 0) return false;
  if ([...byPrincipal.values()].reduce((sum, rows) => sum + rows.length, 0) !== events.length) {
    return false;
  }

  for (const rows of byPrincipal.values()) {
    if (rows.length < 2) continue;
    const first = rows[0]!.createdAt.getTime();
    const last = rows[rows.length - 1]!.createdAt.getTime();
    const expected = Math.floor(Math.max(0, last - first) / minimumIntervalMs) + 1;
    // Permit scheduler jitter and one boundary call in a truncated ledger.
    const allowed = Math.ceil(expected * 1.15) + 1;
    if (rows.length > allowed) return false;
  }
  return true;
}

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
    {
      count: number;
      failCount: number;
      refusalCount: number;
      durationSum: number;
      durationN: number;
      events: CallEfficiencyEvent[];
    }
  >();
  for (const e of sorted) {
    const row = toolMap.get(e.toolName) ?? {
      count: 0,
      failCount: 0,
      refusalCount: 0,
      durationSum: 0,
      durationN: 0,
      events: [],
    };
    row.count += 1;
    // A governed refusal is neither a success nor a tool failure: it is the
    // system correctly declining. Counting it as a failure is what filed
    // `fix_instructions` findings against gates that were working.
    if (e.governedRefusal) row.refusalCount += 1;
    else if (!e.success) row.failCount += 1;
    if (e.durationMs != null) {
      row.durationSum += e.durationMs;
      row.durationN += 1;
    }
    row.events.push(e);
    toolMap.set(e.toolName, row);
  }
  const topTools = Array.from(toolMap.entries())
    .map(([toolName, v]) => ({
      toolName,
      count: v.count,
      failCount: v.failCount,
      refusalCount: v.refusalCount,
      // Rate the TOOL on the calls it was actually responsible for. A gate that
      // declines 90% of calls is not a 10%-reliable tool.
      successRate: v.count - v.refusalCount > 0
        ? (v.count - v.refusalCount - v.failCount) / (v.count - v.refusalCount)
        : 1,
      avgDurationMs: v.durationN > 0 ? v.durationSum / v.durationN : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const findings: EfficiencyFinding[] = [];

  let suppressedRoutineCadenceFindings = 0;
  let suppressedAggregateVolumeFindings = 0;

  // Thrash: per best-known execution correlation and tool.
  const thrashMap = new Map<string, CallEfficiencyEvent[]>();
  for (const e of sorted) {
    const correlationId = eventCorrelationId(e);
    if (!correlationId) continue;
    const key = `${correlationId}::${e.toolName}`;
    const list = thrashMap.get(key) ?? [];
    list.push(e);
    thrashMap.set(key, list);
  }
  for (const [, list] of thrashMap) {
    if (list.length < thrashThreshold) continue;
    const head = list[0]!;
    const correlationId = eventCorrelationId(head)!;
    const waste = list.length - Math.max(2, Math.floor(thrashThreshold / 2));
    findings.push({
      kind: "thrash",
      severity: list.length >= thrashThreshold * 2 ? "critical" : "warning",
      toolName: head.toolName,
      title: `Thrash: ${head.toolName} ×${list.length} in one execution`,
      detail:
        `Execution principal ${correlationId} called ${head.toolName} ${list.length} times ` +
        `(threshold ${thrashThreshold}). Likely missing skill, over-broad tool, or poll loop.`,
      evidence: {
        count: list.length,
        ...(head.threadId ? { threadId: head.threadId } : {}),
        agentId: head.agentId,
        correlationId,
        surface: surfaceLabel(head),
        sampleIds: list.slice(0, 5).map((x) => x.id),
      },
      recommendedAction: recommendForTool(head.toolName, "thrash"),
      wasteCallEstimate: Math.max(0, waste),
    });
  }

  // Retry storm: fail then same tool within retryWindowMs (per correlation).
  const byCorrelation = groupByCorrelation(sorted);
  for (const [correlationId, list] of byCorrelation) {
    const pairs = new Map<string, { n: number; refused: number; ids: string[]; agentId: string }>();
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.success) continue;
      if (a.toolName !== b.toolName) continue;
      const dt = b.createdAt.getTime() - a.createdAt.getTime();
      if (dt < 0 || dt > retryWindowMs) continue;
      const row = pairs.get(a.toolName) ?? {
        n: 0,
        refused: 0,
        ids: [] as string[],
        agentId: a.agentId,
      };
      row.n += 1;
      // Retrying a governed refusal is still waste — often worse, because the
      // refusal is non-retryable and the loop cannot terminate by succeeding.
      // But it is the CALLER's loop, not a broken tool, and saying "fix tool
      // errors" sends the reader to the wrong place.
      if (a.governedRefusal) row.refused += 1;
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
        detail: row.refused >= row.n / 2
          ? `Execution principal ${correlationId} retried ${toolName} ${row.n} times within `
            + `${retryWindowMs / 1000}s windows, and ${row.refused} of those followed a GOVERNED REFUSAL `
            + `rather than a tool failure. The policy declined the action; re-calling cannot make it `
            + `succeed. Fix the caller's retry loop — not the tool, and not its instructions on how to `
            + `call it correctly.`
          : `Execution principal ${correlationId} retried ${toolName} after failure ${row.n} times `
            + `within ${retryWindowMs / 1000}s windows. Fix tool errors or agent instructions.`,
        evidence: {
          count: row.n,
          ...(list[0]?.threadId ? { threadId: list[0].threadId } : {}),
          agentId: row.agentId,
          correlationId,
          sampleIds: row.ids.slice(0, 5),
        },
        recommendedAction: "fix_instructions",
        wasteCallEstimate: row.n,
      });
    }
  }

  // High volume / high failure from tool rollup
  for (const t of topTools) {
    const toolEvents = toolMap.get(t.toolName)!.events;
    const routineInterval = ROUTINE_MACHINE_MIN_INTERVAL_MS[t.toolName];
    const routineCadenceHealthy = routineInterval !== undefined && fitsRoutineMachineCadence(
      toolEvents,
      routineInterval,
    );
    if (t.count >= highVolumeFloor && routineCadenceHealthy) {
      suppressedRoutineCadenceFindings += 1;
    } else if (t.count >= highVolumeFloor) {
      const dominant = [...groupByCorrelation(toolEvents).entries()]
        .sort((a, b) => b[1].length - a[1].length)[0];
      if (!dominant || dominant[1].length < highVolumeFloor) {
        suppressedAggregateVolumeFindings += 1;
      } else {
        const [correlationId, correlatedEvents] = dominant;
        const failCount = correlatedEvents.filter((event) => !event.success).length;
        const correlatedSuccessRate =
          (correlatedEvents.length - failCount) / correlatedEvents.length;
        findings.push({
          kind: "high_volume",
          severity: correlatedEvents.length >= highVolumeFloor * 3 ? "critical" : "warning",
          toolName: t.toolName,
          title: `High volume: ${t.toolName} (${correlatedEvents.length} calls)`,
          detail:
            `${t.toolName} accounts for ${correlatedEvents.length} calls from ${correlationId} ` +
            `(${(correlatedSuccessRate * 100).toFixed(0)}% success). Candidate for skill packaging, ` +
            `richer tool, or event/webhook replacement if status-polling.`,
          evidence: {
            count: correlatedEvents.length,
            failCount,
            correlationId,
            sampleIds: correlatedEvents.slice(0, 5).map((event) => event.id),
          },
          recommendedAction: recommendForTool(t.toolName, "high_volume"),
          wasteCallEstimate: Math.max(0, correlatedEvents.length - highVolumeFloor),
        });
      }
    }
    // Rate the tool on the calls it was answerable for. Governed refusals are
    // excluded from both the numerator and the denominator: a gate that declines
    // most of what it is asked is working, and filing `fix_instructions` against
    // it sends the next agent looking for a defect that is not there.
    const answerableCalls = t.count - t.refusalCount;
    const failureRate = answerableCalls > 0 ? t.failCount / answerableCalls : 0;
    if (
      answerableCalls >= highFailureMinSamples &&
      failureRate >= highFailureRate
    ) {
      findings.push({
        kind: "high_failure",
        severity: failureRate >= 0.6 ? "critical" : "warning",
        toolName: t.toolName,
        title: `High failure: ${t.toolName} (${(failureRate * 100).toFixed(0)}%)`,
        detail:
          `${t.failCount}/${answerableCalls} answerable calls failed. Agents may be retrying blindly — ` +
          `fix tool contract, grants, or skill guidance.` +
          (t.refusalCount > 0
            ? ` ${t.refusalCount} further call(s) were governed refusals and are excluded — the policy declined them, the tool did not fail.`
            : ""),
        evidence: {
          count: answerableCalls,
          failCount: t.failCount,
          sampleIds: sorted
            .filter((e) => e.toolName === t.toolName && !e.success && !e.governedRefusal)
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
        ? "ToolExecution volume is sufficient for thrash/volume/failure findings. " +
          (suppressedRoutineCadenceFindings > 0
            ? `${suppressedRoutineCadenceFindings} raw-volume finding(s) were suppressed because calls fit contractual machine cadence. `
            : "") +
          (suppressedAggregateVolumeFindings > 0
            ? `${suppressedAggregateVolumeFindings} raw-volume finding(s) were suppressed because unattributed aggregate traffic did not reach the threshold for one execution principal. `
            : "") +
          "tools/list and pre-auth denials remain unlogged gaps."
        : "Too few ToolExecution rows in window for reliable optimization; collect more traffic or widen the window.",
    },
  };
}
