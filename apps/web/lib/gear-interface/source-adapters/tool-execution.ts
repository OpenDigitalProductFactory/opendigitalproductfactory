// apps/web/lib/gear-interface/source-adapters/tool-execution.ts
//
// Reduction Gear Phase 0 — ToolExecution → GearInterface adapter.
//
// ToolExecution is one of the Ring 1 inner-shaft event types. Phase 0 does NOT
// emit per-tool-execution GearInterface rows (that would multiply volume by
// every governed tool call). This adapter exists so the contract is well-typed
// and tested, ready for Phase 1 when per-tool granularity is added behind a
// per-source feature flag.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.1

import type { GearInterfaceInput } from "../types";

export interface ToolExecutionSource {
  id: string;
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  success: boolean;
  executionMode: string;
  routeContext: string | null;
  durationMs: number | null;
  createdAt: Date;
  capabilityId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

/**
 * Normalize a ToolExecution row into a Ring 1→2 GearInterfaceInput.
 *
 * This is a 1:1 mapping of one tool call to one transmission record. Phase 0
 * does NOT call this in production; it's kept as a pure adapter for tests and
 * Phase 1 wiring.
 */
export function toolExecutionToRing12Input(
  source: ToolExecutionSource,
  options: { organizationId?: string | null } = {},
): GearInterfaceInput {
  const torqueTechnical = source.success ? 1.0 : 0.0;

  return {
    interfaceClass: "internal-adjacent",
    transmissionDirection: "outward",
    innerRing: 1,
    outerRing: 2,
    shaftSourceType: "tool-execution",
    shaftSourceId: source.id,
    sourceEventAt: source.createdAt,
    actorType: "agent",
    actorId: source.agentId,
    intent: source.toolName,
    capabilityName: source.capabilityId ?? source.toolName,
    capabilityVocabularyVersion: "raw-v0",
    archetypeContext: null,
    agentIdForTriple: source.agentId,
    torqueTechnical,
    torqueConfidence: 0.7, // tool success/fail is a strong but imperfect signal
    ratioConsumed: 1, // one tool call = one inner-ring event
    outcomeType: source.success ? "transmission" : "slip",
    slipDetected: !source.success,
    slipReason: source.success ? null : "failed-outcome",
    costUsd: source.costUsd,
    inputTokens: source.inputTokens,
    outputTokens: source.outputTokens,
    durationMs: source.durationMs,
    graderType: "runtime-check",
    organizationId: options.organizationId ?? null,
  };
}
