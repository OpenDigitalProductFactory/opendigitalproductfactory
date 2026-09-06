import "server-only";

import { prisma } from "@dpf/db";

import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";

import {
  persistPolicyAuthorityProjection,
  projectPolicyAuthority,
  type PolicyAuthorityGate,
  type PolicyAuthorityProjectionInput,
} from "./policy-authority-projector";
import type { PolicyAuthorityProjectionAttempt } from "./coworker-tool-authority-gate";

const PROJECTABLE_ACTIONS = new Set(Object.keys(INITIATIVE_READINESS_LANES));
const MAX_JUDGMENT_AGE_MS = 60 * 60 * 1000;

type DecisionRow = {
  interactionId: string;
  gateKey: string | null;
  outcomeType: string;
  recommendedOptionId: string | null;
  outcomePayload: unknown;
  riskTier: string;
  principleConflict: boolean;
  sources: unknown;
  createdAt: Date;
  sealedAt: Date | null;
  chainEntryHash: string | null;
  profile: {
    profileId: string;
    kind: string;
    scope: unknown;
    ownerOrganizationId: string | null;
    ownerPrincipalId: string | null;
    currentVersionId: string | null;
  };
  profileVersion: {
    versionId: string;
    promotedByPrincipalId: string | null;
  };
};

type PolicyAuthorityDb = {
  decisionInteraction: { findMany(args: unknown): Promise<DecisionRow[]> };
  delegationGrant: {
    findFirst(args: unknown): Promise<{
      grantId: string;
      status: string;
      grantorUserId: string;
      riskBand: string;
      validFrom: Date;
      expiresAt: Date;
      workflowKey: string | null;
      objectRef: string | null;
      maxUses: number | null;
      useCount: number;
      granteeAgent: { agentId: string };
    } | null>;
  };
  $transaction: Parameters<typeof persistPolicyAuthorityProjection>[0]["db"]["$transaction"];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function risk(value: unknown): "low" | "medium" | "high" | "critical" {
  return value === "low" || value === "high" || value === "critical" ? value : "medium";
}

function gateFor(key: string | null): PolicyAuthorityGate | null {
  if (key === "org-business") return "wwwd";
  if (key === "profession") return "wsid";
  if (key === "kernel-consult" || key === "build-studio" || key === "backlog-triage") return "wwmd";
  return null;
}

function subject(value: unknown): PolicyAuthorityProjectionInput["binding"]["subject"] | null {
  const candidate = record(value);
  const kind = string(candidate.kind);
  const id = string(candidate.id);
  if (!kind || !id) return null;
  if (!["employee", "account", "contact", "partner-account", "principal", "team", "backlog-item", "platform"].includes(kind)) return null;
  return { kind, id } as PolicyAuthorityProjectionInput["binding"]["subject"];
}

function actionBinding(payload: Record<string, unknown>): PolicyAuthorityProjectionInput["judgment"]["actionBinding"] {
  const stored = record(payload.policyActionBinding);
  const storedSubject = subject(stored.subject);
  const actionKey = string(stored.actionKey);
  const artifactFingerprint = string(stored.artifactFingerprint);
  if (!storedSubject || !actionKey || !artifactFingerprint) return null;
  return {
    actionKey,
    subject: storedSubject,
    organizationId: string(stored.organizationId),
    professionId: string(stored.professionId),
    routeContext: string(stored.routeContext),
    artifactFingerprint,
  };
}

function matchesRequestedAction(
  stored: NonNullable<PolicyAuthorityProjectionInput["judgment"]["actionBinding"]>,
  input: Parameters<PolicyAuthorityProjectionAttempt>[0],
): boolean {
  const requestedSubject = input.authorityInput.subject;
  return Boolean(requestedSubject)
    && stored.actionKey === input.execution.toolName
    && stored.subject.kind === requestedSubject?.kind
    && stored.subject.id === requestedSubject?.id
    && stored.organizationId === (input.authorityInput.organizationId ?? null)
    && stored.routeContext === input.authorityInput.action.routeContext
    && stored.artifactFingerprint === input.approvalBinding.inputFingerprint;
}

/**
 * Server adapter for the pure projector. It never accepts a DI id or policy
 * interpretation from tool arguments: recent sealed candidates, current
 * profile ownership, promotion provenance, and delegation are loaded here.
 */
export async function resolveAndPersistPolicyActionAuthority(
  input: Parameters<PolicyAuthorityProjectionAttempt>[0],
  db: PolicyAuthorityDb = prisma as unknown as PolicyAuthorityDb,
  overrides: {
    produceJudgment?: (input: Parameters<PolicyAuthorityProjectionAttempt>[0]) => Promise<void>;
  } = {},
): ReturnType<PolicyAuthorityProjectionAttempt> {
    const { execution, authorityInput, approvalBinding } = input;
    if (!PROJECTABLE_ACTIONS.has(execution.toolName)) return { outcome: "not-authorized" };
    const actingHumanUserId = authorityInput.authContext.actingHumanUserId;
    const actingAgentId = authorityInput.authContext.actingAgentId;
    if (!actingHumanUserId || !actingAgentId || !authorityInput.subject) return { outcome: "not-authorized" };

    const now = authorityInput.now ?? new Date();
    const findCandidates = () => db.decisionInteraction.findMany({
      where: {
        gateKey: { in: ["kernel-consult", "build-studio", "backlog-triage", "org-business", "profession"] },
        createdAt: { gte: new Date(now.getTime() - MAX_JUDGMENT_AGE_MS) },
        sealedAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        interactionId: true,
        gateKey: true,
        outcomeType: true,
        recommendedOptionId: true,
        outcomePayload: true,
        riskTier: true,
        principleConflict: true,
        sources: true,
        createdAt: true,
        sealedAt: true,
        chainEntryHash: true,
        profile: { select: { profileId: true, kind: true, scope: true, ownerOrganizationId: true, ownerPrincipalId: true, currentVersionId: true } },
        profileVersion: { select: { versionId: true, promotedByPrincipalId: true } },
      },
    });
    let candidates = await findCandidates();

    const grantIds = authorityInput.authContext.delegationGrantIds;
    const grant = grantIds.length > 0
      ? await db.delegationGrant.findFirst({
          where: {
            OR: [{ id: { in: grantIds } }, { grantId: { in: grantIds } }],
            status: "active",
          },
          orderBy: { expiresAt: "desc" },
          select: {
            grantId: true,
            status: true,
            grantorUserId: true,
            riskBand: true,
            validFrom: true,
            expiresAt: true,
            workflowKey: true,
            objectRef: true,
            maxUses: true,
            useCount: true,
            granteeAgent: { select: { agentId: true } },
          },
        })
      : null;

    let producedJudgment = false;
    while (true) {
    for (const row of candidates) {
      const payload = record(row.outcomePayload);
      const storedBinding = actionBinding(payload);
      const gate = gateFor(row.gateKey);
      if (!gate || !storedBinding) continue;
      if (!matchesRequestedAction(storedBinding, { execution, authorityInput, approvalBinding })) continue;
      const humanRootPrincipalId = row.profileVersion.promotedByPrincipalId;
      if (!humanRootPrincipalId) continue;
      const profileScope = record(row.profile.scope);
      const projection = projectPolicyAuthority({
        now,
        binding: {
          gate,
          actionKey: execution.toolName,
          affirmativeOptionId: string(payload.policyAffirmativeOptionId) ?? "proceed",
          subject: authorityInput.subject,
          organizationId: authorityInput.organizationId ?? null,
          professionId: string(storedBinding.professionId),
          routeContext: authorityInput.action.routeContext,
          artifactFingerprint: approvalBinding.inputFingerprint,
          actingHumanUserId,
          actingAgentId,
          humanRootPrincipalId,
          delegationRequired: grantIds.length > 0,
          maximumRiskTier: "medium",
          dualControlRequired: payload.dualControlRequired === true,
        },
        approvalBinding,
        judgment: {
          interactionId: row.interactionId,
          gateKey: row.gateKey,
          profileId: row.profile.profileId,
          profileKind: row.profile.kind,
          profileOwnerOrganizationId: row.profile.ownerOrganizationId,
          profileOwnerPrincipalId: row.profile.ownerPrincipalId,
          profileOwnerProfessionId: string(profileScope.professionId),
          profileCurrentVersionId: row.profile.currentVersionId,
          profileVersionId: row.profileVersion.versionId,
          versionPromotedByPrincipalId: row.profileVersion.promotedByPrincipalId,
          outcomeType: row.outcomeType,
          recommendedOptionId: row.recommendedOptionId ?? string(payload.recommendedOptionId),
          verdict: string(payload.verdict),
          signalUsable: boolean(payload.signalUsable),
          autonomyEligible: boolean(payload.autonomyEligible),
          recommendationConfidence: string(payload.recommendationConfidence),
          featureCoverageWeak: boolean(payload.featureCoverageWeak),
          sensitivityUnstable: boolean(payload.sensitivityUnstable),
          commandmentConflict: row.principleConflict || payload.commandmentConflict === true,
          riskTier: risk(row.riskTier),
          createdAt: row.createdAt,
          sealedAt: row.sealedAt,
          chainEntryHash: row.chainEntryHash,
          evidenceRefs: Array.isArray(row.sources) ? row.sources : [],
          contributionLedger: Array.isArray(payload.topContributors) ? payload.topContributors : [],
          actionBinding: storedBinding,
        },
        delegation: grant ? {
          grantId: grant.grantId,
          status: grant.status,
          grantorUserId: grant.grantorUserId,
          granteeAgentId: grant.granteeAgent.agentId,
          validFrom: grant.validFrom,
          expiresAt: grant.expiresAt,
          riskBand: risk(grant.riskBand),
          workflowKey: grant.workflowKey,
          objectRef: grant.objectRef,
          maxUses: grant.maxUses,
          useCount: grant.useCount,
        } : null,
      });
      if (projection.outcome === "deny") {
        return {
          outcome: "denied",
          reasonCode: projection.reasonCode === "policy-declined"
            ? "policy-declined"
            : "policy-authorization-invalid",
          explanation: projection.explanation,
        };
      }
      if (projection.outcome === "resolve") {
        if (projection.reasonCode === "dual-control-required") {
          return {
            outcome: "resolution-required",
            reasonCode: "dual-control-required",
            explanation: projection.explanation,
          };
        }
        return { outcome: "not-authorized" };
      }
      const persisted = await persistPolicyAuthorityProjection({
        db,
        projection,
        approvalBinding,
        threadId: execution.context?.threadId ?? null,
      });
      return {
        outcome: "approved",
        authorityDecisionId: persisted.authorityDecisionId,
        envelopeId: persisted.envelopeId,
        expiresAt: projection.expiresAt,
      };
    }
    if (producedJudgment) return { outcome: "not-authorized" };
    producedJudgment = true;
    try {
      const produceJudgment = overrides.produceJudgment
        ?? (await import("./policy-action-judgment")).producePolicyActionJudgment;
      await produceJudgment(input);
      candidates = await findCandidates();
    } catch (error) {
      console.warn(
        "[policy-action-authority] WWMD judgment unavailable:",
        error instanceof Error ? error.message : String(error),
      );
      return { outcome: "not-authorized" };
    }
    }
}
