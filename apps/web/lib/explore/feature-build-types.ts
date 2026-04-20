// apps/web/lib/feature-build-types.ts
// Pure types and helpers for the Build Studio. No server imports.

import * as crypto from "crypto";
import type { BuildExecutionState } from "@/lib/build-exec-types";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Canonical values for FeatureBuild.uxVerificationStatus. Defined as an
 * `as const` array so runtime checks and the TypeScript union stay in sync,
 * following the String-typed-enum pattern documented in CLAUDE.md. The DB
 * column is plain TEXT — this array is the authority for valid values.
 */
export const UX_VERIFICATION_STATUSES = ["running", "complete", "failed", "skipped"] as const;
export type UxVerificationStatus = typeof UX_VERIFICATION_STATUSES[number];

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

export type ReusabilityAnalysis = {
  scope: "one_off" | "parameterizable" | "already_generic";
  domainEntities: Array<{
    hardcodedValue: string;       // e.g. "ITIL"
    parameterName: string;        // e.g. "trainingAuthority"
    otherInstances: string[];     // e.g. ["OpenGroup", "BIAN", "PMI"]
  }>;
  abstractionBoundary: string;    // What is generic vs. instance config
  contributionReadiness: "high" | "medium" | "low";
};

export type BuildDesignDoc = {
  problemStatement: string;
  dataModel?: string;
  existingCodeAudit?: string;
  existingFunctionalityAudit?: string; // legacy name — accept both
  reusePlan: string;
  proposedApproach: string;
  acceptanceCriteria: string[];
  reusabilityAnalysis?: ReusabilityAnalysis;
  /** Accessibility requirements (or "Not applicable — <reason>"). The
   *  review prompt checks this explicit field rather than re-asking
   *  the reviewer to derive a11y on every run, which was producing
   *  review-rejection loops. */
  accessibility?: string;
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

export type HappyPathFailureStage = "connect" | "fetch" | "parse" | "persist";

export type HappyPathIntakeState = {
  status: "pending" | "ready" | "failed";
  taxonomyNodeId: string | null;
  backlogItemId: string | null;
  epicId: string | null;
  constrainedGoal: string | null;
  failureReason: string | null;
};

export type HappyPathExecutionState = {
  engine: "claude" | "codex" | "agentic" | null;
  source: "grafana" | "prometheus" | null;
  status: "pending" | "running" | "failed" | "done";
  failureStage: HappyPathFailureStage | null;
};

export type HappyPathVerificationState = {
  status: "pending" | "running" | "failed" | "passed";
  checks: Array<{
    stage: HappyPathFailureStage;
    passed: boolean;
    detail: string;
  }>;
};

export type HappyPathState = {
  intake: HappyPathIntakeState;
  execution: HappyPathExecutionState;
  verification: HappyPathVerificationState;
};

export type HappyPathStatePatch = {
  intake?: Partial<HappyPathIntakeState>;
  execution?: Partial<HappyPathExecutionState>;
  verification?: Partial<HappyPathVerificationState>;
};

// ─── Scout Research Types ────────────────────────────────────────────────────

export type ScoutRelatedModel = {
  name: string;
  file: string;
  line: number;
  usage: string;
};

export type ScoutRelatedRoute = {
  name: string;
  file: string;
  purpose: string;
};

export type ScoutRelatedComponent = {
  name: string;
  file: string;
  purpose: string;
};

export type ScoutGap = {
  entity: string;
  reason: string;
};

export type ScoutExternalStructure = {
  url: string;
  title: string;
  sections: Array<{ heading: string; content: string }>;
  estimatedEntityCount: number;
};

export type ScoutResult = {
  relatedModels: ScoutRelatedModel[];
  relatedRoutes: ScoutRelatedRoute[];
  relatedComponents: ScoutRelatedComponent[];
  externalStructure?: ScoutExternalStructure;
  gaps: ScoutGap[];
  suggestedQuestions: string[];
  estimatedComplexity: "low" | "medium" | "high";
  complexityReason: string;
  estimatedEffort: "tiny" | "small" | "medium" | "large";
  effortReason: string;
  executionApproach: "single-build" | "epic-decompose" | "requires-epic";
  scoutDurationMs: number;
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
  scoutFindings: ScoutResult | null;
  uxTestResults: Array<{ step: string; passed: boolean; screenshotUrl: string | null; error: string | null }> | null;
  uxVerificationStatus: UxVerificationStatus | null;
  accountableEmployeeId: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
  buildExecState: BuildExecutionState | null;
  phaseHandoffs: Array<{
    fromPhase: string;
    toPhase: string;
    fromAgentId: string;
    toAgentId: string;
    summary: string;
    compressedSummary?: string | null;
    evidenceDigest: Record<string, string>;
    createdAt: Date;
  }> | null;
  happyPathState: HappyPathState;
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
  // Label-only rename per ship-phase-fork-redesign spec §3.1. The DB column
  // value stays "ship" — this is what the user sees, not what's persisted.
  // "Ready to Ship" signals that two independent fork outcomes may follow
  // (upstream PR + promote to prod), rather than a single binary checkbox.
  ship:     "Ready to Ship",
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

const DEFAULT_HAPPY_PATH_STATE: HappyPathState = {
  intake: {
    status: "pending",
    taxonomyNodeId: null,
    backlogItemId: null,
    epicId: null,
    constrainedGoal: null,
    failureReason: null,
  },
  execution: {
    engine: null,
    source: null,
    status: "pending",
    failureStage: null,
  },
  verification: {
    status: "pending",
    checks: [],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFailureStage(value: unknown): HappyPathFailureStage | null {
  return value === "connect" || value === "fetch" || value === "parse" || value === "persist"
    ? value
    : null;
}

function asStringArrayChecks(value: unknown): HappyPathVerificationState["checks"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const stage = asFailureStage(record.stage);
      if (!stage) return null;
      return {
        stage,
        passed: Boolean(record.passed),
        detail: typeof record.detail === "string" ? record.detail : "",
      };
    })
    .filter((entry): entry is HappyPathVerificationState["checks"][number] => Boolean(entry));
}

export function normalizeHappyPathState(raw: unknown): HappyPathState {
  const root = asRecord(raw);
  const intake = asRecord(root?.intake);
  const execution = asRecord(root?.execution);
  const verification = asRecord(root?.verification);

  return {
    intake: {
      status: intake?.status === "ready" || intake?.status === "failed" ? intake.status : "pending",
      taxonomyNodeId: asNullableString(intake?.taxonomyNodeId),
      backlogItemId: asNullableString(intake?.backlogItemId),
      epicId: asNullableString(intake?.epicId),
      constrainedGoal: asNullableString(intake?.constrainedGoal),
      failureReason: asNullableString(intake?.failureReason),
    },
    execution: {
      engine: execution?.engine === "claude" || execution?.engine === "codex" || execution?.engine === "agentic"
        ? execution.engine
        : null,
      source: execution?.source === "grafana" || execution?.source === "prometheus"
        ? execution.source
        : null,
      status: execution?.status === "running" || execution?.status === "failed" || execution?.status === "done"
        ? execution.status
        : "pending",
      failureStage: asFailureStage(execution?.failureStage),
    },
    verification: {
      status: verification?.status === "running" || verification?.status === "failed" || verification?.status === "passed"
        ? verification.status
        : "pending",
      checks: asStringArrayChecks(verification?.checks),
    },
  };
}

export function isHappyPathIntakeReady(state: HappyPathState | null | undefined): boolean {
  if (!state) return false;
  const { taxonomyNodeId, backlogItemId, epicId, constrainedGoal } = state.intake;
  return Boolean(taxonomyNodeId && backlogItemId && epicId && constrainedGoal);
}

export function mergeHappyPathStateIntoPlan(
  plan: Record<string, unknown> | null | undefined,
  patch: HappyPathStatePatch,
): Record<string, unknown> {
  const existingPlan = plan ?? {};
  const mergedState = normalizeHappyPathState({
    ...normalizeHappyPathState(existingPlan["happyPathState"]),
    ...patch,
    intake: {
      ...normalizeHappyPathState(existingPlan["happyPathState"]).intake,
      ...(patch.intake ?? {}),
    },
    execution: {
      ...normalizeHappyPathState(existingPlan["happyPathState"]).execution,
      ...(patch.execution ?? {}),
    },
    verification: {
      ...normalizeHappyPathState(existingPlan["happyPathState"]).verification,
      ...(patch.verification ?? {}),
      checks: patch.verification?.checks
        ?? normalizeHappyPathState(existingPlan["happyPathState"]).verification.checks,
    },
  });
  return {
    ...existingPlan,
    happyPathState: mergedState as unknown as Record<string, unknown>,
  };
}

function missingHappyPathAnchors(state: HappyPathState): string[] {
  const missing: string[] = [];
  if (!state.intake.taxonomyNodeId) missing.push("taxonomy");
  if (!state.intake.backlogItemId) missing.push("backlog item");
  if (!state.intake.epicId) missing.push("epic");
  if (!state.intake.constrainedGoal) missing.push("constrained goal");
  return missing;
}

export function checkPhaseGate(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): PhaseGateResult {
  if (to === "failed") return { allowed: true };
  if (from === "review" && to === "build") return { allowed: true };

  if (from === "ideate" && to === "plan") {
    if (!evidence.designDoc) return { allowed: false, reason: "A design document is required before planning." };
    if (!evidence.designReview) return { allowed: false, reason: "Design review is required before planning." };
    // Review must pass — a failed review blocks advancement until revision + re-review
    const designReview = evidence.designReview as { decision?: string };
    if (designReview.decision === "fail") {
      return { allowed: false, reason: "Design review failed. Revise the design document and re-run reviewDesignDoc before advancing." };
    }
    const happyPathState = normalizeHappyPathState(evidence.happyPathState);
    if (!isHappyPathIntakeReady(happyPathState)) {
      const missing = missingHappyPathAnchors(happyPathState).join(", ");
      return { allowed: false, reason: `Intake is incomplete. Link taxonomy, backlog item, epic, and a constrained goal before planning. Missing: ${missing}.` };
    }
    return { allowed: true };
  }

  if (from === "plan" && to === "build") {
    if (!evidence.buildPlan) return { allowed: false, reason: "An implementation plan is required before building." };
    if (!evidence.planReview) return { allowed: false, reason: "Plan review is required before building." };
    // Review must pass — a failed review blocks advancement until revision + re-review
    const planReview = evidence.planReview as { decision?: string };
    if (planReview.decision === "fail") {
      return { allowed: false, reason: "Plan review failed. Revise the implementation plan and re-run reviewBuildPlan before advancing." };
    }
    const happyPathState = normalizeHappyPathState(evidence.happyPathState);
    if (!isHappyPathIntakeReady(happyPathState)) {
      const missing = missingHappyPathAnchors(happyPathState).join(", ");
      return { allowed: false, reason: `Intake is incomplete. Link taxonomy, backlog item, epic, and a constrained goal before building. Missing: ${missing}.` };
    }
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
    // The AI may save acceptanceMet as a string description or an array of {criterion, met, evidence}.
    // Both indicate the AI evaluated criteria. Only block if it's a proper array with unmet items.
    if (Array.isArray(evidence.acceptanceMet)) {
      const criteria = evidence.acceptanceMet as Array<{ met?: boolean }>;
      if (criteria.some((c) => !c.met)) return { allowed: false, reason: "Not all acceptance criteria are met." };
    }
    // UX verification gate — three signals in combination:
    //   status "running"             -> in-flight, block until it settles
    //   status null + acceptance > 0 -> never ran, block (something's wrong)
    //   status "skipped"             -> zero acceptance criteria, allow
    //   status "failed"              -> blocked (unless override)
    //   failed steps in uxTestResults -> blocked (defense in depth even if
    //                                    the column got out of sync)
    const status = evidence.uxVerificationStatus as
      | "running" | "complete" | "failed" | "skipped" | null | undefined;
    const hasAcceptance = Array.isArray(evidence.acceptanceCriteria)
      && (evidence.acceptanceCriteria as unknown[]).length > 0;

    if (status === "running") {
      return { allowed: false, reason: "UX verification is still running. Retry in a moment." };
    }
    if ((status === null || status === undefined) && hasAcceptance) {
      return { allowed: false, reason: "UX verification has not run yet." };
    }
    if (evidence.uxTestResults) {
      const uxResults = evidence.uxTestResults as Array<{ passed?: boolean; step?: string }>;
      const failed = uxResults.filter((s) => !s.passed);
      if (failed.length > 0) {
        const stepNames = failed.map((s) => s.step).filter(Boolean).slice(0, 3).join("; ");
        return {
          allowed: false,
          reason: `UX verification failed: ${stepNames || `${failed.length} step(s)`}. Fix issues before shipping.`,
        };
      }
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
