import { prisma, type Prisma } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";
import {
  parseWorkPatternAuthorityScope,
  WORK_PATTERN_BINDING_RESOURCE_TYPE,
} from "./work-pattern-binding-reader";
import type {
  WorkPatternActivationBinding,
  WorkPatternActivationObservation,
  WorkPatternActivationPersistence,
  WorkPatternActivationPersistenceSession,
  WorkPatternActivationSnapshot,
} from "./work-pattern-activation";
import {
  isRetainedWorkPatternFailureClass,
  resolveEffectiveWorkPatternLedger,
} from "./work-pattern-effective-ledger";

type SnapshotReader = (
  transaction: Prisma.TransactionClient,
) => Promise<WorkPatternActivationSnapshot>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function ledgerId(observation: WorkPatternActivationObservation): string {
  const binding = observation.bindingId ?? "none";
  return [
    "DSL-WP",
    observation.sourceExperimentTaskRunId,
    observation.decision,
    binding,
  ].join("-");
}

function createSession(
  tx: Prisma.TransactionClient,
  readAuthoritativeSnapshot: SnapshotReader,
): WorkPatternActivationPersistenceSession {
  let snapshot: WorkPatternActivationSnapshot | null = null;

  async function readSnapshot() {
    snapshot = await readAuthoritativeSnapshot(tx);
    return snapshot;
  }

  async function resolveAgentRowId(agentId: string) {
    const agent = await tx.agent.findUnique({
      where: { agentId },
      select: { id: true },
    });
    if (!agent) throw new Error(`unknown_work_pattern_coworker:${agentId}`);
    return agent.id;
  }

  async function readBinding(bindingId: string) {
    const row = await tx.authorityBinding.findUnique({
      where: { bindingId },
      include: {
        appliedAgent: { select: { agentId: true } },
        grants: { orderBy: { grantKey: "asc" } },
      },
    });
    if (!row || row.resourceType !== WORK_PATTERN_BINDING_RESOURCE_TYPE) return null;
    const authorityScope = parseWorkPatternAuthorityScope(row.authorityScope);
    if (!authorityScope || !row.appliedAgent) return null;
    return {
      bindingId: row.bindingId,
      name: row.name,
      status: row.status as WorkPatternActivationBinding["status"],
      resourceRef: row.resourceRef,
      appliedAgentId: row.appliedAgent.agentId,
      grants: row.grants.map((grant) => ({
        grantKey: grant.grantKey,
        mode: grant.mode,
        rationale: grant.rationale,
      })),
      authorityScope,
    };
  }

  return {
    readSnapshot,
    listBindingsForLane: async (activationLaneKey) => {
      const current = snapshot ?? await readSnapshot();
      const rows = await tx.authorityBinding.findMany({
        where: {
          resourceType: WORK_PATTERN_BINDING_RESOURCE_TYPE,
          appliedAgent: { agentId: current.agentId },
        },
        include: {
          appliedAgent: { select: { agentId: true } },
          grants: { orderBy: { grantKey: "asc" } },
        },
      });
      return rows.flatMap((row) => {
        const authorityScope = parseWorkPatternAuthorityScope(row.authorityScope);
        if (
          !authorityScope
          || authorityScope.activationLaneKey !== activationLaneKey
          || !row.appliedAgent
        ) return [];
        return [{
          bindingId: row.bindingId,
          name: row.name,
          status: row.status as WorkPatternActivationBinding["status"],
          resourceRef: row.resourceRef,
          appliedAgentId: row.appliedAgent.agentId,
          grants: row.grants.map((grant) => ({
            grantKey: grant.grantKey,
            mode: grant.mode,
            rationale: grant.rationale,
          })),
          authorityScope,
        }];
      });
    },
    findBinding: readBinding,
    listRejectedCandidates: async () => {
      const current = snapshot ?? await readSnapshot();
      const rows = await tx.decisionShadowLedger.findMany({
        where: {
          agentId: current.agentId,
          activityType: current.promotionEvidence.activityKey,
          riskClass: current.promotionEvidence.riskClass,
          sourceKind: "work-pattern-promotion",
        },
        select: {
          ledgerId: true,
          metadata: true,
        },
        orderBy: { observedAt: "asc" },
      });
      return resolveEffectiveWorkPatternLedger(rows).flatMap((row) => {
        if (!isRecord(row.metadata)) return [];
        const metadata = row.metadata;
        return metadata.decision === "reject"
          && typeof metadata.candidateIdentity === "string"
          && typeof metadata.failureClass === "string"
          && isRetainedWorkPatternFailureClass(metadata.failureClass)
          ? [{
              candidateIdentity: metadata.candidateIdentity,
              failureClass: metadata.failureClass,
            }]
          : [];
      });
    },
    saveBinding: async (binding) => {
      const appliedAgentId = await resolveAgentRowId(binding.appliedAgentId);
      await tx.authorityBinding.upsert({
        where: { bindingId: binding.bindingId },
        update: {
          name: binding.name,
          status: binding.status,
          resourceRef: binding.resourceRef,
          appliedAgentId,
          authorityScope: toJson(binding.authorityScope),
          grants: {
            deleteMany: {},
            create: binding.grants,
          },
        },
        create: {
          bindingId: binding.bindingId,
          name: binding.name,
          scopeType: "work-pattern-activation",
          status: binding.status,
          resourceType: WORK_PATTERN_BINDING_RESOURCE_TYPE,
          resourceRef: binding.resourceRef,
          appliedAgentId,
          authorityScope: toJson(binding.authorityScope),
          approvalMode: "policy",
          grants: { create: binding.grants },
        },
      });
      return binding;
    },
    updateBindingStatus: async (bindingId, status) => {
      await tx.authorityBinding.update({
        where: { bindingId },
        data: { status },
      });
    },
    recordDecision: async (observation) => {
      const current = snapshot ?? await readSnapshot();
      const id = ledgerId(observation);
      await tx.decisionShadowLedger.upsert({
        where: { ledgerId: id },
        update: {},
        create: {
          ledgerId: id,
          agentId: current.agentId,
          activityType: current.promotionEvidence.activityKey,
          riskClass: current.promotionEvidence.riskClass,
          autonomyLevel: "autonomous",
          proposedDecision: toJson({ decision: observation.decision }),
          actualDecision: toJson({ decision: observation.decision }),
          outcome: toJson({
            bindingId: observation.bindingId,
            activeBindingId: observation.activeBindingId,
            reasons: observation.reasons,
          }),
          agreement: true,
          sourceKind: "work-pattern-promotion",
          taskRunId: observation.sourceExperimentTaskRunId,
          metadata: toJson({
            activationLaneKey: observation.activationLaneKey,
            bindingId: observation.bindingId,
            decision: observation.decision,
            candidateIdentity: observation.candidateIdentity,
            failureClass: observation.reasons[0] ?? "none",
          }),
        },
      });
    },
  };
}

export function createPrismaWorkPatternActivationPersistence(
  readSnapshot: SnapshotReader,
): WorkPatternActivationPersistence {
  return {
    withActivationLock: (activationLaneKey, work) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${activationLaneKey}, 0))
        `;
        return work(createSession(tx, readSnapshot));
      }, { isolationLevel: "Serializable" }),
  };
}
