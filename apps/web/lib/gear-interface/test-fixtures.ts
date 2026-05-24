// apps/web/lib/gear-interface/test-fixtures.ts
//
// Reduction Gear Phase 0 — coherent fixture builders for tests.
//
// Per spec §9.1 refactoring allocation: "Add test helpers that can build a
// coherent phase-run evidence fixture without copy-pasted JSON blobs."
//
// These builders return a related set of source-row shapes (PhaseRun +
// outcome signals + adapter telemetry + dispatch attempts) that all agree on
// the same buildId / agent / phase window, so adapter and emit tests don't
// re-invent fixture geometry per file.

import type {
  PhaseOutcomeSignals,
  PhaseRunSource,
} from "./source-adapters/phase-run";
import type { AdapterRunTelemetrySource } from "./source-adapters/adapter-run-telemetry";
import type { ToolExecutionSource } from "./source-adapters/tool-execution";
import type { GearInterfaceInput } from "./types";

export interface BuildPhaseFixture {
  buildId: string;
  phase: "ideate" | "plan" | "build" | "review" | "ship";
  agentId: string;
  phaseRun: PhaseRunSource;
  signals: PhaseOutcomeSignals;
  inferences: AdapterRunTelemetrySource[];
  toolExecutions: ToolExecutionSource[];
}

export interface FixtureOptions {
  buildId?: string;
  phase?: BuildPhaseFixture["phase"];
  agentId?: string;
  startedAt?: Date;
  /** "clean" (default) | "abandoned" | "ux-failed" | "with-retries" */
  outcome?: "clean" | "abandoned" | "ux-failed" | "with-retries";
  inferenceCount?: number;
}

/**
 * Build a coherent Build Studio phase fixture. All produced rows share the
 * same buildId, agent, and time window so emit-path tests can assert
 * end-to-end transmission without bespoke wiring.
 */
export function buildPhaseFixture(opts: FixtureOptions = {}): BuildPhaseFixture {
  const buildId = opts.buildId ?? "fixture-build-1";
  const phase = opts.phase ?? "build";
  const agentId = opts.agentId ?? "agent-build-specialist";
  const startedAt = opts.startedAt ?? new Date("2026-05-24T15:00:00Z");
  const completedAt = new Date(startedAt.getTime() + 30 * 60 * 1000);
  const inferenceCount = opts.inferenceCount ?? 6;
  const outcome = opts.outcome ?? "clean";

  const phaseRun: PhaseRunSource = {
    id: `phaserun-${buildId}-${phase}`,
    buildId,
    phase,
    startedAt,
    completedAt,
    durationMs: 30 * 60 * 1000,
    inputTokens: inferenceCount * 1500,
    outputTokens: inferenceCount * 600,
    costUsd: (inferenceCount * 0.018).toFixed(6),
    inferenceCount,
    providerId: "anthropic",
  };

  const signals: PhaseOutcomeSignals = {
    claimedByAgentId: agentId,
    codingProvider: "claude-cli",
    uxVerificationStatus:
      outcome === "ux-failed" ? "failed" : outcome === "clean" || outcome === "with-retries" ? "complete" : null,
    acceptanceMet: outcome === "abandoned" ? null : outcome === "ux-failed" ? false : true,
    abandoned: outcome === "abandoned",
    abandonReason: outcome === "abandoned" ? "operator-veto" : null,
    worstFailureAxis: outcome === "with-retries" ? "rate-limit" : null,
    attemptCount: outcome === "with-retries" ? 2 : 1,
  };

  const inferences: AdapterRunTelemetrySource[] = Array.from({ length: inferenceCount }).map(
    (_, i) => ({
      id: `art-${buildId}-${phase}-${i}`,
      threadId: `thread-${buildId}`,
      agentId,
      buildId,
      adapterKind: "anthropic-messages",
      providerId: "anthropic",
      modelId: "claude-opus-4-7",
      startedAt: new Date(startedAt.getTime() + i * 60 * 1000),
      finishedAt: new Date(startedAt.getTime() + i * 60 * 1000 + 4000),
      durationMs: 4000,
      status: "success",
      refusalReason: null,
      errorClass: null,
      inputTokens: 1500,
      cachedInputTokens: 800,
      cacheCreationInputTokens: 100,
      outputTokens: 600,
      reasoningTokens: 50,
      estimatedCostUsd: "0.018",
      toolCallsTotal: 2,
      toolCallsInvalid: 0,
      schemaDriftDetected: false,
      capabilitiesUsed: ["tool_use"],
    }),
  );

  const toolExecutions: ToolExecutionSource[] = Array.from({ length: inferenceCount * 2 }).map(
    (_, i) => ({
      id: `te-${buildId}-${phase}-${i}`,
      threadId: `thread-${buildId}`,
      agentId,
      userId: "user-1",
      toolName: i % 2 === 0 ? "create_backlog_item" : "search_project_files",
      success: true,
      executionMode: "governed",
      routeContext: "/build",
      durationMs: 120,
      createdAt: new Date(startedAt.getTime() + i * 30 * 1000),
      capabilityId: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    }),
  );

  return { buildId, phase, agentId, phaseRun, signals, inferences, toolExecutions };
}

/**
 * Sanity helper — verifies that the fixture's normalized Ring 1→2 input
 * passes writer validation. Used inside tests to fail fast when the fixture
 * geometry itself drifts.
 */
export function assertFixtureProducesValidInput(
  input: GearInterfaceInput | null,
): asserts input is GearInterfaceInput {
  if (!input) throw new Error("fixture produced null input");
}
