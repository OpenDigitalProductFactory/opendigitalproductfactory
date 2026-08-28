// apps/web/lib/feature-build-types.ts
// Pure types and helpers for the Build Studio. No server imports.

import * as crypto from "crypto";
import type { BuildExecutionState } from "@/lib/build-exec-types";
import type { DecisionInteractionGateView } from "@/lib/decision-perspective/types";
import type { SemanticReviewDecision, SemanticReviewResult } from "@/lib/change-review/semantic-change-review";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Canonical values for FeatureBuild.uxVerificationStatus. Defined as an
 * `as const` array so runtime checks and the TypeScript union stay in sync,
 * following the String-typed-enum pattern documented in CLAUDE.md. The DB
 * column is plain TEXT — this array is the authority for valid values.
 */
export const UX_VERIFICATION_STATUSES = ["running", "complete", "failed", "skipped"] as const;
export type UxVerificationStatus = typeof UX_VERIFICATION_STATUSES[number];

/**
 * Canonical values for FeatureBuild.kind — the work-kind discriminator that
 * lets the Build Studio pipeline run a build as a new-capability *feature*,
 * a targeted defect *fix*, an intent-driven *chore*, or a *doc* gap.
 * `feature-build-types.ts` is the canonical home (kind is a FeatureBuild
 * concern; BacklogItem.source stays owned by backlog.ts).
 *
 * The DB column is plain TEXT defaulting to "feature"; this array is the
 * authority for valid values. Adding a value requires:
 *   1. Adding it here.
 *   2. Wiring at least one cell per size in DEFAULT_LIFECYCLE_MATRIX (see
 *      build-process-matrix.ts §4.3) and any matching prompt variant in
 *      build-agent-prompts.ts (or deliberately falling through to "feature").
 *   3. Updating any MCP tool schema that mirrors the enum, in the same commit,
 *      before any DB row writes the new value.
 *
 * Right-sizing matrix: docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
 */
export const FEATURE_BUILD_KIND_VALUES = ["feature", "fix", "chore", "doc"] as const;
export type FeatureBuildKind = typeof FEATURE_BUILD_KIND_VALUES[number];

/**
 * Process sizes that drive the right-sizing matrix. Mirrors
 * BACKLOG_EFFORT_SIZES; re-exported here so build-side consumers
 * (build-agent-prompts, build-pipeline) can import everything they need
 * from one canonical types module. Single source of truth still lives
 * in backlog.ts (BACKLOG_EFFORT_SIZES); build-process-matrix.ts re-uses
 * that array under a build-flavored alias.
 */
export type BuildProcessSize = "small" | "medium" | "large" | "xlarge";

/**
 * Structured defect context for a `kind: "fix"` build. Carried additively on
 * `FeatureBrief` (not a discriminated union) so every structural reader of the
 * brief keeps compiling. Populated at promote time from the originating
 * `PlatformIssueReport`; `rootCause`/`fixApproach` are filled during ideate.
 */
export type FixContext = {
  severity?: string;
  originatingIssueReportId?: string;
  originatingIssueReportPublicId?: string;
  routeContext?: string;
  errorStackExcerpt?: string;
  reproSteps?: string;
  expected?: string;
  actual?: string;
  rootCause?: string;
  fixApproach?: string;
};

export type FeatureBrief = {
  title: string;
  description: string;
  portfolioContext: string;
  targetRoles: string[];
  inputs: string[];
  dataNeeds: string;
  acceptanceCriteria: string[];
  /** Present iff the owning build's kind === "fix". */
  fixContext?: FixContext;
};

/**
 * Derive the UX-verification assertion(s) for a fix build from its diagnosis.
 * A fix's UX check is "the reported defect no longer reproduces on the affected
 * route" — NOT the feature `acceptanceCriteria` (which on a fix build can be
 * polluted with fixContext prose, producing nonsense browser-use navigations
 * like `https://fixContext.reproSteps`). Returns [] when there's nothing
 * actionable to verify in a browser. (BI-AC5CFDB0)
 */
export function deriveFixUxTestCases(fixContext: FixContext | null | undefined): string[] {
  if (!fixContext) return [];
  const route = fixContext.routeContext?.trim();
  const expected = fixContext.expected?.trim();
  const actual = fixContext.actual?.trim();
  // Nothing browser-verifiable (e.g. a pure server/tool fix with no route) →
  // let the caller skip UX rather than invent a navigation target.
  if (!route && !expected) return [];
  const where = route ? `Navigate to ${route} and ` : "";
  const wasClause = actual ? ` (previously: ${actual})` : "";
  const expectClause = expected ? ` Expected: ${expected}.` : "";
  return [
    `${where}verify the previously-reported defect no longer occurs${wasClause}.` +
      `${expectClause} The page must load without a runtime error overlay or blank-screen crash.`,
  ];
}

export type TaxonomyAttributionView = {
  method: "rule" | "heuristic" | "ai_proposed" | "manual" | "invalid_portfolio";
  confidence: number;
  portfolioSlug?: string | null;
  invalidPortfolioContext?: string | null;
  validPortfolioOptions?: Array<{ slug: string; name: string }>;
  confirmedNodeId: string | null;
  topCandidate: {
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  } | null;
  candidates: Array<{
    nodeId: string;
    nodeName: string;
    score: number;
    evidence: string;
  }>;
  proposedNewNode: {
    parentNodeId: string;
    name: string;
    description: string;
    rationale: string;
    proposalId?: string | null;
  } | null;
  attributedAt: string;
};

// ─── Build Disciplines Evidence Types ────────────────────────────────────────

export type ReviewResult = SemanticReviewResult & {
  /** Iteration tracking populated when this ReviewResult is the output of a
   *  re-review (e.g. reviewBuildPlan called against an existing planReview).
   *  Enables the operator-facing iteration progress chip and the reviewer's
   *  own delta-awareness on subsequent rounds. BI-4396EFEC (D38). */
  iteration?: {
    /** 1-based round number. First review = 1, subsequent = 2, 3, ... */
    round: number;
    /** Comparison against the immediately-prior round. Absent on round 1. */
    prior?: {
      issueCount: number;
      /** Prior issues whose description no longer appears in current. */
      addressed: number;
      /** Prior issues whose description still appears in current. */
      persisted: number;
      /** Current issues whose description didn't appear in prior. */
      newlySurfaced: number;
    };
    /** True when the iteration is not making net progress — issue count
     *  this round is >= prior round AND the review traded one set of
     *  issues for another (addressed > 0 AND newlySurfaced > 0). Operator
     *  signal that the feature scope may be too large to converge. */
    oscillating?: boolean;
  };
  /** Deterministic size assessment of the reviewed design, written by
   *  reviewDesignDoc on Ideate-phase reviews only (BI-2E6CC391, spec
   *  docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md).
   *  Phase 3 renders the gate banner from it; Phase 4 gates the decomposition
   *  assistant. Absent on Plan-phase reviews and on pre-Phase-2 builds. */
  /** True when NO reviewer returned a usable verdict, so this says nothing
   *  about the work (BI-D33F968A). `fail` is the safe default, never "examined
   *  and rejected" — a repair budget spent on it destroys the build. */
  reviewIncomplete?: boolean;
  sizeAssessment?: SizeAssessmentSnapshot;
  /** Operator override recorded when the build's size assessment is
   *  `decompose-required` but the operator chose to proceed
   *  monolithically. Phase 4a writes this; Phase 4b enforces the gate by
   *  blocking advance-to-plan unless either decomposition happened OR an
   *  override exists. Spec §12 Q1. */
  decompositionOverride?: DecompositionOverrideSnapshot;
  /** Candidate decompositions returned by propose_build_decomposition.
   *  `latest` is the most recent set the operator can pick from; prior
   *  rounds (after a regenerate) move into `priorRounds` for audit. */
  decompositionCandidates?: DecompositionCandidatesSnapshot;
  /** Advisory architectural-alignment findings from the chief-architect
   *  reviewer (the Enterprise Architect persona, AGT-WS-EA). Populated by
   *  reviewDesignDoc / reviewBuildPlan when the architecture reviewer runs.
   *  ADVISORY ONLY — these findings never gate pass/fail. They join the
   *  deliberation trail as the `architect` branch and are surfaced to the
   *  build coworker so it can fold actionable concerns back into the spec. */
  architectureAdvisory?: ArchitectureAdvisory;
  /** Per-reviewer verdicts captured BEFORE mergeReviews() collapses the two
   *  gating reviewers (+ the advisory architect) into a single decision. Lets
   *  the Review-phase UI show WHICH named reviewer cleared vs flagged instead
   *  of only the merged outcome. Nested on the JSON column (like
   *  architectureAdvisory) — no migration. Absent on rows reviewed before this
   *  shipped; the UI falls back to the merged checklist lens. */
  reviewers?: ReviewerVerdict[];
};

/** A single reviewer's verdict, preserved on ReviewResult.reviewers so the
 *  Review-phase UI can render named reviewer chips. The three sources match the
 *  deliberation branch ids the dual-review run already emits (reviewer-1,
 *  reviewer-2, architect). There is NO larger named-discipline roster — the
 *  build review system runs exactly these three reviewers. */
export type ReviewerVerdict = {
  /** Stable reviewer id — matches the deliberation branchNodeId. */
  source: "reviewer-1" | "reviewer-2" | "architect";
  /** Operator-facing name: "Primary review" / "Independent review" / "Architecture". */
  label: string;
  /** "reviewer" verdicts gate via mergeReviews; "architect" is advisory only. */
  role: "reviewer" | "architect";
  decision: SemanticReviewDecision;
  /** Issue counts by severity — enough to render a chip without the full list. */
  issueCounts: { critical: number; important: number; minor: number };
  /** True when this reviewer's output failed to parse (absent, not dissenting). */
  parseError?: boolean;
};

/** Compact, advisory-only record of an architectural-alignment review.
 *  Stored nested on ReviewResult.architectureAdvisory rather than in its own
 *  column — no migration, and every `data: { review }` tool response carries
 *  it for free. Issues reuse the ReviewResult issue shape so the UI can render
 *  them with the same severity styling; severity here is advisory weight, not
 *  a gate signal. */
export type ArchitectureAdvisory = {
  summary: string;
  issues: ReviewResult["issues"];
};

/** Persisted shape of the candidate-set generated by propose_build_decomposition.
 *  Library shape lives in apps/web/lib/build/decomposition-candidates.ts —
 *  we copy the minimum here so the ReviewResult type has no module-graph
 *  dependency on the candidates library. */
export type DecompositionCandidatesSnapshot = {
  latest: Array<{
    candidateId: string;
    rationale: string;
    childScopes: Array<{
      childOrder: number;
      title: string;
      summary: string;
      acceptanceCriteriaIndices: number[];
      dependsOn: number[];
    }>;
  }>;
  latestGeneratedAt: string;
  latestOperatorHint: string | null;
  latestRejectedCount: number;
  priorRounds: unknown[];
};

/** Persisted shape of the "keep as one build" operator override. */
export type DecompositionOverrideSnapshot = {
  rationale: string;
  recordedAt: string;
  recordedByUserId: string;
  recordedByAgentId: string | null;
};

/** Snapshot of the sizeDesignDoc output as persisted on a ReviewResult.
 *  Kept structurally compatible with `SizeAssessment` in
 *  apps/web/lib/build/size-design-doc.ts so client code can import either
 *  type. Defined here (rather than imported) so the ReviewResult shape has
 *  no module-graph dependency on the sizing logic. */
export type SizeAssessmentSnapshot = {
  decision: "ok" | "decompose-recommended" | "decompose-required";
  breakdown: {
    models: { count: number; samples: string[] };
    endpoints: { count: number; samples: string[] };
    acs: { count: number };
    multipliers: { count: number; matchedKeywords: string[] };
    routes: { count: number; samples: string[] };
  };
  trips: Array<{
    dimension: "models" | "endpoints" | "acs" | "multipliers" | "routes";
    level: "recommend" | "required";
    threshold: number;
    observed: number;
  }>;
  rationale: string;
  thresholds: {
    models: { recommend: number; required: number };
    endpoints: { recommend: number; required: number };
    acs: { recommend: number; required: number };
    multipliers: { recommend: number; required: number };
    routes: { recommend: number; required: number };
  };
  assessedAt: string;
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

export type BuildDeliberationPhase = "ideate" | "plan" | "review";

export type BuildDeliberationSummaryEntry = {
  patternSlug: "review" | "debate";
  deliberationRunId: string;
  consensusState:
    | "consensus"
    | "partial-consensus"
    | "no-consensus"
    | "insufficient-evidence"
    | "pending";
  rationaleSummary: string;
  evidenceQuality: "source-backed" | "mixed" | "needs-more-evidence";
  unresolvedRisks: string[];
  diversityLabel: string;
};

export type BuildDeliberationSummary = Partial<
  Record<BuildDeliberationPhase, BuildDeliberationSummaryEntry>
>;

/**
 * BI-D93CF6C0 — plain-language change summary (Band 2 of the overseer layer).
 * Generated once at build completion from the goal + plan + diff, stored on
 * FeatureBuild.changeNarrative. Distinct from diffSummary (the raw diff prefix);
 * this is the "we added X so your customers can Y" narrative for a non-technical
 * overseer. Spec: docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md.
 */
export type BuildChangeNarrative = {
  headline: string;
  bullets: string[];
  whyItMatters: string;
  openQuestions?: string[];
  generatedAt: string;
  model: string;
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
  engine: "claude" | "codex" | "grok" | "opencode" | "agentic" | null;
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
// "abandoned" is a TERMINAL phase the escalate-to-human path writes
// (escalate-build-to-human.ts) when Build Studio cannot self-repair a build and
// hands it to a human: WIP is freed, the originating BI is parked as "deferred",
// and a durable escalation report is filed. It was previously stored in the DB
// but missing from this union (BI-A2F3FA9D), so guidance/custodian switches had
// no branch and fell through to a stale "Working" state. It is intentionally NOT
// in VISIBLE_PHASES (terminal, off the happy-path stepper, like complete/failed).
export type BuildPhase = "ideate" | "plan" | "build" | "review" | "ship" | "complete" | "failed" | "abandoned";
export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title: string;
  description: string | null;
  // Optional for back-compat: rows loaded from selects that predate the kind
  // column read as undefined and are treated as "feature".
  kind?: FeatureBuildKind | null;
  portfolioId: string | null;
  parentEpicId?: string | null;
  originatingBacklogItemId: string | null;
  brief: FeatureBrief | null;
  businessBuildBrief?: import("@/lib/build/business-build-brief").BusinessBuildBrief | null;
  plan: Record<string, unknown> | null;
  phase: BuildPhase;
  sandboxId: string | null;
  sandboxPort: number | null;
  diffSummary: string | null;
  diffPatch: string | null;
  codingProvider: string | null;
  threadId: string | null;
  digitalProductId: string | null;
  disposition?: "private" | "shareable" | string | null; dispositionReason?: string | null; dispositionSuggested?: "private" | "shareable" | string | null; dispositionSuggestionReason?: string | null;
  product: { productId: string; version: string; backlogCount: number } | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  draftApprovedAt: Date | null;
  // Build-level terminal-abandon fields (BI-A2F3FA9D). Optional for back-compat:
  // rows/fixtures that predate these selects read as undefined. Written by the
  // escalate-to-human path (escalate-build-to-human.ts) alongside phase="abandoned"
  // — abandonReason is the human-readable handoff reason surfaced in the terminal UI.
  abandonReason?: string | null;
  abandonedAt?: Date | null;
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
  evidenceObservedAt?: import("@/lib/build/owner-change-evidence").OwnerEvidenceObservedAt;
  accountableEmployeeId: string | null;
  claimedByAgentId: string | null;
  claimedAt: Date | null;
  claimStatus: string | null;
  buildExecState: BuildExecutionState | null;
  taxonomyAttribution?: TaxonomyAttributionView | null;
  deliberationSummary: BuildDeliberationSummary | null;
  originator: {
    id: string;
    itemId: string;
    title: string;
    status: string;
    triageOutcome: string | null;
    effortSize: string | null;
    proposedOutcome: string | null;
    activeBuildId: string | null;
    resolution: string | null;
    abandonReason: string | null;
  } | null;
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
  decisionInteraction?: DecisionInteractionGateView | null;
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
  "ideate", "plan", "build", "review", "ship", "complete", "failed", "abandoned",
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
  abandoned: "Escalated to owner",
};

export const PHASE_COLOURS: Record<BuildPhase, string> = {
  ideate:   "#a78bfa",
  plan:     "#38bdf8",
  build:    "#fbbf24",
  review:   "#fb923c",
  ship:     "#4ade80",
  complete: "#4ade80",
  failed:   "#f87171",
  // Terminal/parked handoff — a muted token (consumers already render
  // var(--dpf-muted) for inactive phases, e.g. PhaseIndicator), keeping the
  // style-drift discipline instead of adding a fresh hardcoded hex.
  abandoned: "var(--dpf-muted)",
};

export const CODING_CAPABILITY_COLOURS: Record<CodingCapability, string> = {
  excellent:    "#4ade80",
  adequate:     "#fbbf24",
  insufficient: "#f87171",
};

export const VISIBLE_PHASES: BuildPhase[] = ["ideate", "plan", "build", "review", "ship"];

// ─── Review iteration helpers (BI-4396EFEC / D38) ───────────────────────────

/** Normalize a review issue description for cross-round comparison. Mirrors
 *  the dedup key used in `mergeReviews` (first 80 chars, lowercased) so a
 *  reviewer that re-phrases the same issue between rounds isn't double-counted. */
export function normalizeIssueKey(description: string): string {
  return description.toLowerCase().slice(0, 80);
}

export type ReviewIterationDelta = {
  issueCount: number;
  addressed: number;
  persisted: number;
  newlySurfaced: number;
};

/** Pure helper: given prior and current review issues, compute the delta.
 *  Used by reviewBuildPlan to populate ReviewResult.iteration.prior. */
export function computeReviewDelta(
  priorIssues: ReadonlyArray<{ description: string }>,
  currentIssues: ReadonlyArray<{ description: string }>,
): ReviewIterationDelta {
  const priorKeys = new Set(priorIssues.map((i) => normalizeIssueKey(i.description)));
  const currentKeys = new Set(currentIssues.map((i) => normalizeIssueKey(i.description)));
  let persisted = 0;
  for (const k of currentKeys) if (priorKeys.has(k)) persisted++;
  const addressed = priorKeys.size - persisted;
  const newlySurfaced = currentKeys.size - persisted;
  return {
    issueCount: priorIssues.length,
    addressed,
    persisted,
    newlySurfaced,
  };
}

/** Oscillation heuristic: the review is trading one set of issues for another
 *  without making net progress. True when current count is >= prior count AND
 *  the review both addressed some prior issues AND surfaced new ones. */
export function isOscillating(
  delta: ReviewIterationDelta,
  currentIssueCount: number,
): boolean {
  return (
    currentIssueCount >= delta.issueCount &&
    delta.addressed > 0 &&
    delta.newlySurfaced > 0
  );
}

/** Build the operator-facing reason string for a failed planReview, including
 *  iteration trajectory when present. Pure: extracted so checkPhaseGate stays
 *  simple and the format is unit-testable. */
export function describePlanReviewFailure(planReview: ReviewResult): string {
  const base = "Plan review failed. Revise the implementation plan and re-run plan review before advancing.";
  const iter = planReview.iteration;
  if (!iter) return base;
  const round = `Round ${iter.round}`;
  if (!iter.prior) {
    return `${base} (${round})`;
  }
  const trajectory =
    `${iter.prior.addressed} addressed, ${iter.prior.persisted} persist, ${iter.prior.newlySurfaced} new`;
  const oscillation = iter.oscillating
    ? " — issue count is not decreasing across rounds. Consider splitting this feature into smaller scopes before continuing to iterate."
    : "";
  return `${base} (${round}: ${trajectory})${oscillation}`;
}

/** Build the operator-facing reason string for a failed designReview, including
 *  iteration trajectory when present. Mirror of describePlanReviewFailure for
 *  the design path (BI-CE49D82E). Same convergence/oscillation language so the
 *  operator's mental model is consistent across phase gates. */
export function describeDesignReviewFailure(designReview: ReviewResult): string {
  // BI-62442F75: operator vocabulary, not the raw camelCase tool name. Mirrors
  // the plan sibling's "re-run plan review" so the D33 banner never leaks
  // "reviewDesignDoc" into human-facing copy.
  const base = "Design review failed. Revise the design document and re-run the design review before advancing.";
  const iter = designReview.iteration;
  if (!iter) return base;
  const round = `Round ${iter.round}`;
  if (!iter.prior) {
    return `${base} (${round})`;
  }
  const trajectory =
    `${iter.prior.addressed} addressed, ${iter.prior.persisted} persist, ${iter.prior.newlySurfaced} new`;
  const oscillation = iter.oscillating
    ? " — issue count is not decreasing across rounds. Consider splitting this feature into smaller scopes before continuing to iterate."
    : "";
  return `${base} (${round}: ${trajectory})${oscillation}`;
}

// ─── Phase Transitions ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<BuildPhase, BuildPhase[]> = {
  ideate:   ["plan", "failed"],
  plan:     ["build", "failed"],
  build:    ["review", "failed"],
  review:   ["ship", "failed", "build"],
  ship:     ["complete", "failed"],
  complete: [],
  failed:   [],
  // Terminal: an escalated build is handed to a human; the work resumes by
  // re-opening the parked backlog item, not by transitioning this build.
  abandoned: [],
};

export function canTransitionPhase(from: BuildPhase, to: BuildPhase): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ─── Phase Gate Enforcement ──────────────────────────────────────────────────

export type PhaseGateResult = { allowed: boolean; reason?: string };

// ─── Phase-handoff evidence digest ───────────────────────────────────────────
//
// A PhaseHandoff row is the structured artifact the next phase reads instead of
// the raw conversation history. Its evidence half (evidenceFields +
// evidenceDigest) was historically written empty, so the consumer
// (agent-coworker.ts "## Context from Previous Phase" block) rendered nothing.
// This derives a one-line-per-field manifest from the build's own evidence
// columns. Pure — no I/O — so it is unit-tested directly.

/** The FeatureBuild evidence columns a handoff summarizes. All optional. */
export type PhaseHandoffEvidenceInput = {
  designDoc?: unknown;
  designReview?: unknown;
  buildPlan?: unknown;
  planReview?: unknown;
  verificationOut?: unknown;
  acceptanceMet?: unknown;
  uxTestResults?: unknown;
  uxVerificationStatus?: string | null;
};

export type PhaseHandoffEvidence = {
  evidenceFields: string[];
  evidenceDigest: Record<string, string>;
};

// Render order for the digest.
const PHASE_HANDOFF_EVIDENCE_FIELDS: readonly (keyof PhaseHandoffEvidenceInput)[] = [
  "designDoc",
  "designReview",
  "buildPlan",
  "planReview",
  "verificationOut",
  "acceptanceMet",
  "uxVerificationStatus",
  "uxTestResults",
];

const EVIDENCE_ONE_LINER_MAX = 140;

function summarizeEvidenceValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;

  const oneLine = (s: string): string | null => {
    const c = s.replace(/\s+/g, " ").trim();
    if (c.length === 0) return null;
    return c.length > EVIDENCE_ONE_LINER_MAX ? `${c.slice(0, EVIDENCE_ONE_LINER_MAX - 1)}…` : c;
  };

  if (typeof value === "string") return oneLine(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? null : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // First populated "verdict-like" key wins; falls back to a key census.
    for (const key of ["verdict", "decision", "status", "result", "summary", "passed", "title"]) {
      const inner = obj[key];
      if (inner === null || inner === undefined) continue;
      const innerStr = typeof inner === "boolean" ? (inner ? "yes" : "no") : String(inner);
      const line = oneLine(`${key}: ${innerStr}`);
      if (line) return line;
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;
    return oneLine(`present (${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 6).join(", ")})`);
  }
  return null;
}

/**
 * Build the structured evidence manifest for a PhaseHandoff from a build's
 * evidence columns. Only fields that carry signal appear — a field with no
 * value is omitted from both arrays, so the next phase never sees an empty
 * "Evidence" line (absence is the marker).
 */
export function buildPhaseHandoffEvidence(build: PhaseHandoffEvidenceInput): PhaseHandoffEvidence {
  const evidenceFields: string[] = [];
  const evidenceDigest: Record<string, string> = {};
  for (const field of PHASE_HANDOFF_EVIDENCE_FIELDS) {
    const digest = summarizeEvidenceValue(build[field]);
    if (digest === null) continue;
    evidenceFields.push(field);
    evidenceDigest[field] = digest;
  }
  return { evidenceFields, evidenceDigest };
}

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

/**
 * Provenance-tagged taxonomy anchor for a build whose ideate agent never ran
 * confirm_taxonomy_placement. Returns null when an anchor already exists so
 * callers never clobber an operator choice. Both shapes satisfy
 * {@link isHappyPathIntakeReady} while staying traceable: `triaged-bi:<id>`
 * (the BI's triage outcome IS the categorization) and `adhoc-build:<id>` (a
 * free-text quick-box build with no originating BI, which otherwise gate-blocks
 * on "Intake is incomplete" forever).
 */
export function deriveIntakeTaxonomyAnchor(args: {
  taxonomyNodeId: string | null | undefined;
  originatingBacklogItemId: string | null | undefined;
  buildId: string;
}): string | null {
  if (args.taxonomyNodeId) return null;
  return args.originatingBacklogItemId
    ? `triaged-bi:${args.originatingBacklogItemId}`
    : `adhoc-build:${args.buildId}`;
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

// missingHappyPathAnchors moved to build-process-matrix.ts where the
// happyPathIntake-ready requirement is implemented. The matrix is the only
// caller now that checkPhaseGate delegates to it.

/**
 * A fix build's diagnosis is "complete enough" to plan against when it has
 * reproduction steps, a root cause, and a fix approach. This is the fix-flow
 * analogue of requiring a design document before planning a feature.
 */
export function isFixContextComplete(fc: FixContext | null | undefined): boolean {
  if (!fc) return false;
  return Boolean(fc.reproSteps?.trim() && fc.rootCause?.trim() && fc.fixApproach?.trim());
}

/**
 * Phase gate — re-exported from build-process-matrix.ts.
 *
 * The implementation moved to build-process-matrix.ts so the right-sizing
 * matrix module owns the gate logic and the LifecyclePolicy table together.
 * This re-export preserves every existing import site that reaches
 * checkPhaseGate via @/lib/feature-build-types.
 *
 * Back-compat invariant: when `evidence.kind` is absent (or "feature") and
 * `evidence.processSize` is absent (or "medium"), the resolved policy is
 * the default feature-standard cell — byte-identical to the pre-matrix
 * behavior. See docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md.
 */
export { checkPhaseGate } from "./build-process-matrix";

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
