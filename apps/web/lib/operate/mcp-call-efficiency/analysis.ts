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

export const MAX_EFFICIENCY_FIELD_CHARS = 1024;

export type EfficiencyCheckpoint = { createdAt: string; id: string };
export type EfficiencyStateStopReason = "state-budget" | "memory-budget" | "field-budget";
type EventHead = Pick<CallEfficiencyEvent, "toolName" | "threadId" | "agentId"> & { surface: string };
type PreviousEvent = Pick<CallEfficiencyEvent, "id" | "toolName" | "agentId" | "success" | "governedRefusal"> & { time: number };
type RetryAggregate = { n: number; refused: number; ids: string[]; agentId: string; firstSeen: number };
type ExecutionGroup = {
  correlationId: string; count: number; failCount: number; first: number; last: number;
  head: EventHead; sampleIds: string[]; retry: RetryAggregate;
};
type ToolAggregate = {
  count: number; failCount: number; refusalCount: number; durationSum: number; durationN: number;
  correlatedCount: number; failureIds: string[]; groups: ExecutionGroup[];
};
type CorrelationAggregate = { firstThreadId: string; order: number; previous: PreviousEvent; previousBytes: number };

/** PostgreSQL COLLATE "C" order for valid Unicode strings, without locale state. */
export function compareEfficiencyIds(a: string, b: string): number {
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const left = a.codePointAt(i)!;
    const right = b.codePointAt(j)!;
    if (left !== right) return left - right;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  return a.length - b.length;
}

function isRoutineMachineCadence(group: ExecutionGroup): boolean {
  const interval = ROUTINE_MACHINE_MIN_INTERVAL_MS[group.head.toolName];
  if (interval === undefined) return false;
  const expected = Math.floor(Math.max(0, group.last - group.first) / interval) + 1;
  return group.count <= Math.ceil(expected * 1.15) + 1;
}

function retainedStringsBytes(...values: string[]): number {
  // UTF-16 payload plus a conservative per-string bookkeeping allowance.
  return values.reduce((sum, value) => sum + value.length * 2 + 64, 0);
}

export function efficiencyBudget(value: number | undefined, fallback: number, ceiling: number, minimum = 1): number {
  return Math.min(ceiling, Math.max(minimum, Math.floor(
    typeof value === "number" && Number.isFinite(value) ? value : fallback,
  )));
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

/** Shared streaming policy. No raw event or argument/result payload is retained. */
export function createCallEfficiencyAccumulator(
  opts: AnalyzeCallEfficiencyOptions & { maxStateEntries?: number; maxRetainedBytes?: number } = {},
) {
  const thrashThreshold = opts.thrashThreshold ?? 8;
  const highVolumeFloor = opts.highVolumeFloor ?? 25;
  const highFailureRate = opts.highFailureRate ?? 0.35;
  const highFailureMinSamples = opts.highFailureMinSamples ?? 8;
  const retryWindowMs = opts.retryWindowMs ?? 120_000;
  const retryStormMin = opts.retryStormMin ?? 3;
  const maxFindings = efficiencyBudget(opts.maxFindings, 25, 100, 0);
  const maxStateEntries = efficiencyBudget(opts.maxStateEntries, 20_000, 20_000, 0);
  const maxRetainedBytes = efficiencyBudget(opts.maxRetainedBytes, 16 * 1024 * 1024, 16 * 1024 * 1024, 0);
  let totalCalls = 0;
  let successCount = 0;
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let checkpoint: EfficiencyCheckpoint | null = null;
  let checkpointBytes = 0;
  let stateEntries = 0;
  let retainedBytes = 0;
  let stopReason: EfficiencyStateStopReason | null = null;
  const surfaceMap = new Map<string, { count: number; failCount: number }>();
  const toolMap = new Map<string, ToolAggregate>();
  const groups = new Map<string, ExecutionGroup>();
  const correlations = new Map<string, CorrelationAggregate>();

  function push(e: CallEfficiencyEvent): boolean {
    if (stopReason) return false;
    const time = e.createdAt.getTime();
    if (!Number.isFinite(time) || (lastTime !== null && (time < lastTime ||
      (time === lastTime && compareEfficiencyIds(e.id, checkpoint!.id) <= 0)))) {
      throw new Error("Efficiency events must have unique identities in (createdAt, id) order");
    }
    const owner = recordParameter(e.parameters, "ownerSessionId") ?? "";
    if ([e.id, e.toolName, e.threadId, e.agentId, e.executionMode, owner]
      .some((value) => value.length > MAX_EFFICIENCY_FIELD_CHARS)) {
      stopReason = "field-budget";
      return false;
    }
    const surface = surfaceLabel(e);
    const correlationId = eventCorrelationId(e);
    const key = correlationId === null ? null : JSON.stringify([correlationId, e.toolName]);
    const tool = toolMap.get(e.toolName);
    const group = key === null ? undefined : groups.get(key);
    const correlation = correlationId === null ? undefined : correlations.get(correlationId);
    const previous = correlation?.previous;
    const retry = previous && !previous.success && previous.toolName === e.toolName &&
      time - previous.time <= retryWindowMs;
    const newEntries = Number(!surfaceMap.has(surface)) + Number(!tool) +
      Number(correlationId !== null && !correlation) + Number(key !== null && !group);
    const previousBytes = retainedStringsBytes(e.id, e.toolName, e.agentId);
    const nextCheckpointBytes = retainedStringsBytes(e.id);
    // Charges include aggregate objects, map/array entries and bounded samples.
    // This is a conservative retained-state estimate, not a JS heap measurement.
    const addedBytes = newEntries * 1024 +
      (!surfaceMap.has(surface) ? retainedStringsBytes(surface) : 0) +
      (!tool ? retainedStringsBytes(e.toolName) : 0) +
      (correlationId !== null && !correlation ? retainedStringsBytes(correlationId, e.threadId) : 0) +
      (key !== null && !group ? retainedStringsBytes(key, e.toolName, e.threadId, e.agentId, surface) : 0) +
      (key !== null && (!group || group.sampleIds.length < 5) ? retainedStringsBytes(e.id) : 0) +
      (!e.success && !e.governedRefusal && (!tool || tool.failureIds.length < 5) ? retainedStringsBytes(e.id) : 0) +
      (retry && group && group.retry.ids.length < 5 ? retainedStringsBytes(previous.id, e.id) : 0) +
      (retry && group?.retry.n === 0 ? retainedStringsBytes(previous.agentId) : 0) +
      (correlationId !== null ? Math.max(0, previousBytes - (correlation?.previousBytes ?? 0)) : 0) +
      Math.max(0, nextCheckpointBytes - checkpointBytes);
    if (stateEntries + newEntries > maxStateEntries || retainedBytes + addedBytes > maxRetainedBytes) {
      stopReason = stateEntries + newEntries > maxStateEntries ? "state-budget" : "memory-budget";
      return false;
    }
    stateEntries += newEntries;
    retainedBytes += addedBytes;
    checkpointBytes = Math.max(checkpointBytes, nextCheckpointBytes);
    totalCalls += 1;
    if (e.success) successCount += 1;
    firstTime ??= time;
    lastTime = time;
    checkpoint = { createdAt: e.createdAt.toISOString(), id: e.id };
    const surfaceRow = surfaceMap.get(surface) ?? { count: 0, failCount: 0 };
    surfaceRow.count += 1;
    if (!e.success) surfaceRow.failCount += 1;
    surfaceMap.set(surface, surfaceRow);
    const toolRow = tool ?? {
      count: 0, failCount: 0, refusalCount: 0, durationSum: 0, durationN: 0,
      correlatedCount: 0, failureIds: [], groups: [],
    };
    toolRow.count += 1;
    if (e.governedRefusal) toolRow.refusalCount += 1;
    else if (!e.success) {
      toolRow.failCount += 1;
      if (toolRow.failureIds.length < 5) toolRow.failureIds.push(e.id);
    }
    if (e.durationMs != null) { toolRow.durationSum += e.durationMs; toolRow.durationN += 1; }
    toolMap.set(e.toolName, toolRow);
    if (correlationId !== null && key !== null) {
      const groupRow = group ?? {
        correlationId, count: 0, failCount: 0, first: time, last: time,
        head: { toolName: e.toolName, threadId: e.threadId, agentId: e.agentId, surface },
        sampleIds: [], retry: { n: 0, refused: 0, ids: [], agentId: "", firstSeen: 0 },
      };
      if (!group) { groups.set(key, groupRow); toolRow.groups.push(groupRow); }
      groupRow.count += 1;
      groupRow.last = time;
      if (!e.success) groupRow.failCount += 1;
      if (groupRow.sampleIds.length < 5) groupRow.sampleIds.push(e.id);
      toolRow.correlatedCount += 1;
      if (retry) {
        const pair = groupRow.retry;
        if (pair.n === 0) { pair.agentId = previous.agentId; pair.firstSeen = totalCalls; }
        pair.n += 1;
        if (previous.governedRefusal) pair.refused += 1;
        if (pair.ids.length < 5) pair.ids.push(...[previous.id, e.id].slice(0, 5 - pair.ids.length));
      }
      correlations.set(correlationId, {
        firstThreadId: correlation?.firstThreadId ?? e.threadId,
        order: correlation?.order ?? correlations.size,
        previous: { id: e.id, toolName: e.toolName, agentId: e.agentId, success: e.success,
          governedRefusal: e.governedRefusal, time },
        previousBytes: Math.max(correlation?.previousBytes ?? 0, previousBytes),
      });
    }
    return true;
  }

  function finish(): CallEfficiencyReport {
    const windowStart = new Date(firstTime ?? 0).toISOString();
    const windowEnd = new Date(lastTime ?? 0).toISOString();
    const successRate = totalCalls > 0 ? successCount / totalCalls : 1;
    const bySurface = Array.from(surfaceMap.entries())
      .map(([surface, v]) => ({ surface, ...v }))
      .sort((a, b) => b.count - a.count);

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
    function addFinding(finding: EfficiencyFinding) {
      const position = findings.findIndex((prior) =>
        severityRank(finding.severity) < severityRank(prior.severity) ||
        (finding.severity === prior.severity && finding.wasteCallEstimate > prior.wasteCallEstimate));
      if (position < 0) findings.push(finding);
      else findings.splice(position, 0, finding);
      if (findings.length > maxFindings) findings.pop();
    }

    let suppressedRoutineCadenceFindings = 0;
    let suppressedAggregateVolumeFindings = 0;

    // Thrash: per best-known execution correlation and tool.
    for (const group of groups.values()) {
      if (group.count < thrashThreshold) continue;
      const head = group.head;
      if (isRoutineMachineCadence(group)) {
        suppressedRoutineCadenceFindings += 1;
        continue;
      }
      const correlationId = group.correlationId;
      const waste = group.count - Math.max(2, Math.floor(thrashThreshold / 2));
      addFinding({
        kind: "thrash",
        severity: group.count >= thrashThreshold * 2 ? "critical" : "warning",
        toolName: head.toolName,
        title: `Thrash: ${head.toolName} ×${group.count} in one execution`,
        detail:
          `Execution principal ${correlationId} called ${head.toolName} ${group.count} times ` +
          `(threshold ${thrashThreshold}). Likely missing skill, over-broad tool, or poll loop.`,
        evidence: {
          count: group.count,
          ...(head.threadId ? { threadId: head.threadId } : {}),
          agentId: head.agentId,
          correlationId,
          surface: head.surface,
          sampleIds: [...group.sampleIds],
        },
        recommendedAction: recommendForTool(head.toolName, "thrash"),
        wasteCallEstimate: Math.max(0, waste),
      });
    }

    // Retry storm: fail then same tool within retryWindowMs (per correlation).
    const retryGroups = [...groups.values()].filter((group) => group.retry.n >= retryStormMin)
      .sort((a, b) => correlations.get(a.correlationId)!.order - correlations.get(b.correlationId)!.order ||
        a.retry.firstSeen - b.retry.firstSeen);
    for (const group of retryGroups) {
        const correlationId = group.correlationId;
        const toolName = group.head.toolName;
        const row = group.retry;
        const firstThreadId = correlations.get(correlationId)!.firstThreadId;
        addFinding({
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
            ...(firstThreadId ? { threadId: firstThreadId } : {}),
            agentId: row.agentId,
            correlationId,
            sampleIds: row.ids.slice(0, 5),
          },
          recommendedAction: "fix_instructions",
          wasteCallEstimate: row.n,
        });
    }

    // High volume / high failure from tool rollup
    for (const t of topTools) {
      const tool = toolMap.get(t.toolName)!;
      const routineCadenceHealthy = tool.correlatedCount === tool.count &&
        tool.groups.length > 0 && tool.groups.every(isRoutineMachineCadence);
      if (t.count >= highVolumeFloor && routineCadenceHealthy) {
        suppressedRoutineCadenceFindings += 1;
      } else if (t.count >= highVolumeFloor) {
        const dominant = tool.groups.reduce<ExecutionGroup | undefined>((best, group) =>
          !best || group.count > best.count ? group : best, undefined);
        if (!dominant || dominant.count < highVolumeFloor) {
          suppressedAggregateVolumeFindings += 1;
        } else {
          const { correlationId, failCount } = dominant;
          const correlatedSuccessRate =
            (dominant.count - failCount) / dominant.count;
          addFinding({
            kind: "high_volume",
            severity: dominant.count >= highVolumeFloor * 3 ? "critical" : "warning",
            toolName: t.toolName,
            title: `High volume: ${t.toolName} (${dominant.count} calls)`,
            detail:
              `${t.toolName} accounts for ${dominant.count} calls from ${correlationId} ` +
              `(${(correlatedSuccessRate * 100).toFixed(0)}% success). Candidate for skill packaging, ` +
              `richer tool, or event/webhook replacement if status-polling.`,
            evidence: {
              count: dominant.count,
              failCount,
              correlationId,
              sampleIds: [...dominant.sampleIds],
            },
            recommendedAction: recommendForTool(t.toolName, "high_volume"),
            wasteCallEstimate: Math.max(0, dominant.count - highVolumeFloor),
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
        addFinding({
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
            sampleIds: [...tool.failureIds],
          },
          recommendedAction: "fix_instructions",
          wasteCallEstimate: t.failCount,
        });
      }
    }

    const usable = totalCalls >= 10 && stopReason === null;
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
        note: stopReason ? `Partial diagnostics: ${stopReason}; no complete-window conclusion is available.` : usable
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

  return {
    push,
    finish,
    get stats() {
      return { stateEntries, estimatedRetainedBytes: retainedBytes, includedCount: totalCalls,
        lastProcessed: checkpoint ? { ...checkpoint } : null, stopReason };
    },
  };
}

/** Compatibility adapter for callers that already have an in-memory bag. */
export function analyzeCallEfficiency(
  events: CallEfficiencyEvent[],
  opts: AnalyzeCallEfficiencyOptions = {},
): CallEfficiencyReport {
  const accumulator = createCallEfficiencyAccumulator(opts);
  const sorted = [...events].sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || compareEfficiencyIds(a.id, b.id));
  for (const event of sorted) {
    if (!accumulator.push(event)) {
      throw new Error(`Efficiency input exceeds ${accumulator.stats.stopReason}; use the window scanner for partial diagnostics`);
    }
  }
  return accumulator.finish();
}
