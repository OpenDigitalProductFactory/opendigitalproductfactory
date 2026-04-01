// apps/web/lib/feature-build-types.ts
// Pure types and helpers for the Build Studio. No server imports.

import * as crypto from "crypto";
import type { BuildExecutionState } from "./build-exec-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeatureBrief = {
  title: string;
  description: string;
  portfolioContext: string;
  targetRoles: string[];
  inputs: string[];
  dataNeeds: string;
  acceptanceCriteria: string[];
};

// ─── Build Disciplines Evidence Types ────────────────────────────────────────

export type ReviewResult = {
  decision: "pass" | "fail";
  issues: Array<{
    severity: "critical" | "important" | "minor";
    description: string;
    location?: string;
    suggestion?: string;
  }>;
  summary: string;
};

export type BuildDesignDoc = {
  problemStatement: string;
  existingFunctionalityAudit: string;
  alternativesConsidered: string;
  reusePlan: string;
  newCodeJustification: string;
  proposedApproach: string;
  acceptanceCriteria: string[];
};

export type BuildPlanDoc = {
  fileStructure: Array<{ path: string; action: "create" | "modify"; purpose: string }>;
  tasks: Array<{
    title: string;
    testFirst: string;
    implement: string;
    verify: string;
  }>;
};

export type TaskResult = {
  taskIndex: number;
  title: string;
  testResult: { passed: boolean; output: string };
  codeReview: ReviewResult;
  commitSha?: string;
};

export type VerificationOutput = {
  testsPassed: number;
  testsFailed: number;
  typecheckPassed: boolean;
  fullOutput: string;
  timestamp: string;
};

export type AcceptanceCriterion = {
  criterion: string;
  met: boolean;
  evidence: string;
};

export type BuildPhase = "ideate" | "plan" | "build" | "review" | "ship" | "complete" | "failed";

export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title: string;
  description: string | null;
  portfolioId: string | null;
  brief: FeatureBrief | null;
  plan: Record<string, unknown> | null;
  phase: BuildPhase;
  sandboxId: string | null;
  sandboxPort: number | null;
  diffSummary: string | null;
  diffPatch: string | null;
  codingProvider: string | null;
  threadId: string | null;
  digitalProductId: string | null;
  product: { productId: string; version: string; backlogCount: number } | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  designDoc: BuildDesignDoc | null;
  designReview: ReviewResult | null;
  buildPlan: BuildPlanDoc | null;
  planReview: ReviewResult | null;
  taskResults: TaskResult[] | null;
  verificationOut: VerificationOutput | null;
  acceptanceMet: AcceptanceCriterion[] | null;
  uxTestResults: Array<{ step: string; passed: boolean; screenshotUrl: string | null; error: string | null }> | null;
  accountableEmployeeId: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
  buildExecState: BuildExecutionState | null;
};

export type FeaturePackRow = {
  id: string;
  packId: string;
  title: string;
  description: string | null;
  portfolioContext: string | null;
  version: string;
  status: string;
  buildId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CodingCapability = "excellent" | "adequate" | "insufficient";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PHASE_ORDER: BuildPhase[] = [
  "ideate", "plan", "build", "review", "ship", "complete", "failed",
];

export const PHASE_LABELS: Record<BuildPhase, string> = {
  ideate:   "Ideate",
  plan:     "Plan",
  build:    "Build",
  review:   "Review",
  ship:     "Ship",
  complete: "Complete",
  failed:   "Failed",
};

export const PHASE_COLOURS: Record<BuildPhase, string> = {
  ideate:   "#a78bfa",
  plan:     "#38bdf8",
  build:    "#fbbf24",
  review:   "#fb923c",
  ship:     "#4ade80",
  complete: "#4ade80",
  failed:   "#f87171",
};

export const CODING_CAPABILITY_COLOURS: Record<CodingCapability, string> = {
  excellent:    "#4ade80",
  adequate:     "#fbbf24",
  insufficient: "#f87171",
};

export const VISIBLE_PHASES: BuildPhase[] = ["ideate", "plan", "build", "review", "ship"];

// ─── Phase Transitions ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<BuildPhase, BuildPhase[]> = {
  ideate:   ["plan", "failed"],
  plan:     ["build", "failed"],
  build:    ["review", "failed"],
  review:   ["ship", "failed", "build"],
  ship:     ["complete", "failed"],
  complete: [],
  failed:   [],
};

export function canTransitionPhase(from: BuildPhase, to: BuildPhase): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ─── Phase Gate Enforcement ──────────────────────────────────────────────────

export type PhaseGateResult = { allowed: boolean; reason?: string };

export function checkPhaseGate(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): PhaseGateResult {
  if (to === "failed") return { allowed: true };
  if (from === "review" && to === "build") return { allowed: true };

  if (from === "ideate" && to === "plan") {
    if (!evidence.designDoc) return { allowed: false, reason: "A design document is required before planning." };
    // Review is informational — presence is sufficient, decision doesn't block
    if (!evidence.designReview) return { allowed: false, reason: "Design review is required before planning." };
    return { allowed: true };
  }

  if (from === "plan" && to === "build") {
    if (!evidence.buildPlan) return { allowed: false, reason: "An implementation plan is required before building." };
    // Review is informational — presence is sufficient, decision doesn't block
    if (!evidence.planReview) return { allowed: false, reason: "Plan review is required before building." };
    return { allowed: true };
  }

  if (from === "build" && to === "review") {
    const verification = evidence.verificationOut as { testsFailed?: number; typecheckPassed?: boolean } | null;
    if (!verification) return { allowed: false, reason: "A verification run (tests + typecheck) is required before review." };
    if (!verification.typecheckPassed) return { allowed: false, reason: "Typecheck must pass before review." };
    // Unit test failures are informational — the sandbox runs the full platform test
    // suite, so pre-existing failures in unrelated modules must not block feature builds.
    return { allowed: true };
  }

  if (from === "review" && to === "ship") {
    if (!evidence.designDoc) return { allowed: false, reason: "Design document is missing." };
    if (!evidence.buildPlan) return { allowed: false, reason: "Implementation plan is missing." };
    if (!evidence.verificationOut) return { allowed: false, reason: "Verification output is missing." };
    if (!evidence.acceptanceMet) return { allowed: false, reason: "Acceptance criteria not evaluated." };
    const criteria = evidence.acceptanceMet as Array<{ met?: boolean }>;
    if (criteria.some((c) => !c.met)) return { allowed: false, reason: "Not all acceptance criteria are met." };
    // UX tests: soft gate — if present, all must pass. New builds always have them (Review prompt runs them).
    if (evidence.uxTestResults) {
      const uxResults = evidence.uxTestResults as Array<{ passed?: boolean }>;
      const failed = uxResults.filter((s) => !s.passed).length;
      if (failed > 0) return { allowed: false, reason: `${failed} UX test(s) failed. Fix issues before shipping.` };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ValidationResult = { valid: boolean; errors: string[] };

export function validateFeatureBrief(brief: FeatureBrief): ValidationResult {
  const errors: string[] = [];
  if (!brief.title.trim()) errors.push("title is required");
  if (!brief.description.trim()) errors.push("description is required");
  return { valid: errors.length === 0, errors };
}

// ─── ID Generation ───────────────────────────────────────────────────────────

export function generateBuildId(): string {
  return `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generatePackId(): string {
  return `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

// ─── Version Bumping ──────────────────────────────────────────────────────

export type VersionBump = "major" | "minor" | "patch";

export function bumpVersion(current: string, bump: VersionBump): string {
  const parts = current.split(".");
  if (parts.length !== 3) return "1.0.0";

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);
  const patch = parseInt(parts[2]!, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return "1.0.0";

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
    default:
      return `${major}.${minor + 1}.0`;
  }
}

// ─── Portfolio Search Types ──────────────────────────────────────────────────

export type SearchMatch = {
  id: string;
  name: string;
  slug?: string;
  description: string | null;
  relevanceScore: number;
  context?: string;
};

export type PortfolioSearchResult = {
  taxonomyMatches: SearchMatch[];
  productMatches: SearchMatch[];
  buildMatches: SearchMatch[];
  backlogMatches: SearchMatch[];
};

// ─── Complexity Assessment Types ─────────────────────────────────────────────

export type ComplexityDimension =
  | "taxonomySpan"
  | "dataEntities"
  | "integrations"
  | "novelty"
  | "regulatory"
  | "costEstimate"
  | "techDebt";

export type ComplexityScores = Record<ComplexityDimension, 1 | 2 | 3>;

export type ComplexityPath = "simple" | "moderate" | "complex";

export type ComplexityResult = {
  total: number;
  path: ComplexityPath;
  scores: ComplexityScores;
};

// ─── Decomposition Types ─────────────────────────────────────────────────────

export type BuildOrBuyRecommendation = "build" | "buy" | "integrate";

export type FeatureSetEntry = {
  title: string;
  description: string;
  type: "feature_build" | "digital_product";
  estimatedBuilds: number;
  recommendation: BuildOrBuyRecommendation;
  rationale: string;
  techDebtNote: string | null;
};

export type DecompositionPlan = {
  epicTitle: string;
  epicDescription: string;
  featureSets: FeatureSetEntry[];
};
