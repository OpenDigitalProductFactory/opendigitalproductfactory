import type { ExecutionEvidenceDimension } from "../execution-evidence";
import type {
  ReadinessCode,
  ReadinessEvidenceLane,
  ReadinessEvidenceState,
  ReadinessProfile,
  ReadinessRequirementResult,
} from "./types";

/**
 * Where a requirement's evidence actually lives, as opposed to whether it exists.
 *
 * BI-28E8CB88: readiness is projected from `initiative_gate_receipt` activities
 * alone. An author who calls `record_execution_evidence` gets a success result
 * and a visible timeline entry, and reasonably concludes the obligation is met;
 * the gate then reports the requirement as `missing`. Measured on the live
 * install: 38 items held `evidence` activities, 4 held gate receipts, so 35
 * recorded their work into a lane nothing reads and nothing said so.
 *
 * The fix keeps receipts as the only currency — relaxing that would make the
 * reviewer lane self-approvable — and makes the divergence loud instead:
 *
 * - `gate-receipt`   the requirement is satisfied by the receipt the gate reads.
 * - `recorded-unread` evidence for this requirement EXISTS on the item and this
 *   gate cannot read it. Not "you supplied nothing".
 * - `none`           no evidence of any kind was found for this requirement.
 */
export type { ReadinessEvidenceLane } from "./types";

/**
 * What a requirement MEANS for one profile, and the exact door that records it.
 *
 * BI-3AE38A1F, reframed on founder direction 2026-08-26: even a bug needs
 * research — did you verify the claim, and did you find it? What constitutes
 * research VARIES BY PROFILE. A net-new capability and an operational fix demand
 * different evidence, and the platform must state the distinction rather than
 * applying one undifferentiated gate and leaving the worker to discover the bar
 * by being refused.
 *
 * The requirement is unchanged. Only the definition and the door are stated.
 */
export type ReadinessRequirementDefinition = {
  /** One sentence: what this requirement asks of THIS profile. */
  summary: string;
  /** The concrete evidence that answers it. */
  satisfiedBy: readonly string[];
  /** The tool that records it. Naming it is the whole point. */
  writerTool: string;
};

/**
 * Operational-fix research, written from a record that was actually produced and
 * could not be recorded anywhere (BI-2DB7254B): the defect confirmed on a named
 * ref rather than from memory, a failing-then-passing proof, candidate causes
 * disproved by running them rather than by reading, and reachability established
 * by execution.
 */
const OPERATIONAL_FIX_RESEARCH: ReadinessRequirementDefinition = {
  summary:
    "For a fix, research is verification and reproduction: prove the defect is real on the current tree before writing a line.",
  satisfiedBy: [
    "the defect confirmed on a NAMED ref (commit or branch + file + line), not from memory",
    "a failing-then-passing proof — the test that fails before the fix and passes after",
    "the candidate causes you ruled out, and how you ruled them out by running them rather than reading them",
  ],
  writerTool: "record_initiative_evidence(gate: \"research\")",
};

const DESIGN_EXPLORATION_RESEARCH: ReadinessRequirementDefinition = {
  summary:
    "For net-new capability, research is design exploration: show the shape was chosen against alternatives, not invented.",
  satisfiedBy: [
    "2-3 comparable open-source or industry implementations compared",
    "the standard this follows, cited, or the project-specific reason for deviating",
    "what DPF adopts and what it rejects, with the reason",
  ],
  writerTool: "record_initiative_evidence(gate: \"research\")",
};

/** `null` means the profile does not carry the requirement at all. */
export const RESEARCH_DEFINITIONS: Record<ReadinessProfile, ReadinessRequirementDefinition | null> = {
  "doc-only": null,
  fix: OPERATIONAL_FIX_RESEARCH,
  feature: DESIGN_EXPLORATION_RESEARCH,
  "cross-domain": DESIGN_EXPLORATION_RESEARCH,
  archetype: DESIGN_EXPLORATION_RESEARCH,
};

/**
 * What "plan" means per profile. A fix does not earn a plan document: shipping
 * one adds the plan-backlog coverage gate, whose receipt is obtainable only
 * through the reviewer route, for a single-deliverable change. The sequence
 * belongs in the design doc, and coverage cites that.
 */
const PHASED_PLAN: ReadinessRequirementDefinition = {
  summary: "For net-new capability, the plan is a phased implementation plan with live backlog coverage.",
  satisfiedBy: [
    "a phased plan under docs/superpowers/plans/",
    "a coverage record mapping every deliverable to a filed backlog item",
  ],
  writerTool: "record_plan_backlog_coverage",
};

export const PLAN_DEFINITIONS: Record<ReadinessProfile, ReadinessRequirementDefinition | null> = {
  "doc-only": null,
  fix: {
    summary:
      "For a fix, the ordered sequence stays in the design doc — not a separate plan document; implementation coverage belongs to the governed implementation parent rather than the documentation artifact.",
    satisfiedBy: [
      "the design doc naming the deliverables in order",
      "an explicit binding to the implementation parent or child that owns the current scope baseline",
      "a coverage record against that implementation item's canonical plan",
    ],
    writerTool: "record_plan_backlog_coverage",
  },
  feature: PHASED_PLAN,
  "cross-domain": PHASED_PLAN,
  archetype: PHASED_PLAN,
};

/** The definition for a requirement under a profile, when one is written. */
export function requirementDefinition(
  code: ReadinessCode,
  profile: ReadinessProfile,
): ReadinessRequirementDefinition | null {
  if (code === "RESEARCH_REQUIRED") return RESEARCH_DEFINITIONS[profile];
  if (code === "PLAN_REQUIRED" || code === "PLAN_COVERAGE_REQUIRED") return PLAN_DEFINITIONS[profile];
  return null;
}

/**
 * Which requirements an execution-evidence dimension could plausibly be an
 * attempt at. Deliberately narrow: reporting every recorded activity against
 * every unmet requirement would be as uninformative as reporting none.
 */
const CODES_BY_EVIDENCE_DIMENSION: Partial<Record<ExecutionEvidenceDimension, readonly ReadinessCode[]>> = {
  source: ["RESEARCH_REQUIRED", "DELIVERY_EVIDENCE_REQUIRED"],
  "unit-tests": ["RESEARCH_REQUIRED", "DELIVERY_EVIDENCE_REQUIRED"],
  "production-build": ["DELIVERY_EVIDENCE_REQUIRED"],
  ux: ["DELIVERY_EVIDENCE_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED"],
  migration: ["DELIVERY_EVIDENCE_REQUIRED"],
  documentation: ["CANONICAL_DESIGN_REQUIRED", "SPEC_APPROVAL_REQUIRED", "OBJECTIVE_BASELINE_REQUIRED"],
  manual: ["RESEARCH_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED", "DELIVERY_EVIDENCE_REQUIRED"],
};

export function readinessCodesForEvidenceDimension(
  dimension: ExecutionEvidenceDimension,
): readonly ReadinessCode[] {
  return CODES_BY_EVIDENCE_DIMENSION[dimension] ?? [];
}

/**
 * Remedies for requirements whose door is fixed regardless of profile. These
 * mirror the recovery-router text so a caller reading the decision alone is not
 * worse off than one who also called the recovery route.
 */
const GENERIC_REMEDIES: Partial<Record<ReadinessCode, string>> = {
  CLASSIFICATION_REQUIRED:
    "Classify the item before shaping it: set the work type and scope so a readiness profile can be derived.",
  AUTHORIZATION_DENIED:
    "The caller's authority does not cover this transition. Re-run from a principal holding the required capability.",
  CANONICAL_DESIGN_REQUIRED:
    "Record the canonical design as the scope baseline with record_initiative_design_review(gate: \"design-spec\").",
  SPEC_APPROVAL_REQUIRED:
    "An independent reviewer approves the design with record_initiative_design_review(gate: \"spec-approval\").",
  OBJECTIVE_BASELINE_REQUIRED:
    "The scope baseline is minted by a passing spec-approval receipt. Route record_initiative_design_review(gate: \"spec-approval\") to an eligible independent reviewer.",
  PLAN_REVIEW_REQUIRED:
    "An independent reviewer approves the plan with record_initiative_design_review(gate: \"plan-review\").",
  ARTIFACT_AUTHOR_REQUIRED:
    "Sign the design commit off (git commit -s), push the rewritten sha, then re-sync the workroom head with adopt_worktree.",
  CAPSULE_IDENTITY_MISMATCH:
    "The claim did not match the workroom's recorded identity. The reasons above name which fields differ: a stale branch or head re-syncs with adopt_worktree(headBranch, headSha), an expired lease renews with heartbeat_workroom, and a terminal or foreign-held room needs a new claim.",
  DELIVERY_EVIDENCE_REQUIRED:
    "Record delivery evidence with record_execution_evidence, then cite those activity IDs in completionEvidence.evidenceActivityIds.",
  ACCEPTANCE_EVIDENCE_REQUIRED:
    "Record acceptance evidence against the objective baseline before closing the item.",
  OBJECTIVE_RECONCILIATION_REQUIRED:
    "Reconcile delivered outcomes against the objective baseline with record_product_outcome_observation.",
  READINESS_PROJECTION_FAILED:
    "Readiness projection could not read this item's evidence. Report it; do not retry blindly.",
  STALE_EVIDENCE:
    "Recorded evidence is bound to a superseded artifact. Re-record it against the current immutable head.",
};

function definitionSentence(definition: ReadinessRequirementDefinition): string {
  return `${definition.summary} That means: ${definition.satisfiedBy.join("; ")}. Record it with ${definition.writerTool}.`;
}

export type RequirementGuidanceInput = {
  code: ReadinessCode;
  profile: ReadinessProfile;
  state: ReadinessEvidenceState | "blocked";
  /** Non-receipt activity IDs on this item that could be an attempt at this requirement. */
  unreadEvidenceRefs: readonly string[];
  /**
   * Reasons produced by a sub-policy that the single evidence state collapses.
   * The completion-evidence policy computes precise blockers ("missing
   * production-build") and `deliveryState()` flattened all of them to `missing`,
   * so the caller was told nothing at all (BI-28E8CB88, recurrence 2026-08-27).
   */
  reasons?: readonly string[];
};

export function requirementEvidenceLane(input: {
  state: ReadinessEvidenceState | "blocked";
  unreadEvidenceRefs: readonly string[];
}): ReadinessEvidenceLane {
  if (input.state === "pass") return "gate-receipt";
  return input.unreadEvidenceRefs.length > 0 ? "recorded-unread" : "none";
}

/**
 * The one actionable sentence a caller needs for an unmet requirement.
 *
 * Returns `null` for a satisfied requirement: an instruction attached to
 * something already done is noise, and noise is what makes the real remedy easy
 * to miss.
 */
/** Give a clause a full stop so joined reasons do not read as one sentence. */
function endWithStop(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return trimmed;
  return /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function requirementNextAction(input: RequirementGuidanceInput): string | null {
  if (input.state === "pass" || input.state === "not-applicable") return null;

  const parts: string[] = [];
  if (input.reasons && input.reasons.length > 0) {
    // Terminate each reason before joining. A blocker message is a bare clause
    // ("Completion evidence is missing source"), so a plain space ran them
    // together into "...missing source Completion evidence is missing
    // production-build" — one sentence naming a dimension called
    // "source Completion". The reasons are the part a caller acts on, so they
    // are the last place to make them re-read a line to find the boundary.
    parts.push(input.reasons.map(endWithStop).join(" "));
  }

  const definition = requirementDefinition(input.code, input.profile);
  if (definition) {
    parts.push(definitionSentence(definition));
  } else if (GENERIC_REMEDIES[input.code]) {
    parts.push(GENERIC_REMEDIES[input.code]!);
  }

  if (input.unreadEvidenceRefs.length > 0) {
    // The exact statement BI-28E8CB88 asks for: evidence exists, this gate does
    // not read it, and here is what does.
    parts.push(
      `${input.unreadEvidenceRefs.length} evidence activit${input.unreadEvidenceRefs.length === 1 ? "y is" : "ies are"} `
      + `recorded on this item that this gate cannot read (${input.unreadEvidenceRefs.slice(0, 5).join(", ")}). `
      + "A timeline evidence entry is not a gate receipt; recording one does not satisfy this requirement.",
    );
  }

  if (input.state === "malformed") {
    parts.push("The recorded receipt does not match the governed schema, so it cannot be read. Re-record it.");
  }
  if (input.state === "stale") {
    parts.push("The recorded receipt is bound to a superseded artifact digest. Re-record it against the current head.");
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Build a complete requirement result outside the evaluator.
 *
 * Several call sites synthesise a requirement directly — a hard authorization
 * denial, a stale-evidence blocker, an epic rolling its children up. Each one is
 * a thing a caller has to act on, so each one owes the same lane and next
 * action the evaluator produces. This is the single constructor so a new site
 * cannot reintroduce a bare `{ code, state }` that says nothing (BI-28E8CB88).
 */
export function readinessRequirement(input: {
  code: ReadinessCode;
  state: ReadinessEvidenceState | "blocked";
  accountableRole: string;
  profile?: ReadinessProfile;
  evidenceRefs?: readonly string[];
  unreadEvidenceRefs?: readonly string[];
  reasons?: readonly string[];
}): ReadinessRequirementResult {
  const unreadEvidenceRefs = [...(input.unreadEvidenceRefs ?? [])];
  return {
    code: input.code,
    state: input.state,
    accountableRole: input.accountableRole,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    evidenceLane: requirementEvidenceLane({ state: input.state, unreadEvidenceRefs }),
    unreadEvidenceRefs,
    nextAction: requirementNextAction({
      code: input.code,
      // Without a profile the profile-specific definitions do not apply and the
      // generic remedy is used, which is correct rather than merely tolerable.
      profile: input.profile ?? "doc-only",
      state: input.state,
      unreadEvidenceRefs,
      reasons: input.reasons,
    }),
  };
}
