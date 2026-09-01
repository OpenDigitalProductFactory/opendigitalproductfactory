/**
 * EP-INF-001: Type definitions for the manifest-based routing pipeline.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";

import type { QualityTier } from "./quality-tiers";

// ── Sensitivity ──

/**
 * Routing sensitivity. Extends the principal/business-data confidentiality scale
 * (`PrincipalSensitivity`: public < internal < confidential < restricted) with a
 * distinct **development** class for platform source-code generation.
 *
 * Founder ruling (2026-08-12): "code isn't sensitive, the business data is
 * sensitive." Generating platform source code is development work, not the
 * processing of internal business data, so it must not be gated at the internal
 * business-data clearance bar. `development` is the least-sensitive class — an
 * endpoint cleared for `public` business content is cleared for it — which lets
 * the operator's connected frontier cloud dev tools run builds, while builds that
 * actually ingest business/customer data stay classified at their real level.
 * Content-based payload screening still inspects every request, so this only
 * relaxes the declared-clearance floor, never the data-leak safety net.
 *
 * It is a routing-only superset of PrincipalSensitivity (which stays the closed
 * DB enum for principal clearances), so no Prisma enum migration is required and
 * provider `sensitivityClearance` (a `String[]`) can carry it without schema
 * change.
 */
export type SensitivityLevel = PrincipalSensitivity | "development";

// ── Endpoint Manifest (loaded from ModelProfile joined with ModelProvider) ──

/**
 * Provider tier for routing preference.
 *
 * `bundled` — providers that ship with DPF and require no user action
 *   to be usable (Docker Model Runner, Ollama). Treated as a fallback
 *   default: always available, but never preferred when a user has
 *   explicitly configured an external provider.
 * `user_configured` — providers the user had to actively connect (OAuth
 *   completed or API key saved). Preferred over bundled because the user's
 *   configuration action expresses an explicit preference that the routing
 *   layer must honour on fresh installs — before any eval or pricing
 *   metadata has populated.
 */
export type ProviderTier = "bundled" | "user_configured";

export interface EndpointManifest {
  // Identity
  id: string;
  providerId: string;
  modelId: string;     // from ModelProfile
  name: string;
  endpointType: string;
  status: "active" | "degraded" | "disabled" | "unconfigured" | "retired";
  providerTier: ProviderTier;

  // Hard constraints
  sensitivityClearance: SensitivityLevel[];
  /**
   * Tri-state tool capability (BI-DFC30977):
   *   true  — known tool-capable.
   *   false — an EXPLICIT floor (provider backend, admin capabilityOverrides,
   *           or a catalog entry) that must never be routed tool work.
   *   null  — UNKNOWN; discovery could not determine it (metadata-extractor
   *           only derives toolUse for ollama/gemini/openrouter).
   *
   * Capability is a property of (model x transport), not model identity — the
   * same model can be tool-capable on one backend and not another (e.g.
   * chatgpt/gpt-5.4 false vs codex/gpt-5.4 true). Gates must therefore exclude
   * only on `=== false`, so a genuinely unknown endpoint is attempted and then
   * calibrated by the eval, while an explicit floor stays excluded.
   */
  supportsToolUse: boolean | null;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  modelRestrictions: string[];
  /**
   * Account/transport-specific hard exclusion computed by the manifest loader.
   * The endpoint remains in the candidate trace so runtime health can explain
   * why it was skipped and show the supported fallback that won.
   */
  eligibilityExclusionReason?: string;

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

  // EP-INF-012: Quality tier (frontier / strong / adequate / basic)
  qualityTier?: QualityTier;

  // EP-INF-003: ModelCard fields
  modelClass: string;
  modelFamily: string | null;
  inputModalities: string[];
  outputModalities: string[];
  capabilities: import("./model-card-types").ModelCardCapabilities;
  pricing: import("./model-card-types").ModelCardPricing;
  supportedParameters: string[];
  deprecationDate: Date | null;
  metadataSource: string;
  metadataConfidence: string;
  perRequestLimits: { promptTokens: number | null; completionTokens: number | null } | null;
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
  providerId: string;
  modelId: string;
  endpointName: string;
  fitnessScore: number;
  dimensionScores: Record<string, number>;
  costPerOutputMToken: number | null;
  excluded: boolean;
  excludedReason?: string;
}

export interface RouteDecision {
  /** Request-scoped W3C Trace Context-compatible correlation id. */
  traceId?: string;
  /** Governed routing design revision used for this live dispatch. */
  designRevision?: string;
  selectedEndpoint: string | null;
  selectedModelId: string | null;
  reason: string;
  fitnessScore: number;
  fallbackChain: string[];
  candidates: CandidateTrace[];
  excludedCount: number;
  excludedReasons: string[];
  policyRulesApplied: string[];
  /** Structured preference outcome; avoids coupling behavior to reason text. */
  preferenceResolution?: RoutePreferenceResolution;
  taskType: string;
  sensitivity: SensitivityLevel;
  timestamp: Date;
  /** Policy-safe provider suitability audit receipt; never contains request content or raw account ids. */
  providerSuitabilityReceipt?: import("./provider-suitability/evidence").ProviderSuitabilityRouteReceipt;
  /** Policy-safe inference data screen receipt; never contains prompts, tool payloads, or detected values. */
  inferenceDataScreenReceipt?: import("@/lib/inference/data-screening/types").InferenceDataScreenReceipt;

  // EP-INF-005b: Execution recipe fields
  selectedRecipeId?: string;
  selectedRecipeVersion?: number;
  executionPlan?: import("./recipe-types").RoutedExecutionPlan;

  // EP-INF-006: Exploration fields
  explorationMode?: "champion" | "challenger";
  challengerRecipeId?: string;
}

export type RoutePreferenceKind = "endpoint" | "provider" | "model";

export interface RoutePreferenceResolution {
  requested: Array<{ kind: RoutePreferenceKind; value: string }>;
  applied: Array<{
    kind: RoutePreferenceKind;
    value: string;
    endpointId: string;
  }>;
  unavailable: Array<{ kind: RoutePreferenceKind; value: string }>;
  fallbackUsed: boolean;
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
