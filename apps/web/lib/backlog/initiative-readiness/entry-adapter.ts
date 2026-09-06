import { evidenceKindMetadata, isExecutionEvidenceKind } from "../execution-evidence";

import { evaluateInitiativeReadiness } from "./evaluate";
import { deriveAuthoritativeReadinessProfile } from "./profiles";
import { readinessCodesForEvidenceDimension } from "./readiness-guidance";
import type {
  InitiativeReadinessDecision,
  InitiativeReadinessFacts,
  InitiativeTransitionObject,
  ReadinessCode,
  ReadinessEvidenceState,
  ReadinessTarget,
} from "./types";
import { READINESS_CODES, READINESS_EVIDENCE_LANES, READINESS_PROFILES } from "./types";

export type InitiativeReadinessActivity = {
  id: string;
  kind: string;
  gateKey: string | null;
  recordedAt: Date;
  payload: unknown;
};

export type InitiativeReadinessItem = {
  id: string;
  itemId: string;
  status?: string | null;
  type?: string | null;
  source?: string | null;
  workType?: string | null;
  scopeKind?: string | null;
  archetypeCategories?: readonly string[];
  archetypeIds?: readonly string[];
  activeBuildKind?: string | null;
};

type Baseline = {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactDigest: string;
  profile: InitiativeReadinessFacts["profile"];
};

const GATE_NAMES = new Set([
  "classification", "research", "design-spec", "spec-approval", "architecture-review",
  "data-review", "ux-fit-review", "security-review", "compliance-review", "domain-review",
  "plan-review", "dependency-disposition", "archetype-provisioning", "archetype-completeness",
]);

function normalizeGate(value: string | null): string | null {
  return value?.replaceAll("_", "-") ?? null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseBaselines(activities: readonly InitiativeReadinessActivity[], itemId: string): {
  current: Baseline | null;
  malformed: boolean;
  ambiguous: boolean;
} {
  const rows = activities.filter((activity) => activity.kind === "initiative_scope_baseline");
  const parsed: Baseline[] = [];
  for (const row of rows) {
    const payload = object(row.payload);
    const subject = object(payload?.subject);
    const profile = payload?.profile;
    if (!payload
      || payload.schemaVersion !== 1
      || typeof payload.baselineId !== "string"
      || (payload.supersedesBaselineId !== null && typeof payload.supersedesBaselineId !== "string")
      || typeof payload.artifactDigest !== "string"
      || subject?.kind !== "backlog-item"
      || subject.id !== itemId
      || !(typeof profile === "string" && ["doc-only", "fix", "feature", "cross-domain", "archetype"].includes(profile))) {
      return { current: null, malformed: true, ambiguous: true };
    }
    parsed.push({
      baselineId: payload.baselineId,
      supersedesBaselineId: payload.supersedesBaselineId as string | null,
      artifactDigest: payload.artifactDigest,
      profile: profile as Baseline["profile"],
    });
  }
  const ids = new Set(parsed.map((entry) => entry.baselineId));
  if (ids.size !== parsed.length || parsed.some((entry) => entry.supersedesBaselineId && !ids.has(entry.supersedesBaselineId))) {
    return { current: null, malformed: false, ambiguous: true };
  }
  const superseded = new Set(parsed.flatMap((entry) => entry.supersedesBaselineId ? [entry.supersedesBaselineId] : []));
  const heads = parsed.filter((entry) => !superseded.has(entry.baselineId));
  return {
    current: heads.length === 1 ? heads[0]! : null,
    malformed: false,
    ambiguous: heads.length > 1,
  };
}

function validString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

function validArtifactRef(value: Record<string, unknown> | null): boolean {
  if (!value) return false;
  if (value.kind === "feature-build-revision") return validString(value.revisionId);
  if (value.kind === "document-version") return validString(value.versionId);
  return value.kind === "repo-blob-at-commit"
    && validString(value.repositoryFullName)
    && validString(value.commitSha)
    && validString(value.path)
    && validString(value.providerBlobId);
}

function validAuthoritySnapshot(value: Record<string, unknown> | null): boolean {
  return value?.decision === "allow"
    && validString(value.effectiveHumanCapability)
    && validString(value.effectiveAgentGrant)
    && validString(value.tokenScope)
    && validString(value.organizationId)
    && validString(value.actionKey)
    && validString(value.policyVersion);
}

function validTransitionObject(value: Record<string, unknown> | null): boolean {
  return Boolean(value
    && ["backlog-item", "epic", "feature-build", "work-capsule", "task-run"].includes(String(value.kind))
    && validString(value.id)
    && validString(value.expectedVersion)
    && ["complete", "done"].includes(String(value.targetState)));
}

function validRequirementResult(value: unknown): boolean {
  const requirement = object(value);
  return Boolean(requirement
    && READINESS_CODES.includes(requirement.code as (typeof READINESS_CODES)[number])
    && ["pass", "fail", "missing", "malformed", "stale", "not-applicable", "blocked"].includes(String(requirement.state))
    && validString(requirement.accountableRole)
    && validStringArray(requirement.evidenceRefs)
    && READINESS_EVIDENCE_LANES.includes(requirement.evidenceLane as (typeof READINESS_EVIDENCE_LANES)[number])
    && validStringArray(requirement.unreadEvidenceRefs)
    && (requirement.nextAction === null || typeof requirement.nextAction === "string"));
}

function validRequirementResults(value: unknown): boolean {
  return Array.isArray(value) && value.every(validRequirementResult);
}

function persistedTerminalCompletionDecision(
  activities: readonly InitiativeReadinessActivity[],
  item: InitiativeReadinessItem,
): InitiativeReadinessDecision | null {
  if (item.status !== "done") return null;
  const candidates = [...activities]
    .filter((activity) => activity.kind === "initiative_readiness_decision")
    .sort((left, right) => {
      const byTime = right.recordedAt.getTime() - left.recordedAt.getTime();
      if (byTime !== 0) return byTime;
      const leftDecisionId = object(left.payload)?.decisionId;
      const rightDecisionId = object(right.payload)?.decisionId;
      return String(rightDecisionId ?? "").localeCompare(String(leftDecisionId ?? ""));
    });
  for (const activity of candidates) {
    const payload = object(activity.payload);
    const subject = object(payload?.subject);
    const transitionObject = object(payload?.transitionObject);
    const satisfied = Array.isArray(payload?.satisfied) ? payload.satisfied : null;
    const unmet = Array.isArray(payload?.unmet) ? payload.unmet : null;
    const blockers = Array.isArray(payload?.blockers) ? payload.blockers : null;
    if (!payload
      || payload.schemaVersion !== 1
      || payload.enforcementState !== "enforced"
      || payload.target !== "completion"
      || payload.verdict !== "allowed"
      || subject?.kind !== "backlog-item"
      || subject.id !== item.itemId
      || !validString(payload.decisionId)
      || !validString(payload.policyVersion)
      || !READINESS_PROFILES.includes(payload.profile as (typeof READINESS_PROFILES)[number])
      || !validString(payload.evaluatedAt)
      || !validTransitionObject(transitionObject)
      || !satisfied
      || !unmet
      || !blockers
      || !validRequirementResults(satisfied)
      || !validRequirementResults(unmet)
      || !validRequirementResults(blockers)
      || unmet.length !== 0
      || blockers.length !== 0
      || !validString(payload.factsDigest)
      || !validString(payload.authorityDecisionId)
      || !validAuthoritySnapshot(object(payload.authoritySnapshot))) {
      continue;
    }
    return {
      decisionId: payload.decisionId,
      policyVersion: payload.policyVersion,
      subject: subject as InitiativeReadinessDecision["subject"],
      transitionObject: transitionObject as InitiativeReadinessDecision["transitionObject"],
      profile: payload.profile as InitiativeReadinessDecision["profile"],
      target: "completion",
      verdict: "allowed",
      satisfied: satisfied as InitiativeReadinessDecision["satisfied"],
      unmet: unmet as InitiativeReadinessDecision["unmet"],
      blockers: blockers as InitiativeReadinessDecision["blockers"],
      evaluatedAt: payload.evaluatedAt,
    };
  }
  return null;
}

function projectGateReceipt(
  activity: InitiativeReadinessActivity,
  canonicalDigest: string | null,
  itemId: string,
): { state: ReadinessEvidenceState; malformed: boolean; gate: string | null } {
  const payload = object(activity.payload);
  const gate = normalizeGate(activity.gateKey);
  if (!payload || !gate || !GATE_NAMES.has(gate)) return { state: "malformed", malformed: true, gate };
  const payloadGate = normalizeGate(typeof payload.gate === "string" ? payload.gate : null);
  const decision = payload.decision;
  const artifactRef = object(payload.artifactRef);
  const authority = object(payload.authoritySnapshot);
  const subject = object(payload.subject);
  const valid = payload.schemaVersion === 1
    && payload.receiptId === activity.id
    && payloadGate === gate
    && ["pass", "fail", "not-applicable"].includes(String(decision))
    && validString(payload.policyVersion)
    && validString(payload.artifactDigest)
    && validString(payload.artifactAuthorRef)
    && validString(payload.reviewerPrincipalId)
    && validString(payload.reviewerAgentId)
    && validString(payload.authorityDecisionId)
    && validString(payload.reason)
    && subject?.kind === "backlog-item"
    && subject.id === itemId
    && validArtifactRef(artifactRef)
    && validAuthoritySnapshot(authority)
    && validStringArray(payload.findingRefs)
    && validStringArray(payload.resolvedFindingRefs)
    && (gate !== "classification" || decision !== "pass"
      || ["doc-only", "fix", "feature", "cross-domain", "archetype"].includes(String(payload.selectedProfile)))
    && (gate === "classification" || payload.selectedProfile === undefined)
    && (decision === "fail" || payload.findingRefs.length === 0);
  if (!valid) return { state: "malformed", malformed: true, gate };
  if (canonicalDigest && payload.artifactDigest !== canonicalDigest) {
    return { state: "stale", malformed: false, gate };
  }
  return { state: decision as ReadinessEvidenceState, malformed: false, gate };
}

function latestGateStates(
  activities: readonly InitiativeReadinessActivity[],
  canonicalDigest: string | null,
  itemId: string,
): { states: Map<string, ReadinessEvidenceState>; malformed: boolean } {
  const latest = [...activities]
    .filter((activity) => activity.kind === "initiative_gate_receipt")
    .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || right.id.localeCompare(left.id));
  const states = new Map<string, ReadinessEvidenceState>();
  let malformed = false;
  for (const activity of latest) {
    const gate = normalizeGate(activity.gateKey);
    if (gate && states.has(gate)) continue;
    const projected = projectGateReceipt(activity, canonicalDigest, itemId);
    malformed ||= projected.malformed;
    if (projected.gate) states.set(projected.gate, projected.state);
  }
  return { states, malformed };
}

function state(states: ReadonlyMap<string, ReadinessEvidenceState>, gate: string): ReadinessEvidenceState {
  return states.get(gate) ?? "missing";
}

/**
 * Timeline `evidence` activities grouped by the requirement they could be an
 * attempt at.
 *
 * BI-28E8CB88: `record_execution_evidence` writes a `BacklogItemActivity` of
 * kind `evidence`; readiness reads `initiative_gate_receipt` only. The writer
 * works — it just writes somewhere the reader never looks, and neither side said
 * so. Measured on the live install: 38 items held evidence, 4 held receipts.
 *
 * This does NOT make evidence satisfy a gate. It records that the evidence is
 * there so the decision can say "recorded in a form this gate does not read"
 * instead of "missing", which is the one output guaranteed to read as "you
 * supplied nothing" to someone who supplied what was asked for.
 */
function unreadEvidenceByCode(
  activities: readonly InitiativeReadinessActivity[],
): Partial<Record<ReadinessCode, string[]>> {
  const byCode: Partial<Record<ReadinessCode, string[]>> = {};
  for (const activity of activities) {
    if (activity.kind !== "evidence") continue;
    const payload = object(activity.payload);
    const evidenceKind = payload?.evidenceKind;
    if (!isExecutionEvidenceKind(evidenceKind)) continue;
    const metadata = evidenceKindMetadata(evidenceKind);
    // A failing or non-gate-eligible record is not an attempt at satisfying a
    // requirement, so reporting it as one would mislead in the other direction.
    if (!metadata.gateEligible || metadata.polarity !== "pass") continue;
    for (const code of readinessCodesForEvidenceDimension(metadata.dimension)) {
      (byCode[code] ??= []).push(activity.id);
    }
  }
  return byCode;
}

function projectPlanCoverage(
  activities: readonly InitiativeReadinessActivity[],
  baseline: Baseline | null,
): ReadinessEvidenceState {
  const latest = [...activities]
    .filter((activity) => activity.kind === "plan_backlog_coverage")
    .sort((left, right) => right.recordedAt.getTime() - left.recordedAt.getTime() || right.id.localeCompare(left.id))[0];
  if (!latest) return "missing";
  const payload = object(latest.payload);
  const artifact = object(payload?.planArtifactRef);
  if (!payload
    || payload.schemaVersion !== 2
    || !["atomic", "decomposed"].includes(String(payload.decision))
    || !validString(payload.planPath)
    || !Array.isArray(payload.deliverables)
    || artifact?.kind !== "repo-blob-at-commit"
    || artifact.path !== payload.planPath
    || !validString(payload.planArtifactDigest)
    || !baseline
    || payload.scopeBaselineId !== baseline.baselineId
    || payload.scopeBaselineArtifactDigest !== baseline.artifactDigest) {
    return "malformed";
  }
  return "pass";
}

export function projectBacklogItemReadiness(args: {
  item: InitiativeReadinessItem;
  activities: readonly InitiativeReadinessActivity[];
  target: ReadinessTarget;
  transitionObject: InitiativeTransitionObject;
  authorization: ReadinessEvidenceState;
  capsuleIdentity: ReadinessEvidenceState;
  planCoverage?: ReadinessEvidenceState;
  artifactHints?: { hasSpec: boolean; hasPlan: boolean };
  completion?: {
    deliveryEvidence: ReadinessEvidenceState;
    acceptanceEvidence: ReadinessEvidenceState;
    objectiveReconciliation: ReadinessEvidenceState;
    evidenceRefs?: InitiativeReadinessFacts["evidenceRefs"];
    /** Sub-policy reasons a single evidence state collapses (BI-28E8CB88). */
    requirementReasons?: InitiativeReadinessFacts["requirementReasons"];
    objectiveBaselineConflict?: boolean;
    projectionError?: boolean;
  };
  evaluatedAt: string;
}): {
  governed: boolean;
  baselineId: string | null;
  artifactHints: { hasSpec: boolean; hasPlan: boolean };
  decision: InitiativeReadinessDecision;
} {
  const baseline = parseBaselines(args.activities, args.item.itemId);
  const receipts = latestGateStates(args.activities, baseline.current?.artifactDigest ?? null, args.item.itemId);
  const profile = deriveAuthoritativeReadinessProfile({
    ...args.item,
    recordedProfiles: baseline.current ? [baseline.current.profile] : [],
  });
  const governed = profile !== null;
  const evidence = receipts.states;
  const baselineState: ReadinessEvidenceState = baseline.current ? "pass" : "missing";
  const coverage = args.planCoverage ?? projectPlanCoverage(args.activities, baseline.current);
  const dependency = state(evidence, "dependency-disposition");
  const archetypeProvisioning = state(evidence, "archetype-provisioning");
  const facts: InitiativeReadinessFacts = {
    subject: { kind: "backlog-item", id: args.item.itemId },
    transitionObject: args.transitionObject,
    profile: profile ?? "doc-only",
    evaluatedAt: args.evaluatedAt,
    classification: profile ? "pass" : "missing",
    canonicalDesign: baselineState,
    canonicalDesignAmbiguous: baseline.ambiguous,
    research: state(evidence, "research"),
    specApproval: state(evidence, "spec-approval"),
    specialistReviews: {
      architecture: state(evidence, "architecture-review"),
      data: state(evidence, "data-review"),
      ux: state(evidence, "ux-fit-review"),
      security: state(evidence, "security-review"),
      compliance: state(evidence, "compliance-review"),
      domain: state(evidence, "domain-review"),
    },
    plan: coverage,
    planReview: state(evidence, "plan-review"),
    planCoverage: coverage,
    traceability: coverage,
    dependencies: dependency === "missing" ? "not-applicable" : dependency,
    authorization: args.authorization,
    artifactAuthor: baselineState,
    capsuleIdentity: args.capsuleIdentity,
    deliveryEvidence: args.completion?.deliveryEvidence ?? "missing",
    acceptanceEvidence: args.completion?.acceptanceEvidence ?? "missing",
    objectiveBaseline: baselineState,
    objectiveBaselineConflict: args.completion?.objectiveBaselineConflict,
    objectiveReconciliation: args.completion?.objectiveReconciliation ?? "missing",
    archetypeProvisioning: {
      templateSubstrate: archetypeProvisioning,
      professionCorpus: archetypeProvisioning,
      coworkerDefinition: archetypeProvisioning,
      skillsAndTools: archetypeProvisioning,
    },
    archetypeCompleteness: state(evidence, "archetype-completeness"),
    projectionError: baseline.malformed || receipts.malformed || args.completion?.projectionError,
    evidenceRefs: args.completion?.evidenceRefs,
    unreadEvidenceRefs: unreadEvidenceByCode(args.activities),
    requirementReasons: args.completion?.requirementReasons,
  };
  return {
    governed,
    baselineId: baseline.current?.baselineId ?? null,
    artifactHints: args.artifactHints ?? { hasSpec: false, hasPlan: false },
    decision: evaluateInitiativeReadiness(facts, args.target),
  };
}

export function projectBacklogItemReadinessSummary(args: {
  item: InitiativeReadinessItem;
  activities: readonly InitiativeReadinessActivity[];
  hasSpec: boolean;
  hasPlan: boolean;
  evaluatedAt: string;
}) {
  const terminalCompletion = persistedTerminalCompletionDecision(args.activities, args.item);
  const decisions = Object.fromEntries((["design", "plan", "implementation", "completion"] as const).map((target) => {
    if (target === "completion" && terminalCompletion) return [target, terminalCompletion];
    const projected = projectBacklogItemReadiness({
      item: args.item,
      activities: args.activities,
      target,
      transitionObject: {
        kind: "backlog-item",
        id: args.item.itemId,
        expectedVersion: "read-projection",
        targetState: target,
      },
      authorization: "pass",
      capsuleIdentity: "pass",
      artifactHints: { hasSpec: args.hasSpec, hasPlan: args.hasPlan },
      evaluatedAt: args.evaluatedAt,
    });
    return [target, projected.decision];
  })) as Record<ReadinessTarget, InitiativeReadinessDecision>;
  return {
    governed: projectBacklogItemReadiness({
      item: args.item,
      activities: args.activities,
      target: "design",
      transitionObject: { kind: "backlog-item", id: args.item.itemId, expectedVersion: "read-projection", targetState: "design" },
      authorization: "pass",
      capsuleIdentity: "pass",
      evaluatedAt: args.evaluatedAt,
    }).governed,
    artifactHints: { hasSpec: args.hasSpec, hasPlan: args.hasPlan },
    decisions,
  };
}
