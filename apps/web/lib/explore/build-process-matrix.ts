// apps/web/lib/explore/build-process-matrix.ts
//
// Right-sizing matrix for Build Studio. Maps (work-type, work-size) -> a
// LifecyclePolicy that tells the prompt selector + phase gate how much
// ceremony a given build deserves.
//
// Spec: docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
// Seed: docs/superpowers/specs/2026-05-29-fix-flow-through-build-studio-design.md
// Composes with: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
//
// Design contract:
//   - The default cell (feature, medium) is byte-identical to today's behavior.
//   - The phase graph (PHASE_ORDER, ALLOWED_TRANSITIONS) is global and unchanged.
//     "Skipping" a phase means its outbound gate auto-passes; the agent can
//     advance immediately. The matrix never invents new phases.
//   - Unknown / absent type falls back to "feature"; unknown / absent size
//     falls back to "medium". Existing in-flight builds keep working.

import type { BacklogItemWithRelations } from "./backlog";
import { BACKLOG_EFFORT_SIZES } from "./backlog";
import type { BuildPhase, FeatureBuildKind } from "./feature-build-types";
import { checkVerificationDepthSatisfied } from "./verification-depth-requirement";
import {
  FEATURE_BUILD_KIND_VALUES,
} from "./feature-build-types";

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * Closed work-type enum that drives the lifecycle policy. Extends
 * FEATURE_BUILD_KIND_VALUES (which is now an alias for back-compat).
 *
 * Adding a value requires:
 *   1. Adding it here.
 *   2. Wiring at least one cell per size in DEFAULT_LIFECYCLE_MATRIX (§4.3).
 *   3. Adding the matching prompt variant fallbacks in build-agent-prompts.ts
 *      (or deliberately falling through to "feature").
 *   4. Updating any MCP tool schema that mirrors the enum, in the same commit,
 *      before any DB row writes the new value.
 */
export const BUILD_PROCESS_TYPE_VALUES = ["feature", "fix", "chore", "doc"] as const;
export type BuildProcessType = (typeof BUILD_PROCESS_TYPE_VALUES)[number];

/** Mirrors BACKLOG_EFFORT_SIZES so the build inherits the BI's sizing without
 *  re-classification. The matrix may apply the same policy to multiple sizes;
 *  that's an internal LifecyclePolicy table detail, not a separate enum. */
export const BUILD_PROCESS_SIZES = BACKLOG_EFFORT_SIZES;
export type BuildProcessSize = (typeof BUILD_PROCESS_SIZES)[number];

// Sanity check (compile-time only): BUILD_PROCESS_TYPE_VALUES is a superset
// of the legacy FEATURE_BUILD_KIND_VALUES enum. Encoded as a function
// signature so the cyclic import (feature-build-types <-> matrix) doesn't
// try to read FEATURE_BUILD_KIND_VALUES at module-load time.
type _SupersetCheck = FEATURE_BUILD_KIND_VALUES_ELEMENT_TYPE extends BuildProcessType ? true : never;
type FEATURE_BUILD_KIND_VALUES_ELEMENT_TYPE = (typeof FEATURE_BUILD_KIND_VALUES)[number];
const _supersetCheck: _SupersetCheck = true;
void _supersetCheck;

// ─── Gate requirements ──────────────────────────────────────────────────────

/**
 * Closed enum of named gate checks. checkPhaseGate composes a policy's
 * required list per transition; checkRequirement is a pure switch that
 * inspects the evidence record and returns {allowed, reason?}.
 *
 * Each requirement maps 1:1 to a branch in today's checkPhaseGate, so the
 * default (feature, medium) policy reconstitutes the existing gate exactly.
 */
export const GATE_REQUIREMENTS = [
  "designDoc-present",
  "designReview-passed",
  // Looser variant used by the fix flow: never required to be present,
  // but if it is present and explicitly failed, block. This preserves
  // the fix-flow behavior from the 2026-05-29 fix-flow design where the
  // diagnosis itself is the spec and reviewDesignDoc's review is a
  // synthetic completeness signal — its absence (e.g. a manually-promoted
  // fix that bypassed reviewDesignDoc) must not deadlock the gate.
  "designReview-not-failed-if-present",
  "fixContext-complete",
  "buildPlan-present",
  "planReview-passed",
  "verification-typecheck-passed",
  "verification-depth-satisfied",
  "acceptance-evaluated",
  "acceptance-all-met-if-array",
  "uxVerification-not-blocking",
  "happyPathIntake-ready",
] as const;
export type GateRequirement = (typeof GATE_REQUIREMENTS)[number];

// ─── Lifecycle policy ───────────────────────────────────────────────────────

export type BuildTransition =
  | "ideate->plan"
  | "plan->build"
  | "build->review"
  | "review->ship";

export type ReviewIntensity = "minimal" | "standard" | "thorough";

export type LifecyclePolicy = {
  /** Visible phases in operator UI + agent dispatch. Always a contiguous
   *  prefix of VISIBLE_PHASES — the phase graph itself is unchanged.
   *  Phases not in this list have auto-pass gates and an empty prompt
   *  (i.e. effectively skipped). */
  phases: BuildPhase[];
  /** Prompt slug suffix. getBuildPhasePrompt selects <phase>-<variant>
   *  (or just <phase> for "feature") and falls back to the hardcoded
   *  prompt for that variant; missing variants fall through to feature. */
  promptVariant: BuildProcessType;
  /** Advisory hint for deliberation pattern selection (review/debate).
   *  Phase 1 does not act on this; recorded for the operator-facing
   *  header chip and for Phase 2 deliberation tuning. */
  reviewIntensity: ReviewIntensity;
  /** What each transition requires. A missing transition key means
   *  "no requirements" (auto-pass). Transitions for phases outside
   *  `phases` are still allowed by the phase graph; the policy
   *  auto-passes them. */
  gates: Partial<Record<BuildTransition, ReadonlyArray<GateRequirement>>>;
  /** Operator-facing label for the policy. Pure presentation. */
  label: string;
};

// ─── Default cell — byte-identical to today ─────────────────────────────────
//
// This is the contract test: the default policy composes the exact same
// requirements today's checkPhaseGate enforces for a (feature, medium) build.
// Every other cell in the matrix is a DELTA against this baseline.

const FEATURE_FULL_GATES: LifecyclePolicy["gates"] = {
  "ideate->plan": [
    "designDoc-present",
    "designReview-passed",
    "happyPathIntake-ready",
  ],
  "plan->build": [
    "buildPlan-present",
    "planReview-passed",
    "happyPathIntake-ready",
  ],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": [
    "designDoc-present",
    "buildPlan-present",
    "acceptance-evaluated",
    "acceptance-all-met-if-array",
    "uxVerification-not-blocking",
  ],
};

const FIX_FULL_GATES: LifecyclePolicy["gates"] = {
  // Fix flow: a complete diagnosis substitutes for the feature design doc.
  // The designReview gate uses the *looser* "not-failed-if-present"
  // requirement because reviewDesignDoc on a fix synthesizes a pass/fail
  // from isFixContextComplete; the review may be absent for manually-
  // promoted fixes and that path must not deadlock.
  "ideate->plan": ["fixContext-complete", "designReview-not-failed-if-present"],
  "plan->build": ["buildPlan-present", "planReview-passed"],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": [
    "fixContext-complete",
    "buildPlan-present",
    "acceptance-evaluated",
    "acceptance-all-met-if-array",
    "uxVerification-not-blocking",
  ],
};

// Fix-small: merge ideate+plan. No portfolio intake. UX still defended-in-depth
// at ship-time (the check no-ops when there are no acceptance criteria).
const FIX_SMALL_GATES: LifecyclePolicy["gates"] = {
  "ideate->plan": ["fixContext-complete", "designReview-not-failed-if-present"],
  "plan->build": ["buildPlan-present"],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": [
    "fixContext-complete",
    "buildPlan-present",
    "uxVerification-not-blocking",
  ],
};

// Chore: intent-driven, no ideate ceremony. Plan + verify is the whole story.
const CHORE_SMALL_GATES: LifecyclePolicy["gates"] = {
  "ideate->plan": [],
  "plan->build": ["buildPlan-present"],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": ["buildPlan-present", "uxVerification-not-blocking"],
};

const CHORE_STANDARD_GATES: LifecyclePolicy["gates"] = {
  "ideate->plan": [],
  "plan->build": ["buildPlan-present", "planReview-passed"],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": [
    "buildPlan-present",
    "acceptance-evaluated",
    "acceptance-all-met-if-array",
    "uxVerification-not-blocking",
  ],
};

// Doc: content edit, no sandbox boot in spirit. The verification-typecheck
// gate still applies (typechecking embedded code samples in docs is cheap
// and catches stale references), but acceptance/UX requirements are dropped.
const DOC_GATES: LifecyclePolicy["gates"] = {
  "ideate->plan": [],
  "plan->build": ["buildPlan-present"],
  "build->review": ["verification-typecheck-passed"],
  "review->ship": ["buildPlan-present", "uxVerification-not-blocking"],
};

// xlarge: route to decomposition. Block the most expensive transition until
// the operator either decomposes or overrides; the existing decomposition
// gate (size-design-doc) layers on top.
const DECOMPOSE_REQUIRED_GATES: LifecyclePolicy["gates"] = {
  // Same as the standard feature gate, with one extra requirement that the
  // sizeDesignDoc decision is not "decompose-required" without an override.
  // Phase 1 keeps this aligned with the existing path; the design-time
  // decomposition gate already enforces the same thing via reviewDesignDoc.
  ...FEATURE_FULL_GATES,
};

// ─── The matrix ─────────────────────────────────────────────────────────────

const PHASES_FULL: BuildPhase[] = ["ideate", "plan", "build", "review", "ship"];
const PHASES_NO_IDEATE: BuildPhase[] = ["plan", "build", "review", "ship"];
const PHASES_NO_IDEATE_NO_REVIEW: BuildPhase[] = ["plan", "build", "ship"];

/**
 * Default (feature, medium) — the baseline. Every other cell is a delta
 * against this. Changing this cell is a behavior change for the dominant
 * code path; do not edit without an explicit cross-pipeline review.
 */
const POLICY_FEATURE_STANDARD: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "feature",
  reviewIntensity: "standard",
  gates: FEATURE_FULL_GATES,
  label: "Feature · standard",
};

const POLICY_FEATURE_THOROUGH: LifecyclePolicy = {
  ...POLICY_FEATURE_STANDARD,
  reviewIntensity: "thorough",
  label: "Feature · thorough",
};

const POLICY_FEATURE_DECOMPOSE: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "feature",
  reviewIntensity: "thorough",
  gates: DECOMPOSE_REQUIRED_GATES,
  label: "Feature · decompose first",
};

const POLICY_FIX_STANDARD: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "fix",
  reviewIntensity: "standard",
  gates: FIX_FULL_GATES,
  label: "Fix · standard",
};

const POLICY_FIX_SMALL: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "fix",
  reviewIntensity: "minimal",
  gates: FIX_SMALL_GATES,
  label: "Fix · merged",
};

const POLICY_FIX_THOROUGH: LifecyclePolicy = {
  ...POLICY_FIX_STANDARD,
  reviewIntensity: "thorough",
  label: "Fix · thorough",
};

const POLICY_CHORE_SMALL: LifecyclePolicy = {
  phases: PHASES_NO_IDEATE_NO_REVIEW,
  promptVariant: "chore",
  reviewIntensity: "minimal",
  gates: CHORE_SMALL_GATES,
  label: "Chore · minimal",
};

const POLICY_CHORE_STANDARD: LifecyclePolicy = {
  phases: PHASES_NO_IDEATE,
  promptVariant: "chore",
  reviewIntensity: "minimal",
  gates: CHORE_STANDARD_GATES,
  label: "Chore · standard",
};

const POLICY_CHORE_THOROUGH: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "chore",
  reviewIntensity: "standard",
  gates: FEATURE_FULL_GATES, // large chores are usually refactors; promote to standard review
  label: "Chore · refactor",
};

const POLICY_DOC: LifecyclePolicy = {
  phases: PHASES_NO_IDEATE,
  promptVariant: "doc",
  reviewIntensity: "minimal",
  gates: DOC_GATES,
  label: "Doc · minimal",
};

const POLICY_DOC_STANDARD: LifecyclePolicy = {
  ...POLICY_DOC,
  reviewIntensity: "standard",
  label: "Doc · standard",
};

const POLICY_DECOMPOSE_REQUIRED: LifecyclePolicy = {
  phases: PHASES_FULL,
  promptVariant: "feature",
  reviewIntensity: "thorough",
  gates: DECOMPOSE_REQUIRED_GATES,
  label: "Decompose first",
};

/**
 * The matrix. Two-dim lookup keyed by [type][size]. getProcessPolicy
 * resolves and clones the cell; callers must not mutate the returned
 * policy.
 */
const DEFAULT_LIFECYCLE_MATRIX: Readonly<
  Record<BuildProcessType, Readonly<Record<BuildProcessSize, LifecyclePolicy>>>
> = {
  feature: {
    small: POLICY_FEATURE_STANDARD,
    medium: POLICY_FEATURE_STANDARD,
    large: POLICY_FEATURE_THOROUGH,
    xlarge: POLICY_FEATURE_DECOMPOSE,
  },
  fix: {
    small: POLICY_FIX_SMALL,
    medium: POLICY_FIX_STANDARD,
    large: POLICY_FIX_THOROUGH,
    xlarge: POLICY_DECOMPOSE_REQUIRED,
  },
  chore: {
    small: POLICY_CHORE_SMALL,
    medium: POLICY_CHORE_STANDARD,
    large: POLICY_CHORE_THOROUGH,
    xlarge: POLICY_DECOMPOSE_REQUIRED,
  },
  doc: {
    small: POLICY_DOC,
    medium: POLICY_DOC,
    large: POLICY_DOC_STANDARD,
    xlarge: POLICY_DECOMPOSE_REQUIRED,
  },
};

// ─── Quality-first + risk axis (EP-QUALITY-RIGHTSIZING) ──────────────────────
//
// Spec: docs/superpowers/specs/2026-06-23-quality-first-risk-aware-build-rightsizing-design.md
//
// A second axis — deliverableSensitivity — rides alongside (type, size). It can
// only ever RAISE process (more review, fuller phases, deeper tier), never lower
// it (MONOTONIC). Both the quality-first bump and the sensitivity escalation are
// opt-in via `RightsizingOpts`; when no opts are supplied (or they are inert) the
// matrix is BYTE-IDENTICAL to today — the default-cell contract test still holds.

/** Risk/sensitivity of what a build touches. Orthogonal to effort size. */
export const DELIVERABLE_SENSITIVITIES = ["low", "elevated", "high"] as const;
export type DeliverableSensitivity = (typeof DELIVERABLE_SENSITIVITIES)[number];

const SENSITIVITY_RANK: Record<DeliverableSensitivity, number> = { low: 0, elevated: 1, high: 2 };
const REVIEW_RANK: Record<ReviewIntensity, number> = { minimal: 0, standard: 1, thorough: 2 };

export type RightsizingOpts = {
  /** DPF_BUILD_QUALITY_FIRST_RIGHTSIZING is on: substantive work gets thorough
   *  review + the robust tier; the trivial tail (doc/chore × small) stays light. */
  qualityFirst?: boolean;
  /** Derived sensitivity of the deliverable; HIGH escalates to the deepest
   *  policy for the type regardless of size. */
  sensitivity?: DeliverableSensitivity;
};

/** Quality-first raises the substantive cell's review one notch (standard →
 *  thorough); the trivial tail (minimal) is left light on purpose. Monotonic. */
function raiseReviewForQuality(r: ReviewIntensity): ReviewIntensity {
  return r === "standard" ? "thorough" : r;
}

/** The fullest gate set for a TYPE — used to escalate a high-sensitivity build
 *  to the most ceremony its type allows, without cross-typing (a fix stays a fix). */
const FULL_GATES_BY_TYPE: Record<BuildProcessType, LifecyclePolicy["gates"]> = {
  feature: FEATURE_FULL_GATES,
  fix: FIX_FULL_GATES,
  chore: FEATURE_FULL_GATES, // refactor-grade chores already promote to feature gates
  doc: DOC_GATES,
};

/** Monotonic union of two gate maps: per transition, the required list is the
 *  union of both (never drops a requirement the base already enforced). */
function unionGates(
  base: LifecyclePolicy["gates"],
  add: LifecyclePolicy["gates"],
): LifecyclePolicy["gates"] {
  const out: LifecyclePolicy["gates"] = { ...base };
  for (const key of Object.keys(add) as BuildTransition[]) {
    const merged = new Set<GateRequirement>([...(base[key] ?? []), ...(add[key] ?? [])]);
    out[key] = Array.from(merged);
  }
  return out;
}

/** Apply the quality-first bump + monotonic sensitivity escalation to a base
 *  cell. Returns the base UNCHANGED when nothing actually escalates, so an inert
 *  opts object is byte-identical to no opts at all. */
function escalatePolicy(
  base: LifecyclePolicy,
  type: BuildProcessType,
  opts: RightsizingOpts,
): LifecyclePolicy {
  const sens = opts.sensitivity ?? "low";
  let phases = base.phases;
  let reviewIntensity = base.reviewIntensity;
  let gates = base.gates;
  const tags: string[] = [];

  if (opts.qualityFirst) {
    reviewIntensity = raiseReviewForQuality(reviewIntensity);
    if (reviewIntensity !== base.reviewIntensity) tags.push("quality");
  }
  if (SENSITIVITY_RANK[sens] >= SENSITIVITY_RANK.elevated && REVIEW_RANK[reviewIntensity] < REVIEW_RANK.standard) {
    reviewIntensity = "standard";
  }
  if (sens === "high") {
    phases = PHASES_FULL;
    reviewIntensity = "thorough";
    gates = unionGates(base.gates, FULL_GATES_BY_TYPE[type]);
    tags.push("high-sensitivity");
  } else if (SENSITIVITY_RANK[sens] >= SENSITIVITY_RANK.elevated && reviewIntensity !== base.reviewIntensity) {
    tags.push("elevated");
  }

  if (phases === base.phases && reviewIntensity === base.reviewIntensity && gates === base.gates) {
    return base; // nothing escalated → byte-identical
  }
  return { ...base, phases, reviewIntensity, gates, label: `${base.label} · ${tags.join(" · ")}` };
}

/**
 * Derive a deliverable's sensitivity from a path/keyword heuristic over its text
 * (BI title/body + brief) plus the org risk posture as a FLOOR. The result is
 * `max(keyword-signal, posture-floor)` — monotonic. This is the P1 interim;
 * BI-CFEB2B22 (P3) replaces the heuristic with code-graph blast-radius.
 *
 * `riskPosture` is accepted as a plain string (conservative|balanced|progressive)
 * to keep this module decoupled from govern/risk-posture; an unknown value is
 * treated as the balanced (no-floor) default.
 */
// Bare "card"/"charge" are deliberately excluded — they over-match benign UI
// copy ("dashboard card", "charge up"). Payment exposure is caught by the
// billing/payment/PCI/cardholder/credit-card terms instead.
const HIGH_SENSITIVITY_PATTERN =
  /\b(auth|authn|authz|authentication|authorization|login|sign[- ]?in|password|credential|secret|token|api[- ]?key|billing|payment|invoice|pci|cardholder|credit[- ]?card|debit[- ]?card|customer[- ]?data|pii|personal[- ]?data|gdpr|hipaa|security|vulnerab|encrypt|crypto|kernel|governance|rbac|permission|access[- ]?control|compliance)\b/i;
const ELEVATED_SENSITIVITY_PATTERN =
  /\b(database|migration|schema|prisma|integration|external|webhook|email|outbound|federation|edge|endpoint|deploy|infrastructure)\b/i;

export function deriveDeliverableSensitivity(
  input: { text?: string | null; workType?: string | null },
  riskPosture?: string | null,
): DeliverableSensitivity {
  const text = input.text ?? "";
  let keyword: DeliverableSensitivity = "low";
  if (HIGH_SENSITIVITY_PATTERN.test(text)) keyword = "high";
  else if (ELEVATED_SENSITIVITY_PATTERN.test(text)) keyword = "elevated";
  // Org posture is a floor that can only RAISE caution: a conservative org
  // starts everything at least "elevated". Balanced/progressive add no floor.
  const postureFloor: DeliverableSensitivity = riskPosture === "conservative" ? "elevated" : "low";
  return SENSITIVITY_RANK[keyword] >= SENSITIVITY_RANK[postureFloor] ? keyword : postureFloor;
}

/**
 * Map deliverable sensitivity to the ROUTING provider-clearance contract.
 * Founder ruling (2026-08-12): source-code generation is development work, while
 * business data remains sensitive. Ordinary builds therefore use `development`;
 * elevated/high briefs retain internal/confidential gates. Payload screening
 * still runs, so this does not widen the data-leak surface.
 */
export function mapBuildDeliverableToRoutingSensitivity(
  d: DeliverableSensitivity,
): "development" | "internal" | "confidential" {
  switch (d) {
    case "high":
      return "confidential";
    case "elevated":
      return "internal";
    case "low":
    default:
      return "development";
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the lifecycle policy for a build. Unknown / absent type defaults
 * to "feature"; unknown / absent size defaults to "medium". This is the
 * back-compat contract — pre-existing call sites that pass nothing get the
 * exact same policy as before.
 *
 * `opts` (EP-QUALITY-RIGHTSIZING) is additive + monotonic: it can only raise the
 * resolved policy. Absent/inert opts → the exact base cell (byte-identical).
 */
export function getProcessPolicy(
  type: BuildProcessType | FeatureBuildKind | string | null | undefined,
  size: BuildProcessSize | string | null | undefined,
  opts?: RightsizingOpts,
): LifecyclePolicy {
  const t = normalizeType(type);
  const s = normalizeSize(size);
  const base = DEFAULT_LIFECYCLE_MATRIX[t][s];
  if (!opts || (!opts.qualityFirst && (opts.sensitivity ?? "low") === "low")) {
    return base;
  }
  return escalatePolicy(base, t, opts);
}

export function normalizeType(
  type: string | null | undefined,
): BuildProcessType {
  if (!type) return "feature";
  return (BUILD_PROCESS_TYPE_VALUES as readonly string[]).includes(type)
    ? (type as BuildProcessType)
    : "feature";
}

export function normalizeSize(
  size: string | null | undefined,
): BuildProcessSize {
  if (!size) return "medium";
  return (BUILD_PROCESS_SIZES as readonly string[]).includes(size)
    ? (size as BuildProcessSize)
    : "medium";
}

/**
 * Single source of truth for "given this BI, what build-process type does it
 * become?". Reads the clean `BacklogItem.workType` closed enum (introduced
 * in BI-FD37173A / 2026-05-30) and maps it to the build-process type:
 *   - workType="bug"       -> "fix"   (fix-flow spec, 2026-05-29)
 *   - workType="doc"       -> "doc"   (#1348 right-sizing)
 *   - workType="chore"     -> "chore" (#1348 right-sizing)
 *   - workType in {feature,tool,skill,refactor} -> "feature"
 *     (all four are feature-shaped builds — design, plan, ship a change;
 *      a future spec can split them further if a distinct prompt/gate path
 *      proves useful)
 *
 * Legacy fallback: if workType is NULL (rows from the freeform-tail backfill
 * that pre-date BI-FD37173A and the operator has not yet reclassified), fall
 * back to the previous body-marker heuristic for chore. Eventually retire
 * this fallback once Phase 1 makes workType non-null at the DB level.
 *
 * Accepts a structurally-minimal subset of BacklogItem fields so the helper
 * is callable from anywhere (promote, MCP tool wiring, tests) without
 * dragging in the full Prisma row type.
 */
export function deriveBuildProcessType(
  bi: Pick<BacklogItemWithRelations, "body"> & { workType?: string | null },
): BuildProcessType {
  const workType = bi.workType ?? null;
  if (workType === "bug") return "fix";
  if (workType === "doc") return "doc";
  if (workType === "chore") return "chore";
  if (workType) return "feature";
  // Legacy unclassified-row fallback (deleted in Phase 1).
  if (/^\s*chore\s*:/im.test(bi.body ?? "")) return "chore";
  return "feature";
}

export function deriveBuildProcessSize(
  bi: { effortSize?: string | null },
): BuildProcessSize {
  return normalizeSize(bi.effortSize ?? null);
}

// ─── Model tier (EP-MODEL-TIER-ROUTING) ──────────────────────────────────────

/** Which model tier a build deserves. "local" = the on-box model (opencode /
 *  qwen3-coder); "robust" = a more capable configured engine (cloud Claude/
 *  Codex, or a larger local model). Endpoint-agnostic — the resolver in
 *  build-studio-config decides the concrete provider for each tier. */
export type BuildModelTier = "local" | "robust";

/**
 * Capability-matched routing: small/medium work stays on the local model; large
 * and xlarge (incl. decompose-bound) work routes to the robust tier. Pure
 * function of the right-sizing inputs — the local model reliably clears
 * small/medium designs + codegen, but its quick designs fail review and its
 * codegen overflows the VRAM-capped context on large work (observed
 * 2026-06-21/22), so large+ needs a more capable tier. Type-level refinement
 * (e.g. a large doc is simpler than a large feature) is a deliberate P2+
 * follow-up; P1 routes on size, the operator's stated lever.
 */
export function getModelTier(
  type: BuildProcessType | FeatureBuildKind | string | null | undefined,
  size: BuildProcessSize | string | null | undefined,
  opts?: RightsizingOpts,
): BuildModelTier {
  const t = normalizeType(type);
  const s = normalizeSize(size);
  // Legacy (EP-MODEL-TIER-ROUTING): route purely on size. This is the
  // byte-identical behavior when no quality-first/sensitivity opts are supplied.
  const legacy: BuildModelTier = s === "large" || s === "xlarge" ? "robust" : "local";
  if (!opts) return legacy;
  // A HIGH-sensitivity deliverable is always robust, regardless of size.
  if (opts.sensitivity === "high") return "robust";
  // Quality-first (EP-QUALITY-RIGHTSIZING §4.1): robust for all substantive work;
  // local ONLY for the trivial tail (small doc/chore).
  if (opts.qualityFirst) {
    const trivialTail = (t === "doc" || t === "chore") && s === "small";
    return trivialTail ? "local" : "robust";
  }
  return legacy;
}

// ─── Requirement check primitive ────────────────────────────────────────────

import {
  isFixContextComplete,
  normalizeHappyPathState,
  isHappyPathIntakeReady,
  describePlanReviewFailure,
  describeDesignReviewFailure,
} from "./feature-build-types";
import type { FixContext, ReviewResult } from "./feature-build-types";

type GateEvidence = Record<string, unknown>;

export type RequirementResult = { allowed: true } | { allowed: false; reason: string };

function missingHappyPathAnchorsFromState(state: ReturnType<typeof normalizeHappyPathState>): string[] {
  const missing: string[] = [];
  if (!state.intake.taxonomyNodeId) missing.push("taxonomy");
  if (!state.intake.backlogItemId) missing.push("backlog item");
  if (!state.intake.epicId) missing.push("epic");
  if (!state.intake.constrainedGoal) missing.push("constrained goal");
  return missing;
}

/**
 * Pure check for one named requirement. The wiring matches today's
 * checkPhaseGate body line-for-line so the default policy preserves behavior.
 */
export function checkRequirement(req: GateRequirement, evidence: GateEvidence): RequirementResult {
  switch (req) {
    case "designDoc-present": {
      if (!evidence.designDoc) return { allowed: false, reason: "A design document is required before planning." };
      return { allowed: true };
    }
    case "designReview-passed": {
      const review = evidence.designReview as ReviewResult | undefined;
      if (!review) return { allowed: false, reason: "Design review is required before planning." };
      if ((review as { decision?: string }).decision === "fail") {
        const isFix = evidence.kind === "fix";
        return {
          allowed: false,
          reason: isFix
            ? "Fix review failed. Revise the diagnosis and re-run the review before advancing."
            : describeDesignReviewFailure(review),
        };
      }
      return { allowed: true };
    }
    case "designReview-not-failed-if-present": {
      // Looser variant for the fix flow: absent = allowed.
      const review = evidence.designReview as { decision?: string } | undefined;
      if (review?.decision === "fail") {
        return {
          allowed: false,
          reason: "Fix review failed. Revise the diagnosis and re-run the review before advancing.",
        };
      }
      return { allowed: true };
    }
    case "fixContext-complete": {
      if (!isFixContextComplete(evidence.fixContext as FixContext | undefined)) {
        return {
          allowed: false,
          reason: "A complete fix diagnosis (reproduction steps, root cause, and fix approach) is required before planning.",
        };
      }
      return { allowed: true };
    }
    case "buildPlan-present": {
      if (!evidence.buildPlan) return { allowed: false, reason: "An implementation plan is required before building." };
      return { allowed: true };
    }
    case "planReview-passed": {
      const planReview = evidence.planReview as ReviewResult | undefined;
      if (!planReview) return { allowed: false, reason: "Plan review is required before building." };
      if ((planReview as { decision?: string }).decision === "fail") {
        return { allowed: false, reason: describePlanReviewFailure(planReview) };
      }
      return { allowed: true };
    }
    case "verification-typecheck-passed": {
      const verification = evidence.verificationOut as { testsFailed?: number; typecheckPassed?: boolean } | null | undefined;
      if (!verification) return { allowed: false, reason: "A verification run (tests + typecheck) is required before review." };
      if (!verification.typecheckPassed) return { allowed: false, reason: "Typecheck must pass before review." };
      return { allowed: true };
    }
    case "verification-depth-satisfied": {
      return checkVerificationDepthSatisfied(evidence);
    }
    case "acceptance-evaluated": {
      if (!evidence.acceptanceMet) return { allowed: false, reason: "Acceptance criteria not evaluated." };
      return { allowed: true };
    }
    case "acceptance-all-met-if-array": {
      if (Array.isArray(evidence.acceptanceMet)) {
        const criteria = evidence.acceptanceMet as Array<{ met?: boolean }>;
        if (criteria.some((c) => !c.met)) return { allowed: false, reason: "Not all acceptance criteria are met." };
      }
      return { allowed: true };
    }
    case "uxVerification-not-blocking": {
      // ADVISORY (operator decision 2026-06-07): UX verification is recorded for
      // visibility but does NOT hard-block ship — mirroring the informational
      // unit-test gate ("test failures are informational"). A CLI-developed,
      // committed, serving build ships on the CLI's evidence; browser-use UX
      // results (incl. null = not-run, and failed) are advisory, surfaced in the
      // Review panel rather than blocking. The QUALITY of the UX check itself
      // (browser-use agent producing genuine, non-vacuous results) is tracked
      // separately in BI-4BD81F3B. Only the transient "running" state briefly
      // defers, since the check is genuinely in-flight at that moment.
      const status = evidence.uxVerificationStatus as
        | "running" | "complete" | "failed" | "skipped" | null | undefined;
      if (status === "running") {
        return { allowed: false, reason: "UX verification is still running. Retry in a moment." };
      }
      return { allowed: true };
    }
    case "happyPathIntake-ready": {
      const state = normalizeHappyPathState(evidence.happyPathState);
      if (!isHappyPathIntakeReady(state)) {
        const missing = missingHappyPathAnchorsFromState(state).join(", ");
        // The exact phrasing varies between ideate->plan and plan->build in
        // today's code; the caller supplies the verb via evidence.intakeVerb
        // ("planning" | "building"), defaulting to "planning" to match the
        // ideate->plan use site that was the original home of this check.
        const verb = (evidence.intakeVerb as string | undefined) ?? "planning";
        return {
          allowed: false,
          reason: `Intake is incomplete. Link taxonomy, backlog item, epic, and a constrained goal before ${verb}. Missing: ${missing}.`,
        };
      }
      return { allowed: true };
    }
  }
}

// ─── Header-chip presentation helper (consumed by UI in Phase 2) ────────────

export function describePolicy(type: BuildProcessType, size: BuildProcessSize): string {
  const policy = getProcessPolicy(type, size);
  return `${policy.label} · ${policy.reviewIntensity} review · phases: ${policy.phases.join(" → ")}`;
}

// ─── checkPhaseGate — policy-driven gate ────────────────────────────────────
//
// Lives here (not in feature-build-types.ts) so the matrix module owns the
// gate logic + policy table together. feature-build-types.ts re-exports
// `checkPhaseGate` so existing import sites keep working unchanged.

import type { PhaseGateResult } from "./feature-build-types";

/**
 * Phase gate — generalized to a policy lookup over the right-sizing matrix.
 *
 * The transition graph (ALLOWED_TRANSITIONS) is unchanged. What varies per
 * build is *which* evidence requirements gate each transition. A small fix,
 * a chore, and a doc-gap each pull a different `LifecyclePolicy` from
 * getProcessPolicy(kind, processSize) and only the requirements that policy
 * lists for the current transition are enforced.
 *
 * Back-compat invariant: when `evidence.kind` is absent (or "feature") and
 * `evidence.processSize` is absent (or "medium"), the resolved policy is
 * the default feature-standard cell — byte-identical to the pre-matrix
 * behavior. The fix-flow design's binary kind switch is preserved as the
 * (fix, medium) cell.
 *
 * Threaded inputs:
 *   evidence.kind        — BuildProcessType (default "feature")
 *   evidence.processSize — BuildProcessSize (default "medium")
 *   evidence.intakeVerb  — "planning" | "building" (for the
 *                          happyPathIntake-ready reason string only)
 *   (everything else)    — same as before
 */
/** Read additive rightsizing opts; absent fields preserve byte identity. */
function rightsizingOptsFromEvidence(evidence: GateEvidence): RightsizingOpts | undefined {
  const qualityFirst = evidence.qualityFirst === true;
  const sensitivity = evidence.deliverableSensitivity as DeliverableSensitivity | undefined;
  const hasSensitivity = sensitivity != null && (DELIVERABLE_SENSITIVITIES as readonly string[]).includes(sensitivity);
  if (!qualityFirst && !hasSensitivity) return undefined;
  return { qualityFirst, ...(hasSensitivity ? { sensitivity } : {}) };
}

export function checkPhaseGate(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): PhaseGateResult {
  if (to === "failed") return { allowed: true };
  if (from === "review" && to === "build") return { allowed: true };

  const policy = getProcessPolicy(
    evidence.kind as string | undefined,
    evidence.processSize as string | undefined,
    rightsizingOptsFromEvidence(evidence),
  );
  const transition = `${from}->${to}` as BuildTransition;
  const required = policy.gates[transition] ?? [];

  // Surface the transition-specific intake verb without widening the enum.
  const verb = transition === "plan->build" ? "building" : "planning";
  const evidenceWithVerb = { ...evidence, intakeVerb: evidence.intakeVerb ?? verb };

  for (const req of required) {
    const result = checkRequirement(req, evidenceWithVerb);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
