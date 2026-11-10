import { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/routing/routing-architecture-version";
import { isRecord } from "@/lib/shared/coerce";
import { VERTICAL_SENSITIVE_DATA_POLICY_PACKS } from "@/lib/inference/data-screening/vertical-policy-packs";
import {
  projectRoutingEvidenceConformance,
  type RoutingEvidenceAdapterRunRow,
  type RoutingEvidenceCapacityRow,
  type RoutingEvidenceConformanceProjection,
  type RoutingEvidenceDecisionRow,
  type RoutingEvidenceOutcomeRow,
  type RoutingEvidenceProviderRow,
  type RoutingEvidenceTokenUsageRow,
  type SafeInferenceScreenReceipt,
} from "./routing-evidence-conformance";

type LoadedDecision = Omit<RoutingEvidenceDecisionRow, "screenReceipt"> & {
  inferenceDataScreenReceipt?: unknown;
};
type LoadedAdapterRun = Omit<RoutingEvidenceAdapterRunRow, "estimatedCostUsd"> & {
  estimatedCostUsd: unknown;
};

const knownDataClasses = new Set<string>(VERTICAL_SENSITIVE_DATA_POLICY_PACKS.map((pack) => pack.dataClass));

/**
 * Privacy boundary between Prisma rows and the owner-facing projection.
 *
 * The loader can pass rows with additional selected fields, but this adapter
 * reconstructs the exact safe contract. Missing or invalid receipts remain
 * uncovered; coverage is never inferred from request content.
 */
export function projectLoadedRoutingEvidence(input: {
  window: { start: Date; end: Date } | null;
  decisions: LoadedDecision[];
  adapterRuns: LoadedAdapterRun[];
  outcomes: RoutingEvidenceOutcomeRow[];
  tokenUsage: RoutingEvidenceTokenUsageRow[];
  capacity: RoutingEvidenceCapacityRow[];
  providers: RoutingEvidenceProviderRow[];
}): RoutingEvidenceConformanceProjection {
  const dates = [
    ...input.decisions.map((row) => row.createdAt),
    ...input.adapterRuns.map((row) => row.startedAt),
    ...input.outcomes.map((row) => row.createdAt),
    ...input.tokenUsage.map((row) => row.createdAt),
  ];
  const now = new Date();
  const window = input.window ?? {
    start: dates.length > 0
      ? new Date(Math.min(...dates.map((date) => date.getTime())))
      : now,
    end: now,
  };

  return projectRoutingEvidenceConformance({
    window,
    currentDesignRevision: AI_ROUTING_ARCHITECTURE_VERSION,
    decisions: input.decisions.map((row) => ({
      id: row.id,
      traceId: row.traceId,
      designRevision: row.designRevision,
      agentId: row.agentId,
      actorKind: row.actorKind,
      actorId: row.actorId,
      selectedEndpointId: row.selectedEndpointId,
      selectedModelId: row.selectedModelId,
      taskType: row.taskType,
      sensitivity: row.sensitivity,
      candidateTrace: row.candidateTrace,
      excludedTrace: row.excludedTrace,
      fallbackChain: row.fallbackChain,
      fallbacksUsed: row.fallbacksUsed,
      screenReceipt: projectSafeInferenceScreenReceipt(row.inferenceDataScreenReceipt),
      createdAt: row.createdAt,
    })),
    adapterRuns: input.adapterRuns.map((row) => ({
      id: row.id,
      traceId: row.traceId,
      providerId: row.providerId,
      modelId: row.modelId,
      adapterKind: row.adapterKind,
      status: row.status,
      durationMs: row.durationMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCostUsd: row.estimatedCostUsd === null
        ? null
        : Number(row.estimatedCostUsd),
      startedAt: row.startedAt,
    })),
    outcomes: input.outcomes.map((row) => ({ ...row })),
    tokenUsage: input.tokenUsage.map((row) => ({ ...row })),
    capacity: input.capacity.map((row) => ({ ...row })),
    providers: input.providers.map((row) => ({ ...row })),
  });
}

/** Select only display-safe evidence from the versioned persisted receipt. */
export function projectSafeInferenceScreenReceipt(value: unknown): SafeInferenceScreenReceipt | null {
  if (!isRecord(value) || value.schemaVersion !== "inference-data-screen/v1"
    || typeof value.screenId !== "string" || value.screenId.trim().length === 0
    || (value.routeEffect !== "allow" && value.routeEffect !== "local-only" && value.routeEffect !== "block")
    || (value.transformation !== "none" && value.transformation !== "masked"
      && value.transformation !== "tokenized" && value.transformation !== "blocked")
    || !Array.isArray(value.classifiedDataClasses)
    || !value.classifiedDataClasses.every((entry): entry is string => typeof entry === "string" && knownDataClasses.has(entry))
    || value.rawPayloadStored !== false) return null;
  return {
    screenId: value.screenId,
    routeEffect: value.routeEffect,
    transformation: value.transformation,
    classifiedDataClasses: [...value.classifiedDataClasses],
    rawPayloadStored: false,
  };
}
