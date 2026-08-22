import { evaluateInitiativeReadiness } from "./evaluate";
import { deriveAuthoritativeReadinessProfile } from "./profiles";
import type {
  InitiativeReadinessDecision,
  InitiativeReadinessFacts,
  InitiativeTransitionObject,
  ReadinessEvidenceState,
  ReadinessTarget,
} from "./types";

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
    deliveryEvidence: "missing",
    acceptanceEvidence: "missing",
    objectiveBaseline: baselineState,
    objectiveReconciliation: "missing",
    archetypeProvisioning: {
      templateSubstrate: archetypeProvisioning,
      professionCorpus: archetypeProvisioning,
      coworkerDefinition: archetypeProvisioning,
      skillsAndTools: archetypeProvisioning,
    },
    archetypeCompleteness: state(evidence, "archetype-completeness"),
    projectionError: baseline.malformed || receipts.malformed,
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
  const decisions = Object.fromEntries((["design", "plan", "implementation", "completion"] as const).map((target) => {
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
