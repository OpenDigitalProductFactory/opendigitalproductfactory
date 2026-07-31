// Privacy-safe, request-time routing evidence projection.
//
// The projector accepts already-selected safe fields from the canonical route
// ledgers. It deliberately reconstructs its output instead of spreading source
// rows so prompt, tool, detected-value, vendor-account, and token-map content
// cannot leak into Operations Map or EA conformance payloads.

export type SafeInferenceScreenReceipt = {
  screenId: string;
  routeEffect: "allow" | "local-only" | "block";
  transformation: "none" | "masked" | "tokenized" | "blocked";
  classifiedDataClasses: string[];
  rawPayloadStored: false;
};

export type RoutingEvidenceDecisionRow = {
  id: string;
  traceId: string | null;
  designRevision: string | null;
  agentId: string | null;
  actorKind: string | null;
  actorId: string | null;
  selectedEndpointId: string;
  selectedModelId: string | null;
  taskType: string;
  sensitivity: string;
  candidateTrace: unknown;
  excludedTrace: unknown;
  fallbackChain: string[];
  fallbacksUsed: unknown;
  screenReceipt: SafeInferenceScreenReceipt | null;
  createdAt: Date;
};

export type RoutingEvidenceAdapterRunRow = {
  id: string;
  traceId: string | null;
  providerId: string;
  modelId: string;
  adapterKind: string;
  status: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  startedAt: Date;
};

export type RoutingEvidenceOutcomeRow = {
  id: string;
  traceId: string | null;
  providerId: string;
  modelId: string;
  fallbackOccurred: boolean;
  providerErrorCode: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  createdAt: Date;
};

export type RoutingEvidenceTokenUsageRow = {
  id: string;
  traceId: string | null;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: Date;
};

export type RoutingEvidenceCapacityRow = {
  providerId: string;
  state: string;
  lastObservedAt: Date;
};

export type RoutingEvidenceProviderRow = {
  providerId: string;
  category: string | null;
};

export type RoutingEvidenceConformanceInput = {
  window: { start: Date; end: Date };
  currentDesignRevision: string;
  decisions: RoutingEvidenceDecisionRow[];
  adapterRuns: RoutingEvidenceAdapterRunRow[];
  outcomes: RoutingEvidenceOutcomeRow[];
  tokenUsage: RoutingEvidenceTokenUsageRow[];
  capacity: RoutingEvidenceCapacityRow[];
  providers: RoutingEvidenceProviderRow[];
};

export type RoutingEvidenceCoverage = {
  totalDecisions: number;
  attributedDecisions: number;
  tracedDecisions: number;
  correlatedDecisions: number;
  uncorrelatedDecisions: number;
  unevidencedDecisions: number;
  screenCoveredDecisions: number;
  designBoundDecisions: number;
  /**
   * Decisions that SHOULD name a design revision and do not — i.e. recorded
   * after stamping began. Excludes pre-instrumentation history (BI-A4BC02BE).
   */
  unprovenDesignDecisions: number;
  /**
   * Decisions recorded before design-revision stamping existed. Reported as a
   * fact about when the ledger starts, never as a conformance failure.
   */
  preInstrumentationDecisions: number;
  /**
   * ISO timestamp of the earliest design-bound decision in the window — the
   * point the evidence ledger begins. Null when nothing in the window is
   * stamped, in which case the era cannot be located from this window.
   */
  instrumentedSince: string | null;
  staleDesignDecisions: number;
  attributionRate: number;
  traceRate: number;
  correlationRate: number;
  screenCoverageRate: number;
  designBindingRate: number;
};

export type RoutingEvidenceMetrics = {
  decisionVolume: number;
  adapterAttempts: number;
  successfulAttempts: number;
  errorAttempts: number;
  fallbackAttempts: number;
  excludedCandidates: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  capacityLimitedProviders: number;
  latestEvidenceAt: string | null;
  evidenceAgeSeconds: number | null;
};

export type RoutingProviderMetric = {
  providerId: string;
  attempts: number;
  successes: number;
  errors: number;
  attributes: {
    "gen_ai.operation.name": "chat" | "invoke_agent";
    "gen_ai.provider.name": string;
    "gen_ai.request.model": string | null;
    "gen_ai.response.model": string | null;
    "gen_ai.usage.input_tokens": number;
    "gen_ai.usage.output_tokens": number;
  };
};

export type RoutingConformanceIssueType =
  | "ai-routing-evidence-unattributed"
  | "ai-routing-evidence-uncorrelated"
  | "ai-routing-evidence-missing"
  | "ai-routing-design-unproven"
  | "ai-routing-design-stale"
  | "ai-routing-observed-path-unexpected"
  | "ai-routing-blocked-path-dispatched";

/**
 * WHO, if anyone, can act on a finding — BI-C8BC9DD1.
 *
 * The finding contract previously carried only `message` and `count`. An owner
 * asked their coworker "what do I do about these 173 issues?" and no answer was
 * possible, because no remediation existed to retrieve: the coworker burned its
 * whole iteration budget on tool calls and returned a safety-limit message. The
 * failure looked like a coworker defect; the cause was an empty contract.
 *
 * `none-historical` is the load-bearing value. Several findings count traffic
 * recorded BEFORE the evidence ledger existed. They can never reach zero
 * through any action, so presenting them as open work is simply false — the
 * honest statement is that they predate instrumentation.
 */
export type RoutingFindingOwnerAction =
  /** Nothing to do. Historic traffic that predates the evidence contract. */
  | "none-historical"
  /** The workspace owner or operator can resolve this. */
  | "operator"
  /** A platform defect. The owner cannot fix it; it needs a DPF change. */
  | "platform-defect";

export type RoutingConformanceFinding = {
  issueKey: string;
  issueType: RoutingConformanceIssueType;
  severity: "info" | "warn" | "error";
  message: string;
  count: number;
  architectureStageId: string;
  /** Who can act. Drives whether the surface presents this as work at all. */
  ownerAction: RoutingFindingOwnerAction;
  /** Plain-language next step. Never empty — see REMEDIATION below. */
  nextAction: string;
};

/**
 * Owner-facing remediation, one entry per issue type.
 *
 * Static per type and free of request content, so the privacy contract at the
 * top of this file is unaffected: no prompt, detected value, or vendor account
 * can reach the owner through this map.
 *
 * Exhaustive by construction — `Record<RoutingConformanceIssueType, …>` means a
 * new issue type cannot ship without its remediation, which is the guarantee
 * that made the original gap possible.
 */
const REMEDIATION: Record<
  RoutingConformanceIssueType,
  { ownerAction: RoutingFindingOwnerAction; nextAction: string }
> = {
  "ai-routing-evidence-unattributed": {
    ownerAction: "none-historical",
    nextAction:
      "Nothing to do. These routing decisions were recorded before requests carried an actor, so they cannot be attributed retrospectively. New traffic is attributed automatically.",
  },
  "ai-routing-evidence-uncorrelated": {
    ownerAction: "none-historical",
    nextAction:
      "Nothing to do. These decisions predate request-wide trace identifiers, so they cannot be joined to the other ledgers. New traffic is correlated automatically.",
  },
  "ai-routing-evidence-missing": {
    ownerAction: "platform-defect",
    nextAction:
      "No action available to you. A route expected to dispatch recorded no adapter, outcome, or usage row — that is a platform gap in evidence writing, not a setting on this install.",
  },
  "ai-routing-design-unproven": {
    // Reclassified by BI-A4BC02BE. This used to count pre-instrumentation
    // history and was therefore `none-historical`. Those rows are now excluded
    // from the count, so anything that still reaches this finding was recorded
    // AFTER stamping began and failed to carry a revision — a real gap.
    ownerAction: "platform-defect",
    nextAction:
      "No action available to you. These decisions were recorded after design-revision stamping began but did not carry a revision, which is a gap in how the platform records routing evidence.",
  },
  "ai-routing-design-stale": {
    ownerAction: "none-historical",
    nextAction:
      "Nothing to do. This traffic ran against an earlier routing design and is retained as history; it clears from the window as newer traffic accrues.",
  },
  "ai-routing-observed-path-unexpected": {
    ownerAction: "platform-defect",
    nextAction:
      "No action available to you, and this one is worth reporting. A provider was dispatched that the routing decision had not shortlisted, which means the observed path left the governed design.",
  },
  "ai-routing-blocked-path-dispatched": {
    ownerAction: "platform-defect",
    nextAction:
      "No action available to you, and this is the most serious finding on this page. Work that data policy confined to this machine was dispatched across that boundary. Report it.",
  },
};

export type RoutingEvidenceConformanceProjection = {
  schemaVersion: "ai-routing-evidence/v1";
  designRevision: string;
  window: { start: string; end: string };
  coverage: RoutingEvidenceCoverage;
  metrics: RoutingEvidenceMetrics;
  providerMetrics: RoutingProviderMetric[];
  findings: RoutingConformanceFinding[];
};

type CandidateSummary = {
  endpointId: string | null;
  providerId: string | null;
  modelId: string | null;
  excluded: boolean;
};

export function projectRoutingEvidenceConformance(
  input: RoutingEvidenceConformanceInput,
): RoutingEvidenceConformanceProjection {
  const adapterByTrace = groupByTrace(input.adapterRuns);
  const outcomesByTrace = groupByTrace(input.outcomes);
  const usageByTrace = groupByTrace(input.tokenUsage);
  const providerCategory = new Map(
    input.providers.map((provider) => [provider.providerId, provider.category]),
  );

  let attributedDecisions = 0;
  let tracedDecisions = 0;
  let correlatedDecisions = 0;
  let unevidencedDecisions = 0;
  let screenCoveredDecisions = 0;
  let designBoundDecisions = 0;
  let staleDesignDecisions = 0;
  let excludedCandidates = 0;
  let unexpectedPaths = 0;
  let blockedExternalDispatches = 0;

  for (const decision of input.decisions) {
    const candidates = parseCandidates(decision.candidateTrace);
    const excluded = [
      ...parseCandidates(decision.excludedTrace),
      ...candidates.filter((candidate) => candidate.excluded),
    ];
    excludedCandidates += excluded.length;
    if (hasAttribution(decision)) attributedDecisions += 1;
    if (decision.screenReceipt) screenCoveredDecisions += 1;
    if (decision.designRevision) {
      designBoundDecisions += 1;
      if (decision.designRevision !== input.currentDesignRevision) {
        staleDesignDecisions += 1;
      }
    }

    const traceId = normalizeTraceId(decision.traceId);
    if (traceId) tracedDecisions += 1;
    const adapters = traceId ? adapterByTrace.get(traceId) ?? [] : [];
    const outcomes = traceId ? outcomesByTrace.get(traceId) ?? [] : [];
    const usage = traceId ? usageByTrace.get(traceId) ?? [] : [];
    const relatedEvidenceCount = adapters.length + outcomes.length + usage.length;
    if (traceId && relatedEvidenceCount > 0) correlatedDecisions += 1;
    if (isDispatchExpected(decision) && relatedEvidenceCount === 0) {
      unevidencedDecisions += 1;
    }

    const expectedProviders = new Set(
      candidates
        .map((candidate) => candidate.providerId)
        .filter((providerId): providerId is string => Boolean(providerId)),
    );
    const observedProviders = new Set([
      ...adapters.map((row) => row.providerId),
      ...outcomes.map((row) => row.providerId),
    ]);
    for (const observedProvider of observedProviders) {
      if (expectedProviders.size > 0 && !expectedProviders.has(observedProvider)) {
        unexpectedPaths += 1;
      }
      if (
        decision.screenReceipt?.routeEffect === "block" ||
        (
          decision.screenReceipt?.routeEffect === "local-only" &&
          isExternalCategory(providerCategory.get(observedProvider))
        )
      ) {
        blockedExternalDispatches += 1;
      }
    }
  }

  const totalDecisions = input.decisions.length;

  // BI-A4BC02BE — the design-conformance denominator must be the INSTRUMENTED
  // ERA, not the fetch window.
  //
  // `unprovenDesignDecisions` was `totalDecisions - designBoundDecisions`. Since
  // `totalDecisions` is however many rows the loader fetched (WINDOWED_SOURCE_LIMIT,
  // 400) and design stamping began at a fixed point in the past, that expression
  // evaluated to `fetch_limit - total_stamped_rows_in_existence`. It measured the
  // page size, not conformance. Observed live: 400 - 229 = 171, reported to the
  // owner as "171 issues".
  //
  // Two properties made it unfalsifiable. It DECREMENTED by one on every new
  // inference (each adds a stamped row), so it silently self-cleared without any
  // remediation; and it SCALED with the cap, so raising the limit to 1000 would
  // have reported 771 on identical data.
  //
  // A decision recorded before stamping existed can never name a revision. Those
  // are history, not failures. The earliest stamped decision in the window marks
  // where the ledger begins; anything older is pre-instrumentation, and only
  // unstamped decisions at or after that point are genuine conformance gaps.
  //
  // When the window contains no stamped decision at all the boundary cannot be
  // located, so every unstamped row is treated as pre-instrumentation. That errs
  // toward silence rather than toward crying wolf on an install that simply has
  // not routed since stamping shipped.
  const instrumentedSinceDate = earliestDate(
    input.decisions
      .filter((decision) => decision.designRevision)
      .map((decision) => decision.createdAt),
  );
  const preInstrumentationDecisions = input.decisions.filter((decision) =>
    !decision.designRevision &&
    (instrumentedSinceDate === null || decision.createdAt < instrumentedSinceDate)
  ).length;
  const uncorrelatedDecisions = totalDecisions - correlatedDecisions;
  const unprovenDesignDecisions =
    totalDecisions - designBoundDecisions - preInstrumentationDecisions;
  const coverage: RoutingEvidenceCoverage = {
    totalDecisions,
    attributedDecisions,
    tracedDecisions,
    correlatedDecisions,
    uncorrelatedDecisions,
    unevidencedDecisions,
    screenCoveredDecisions,
    designBoundDecisions,
    unprovenDesignDecisions,
    preInstrumentationDecisions,
    instrumentedSince: instrumentedSinceDate?.toISOString() ?? null,
    staleDesignDecisions,
    attributionRate: rate(attributedDecisions, totalDecisions),
    traceRate: rate(tracedDecisions, totalDecisions),
    correlationRate: rate(correlatedDecisions, totalDecisions),
    screenCoverageRate: rate(screenCoveredDecisions, totalDecisions),
    designBindingRate: rate(designBoundDecisions, totalDecisions),
  };

  const latencies = input.adapterRuns
    .map((row) => row.durationMs)
    .filter((value): value is number => value !== null && value >= 0);
  const latestEvidenceAt = latestDate([
    ...input.decisions.map((row) => row.createdAt),
    ...input.adapterRuns.map((row) => row.startedAt),
    ...input.outcomes.map((row) => row.createdAt),
    ...input.tokenUsage.map((row) => row.createdAt),
    ...input.capacity.map((row) => row.lastObservedAt),
  ]);
  const metrics: RoutingEvidenceMetrics = {
    decisionVolume: totalDecisions,
    adapterAttempts: input.adapterRuns.length,
    successfulAttempts: input.adapterRuns.filter((row) => row.status === "success").length,
    errorAttempts: input.adapterRuns.filter((row) => row.status !== "success").length,
    fallbackAttempts: input.outcomes.filter((row) => row.fallbackOccurred).length,
    excludedCandidates,
    inputTokens: sum(input.tokenUsage.map((row) => row.inputTokens)),
    outputTokens: sum(input.tokenUsage.map((row) => row.outputTokens)),
    costUsd: roundMoney(sum(input.tokenUsage.map((row) => row.costUsd))),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    capacityLimitedProviders: input.capacity.filter((row) =>
      /limited|exhausted|throttled|blocked|unavailable/i.test(row.state)
    ).length,
    latestEvidenceAt: latestEvidenceAt?.toISOString() ?? null,
    evidenceAgeSeconds: latestEvidenceAt
      ? Math.max(0, Math.round((input.window.end.getTime() - latestEvidenceAt.getTime()) / 1000))
      : null,
  };

  const findings: RoutingConformanceFinding[] = [];
  addFinding(findings, {
    issueType: "ai-routing-evidence-unattributed",
    severity: "warn",
    count: totalDecisions - attributedDecisions,
    stage: "request",
    message: "Routing decisions cannot be assigned to an actor or coworker in the selected window.",
  });
  addFinding(findings, {
    issueType: "ai-routing-evidence-uncorrelated",
    severity: "warn",
    count: uncorrelatedDecisions,
    stage: "record-safe-receipt",
    message: "Routing decisions cannot be joined to another request ledger by trace ID.",
  });
  addFinding(findings, {
    issueType: "ai-routing-evidence-missing",
    severity: "warn",
    count: unevidencedDecisions,
    stage: "record-safe-receipt",
    message: "A route expected dispatch evidence but no adapter, outcome, or usage row was recorded.",
  });
  addFinding(findings, {
    issueType: "ai-routing-design-unproven",
    severity: "info",
    count: unprovenDesignDecisions,
    stage: "request",
    // No longer "historic": pre-instrumentation rows are excluded from this
    // count, so anything remaining was recorded AFTER stamping began and is a
    // genuine gap (BI-A4BC02BE).
    message: "Traffic recorded since design-revision stamping began does not name the revision it executed against.",
  });
  addFinding(findings, {
    issueType: "ai-routing-design-stale",
    severity: "warn",
    count: staleDesignDecisions,
    stage: "request",
    message: "Observed traffic names a routing design revision other than the current projection.",
  });
  addFinding(findings, {
    issueType: "ai-routing-observed-path-unexpected",
    severity: "error",
    count: unexpectedPaths,
    stage: "dispatch",
    message: "Observed provider dispatch was outside the decision candidate trace.",
  });
  addFinding(findings, {
    issueType: "ai-routing-blocked-path-dispatched",
    severity: "error",
    count: blockedExternalDispatches,
    stage: "dispatch",
    message: "Observed dispatch crossed a route blocked or constrained to local execution by data policy.",
  });

  return {
    schemaVersion: "ai-routing-evidence/v1",
    designRevision: input.currentDesignRevision,
    window: {
      start: input.window.start.toISOString(),
      end: input.window.end.toISOString(),
    },
    coverage,
    metrics,
    providerMetrics: projectProviderMetrics(input),
    findings,
  };
}

function projectProviderMetrics(
  input: RoutingEvidenceConformanceInput,
): RoutingProviderMetric[] {
  const usageByTraceProvider = new Map<string, RoutingEvidenceTokenUsageRow[]>();
  for (const usage of input.tokenUsage) {
    const traceId = normalizeTraceId(usage.traceId);
    if (!traceId) continue;
    const key = `${traceId}:${usage.providerId}`;
    usageByTraceProvider.set(key, [...(usageByTraceProvider.get(key) ?? []), usage]);
  }

  const byProvider = new Map<string, {
    attempts: number;
    successes: number;
    errors: number;
    modelId: string | null;
    inputTokens: number;
    outputTokens: number;
    operation: "chat" | "invoke_agent";
    consumedUsageKeys: Set<string>;
  }>();

  for (const adapter of input.adapterRuns) {
    const current = byProvider.get(adapter.providerId) ?? {
      attempts: 0,
      successes: 0,
      errors: 0,
      modelId: null,
      inputTokens: 0,
      outputTokens: 0,
      operation: "invoke_agent" as const,
      consumedUsageKeys: new Set<string>(),
    };
    current.attempts += 1;
    current.successes += adapter.status === "success" ? 1 : 0;
    current.errors += adapter.status === "success" ? 0 : 1;
    current.modelId = adapter.modelId || current.modelId;
    const traceId = normalizeTraceId(adapter.traceId);
    const usageKey = traceId ? `${traceId}:${adapter.providerId}` : null;
    if (usageKey && !current.consumedUsageKeys.has(usageKey)) {
      const usage = usageByTraceProvider.get(usageKey) ?? [];
      current.inputTokens += sum(usage.map((row) => row.inputTokens));
      current.outputTokens += sum(usage.map((row) => row.outputTokens));
      current.consumedUsageKeys.add(usageKey);
    }
    const decision = traceId
      ? input.decisions.find((row) => normalizeTraceId(row.traceId) === traceId)
      : null;
    if (decision?.taskType === "conversation") current.operation = "chat";
    byProvider.set(adapter.providerId, current);
  }

  return [...byProvider.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerId, metric]) => ({
      providerId,
      attempts: metric.attempts,
      successes: metric.successes,
      errors: metric.errors,
      attributes: {
        "gen_ai.operation.name": metric.operation,
        "gen_ai.provider.name": providerId,
        "gen_ai.request.model": metric.modelId,
        "gen_ai.response.model": metric.modelId,
        "gen_ai.usage.input_tokens": metric.inputTokens,
        "gen_ai.usage.output_tokens": metric.outputTokens,
      },
    }));
}

function addFinding(
  findings: RoutingConformanceFinding[],
  input: {
    issueType: RoutingConformanceFinding["issueType"];
    severity: RoutingConformanceFinding["severity"];
    count: number;
    stage: string;
    message: string;
  },
): void {
  if (input.count <= 0) return;
  const remediation = REMEDIATION[input.issueType];
  findings.push({
    issueKey: input.issueType,
    issueType: input.issueType,
    severity: input.severity,
    message: `${input.message} Count: ${input.count}.`,
    count: input.count,
    architectureStageId: input.stage,
    ownerAction: remediation.ownerAction,
    nextAction: remediation.nextAction,
  });
}

function groupByTrace<T extends { traceId: string | null }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const traceId = normalizeTraceId(row.traceId);
    if (!traceId) continue;
    grouped.set(traceId, [...(grouped.get(traceId) ?? []), row]);
  }
  return grouped;
}

function normalizeTraceId(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
}

function parseCandidates(value: unknown): CandidateSummary[] {
  const rows = Array.isArray(value) ? value : parseJsonArray(value);
  return rows.map((row) => {
    const record = asRecord(row);
    return {
      endpointId: stringOrNull(record.endpointId),
      providerId: stringOrNull(record.providerId),
      modelId: stringOrNull(record.modelId),
      excluded: record.excluded === true,
    };
  });
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasAttribution(decision: RoutingEvidenceDecisionRow): boolean {
  if (decision.agentId?.trim()) return true;
  return Boolean(
    decision.actorId?.trim() &&
    decision.actorKind &&
    decision.actorKind !== "legacy_unattributed",
  );
}

function isDispatchExpected(decision: RoutingEvidenceDecisionRow): boolean {
  return decision.selectedEndpointId.trim().length > 0 &&
    decision.selectedEndpointId !== "none" &&
    decision.screenReceipt?.routeEffect !== "block";
}

function isExternalCategory(category: string | null | undefined): boolean {
  return category !== "local" && category !== "bundled" && category !== "in-process";
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(quantile * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

function latestDate(values: Date[]): Date | null {
  if (values.length === 0) return null;
  return values.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest
  );
}

/** Earliest of the supplied dates; null when there are none (BI-A4BC02BE). */
function earliestDate(values: Date[]): Date | null {
  if (values.length === 0) return null;
  return values.reduce((earliest, value) =>
    value.getTime() < earliest.getTime() ? value : earliest
  );
}
