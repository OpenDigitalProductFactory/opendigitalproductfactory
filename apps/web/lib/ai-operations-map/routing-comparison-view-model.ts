import {
  AI_ROUTING_STAGES,
  type AiRoutingSourceStatus,
  type AiRoutingStage,
} from "@/lib/ea/ai-routing-architecture-registry";
import type {
  RoutingConformanceFinding,
  RoutingEvidenceConformanceProjection,
} from "./routing-evidence-conformance";

export type RoutingArchitectureMode = "designed" | "observed" | "compare";
export type OwnerRoutingStationId =
  | "ask-context"
  | "data-safety"
  | "eligible-routes"
  | "select-dispatch"
  | "evidence-return";

export type OwnerRoutingStationDefinition = {
  id: OwnerRoutingStationId;
  sequence: number;
  label: string;
  shortLabel: string;
  description: string;
  stageIds: readonly string[];
};

export const OWNER_ROUTING_STATIONS: readonly OwnerRoutingStationDefinition[] = [
  {
    id: "ask-context",
    sequence: 1,
    label: "Ask & context",
    shortLabel: "Ask",
    description: "A coworker asks for AI help and assembles the minimum work context.",
    stageIds: ["request", "assemble-payload"],
  },
  {
    id: "data-safety",
    sequence: 2,
    label: "Data safety",
    shortLabel: "Safety",
    description: "Classify the work and data, apply policy, protect values, or stop safely.",
    stageIds: [
      "sensitive-screen",
      "resolve-governed-context",
      "data-policy-decision",
      "data-policy-gateway",
      "protect-payload",
      "local-review-or-stop",
    ],
  },
  {
    id: "eligible-routes",
    sequence: 3,
    label: "Eligible & available routes",
    shortLabel: "Routes",
    description: "Keep only routes that satisfy capability, boundary, availability, and fallback obligations.",
    stageIds: [
      "compile-request-contract",
      "route-eligibility",
      "eligible-route-gateway",
      "availability-and-limits",
      "availability-gateway",
      "eligible-fallback",
      "fallback-gateway",
    ],
  },
  {
    id: "select-dispatch",
    sequence: 4,
    label: "Select & dispatch",
    shortLabel: "Dispatch",
    description: "Balance quality, time, and cost, then call the selected local or external adapter.",
    stageIds: ["rank-quality-time-cost", "dispatch"],
  },
  {
    id: "evidence-return",
    sequence: 5,
    label: "Evidence & return",
    shortLabel: "Return",
    description: "Record privacy-safe evidence and return only the response this actor may receive.",
    stageIds: [
      "record-safe-receipt",
      "rehydration-gateway",
      "return-masked-response",
      "return-authorized-response",
    ],
  },
] as const;

export type RoutingStationMetric = {
  id: string;
  label: string;
  value: string;
  numericValue: number | null;
  help: string;
};

export type RoutingComparisonStage = Pick<
  AiRoutingStage,
  "id" | "ownerLabel" | "technicalName" | "lane" | "bpmnTypeSlug"
> & {
  source: {
    path: string;
    symbol: string | null;
    version: string;
    status: AiRoutingSourceStatus;
  };
};

export type RoutingComparisonStation = Omit<OwnerRoutingStationDefinition, "stageIds"> & {
  stages: RoutingComparisonStage[];
  metrics: RoutingStationMetric[];
  findings: RoutingConformanceFinding[];
  designStatusCounts: Record<AiRoutingSourceStatus, number>;
};

export type RoutingComparisonViewModel = {
  mode: RoutingArchitectureMode;
  showDesigned: boolean;
  showObserved: boolean;
  designRevision: string;
  evidenceWindow: { start: string; end: string };
  /**
   * When the evidence ledger begins — the earliest design-bound decision in the
   * window. Shown so an owner can tell "we have no record" apart from "the
   * platform did something wrong" (BI-A4BC02BE). Null when the window holds no
   * stamped decision, so the boundary cannot be located.
   */
  instrumentedSince: string | null;
  latestEvidenceAt: string | null;
  focusedStationId: OwnerRoutingStationId | null;
  summary: {
    title: string;
    decisionVolume: number;
    findingCount: number;
    criticalFindingCount: number;
    screenCoverageRate: number;
    designBindingRate: number;
    correlationRate: number;
  };
  stations: RoutingComparisonStation[];
};

type BuildOptions = {
  mode: RoutingArchitectureMode;
  focusStageId?: string | null;
};

const EMPTY_STATUS_COUNTS: Record<AiRoutingSourceStatus, number> = {
  implemented: 0,
  partial: 0,
  proposed: 0,
};

export function buildRoutingComparisonViewModel(
  evidence: RoutingEvidenceConformanceProjection,
  options: BuildOptions,
): RoutingComparisonViewModel {
  const stageById = new Map(AI_ROUTING_STAGES.map((stage) => [stage.id, stage]));
  const stationByStageId = new Map<string, OwnerRoutingStationId>();
  for (const station of OWNER_ROUTING_STATIONS) {
    for (const stageId of station.stageIds) stationByStageId.set(stageId, station.id);
  }

  const findingsByStation = new Map<OwnerRoutingStationId, RoutingConformanceFinding[]>();
  for (const finding of evidence.findings) {
    const stationId = stationByStageId.get(finding.architectureStageId) ?? "evidence-return";
    const findings = findingsByStation.get(stationId) ?? [];
    findings.push(finding);
    findingsByStation.set(stationId, findings);
  }

  const metricsByStation = buildMetricsByStation(evidence);
  const stations = OWNER_ROUTING_STATIONS.map((definition): RoutingComparisonStation => {
    const stages = definition.stageIds
      .map((stageId) => stageById.get(stageId))
      .filter((stage): stage is AiRoutingStage => Boolean(stage))
      .map(projectStage);
    const designStatusCounts = { ...EMPTY_STATUS_COUNTS };
    for (const stage of stages) designStatusCounts[stage.source.status] += 1;
    return {
      id: definition.id,
      sequence: definition.sequence,
      label: definition.label,
      shortLabel: definition.shortLabel,
      description: definition.description,
      stages,
      metrics: metricsByStation.get(definition.id) ?? [],
      findings: findingsByStation.get(definition.id) ?? [],
      designStatusCounts,
    };
  });

  const findingCount = evidence.findings.reduce((sum, finding) => sum + finding.count, 0);
  return {
    mode: options.mode,
    showDesigned: options.mode !== "observed",
    showObserved: options.mode !== "designed",
    designRevision: evidence.designRevision,
    evidenceWindow: evidence.window,
    instrumentedSince: evidence.coverage.instrumentedSince,
    latestEvidenceAt: evidence.metrics.latestEvidenceAt,
    focusedStationId: options.focusStageId
      ? stationByStageId.get(options.focusStageId) ?? null
      : null,
    summary: {
      title:
        options.mode === "designed"
          ? "How routing is intended to work"
          : options.mode === "observed"
            ? "What the evidence shows"
            : "Design and evidence together",
      decisionVolume: evidence.metrics.decisionVolume,
      findingCount,
      criticalFindingCount: evidence.findings
        .filter((finding) => finding.severity === "error")
        .reduce((sum, finding) => sum + finding.count, 0),
      screenCoverageRate: evidence.coverage.screenCoverageRate,
      designBindingRate: evidence.coverage.designBindingRate,
      correlationRate: evidence.coverage.correlationRate,
    },
    stations,
  };
}

function projectStage(stage: AiRoutingStage): RoutingComparisonStage {
  return {
    id: stage.id,
    ownerLabel: stage.ownerLabel,
    technicalName: stage.technicalName,
    lane: stage.lane,
    bpmnTypeSlug: stage.bpmnTypeSlug,
    source: {
      path: stage.source.path,
      symbol: stage.source.symbol ?? null,
      version: stage.source.version,
      status: stage.source.status,
    },
  };
}

function buildMetricsByStation(
  evidence: RoutingEvidenceConformanceProjection,
): Map<OwnerRoutingStationId, RoutingStationMetric[]> {
  const { coverage, metrics, findings } = evidence;
  const blockedDispatchFindings = findings
    .filter((finding) => finding.issueType === "ai-routing-blocked-path-dispatched")
    .reduce((sum, finding) => sum + finding.count, 0);
  return new Map<OwnerRoutingStationId, RoutingStationMetric[]>([
    ["ask-context", []],
    [
      "data-safety",
      [
        metric("screen-coverage", "Screen coverage", percent(coverage.screenCoverageRate), coverage.screenCoverageRate, "Decisions carrying a privacy-safe screen receipt."),
        metric("blocked-dispatch", "Blocked dispatch findings", integer(blockedDispatchFindings), blockedDispatchFindings, "Evidence that a blocked or local-only path crossed its allowed boundary."),
      ],
    ],
    [
      "eligible-routes",
      [
        metric("decision-volume", "Routing decisions", integer(metrics.decisionVolume), metrics.decisionVolume, "Recorded route-selection decisions in this evidence window."),
        metric("excluded-candidates", "Excluded candidates", integer(metrics.excludedCandidates), metrics.excludedCandidates, "Candidates removed by recorded eligibility constraints."),
        metric("capacity-limited", "Capacity-limited providers", integer(metrics.capacityLimitedProviders), metrics.capacityLimitedProviders, "Providers currently observed at a capacity or limit boundary."),
      ],
    ],
    [
      "select-dispatch",
      [
        metric("adapter-attempts", "Adapter attempts", integer(metrics.adapterAttempts), metrics.adapterAttempts, "Recorded calls through provider adapters."),
        metric("errors", "Adapter errors", integer(metrics.errorAttempts), metrics.errorAttempts, "Adapter attempts with an error outcome."),
        metric("fallbacks", "Fallback attempts", integer(metrics.fallbackAttempts), metrics.fallbackAttempts, "Attempts that used a recorded fallback path."),
        metric("latency-p95", "P95 latency", milliseconds(metrics.latencyP95Ms), metrics.latencyP95Ms, "95th percentile latency for correlated route outcomes."),
        metric("tokens", "Input + output tokens", integer(metrics.inputTokens + metrics.outputTokens), metrics.inputTokens + metrics.outputTokens, "Aggregate token usage for correlated evidence."),
        metric("cost", "Estimated cost", currency(metrics.costUsd), metrics.costUsd, "Recorded estimated provider cost in this evidence window."),
      ],
    ],
    [
      "evidence-return",
      [
        metric("correlation", "Evidence correlation", percent(coverage.correlationRate), coverage.correlationRate, "Decisions joined to adapter, outcome, or usage evidence."),
        metric("design-binding", "Design binding", percent(coverage.designBindingRate), coverage.designBindingRate, "Decisions carrying the governed design revision."),
        metric("freshness", "Evidence freshness", freshness(metrics.evidenceAgeSeconds), metrics.evidenceAgeSeconds, "Age of the newest privacy-safe routing evidence."),
        metric("findings", "Conformance findings", integer(findings.reduce((sum, finding) => sum + finding.count, 0)), findings.length, "Architecture conformance issues found in this evidence window."),
      ],
    ],
  ]);
}

function metric(
  id: string,
  label: string,
  value: string,
  numericValue: number | null,
  help: string,
): RoutingStationMetric {
  return { id, label, value, numericValue, help };
}

function integer(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function milliseconds(value: number | null): string {
  return value == null ? "Not enough evidence" : `${integer(value)} ms`;
}

function freshness(seconds: number | null): string {
  if (seconds == null) return "No evidence";
  if (seconds < 60) return `${integer(seconds)} sec`;
  if (seconds < 3_600) return `${integer(seconds / 60)} min`;
  return `${integer(seconds / 3_600)} hr`;
}
