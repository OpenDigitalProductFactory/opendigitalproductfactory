/**
 * EP-INF-012: Type definitions for the TaskRequirement-based routing layer.
 *
 * These types form the "demand side" of the task router. They are intentionally
 * separate from the pipeline-v2 RequestContract types to allow the task router
 * to be used independently of the full contract pipeline.
 *
 * EndpointManifest is re-exported from ./types — there is exactly one definition.
 */

import type { SensitivityLevel } from "./types";
import type { QualityTier } from "./quality-tiers";

// Re-export so consumers only need one import source.
export type { EndpointManifest } from "./types";

// ── Task Requirement ───────────────────────────────────────────────────────────

/**
 * A contract declaring what a task type needs from an endpoint.
 * This is the "demand side" of the task routing equation.
 */
export interface TaskRequirement {
  // Identity
  taskType: string;
  description: string;
  selectionRationale: string;

  // Hard requirements (endpoint must satisfy ALL or it is excluded)
  requiredCapabilities: {
    supportsToolUse?: boolean;
    supportsStructuredOutput?: boolean;
    supportsStreaming?: boolean;
    minContextTokens?: number;
  };

  // Soft requirements (scored — higher is better, not disqualifying)
  preferredMinScores: Record<string, number>;

  // EP-INF-012: Tier gate — endpoints below this tier are excluded before scoring.
  // Maps to TIER_MINIMUM_DIMENSIONS thresholds.
  // "frontier" = complex tool-calling, code-gen; "adequate" = simple conversation.
  minimumTier?: QualityTier;

  // Operational preferences
  maxLatencyMs?: number;
  preferCheap?: boolean;

  // Metadata
  defaultInstructions?: string;
  evaluationTokenLimit?: number;
  origin: "system" | "user";
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
}

// ── Policy Rule ───────────────────────────────────────────────────────────────

/**
 * An organisation-level routing constraint driven by compliance or internal policy.
 * Conditions are evaluated as simple field comparisons against EndpointManifest.
 */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: {
    field: string;
    operator: "in" | "not_in";
    value: unknown[];
  };
  action: "exclude";
  isActive: boolean;
}

// ── Candidate Trace ───────────────────────────────────────────────────────────

/**
 * The scored trace of a single endpoint evaluated during a routing decision.
 * Carries providerId + modelId so the dispatcher can call callProvider without
 * a secondary DB lookup.
 */
export interface CandidateTrace {
  endpointId: string;    // ModelProfile.id (routing key)
  providerId: string;    // ModelProvider.providerId (for callProvider)
  modelId: string;       // ModelProfile.modelId (for callProvider)
  endpointName: string;
  fitnessScore: number;
  dimensionScores: Record<string, number>;
  costPerOutputMToken: number;
  excluded: boolean;
  excludedReason?: string;
}

// ── Task Route Decision ───────────────────────────────────────────────────────

/**
 * The full auditable trace of a task routing decision.
 * Named TaskRouteDecision to avoid collision with the pipeline RouteDecision type.
 */
export interface TaskRouteDecision {
  // Selection
  selectedEndpointId: string | null;
  selectedProviderId: string | null;
  selectedModelId: string | null;
  reason: string;
  fallbackChain: string[];  // endpointIds of next-best candidates

  // Full trace
  candidates: CandidateTrace[];
  excludedCount: number;
  excludedReasons: Record<string, number>;  // reason → count
  policyRulesApplied: string[];

  // Context
  taskType: string;
  sensitivity: SensitivityLevel;
  timestamp: Date;
}
