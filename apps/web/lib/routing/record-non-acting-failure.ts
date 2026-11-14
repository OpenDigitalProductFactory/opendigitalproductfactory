/**
 * DPF2-REMOVABLE BRIDGE MODULE.
 *
 * Penalty writer for the pre-DPF2 non-acting routing bridge. When a
 * `tool-action` turn is classified as non-acting (a fluent reply that never
 * invoked the required tool), this counts the failure against the exact route
 * by emitting a RouteOutcome row (toolSuccess=false) carrying the synthetic
 * non-acting provider error code. That failed outcome is the single durable
 * record of the miss: routing telemetry reflects it, and the time-decayed
 * penalty in cost-ranking's estimateSuccessProbability derives from these
 * non-acting RouteOutcome rows (no separate tally table — single source of
 * truth is RouteOutcome).
 *
 * Delete this file at the DPF2 cutover together with the other bridge
 * consumers listed in non-acting-bridge-config.ts.
 *
 * DB access is fire-and-forget, mirroring route-outcome.ts: all errors are
 * swallowed so a telemetry write can never break a live request.
 */

import { NON_ACTING_BRIDGE_CONFIG } from "./non-acting-bridge-config";
import { recordRouteOutcome } from "./route-outcome";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecordNonActingFailureInput {
  providerId: string;
  modelId: string;
  adapter: string;
  taskType: string;
}

// ── recordNonActingFailure ─────────────────────────────────────────────────────

/**
 * Record a non-acting endpoint failure as a failed RouteOutcome carrying the
 * synthetic non-acting provider error code, counted against the exact route.
 * Fire-and-forget — never throws.
 */
export async function recordNonActingFailure({
  providerId,
  modelId,
  adapter,
  taskType,
}: RecordNonActingFailureInput): Promise<void> {
  // `adapter` keeps the call signature endpoint-scoped for the agentic-loop
  // caller; the non-acting RouteOutcome is keyed on provider+model+taskType.
  void adapter;
  try {
    await recordRouteOutcome({
      providerId,
      modelId,
      recipeId: null,
      contractFamily: taskType,
      taskType,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      schemaValid: null,
      toolSuccess: false,
      fallbackOccurred: false,
      providerErrorCode: NON_ACTING_BRIDGE_CONFIG.nonActingProviderErrorCode,
    });
  } catch {
    // Fire-and-forget — swallow all errors
  }
}
