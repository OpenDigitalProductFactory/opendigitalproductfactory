// apps/web/lib/gear-interface/source-adapters/adapter-run-telemetry.ts
//
// Reduction Gear Phase 0 — AdapterRunTelemetry → GearInterface adapter.
//
// AdapterRunTelemetry is the AI-call telemetry envelope — one row per inference
// call. Phase 0 does NOT emit per-inference GearInterface rows; volume would be
// extreme. The adapter is kept pure for Phase 1 sampling and for fixture tests.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.1

import type { GearInterfaceInput, SlipReason } from "../types";

export interface AdapterRunTelemetrySource {
  id: string;
  threadId: string | null;
  agentId: string | null;
  buildId: string | null;
  adapterKind: string;
  providerId: string;
  modelId: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  status: string;
  refusalReason: string | null;
  errorClass: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: string | number | null;
  toolCallsTotal: number;
  toolCallsInvalid: number;
  schemaDriftDetected: boolean;
  capabilitiesUsed: string[];
}

function statusToOutcome(status: string): {
  torqueTechnical: number;
  outcomeType: GearInterfaceInput["outcomeType"];
  slipReason: SlipReason | null;
} {
  switch (status) {
    case "success":
      return { torqueTechnical: 1.0, outcomeType: "transmission", slipReason: null };
    case "refusal":
      return { torqueTechnical: 0.0, outcomeType: "slip", slipReason: "safety-block" };
    case "policy-block":
      return { torqueTechnical: 0.0, outcomeType: "slip", slipReason: "safety-block" };
    case "timeout":
      return { torqueTechnical: 0.0, outcomeType: "slip", slipReason: "failed-outcome" };
    case "cancelled":
      return { torqueTechnical: 0.0, outcomeType: "slip", slipReason: "human-override" };
    case "error":
    default:
      return { torqueTechnical: 0.0, outcomeType: "slip", slipReason: "failed-outcome" };
  }
}

/**
 * Normalize one AdapterRunTelemetry row into a Ring 1→2 input.
 * The agentId may be null on probes/eval runs — those are excluded by callers
 * before reaching this adapter. We still defend with a default.
 */
export function adapterRunTelemetryToRing12Input(
  source: AdapterRunTelemetrySource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  const { torqueTechnical, outcomeType, slipReason } = statusToOutcome(source.status);

  // Use schema drift / invalid tool calls as a secondary slip signal.
  const slipDetected =
    outcomeType === "slip" || source.toolCallsInvalid > 0 || source.schemaDriftDetected;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 1,
    outerRing: 2,
    shaftSourceType: "tool-execution",
    shaftSourceId: source.id,
    sourceEventAt: source.startedAt,
    actorType: "agent",
    actorId: source.agentId ?? `unknown-agent:${source.providerId}`,
    intent: `inference:${source.adapterKind}`,
    capabilityName: `inference:${source.providerId}/${source.modelId}`,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: null,
    agentIdForTriple: source.agentId ?? `unknown-agent:${source.providerId}`,
    torqueTechnical,
    torqueConfidence: 0.85,
    ratioConsumed: 1,
    outcomeType,
    slipDetected,
    slipReason,
    costUsd: source.estimatedCostUsd ?? null,
    inputTokens: source.inputTokens,
    outputTokens: source.outputTokens,
    cacheCreationInputTokens: source.cacheCreationInputTokens,
    cacheReadInputTokens: source.cachedInputTokens,
    reasoningOutputTokens: source.reasoningTokens,
    durationMs: source.durationMs,
    graderType: "runtime-check",
    organizationId: options.organizationId ?? null,
  };
}
