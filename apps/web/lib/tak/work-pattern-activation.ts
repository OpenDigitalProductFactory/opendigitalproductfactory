import { createHash } from "node:crypto";

import type { CapabilityInstallScope } from "@dpf/db/capability-maturity";

import { validateBindingGrant } from "@/lib/authority/binding-editor";
import {
  canReopenRejectedWorkPatternCandidate,
  workPatternCandidateEvidenceIdentity,
  type WorkPatternCandidateEvidence,
} from "./work-pattern-effective-ledger";
import {
  WORK_PATTERN_BINDING_RESOURCE_TYPE,
  type WorkPatternAuthorityScopeV1,
  type WorkPatternBindingStatus,
  type WorkPatternEvidenceOrigin,
} from "./work-pattern-binding-reader";
import {
  deriveMaximumActivationScope,
  type PortableCanonicalCorpusEvidence,
  type WorkPatternActivationEvidenceScope,
  type WorkPatternCorroborationEvidence,
} from "./work-pattern-activation-scope";
import {
  DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
  evaluateWorkPatternPromotion,
  type WorkPatternPromotionDecision,
  type WorkPatternPromotionEvidence,
} from "./work-pattern-promotion-policy";

export type WorkPatternActivationGrant = {
  grantKey: string;
  mode: string;
  rationale?: string | null;
};

export type WorkPatternActivationBinding = {
  bindingId: string;
  name: string;
  status: WorkPatternBindingStatus;
  resourceRef: string;
  appliedAgentId: string;
  grants: WorkPatternActivationGrant[];
  authorityScope: WorkPatternAuthorityScopeV1;
};

export type WorkPatternActivationSnapshot = {
  agentId: string;
  patternKey: string;
  baselinePatternVersion: number;
  patternVersion: number;
  sourceExperimentTaskRunId: string;
  source: WorkPatternActivationEvidenceScope;
  portableCanonicalCorpus: PortableCanonicalCorpusEvidence | null;
  corroborations: readonly WorkPatternCorroborationEvidence[];
  candidateEvidence: WorkPatternCandidateEvidence;
  promotionEvidence: WorkPatternPromotionEvidence;
  intrinsicGrantKeys: string[];
};

export type WorkPatternActivationPersistenceSession = {
  readSnapshot(): Promise<WorkPatternActivationSnapshot>;
  listBindingsForLane(laneKey: string): Promise<WorkPatternActivationBinding[]>;
  findBinding(bindingId: string): Promise<WorkPatternActivationBinding | null>;
  listRejectedCandidates(): Promise<Array<{
    candidateIdentity: string;
    failureClass: string;
  }>>;
  saveBinding(
    binding: WorkPatternActivationBinding,
  ): Promise<WorkPatternActivationBinding>;
  updateBindingStatus(
    bindingId: string,
    status: WorkPatternBindingStatus,
  ): Promise<void>;
  recordDecision(observation: WorkPatternActivationObservation): Promise<void>;
};

export type WorkPatternActivationPersistence = {
  withActivationLock<T>(
    laneKey: string,
    work: (session: WorkPatternActivationPersistenceSession) => Promise<T>,
  ): Promise<T>;
};

export type WorkPatternActivationRequest = {
  patternKey: string;
  patternVersion: number;
  sourceExperimentTaskRunId: string;
  requestedScope: {
    installScopes: CapabilityInstallScope[];
    organizationIds: string[];
    taskCorpusKeys: string[];
    modelProfileIds: string[];
  };
  grants: WorkPatternActivationGrant[];
  now: Date;
};

export type WorkPatternActivationObservation = {
  decision: WorkPatternPromotionDecision;
  bindingId: string | null;
  activeBindingId: string | null;
  reasons: string[];
  sourceExperimentTaskRunId: string;
  activationLaneKey: string;
  candidateIdentity: string;
};

export type WorkPatternActivationResult = {
  decision: WorkPatternPromotionDecision;
  bindingId: string | null;
  activeBindingId: string | null;
  reasons: string[];
};

function digest(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

function patternLabel(patternKey: string): string {
  const words = patternKey.replaceAll(/[-_.]+/g, " ").trim();
  return words.length > 0
    ? `${words[0].toUpperCase()}${words.slice(1)}`
    : "Living Playbook";
}

export function workPatternActivationLaneKey(
  snapshot: WorkPatternActivationSnapshot,
): string {
  return `WP-LANE-${digest([
    snapshot.agentId,
    snapshot.patternKey,
    snapshot.promotionEvidence.activityKey,
    snapshot.promotionEvidence.riskClass,
    snapshot.source.modelProfileId,
  ])}`;
}

function sameAuthorizedScope(
  left: WorkPatternActivationBinding,
  right: WorkPatternActivationBinding,
): boolean {
  const leftScope = left.authorityScope;
  const rightScope = right.authorityScope;
  const sameValues = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length
    && [...a].sort().every((value, index) => value === [...b].sort()[index]);
  return (
    leftScope.activationLaneKey === rightScope.activationLaneKey
    && leftScope.activityKey === rightScope.activityKey
    && leftScope.riskClass === rightScope.riskClass
    && sameValues(leftScope.installScopes, rightScope.installScopes)
    && sameValues(leftScope.organizationIds, rightScope.organizationIds)
    && sameValues(leftScope.taskCorpusKeys, rightScope.taskCorpusKeys)
    && sameValues(leftScope.modelProfileIds, rightScope.modelProfileIds)
  );
}

function bindingScopeKey(
  snapshot: WorkPatternActivationSnapshot,
  requestedScope: WorkPatternActivationRequest["requestedScope"],
  patternVersion = snapshot.patternVersion,
): string {
  return `WP-SCOPE-${digest([
    snapshot.patternKey,
    patternVersion,
    [...requestedScope.installScopes].sort(),
    [...requestedScope.organizationIds].sort(),
    [...requestedScope.taskCorpusKeys].sort(),
    [...requestedScope.modelProfileIds].sort(),
  ])}`;
}

function bindingIdForVersion(
  snapshot: WorkPatternActivationSnapshot,
  requestedScope: WorkPatternActivationRequest["requestedScope"],
  patternVersion: number,
): string {
  return `AB-WP-${digest([
    snapshot.agentId,
    bindingScopeKey(snapshot, requestedScope, patternVersion),
    snapshot.patternKey,
    patternVersion,
  ])}`;
}

function containsAll<T extends string>(
  ceiling: readonly T[],
  requested: readonly T[],
): boolean {
  const allowed = new Set(ceiling);
  return requested.every((value) => allowed.has(value));
}

function requestMatchesSnapshot(
  request: WorkPatternActivationRequest,
  snapshot: WorkPatternActivationSnapshot,
): boolean {
  return (
    request.patternKey === snapshot.patternKey
    && request.patternVersion === snapshot.patternVersion
    && request.sourceExperimentTaskRunId === snapshot.sourceExperimentTaskRunId
  );
}

function snapshotUsesSupportedPromotionPolicy(
  snapshot: WorkPatternActivationSnapshot,
): boolean {
  return (
    snapshot.candidateEvidence.patternKey === snapshot.patternKey
    && snapshot.candidateEvidence.patternVersion === snapshot.patternVersion
    && snapshot.candidateEvidence.promotionPolicyKey
      === DEFAULT_WORK_PATTERN_PROMOTION_POLICY.policyKey
    && snapshot.candidateEvidence.promotionPolicyVersion
      === DEFAULT_WORK_PATTERN_PROMOTION_POLICY.version
  );
}

function evidenceOrigin(
  ceiling: ReturnType<typeof deriveMaximumActivationScope>["ceiling"],
): WorkPatternEvidenceOrigin {
  if (ceiling === "corroborated") return "customer-corroborated";
  if (ceiling === "canonical-corpus") return "portable-canonical-corpus";
  return "customer-zero";
}

function outcome(
  decision: WorkPatternPromotionDecision,
  reasons: string[],
  bindingId: string | null = null,
  activeBindingId: string | null = null,
): WorkPatternActivationResult {
  return { decision, reasons, bindingId, activeBindingId };
}

async function observe(
  session: WorkPatternActivationPersistenceSession,
  result: WorkPatternActivationResult,
  snapshot: WorkPatternActivationSnapshot,
  activationLaneKey: string,
) {
  await session.recordDecision({
    ...result,
    sourceExperimentTaskRunId: snapshot.sourceExperimentTaskRunId,
    activationLaneKey,
    candidateIdentity:
      workPatternCandidateEvidenceIdentity(snapshot.candidateEvidence),
  });
  return result;
}

export async function activateWorkPattern(
  request: WorkPatternActivationRequest,
  deps: { persistence: WorkPatternActivationPersistence },
): Promise<WorkPatternActivationResult> {
  // The authoritative lane includes evidence fields that are deliberately read
  // only after lock acquisition. Serialize at the coarser pattern boundary so
  // two evidence snapshots can never race into separate active bindings.
  const provisionalLaneKey = `WP-PATTERN-${digest([request.patternKey])}`;

  return deps.persistence.withActivationLock(provisionalLaneKey, async (session) => {
    const snapshot = await session.readSnapshot();
    const activationLaneKey = workPatternActivationLaneKey(snapshot);

    if (!requestMatchesSnapshot(request, snapshot)) {
      return observe(
        session,
        outcome("reject", ["activation_request_evidence_mismatch"]),
        snapshot,
        activationLaneKey,
      );
    }
    if (!snapshotUsesSupportedPromotionPolicy(snapshot)) {
      return observe(
        session,
        outcome("escalate", ["promotion_policy_version_unsupported"]),
        snapshot,
        activationLaneKey,
      );
    }

    await validateBindingGrant({
      intrinsic: snapshot.intrinsicGrantKeys,
      requested: request.grants,
    });

    const bindings = await session.listBindingsForLane(activationLaneKey);
    const active = bindings.find((binding) => binding.status === "active") ?? null;
    const mayBootstrapBaseline =
      Number.isInteger(snapshot.baselinePatternVersion)
      && snapshot.baselinePatternVersion > 0
      && snapshot.baselinePatternVersion < snapshot.patternVersion;
    const baselineBindingId = mayBootstrapBaseline
      ? bindingIdForVersion(
          snapshot,
          request.requestedScope,
          snapshot.baselinePatternVersion,
        )
      : null;
    const effectiveRollbackBindingId =
      active?.bindingId
      ?? snapshot.promotionEvidence.rollbackBindingId
      ?? baselineBindingId;
    const policyVerdict = evaluateWorkPatternPromotion({
      policy: DEFAULT_WORK_PATTERN_PROMOTION_POLICY,
      evidence: {
        ...snapshot.promotionEvidence,
        rollbackBindingId: effectiveRollbackBindingId,
      },
      now: request.now,
    });

    if (policyVerdict.decision === "rollback") {
      const rollbackId = snapshot.promotionEvidence.rollbackBindingId;
      const rollbackTarget = rollbackId
        ? await session.findBinding(rollbackId)
        : null;
      if (!active || !rollbackTarget) {
        return observe(
          session,
          outcome("escalate", ["rollback_target_missing"], active?.bindingId ?? null),
          snapshot,
          activationLaneKey,
        );
      }
      if (!sameAuthorizedScope(active, rollbackTarget)) {
        return observe(
          session,
          outcome("escalate", ["rollback_scope_mismatch"], active.bindingId),
          snapshot,
          activationLaneKey,
        );
      }
      await session.updateBindingStatus(active.bindingId, "rolled-back");
      await session.updateBindingStatus(rollbackTarget.bindingId, "active");
      return observe(
        session,
        outcome("rollback", policyVerdict.reasons, active.bindingId, rollbackTarget.bindingId),
        snapshot,
        activationLaneKey,
      );
    }

    if (policyVerdict.decision !== "activate") {
      return observe(
        session,
        outcome(policyVerdict.decision, policyVerdict.reasons, active?.bindingId ?? null),
        snapshot,
        activationLaneKey,
      );
    }

    const reopen = canReopenRejectedWorkPatternCandidate({
      candidate: snapshot.candidateEvidence,
      effectiveRejections: await session.listRejectedCandidates(),
    });
    if (!reopen.allowed) {
      return observe(
        session,
        outcome("reject", [reopen.reason], active?.bindingId ?? null),
        snapshot,
        activationLaneKey,
      );
    }

    const maximumScope = deriveMaximumActivationScope({
      source: snapshot.source,
      portableCanonicalCorpus: snapshot.portableCanonicalCorpus,
      corroborations: snapshot.corroborations,
    });
    if (
      !containsAll(maximumScope.installScopes, request.requestedScope.installScopes)
      || !containsAll(maximumScope.organizationIds, request.requestedScope.organizationIds)
      || !containsAll(maximumScope.taskCorpusKeys, request.requestedScope.taskCorpusKeys)
      || !containsAll(maximumScope.modelProfileIds, request.requestedScope.modelProfileIds)
    ) {
      return observe(
        session,
        outcome("reject", ["requested_scope_exceeds_evidence"], active?.bindingId ?? null),
        snapshot,
        activationLaneKey,
      );
    }

    const scopeKey = bindingScopeKey(snapshot, request.requestedScope);
    const bindingId = bindingIdForVersion(
      snapshot,
      request.requestedScope,
      snapshot.patternVersion,
    );
    const existing = await session.findBinding(bindingId);
    if (existing?.status === "active") {
      return observe(
        session,
        outcome("activate", [], existing.bindingId, existing.bindingId),
        snapshot,
        activationLaneKey,
      );
    }

    const requestedPriorSafeBindingId = effectiveRollbackBindingId;
    let priorSafeBinding = requestedPriorSafeBindingId
      ? await session.findBinding(requestedPriorSafeBindingId)
      : null;
    if (
      !priorSafeBinding
      && baselineBindingId
      && requestedPriorSafeBindingId === baselineBindingId
    ) {
      const baselineScopeKey = bindingScopeKey(
        snapshot,
        request.requestedScope,
        snapshot.baselinePatternVersion,
      );
      const baselineAuthorityScope: WorkPatternAuthorityScopeV1 = {
        schemaVersion: 1,
        activationLaneKey,
        bindingScopeKey: baselineScopeKey,
        patternKey: snapshot.patternKey,
        patternVersion: snapshot.baselinePatternVersion,
        activityKey: snapshot.promotionEvidence.activityKey,
        riskClass: snapshot.promotionEvidence.riskClass,
        installScopes: [...request.requestedScope.installScopes],
        organizationIds: [...request.requestedScope.organizationIds],
        taskCorpusKeys: [...request.requestedScope.taskCorpusKeys],
        modelProfileIds: [...request.requestedScope.modelProfileIds],
        promotionPolicyKey: DEFAULT_WORK_PATTERN_PROMOTION_POLICY.policyKey,
        promotionPolicyVersion: DEFAULT_WORK_PATTERN_PROMOTION_POLICY.version,
        sourceExperimentTaskRunId: snapshot.sourceExperimentTaskRunId,
        corroborationTaskRunIds: [...maximumScope.corroborationTaskRunIds],
        priorSafeBindingId: null,
        evidenceFreshnessAt: snapshot.promotionEvidence.freshnessAt.toISOString(),
        evidenceOrigin: evidenceOrigin(maximumScope.ceiling),
        scopeCeiling: maximumScope.ceiling,
        blockers: [...maximumScope.blockers],
      };
      priorSafeBinding = await session.saveBinding({
        bindingId: baselineBindingId,
        name: `${patternLabel(snapshot.patternKey)} v${snapshot.baselinePatternVersion}`,
        status: "active",
        resourceRef: `${snapshot.patternKey}@${snapshot.baselinePatternVersion}`,
        appliedAgentId: snapshot.agentId,
        grants: request.grants,
        authorityScope: baselineAuthorityScope,
      });
    }
    if (
      !priorSafeBinding
      || priorSafeBinding.authorityScope.activationLaneKey !== activationLaneKey
    ) {
      return observe(
        session,
        outcome("escalate", ["rollback_target_missing"], active?.bindingId ?? null),
        snapshot,
        activationLaneKey,
      );
    }
    const priorSafeBindingId = priorSafeBinding.bindingId;
    if (priorSafeBinding.status === "active" && priorSafeBinding.bindingId !== bindingId) {
      await session.updateBindingStatus(priorSafeBinding.bindingId, "superseded");
    }

    const authorityScope: WorkPatternAuthorityScopeV1 = {
      schemaVersion: 1,
      activationLaneKey,
      bindingScopeKey: scopeKey,
      patternKey: snapshot.patternKey,
      patternVersion: snapshot.patternVersion,
      activityKey: snapshot.promotionEvidence.activityKey,
      riskClass: snapshot.promotionEvidence.riskClass,
      installScopes: [...request.requestedScope.installScopes],
      organizationIds: [...request.requestedScope.organizationIds],
      taskCorpusKeys: [...request.requestedScope.taskCorpusKeys],
      modelProfileIds: [...request.requestedScope.modelProfileIds],
      promotionPolicyKey: DEFAULT_WORK_PATTERN_PROMOTION_POLICY.policyKey,
      promotionPolicyVersion: DEFAULT_WORK_PATTERN_PROMOTION_POLICY.version,
      sourceExperimentTaskRunId: snapshot.sourceExperimentTaskRunId,
      corroborationTaskRunIds: [...maximumScope.corroborationTaskRunIds],
      priorSafeBindingId,
      evidenceFreshnessAt: snapshot.promotionEvidence.freshnessAt.toISOString(),
      evidenceOrigin: evidenceOrigin(maximumScope.ceiling),
      scopeCeiling: maximumScope.ceiling,
      blockers: [...maximumScope.blockers],
    };
    await session.saveBinding({
      bindingId,
      name: `${patternLabel(snapshot.patternKey)} v${snapshot.patternVersion}`,
      status: "active",
      resourceRef: `${snapshot.patternKey}@${snapshot.patternVersion}`,
      appliedAgentId: snapshot.agentId,
      grants: request.grants,
      authorityScope,
    });

    return observe(
      session,
      outcome("activate", [], bindingId, bindingId),
      snapshot,
      activationLaneKey,
    );
  });
}

export { WORK_PATTERN_BINDING_RESOURCE_TYPE };
