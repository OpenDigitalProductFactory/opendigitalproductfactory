import { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/routing/routing-architecture-version";
import {
  projectRoutingEvidenceConformance,
  type RoutingEvidenceAdapterRunRow,
  type RoutingEvidenceCapacityRow,
  type RoutingEvidenceConformanceProjection,
  type RoutingEvidenceDecisionRow,
  type RoutingEvidenceOutcomeRow,
  type RoutingEvidenceProviderRow,
  type RoutingEvidenceTokenUsageRow,
} from "./routing-evidence-conformance";

type LoadedDecision = Omit<RoutingEvidenceDecisionRow, "screenReceipt">;
type LoadedAdapterRun = Omit<RoutingEvidenceAdapterRunRow, "estimatedCostUsd"> & {
  estimatedCostUsd: unknown;
};

/**
 * Privacy boundary between Prisma rows and the owner-facing projection.
 *
 * The loader can pass rows with additional selected fields, but this adapter
 * reconstructs the exact safe contract. The sensitive-routing dependency will
 * add the privacy-safe screen receipt; until it lands, coverage is honestly
 * reported as absent instead of inferred from request content.
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
      screenReceipt: null,
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
