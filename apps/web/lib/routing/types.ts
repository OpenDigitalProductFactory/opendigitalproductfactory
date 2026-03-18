/**
 * EP-INF-001: Type definitions for the manifest-based routing pipeline.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

// ── Sensitivity ──

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";

// ── Endpoint Manifest (loaded from ModelProvider) ──

export interface EndpointManifest {
  // Identity
  id: string;
  providerId: string;
  name: string;
  endpointType: string;
  status: "active" | "degraded" | "disabled" | "unconfigured" | "retired";

  // Hard constraints
  sensitivityClearance: SensitivityLevel[];
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  modelRestrictions: string[];

  // Capability profile (0-100)
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  customScores: Record<string, number>;

  // Operational
  avgLatencyMs: number | null;
  recentFailureRate: number;
  costPerOutputMToken: number | null;

  // Provenance
  profileSource: "seed" | "evaluated" | "production";
  profileConfidence: "low" | "medium" | "high";

  // Lifecycle
  retiredAt: Date | null;
}

// ── Task Requirement (loaded from TaskRequirement table) ──

export interface TaskRequirementContract {
  taskType: string;
  description: string;
  selectionRationale: string;
  requiredCapabilities: {
    supportsToolUse?: boolean;
    supportsStructuredOutput?: boolean;
    supportsStreaming?: boolean;
    minContextTokens?: number;
  };
  preferredMinScores: Record<string, number>;
  maxLatencyMs?: number;
  preferCheap: boolean;
}

// ── Policy Rule ──

export interface PolicyRuleEval {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
}

export interface PolicyCondition {
  field: "providerId" | "sensitivityClearance" | "profileConfidence" | "endpointType";
  operator: "equals" | "not_equals" | "includes" | "not_includes";
  value: string | string[];
}

// ── Route Decision (the audit trail) ──

export interface CandidateTrace {
  endpointId: string;
  endpointName: string;
  fitnessScore: number;
  dimensionScores: Record<string, number>;
  costPerOutputMToken: number | null;
  excluded: boolean;
  excludedReason?: string;
}

export interface RouteDecision {
  selectedEndpoint: string | null;
  reason: string;
  fitnessScore: number;
  fallbackChain: string[];
  candidates: CandidateTrace[];
  excludedCount: number;
  excludedReasons: string[];
  policyRulesApplied: string[];
  taskType: string;
  sensitivity: SensitivityLevel;
  timestamp: Date;
}

// ── Pinned / Blocked overrides ──

export interface EndpointOverride {
  endpointId: string;
  taskType: string;
  pinned: boolean;
  blocked: boolean;
}

// ── Built-in capability dimension names ──

export const BUILTIN_DIMENSIONS = [
  "reasoning",
  "codegen",
  "toolFidelity",
  "instructionFollowing",
  "structuredOutput",
  "conversational",
  "contextRetention",
] as const;

export type BuiltinDimension = (typeof BUILTIN_DIMENSIONS)[number];
