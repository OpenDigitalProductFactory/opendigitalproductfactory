import { createHash, randomUUID } from "node:crypto";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
  type CoworkerAuthoritySubject,
} from "./coworker-authority-decision";

export const POLICY_AUTHORITY_PROJECTOR_VERSION = "policy-authority-projector.v1";

export type PolicyAuthorityGate = "wwmd" | "wwwd" | "wsid";
type RiskTier = "low" | "medium" | "high" | "critical";

type PolicyActionBinding = {
  actionKey: string;
  subject: CoworkerAuthoritySubject;
  organizationId: string | null;
  professionId: string | null;
  routeContext: string | null;
  artifactFingerprint: string;
};

export type PolicyAuthorityProjectionInput = {
  now?: Date;
  ttlMs?: number;
  maximumJudgmentAgeMs?: number;
  binding: PolicyActionBinding & {
    gate: PolicyAuthorityGate;
    affirmativeOptionId: string;
    actingHumanUserId: string;
    actingAgentId: string;
    humanRootPrincipalId: string;
    delegationRequired: boolean;
    maximumRiskTier: RiskTier;
    dualControlRequired: boolean;
  };
  approvalBinding: CoworkerApprovalBinding;
  judgment: {
    interactionId: string;
    gateKey: string | null;
    profileId: string;
    profileKind: string;
    profileOwnerOrganizationId: string | null;
    profileOwnerPrincipalId: string | null;
    profileOwnerProfessionId?: string | null;
    profileCurrentVersionId: string | null;
    profileVersionId: string;
    versionPromotedByPrincipalId: string | null;
    outcomeType: string;
    recommendedOptionId: string | null;
    verdict: string | null;
    signalUsable: boolean | null;
    autonomyEligible: boolean | null;
    recommendationConfidence: string | null;
    featureCoverageWeak: boolean | null;
    sensitivityUnstable: boolean | null;
    commandmentConflict: boolean;
    riskTier: RiskTier;
    createdAt: Date;
    sealedAt: Date | null;
    chainEntryHash: string | null;
    evidenceRefs: unknown[];
    contributionLedger: unknown[];
    actionBinding: PolicyActionBinding | null;
  };
  delegation: {
    grantId: string;
    status: string;
    grantorUserId: string;
    granteeAgentId: string;
    validFrom: Date;
    expiresAt: Date;
    riskBand: RiskTier;
    workflowKey: string | null;
    objectRef: string | null;
    maxUses: number | null;
    useCount: number;
  } | null;
  independentHumanApproval?: {
    principalId: string;
    approvedAt: Date;
    expiresAt: Date;
    approvalBindingFingerprint: string;
  } | null;
};

type PolicyAuthorityRejectionReason =
  | "policy-declined"
  | "policy-conflict"
  | "policy-resolution-required"
  | "binding-mismatch"
  | "policy-provenance-invalid"
  | "delegation-invalid"
  | "risk-floor-exceeded"
  | "dual-control-required";

export type PolicyAuthorityProjection =
  | {
      outcome: "allow";
      reasonCode: "policy-authorized";
      interactionId: string;
      gate: PolicyAuthorityGate;
      profileId: string;
      profileVersionId: string;
      humanRootPrincipalId: string;
      delegationGrantId: string | null;
      organizationId: string | null;
      actionKey: string;
      objectRef: string;
      routeContext: string | null;
      artifactFingerprint: string;
      approvalBindingFingerprint: string;
      auditEvidenceDigest: string;
      issuedAt: Date;
      expiresAt: Date;
      maxUses: 1;
      rationale: string;
    }
  | {
      outcome: "deny";
      reasonCode: PolicyAuthorityRejectionReason;
      interactionId: string;
      nextAction: "stop";
      explanation: string;
    }
  | {
      outcome: "resolve";
      reasonCode: PolicyAuthorityRejectionReason;
      interactionId: string;
      nextAction: "bounded-retry-or-human-resolution";
      explanation: string;
    };

const RISK_ORDER: Record<RiskTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const GATE_KEYS: Record<PolicyAuthorityGate, readonly string[]> = {
  wwmd: ["kernel-consult", "build-studio", "backlog-triage"],
  wwwd: ["org-business"],
  wsid: ["profession"],
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function objectRef(subject: CoworkerAuthoritySubject): string {
  return `${subject.kind}:${subject.id}`;
}

function reject(
  input: PolicyAuthorityProjectionInput,
  outcome: "deny" | "resolve",
  reasonCode: Exclude<PolicyAuthorityProjection, { outcome: "allow" }>["reasonCode"],
  explanation: string,
): PolicyAuthorityProjection {
  if (outcome === "deny") {
    return {
      outcome: "deny",
      reasonCode,
      interactionId: input.judgment.interactionId,
      nextAction: "stop",
      explanation,
    };
  }
  return {
    outcome: "resolve",
    reasonCode,
    interactionId: input.judgment.interactionId,
    nextAction: "bounded-retry-or-human-resolution",
    explanation,
  };
}

function sameActionBinding(left: PolicyActionBinding, right: PolicyActionBinding): boolean {
  const comparable = (value: PolicyActionBinding): PolicyActionBinding => ({
    actionKey: value.actionKey,
    subject: value.subject,
    organizationId: value.organizationId,
    professionId: value.professionId,
    routeContext: value.routeContext,
    artifactFingerprint: value.artifactFingerprint,
  });
  return digest(comparable(left)) === digest(comparable(right));
}

function validOwningProfile(input: PolicyAuthorityProjectionInput): boolean {
  const { binding, judgment } = input;
  if (!judgment.gateKey || !GATE_KEYS[binding.gate].includes(judgment.gateKey)) return false;
  if (binding.gate === "wwmd") {
    return judgment.profileKind === "platform"
      && judgment.profileOwnerPrincipalId === binding.humanRootPrincipalId;
  }
  if (binding.gate === "wwwd") {
    return judgment.profileKind === "organization"
      && Boolean(binding.organizationId)
      && judgment.profileOwnerOrganizationId === binding.organizationId;
  }
  return judgment.profileKind === "profession"
    && Boolean(binding.professionId)
    && Boolean(judgment.profileOwnerProfessionId)
    && judgment.profileOwnerProfessionId === binding.professionId;
}

function validDelegation(input: PolicyAuthorityProjectionInput, now: Date): boolean {
  if (!input.binding.delegationRequired) return true;
  const grant = input.delegation;
  if (!grant) return false;
  return grant.status === "active"
    && grant.validFrom <= now
    && grant.expiresAt > now
    && grant.grantorUserId === input.binding.actingHumanUserId
    && grant.granteeAgentId === input.binding.actingAgentId
    && (!grant.workflowKey || grant.workflowKey === input.binding.actionKey)
    && (!grant.objectRef || grant.objectRef === objectRef(input.binding.subject))
    && (grant.maxUses === null || grant.useCount < grant.maxUses)
    && RISK_ORDER[grant.riskBand] >= RISK_ORDER[input.judgment.riskTier];
}

/**
 * Project a sealed owning-policy judgment into a bounded action authorization.
 * All fields are server-resolved before entering this pure boundary; an
 * interaction id or caller interpretation alone is intentionally insufficient.
 */
export function projectPolicyAuthority(
  input: PolicyAuthorityProjectionInput,
): PolicyAuthorityProjection {
  const now = input.now ?? new Date();
  const judgment = input.judgment;
  const binding = input.binding;

  if (judgment.commandmentConflict) {
    return reject(input, "deny", "policy-conflict", "A commandment conflict forbids autonomous projection.");
  }
  if (judgment.outcomeType === "decline" || judgment.verdict === "decline") {
    return reject(input, "deny", "policy-declined", "The owning policy judgment explicitly declined this action.");
  }
  if (
    !judgment.sealedAt
    || !judgment.chainEntryHash
    || judgment.outcomeType === "defer"
    || judgment.outcomeType === "escalate"
    || judgment.verdict !== "proceed"
    || judgment.recommendedOptionId !== binding.affirmativeOptionId
    || judgment.signalUsable !== true
    || judgment.autonomyEligible !== true
    || judgment.recommendationConfidence !== "high"
    || judgment.featureCoverageWeak !== false
    || judgment.sensitivityUnstable !== false
  ) {
    return reject(input, "resolve", "policy-resolution-required", "The owning judgment is missing a current, explicit, autonomy-eligible yes.");
  }
  const maximumAge = input.maximumJudgmentAgeMs ?? 60 * 60 * 1000;
  if (judgment.createdAt > now || now.getTime() - judgment.createdAt.getTime() > maximumAge) {
    return reject(input, "resolve", "policy-resolution-required", "The owning judgment is stale or future-dated and must be evaluated again.");
  }
  if (
    judgment.profileCurrentVersionId !== judgment.profileVersionId
    || !judgment.versionPromotedByPrincipalId
    || judgment.versionPromotedByPrincipalId !== binding.humanRootPrincipalId
    || !validOwningProfile(input)
  ) {
    return reject(input, "deny", "policy-provenance-invalid", "The judgment is not rooted in the current human-approved owning policy.");
  }
  if (!judgment.actionBinding) {
    return reject(input, "resolve", "policy-resolution-required", "The judgment has no server-recorded action binding.");
  }
  if (!sameActionBinding(binding, judgment.actionBinding)) {
    return reject(input, "deny", "binding-mismatch", "The judgment belongs to a different subject, action, route, organization, profession, or artifact.");
  }
  if (RISK_ORDER[judgment.riskTier] > RISK_ORDER[binding.maximumRiskTier]) {
    return reject(input, "deny", "risk-floor-exceeded", "The action exceeds the standing delegation's risk floor.");
  }
  if (!validDelegation(input, now)) {
    return reject(input, "deny", "delegation-invalid", "The bounded delegation is missing, expired, revoked, exhausted, or out of scope.");
  }
  if (binding.dualControlRequired) {
    const approval = input.independentHumanApproval;
    if (
      !approval
      || approval.principalId === binding.humanRootPrincipalId
      || approval.approvedAt > now
      || approval.expiresAt <= now
      || approval.approvalBindingFingerprint !== fingerprintCoworkerApprovalBinding(input.approvalBinding)
    ) {
      return reject(input, "resolve", "dual-control-required", "This action's resolved risk policy requires a distinct human approver.");
    }
  }

  const requestedExpiry = new Date(now.getTime() + (input.ttlMs ?? 15 * 60 * 1000));
  const expiresAt = input.delegation && input.delegation.expiresAt < requestedExpiry
    ? input.delegation.expiresAt
    : requestedExpiry;
  const approvalBindingFingerprint = fingerprintCoworkerApprovalBinding(input.approvalBinding);
  const auditEvidenceDigest = digest({
    interactionId: judgment.interactionId,
    chainEntryHash: judgment.chainEntryHash,
    profileId: judgment.profileId,
    profileVersionId: judgment.profileVersionId,
    promoter: judgment.versionPromotedByPrincipalId,
    evidenceRefs: judgment.evidenceRefs,
    contributionLedger: judgment.contributionLedger,
    signal: {
      usable: judgment.signalUsable,
      autonomyEligible: judgment.autonomyEligible,
      confidence: judgment.recommendationConfidence,
      featureCoverageWeak: judgment.featureCoverageWeak,
      sensitivityUnstable: judgment.sensitivityUnstable,
      commandmentConflict: judgment.commandmentConflict,
    },
    binding,
    approvalBindingFingerprint,
  });

  return {
    outcome: "allow",
    reasonCode: "policy-authorized",
    interactionId: judgment.interactionId,
    gate: binding.gate,
    profileId: judgment.profileId,
    profileVersionId: judgment.profileVersionId,
    humanRootPrincipalId: binding.humanRootPrincipalId,
    delegationGrantId: input.delegation?.grantId ?? null,
    organizationId: binding.organizationId,
    actionKey: binding.actionKey,
    objectRef: objectRef(binding.subject),
    routeContext: binding.routeContext,
    artifactFingerprint: binding.artifactFingerprint,
    approvalBindingFingerprint,
    auditEvidenceDigest,
    issuedAt: now,
    expiresAt,
    maxUses: 1,
    rationale: "Explicit autonomy-eligible owning-policy yes projected into a single-use exact-action envelope.",
  };
}

type ProjectionTx = {
  authorizationDecisionLog: { create(args: { data: Record<string, unknown> }): Promise<{ decisionId: string }> };
  coworkerActionEnvelope: {
    findFirst(args: unknown): Promise<{ id: string; authorityDecisionId: string | null } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    updateMany(args: unknown): Promise<unknown>;
  };
};

type ProjectionDb = {
  $transaction<T>(work: (tx: ProjectionTx) => Promise<T>): Promise<T>;
};

/** Persist only a successful pure projection, keeping the allow log and its
 * exact-call approved envelope atomic and idempotent for the same binding. */
export async function persistPolicyAuthorityProjection(input: {
  db: ProjectionDb;
  projection: Extract<PolicyAuthorityProjection, { outcome: "allow" }>;
  approvalBinding: CoworkerApprovalBinding;
  threadId: string | null;
}): Promise<{ authorityDecisionId: string; envelopeId: string; reused: boolean }> {
  return input.db.$transaction(async (tx) => {
    await tx.coworkerActionEnvelope.updateMany({
      where: {
        approvalBindingFingerprint: input.projection.approvalBindingFingerprint,
        status: "approved",
        expiresAt: { lte: input.projection.issuedAt },
      },
      data: { status: "cancelled", resolvedAt: input.projection.issuedAt },
    });
    const existing = await tx.coworkerActionEnvelope.findFirst({
      where: {
        approvalBindingFingerprint: input.projection.approvalBindingFingerprint,
        status: "approved",
        resolvedAt: null,
        expiresAt: { gt: input.projection.issuedAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, authorityDecisionId: true },
    });
    if (existing?.authorityDecisionId) {
      return {
        authorityDecisionId: existing.authorityDecisionId,
        envelopeId: existing.id,
        reused: true,
      };
    }

    const authorityDecisionId = `AUTH-${randomUUID()}`;
    await tx.authorizationDecisionLog.create({
      data: {
        decisionId: authorityDecisionId,
        actorType: "ai-coworker",
        actorRef: input.approvalBinding.actingAgentId,
        humanContextRef: input.approvalBinding.actingHumanUserId,
        agentContextRef: input.approvalBinding.actingAgentId,
        delegationGrantId: input.projection.delegationGrantId,
        // "platform" is the canonical authority-scope sentinel for an
        // organizationless platform BI, not an Organization primary key.
        organizationId: input.projection.organizationId === "platform"
          ? null
          : input.projection.organizationId,
        purposeOfUse: "policy-derived-action-authorization",
        policyVersion: input.projection.profileVersionId,
        actionKey: input.projection.actionKey,
        objectRef: input.projection.objectRef,
        decision: "allow",
        rationale: {
          projectorVersion: POLICY_AUTHORITY_PROJECTOR_VERSION,
          interactionId: input.projection.interactionId,
          gate: input.projection.gate,
          profileId: input.projection.profileId,
          humanRootPrincipalId: input.projection.humanRootPrincipalId,
          artifactFingerprint: input.projection.artifactFingerprint,
          approvalBindingFingerprint: input.projection.approvalBindingFingerprint,
          auditEvidenceDigest: input.projection.auditEvidenceDigest,
          issuedAt: input.projection.issuedAt.toISOString(),
          expiresAt: input.projection.expiresAt.toISOString(),
          maxUses: input.projection.maxUses,
        },
        endpointUsed: "policy-authority-projector",
        mode: "immediate",
        routeContext: input.projection.routeContext,
        sensitivityLevel: input.approvalBinding.sensitivity,
        sensitivityOverride: false,
      },
    });
    const envelope = await tx.coworkerActionEnvelope.create({
      data: {
        coworkerAgentId: input.approvalBinding.actingAgentId,
        delegatingUserId: input.approvalBinding.actingHumanUserId,
        threadId: input.threadId ?? `authority:${input.approvalBinding.actingAgentId}`,
        manifestActionId: input.approvalBinding.toolName,
        argsJson: {
          approvalBinding: input.approvalBinding,
          policyAuthority: {
            interactionId: input.projection.interactionId,
            profileVersionId: input.projection.profileVersionId,
            auditEvidenceDigest: input.projection.auditEvidenceDigest,
            maxUses: input.projection.maxUses,
          },
        },
        rationale: input.projection.rationale,
        status: "approved",
        taskRunId: input.approvalBinding.taskRunId,
        delegationChainId: input.approvalBinding.chainId,
        authorityDecisionId,
        inputFingerprint: input.approvalBinding.inputFingerprint,
        approvalBindingFingerprint: input.projection.approvalBindingFingerprint,
        expiresAt: input.projection.expiresAt,
      },
    });
    return { authorityDecisionId, envelopeId: envelope.id, reused: false };
  });
}
