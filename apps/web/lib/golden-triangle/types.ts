/**
 * EP-GOLDEN-TRIANGLE Slice 1 (BI-8FF4CE21) — core data contracts for the
 * preference-to-policy compiler.
 *
 * See docs/design/golden-triangle-design.md and
 * docs/superpowers/plans/2026-06-21-golden-triangle-implementation-plan.md.
 *
 * Enums that overlap the routing layer are derived from `RequestContract` (the
 * single source of truth) via type-only imports so they stay in sync. `Effort`
 * mirrors `AgentRouteConfig.effort` (apps/web/lib/tak/agentic-loop.ts) and is
 * kept local to avoid importing that runtime-heavy module.
 */
import type { QualityTier } from "../routing/quality-tiers";
import type { RequestContract } from "../routing/request-contract";

export type GoldenTrianglePreset = "fast" | "frugal" | "assured" | "balanced" | "custom";

/** The human posture: soft cost/quality/time weights plus the active preset. */
export interface GoldenTrianglePreference {
  costWeight: number;
  qualityWeight: number;
  timeWeight: number;
  preset: GoldenTrianglePreset;
}

export type BudgetClass = RequestContract["budgetClass"];
export type ReasoningDepth = RequestContract["reasoningDepth"];
export type ResidencyPolicy = NonNullable<RequestContract["residencyPolicy"]>;
export type Effort = "low" | "medium" | "high" | "max";
export type VerificationDepth = "none" | "shallow" | "deep";

/**
 * Routing-shaped output. Fed into `inferContract()`'s `routeContext`
 * caller-override slot — never a parallel routing pass (design §5).
 */
export interface PostureOverride {
  budgetClass?: BudgetClass;
  reasoningDepth?: ReasoningDepth;
  effort?: Effort;
  minimumTier?: QualityTier;
  maxLatencyMs?: number;
  /** A hard bound; the posture may tighten residency but never relax it. */
  residencyPolicy?: ResidencyPolicy;
}

/**
 * Workflow-shaped output. Persisted as JSON on the receipt /
 * `DecisionInteraction.outcomePayload` path; biases the agentic-loop governors
 * and selects a deliberation pattern (design §7). `verificationDepth` is
 * emitted but inert until a verify step exists.
 */
export interface OrchestrationBudget {
  maxDurationMs?: number;
  retryBudget?: number;
  verificationDepth?: VerificationDepth;
  deliberationPattern?: string;
}

export interface PolicyAdjustment {
  field: string;
  from: unknown;
  to: unknown;
  /** Stable machine-readable code (for receipts/learning). */
  reasonCode: string;
  /** Human-readable reason (for the decode panel). */
  reason: string;
}

export type DecodedPolicyState = "ok" | "blocked" | "defer";

export interface DecodedPolicy {
  postureOverride: PostureOverride;
  orchestrationBudget: OrchestrationBudget;
  adjustments: PolicyAdjustment[];
  state: DecodedPolicyState;
  explanation: string;
  compilerVersion: string;
  presetVersion: string;
}

export interface AuthorityScope {
  kind: "wwmd" | "wwwd" | "wsid" | "per-decision" | (string & {});
  profileId?: string;
  profileVersionId?: string;
}

/** Hard bounds the posture cannot cross (design §5 precedence). */
export interface PolicyConstraints {
  residency?: ResidencyPolicy;
  sensitivity?: string;
  toolGrants?: string[];
  minimumTierFloor?: QualityTier;
  /** Hard verification floor; posture and task class may deepen but never relax it. */
  verificationDepthFloor?: VerificationDepth;
  maxLatencyCeilingMs?: number;
}

export interface ModelAvailability {
  /** Tiers currently reachable and healthy. */
  tiers: QualityTier[];
  healthy: boolean;
}

export interface CompileInput {
  preference: GoldenTrianglePreference;
  taskClass: string;
  authorityScope: AuthorityScope;
  policyConstraints?: PolicyConstraints;
  modelAvailability?: ModelAvailability;
}
