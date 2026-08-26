import { createHash, randomUUID } from "node:crypto";

import {
  INITIATIVE_READINESS_POLICY_VERSION,
  projectBacklogItemReadiness,
  type InitiativeReadinessDecision,
  type InitiativeReadinessActivity,
} from "@/lib/backlog/initiative-readiness";
import {
  parseWorkIntentDeclared,
  type WorkCapsuleExecutorKind,
  type WorkIntent,
} from "@/lib/work-capsules";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import {
  resolveInitiativeReviewerRecovery,
  type InitiativeRecoveryCanonicalArtifact,
  type InitiativeRecoveryDispatchContext,
  type InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";

import { claimBacklogItemWorkspace } from "./work-capsule-store";
import { declareWorkCapsuleIntent } from "./work-capsule-intent-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

type ClaimInput = {
  backlogItemId: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  baseBranch?: string | null;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  title?: string;
  objective?: string;
};

type ClaimResult = Awaited<ReturnType<typeof claimBacklogItemWorkspace>>;

type Dependencies = {
  claimWorkspace?: typeof claimBacklogItemWorkspace;
  declareIntent?: typeof declareWorkCapsuleIntent;
  discoverCanonicalArtifact?: DiscoverCanonicalArtifact;
};

type DiscoverCanonicalArtifact = (args: {
  repositoryFullName: string;
  baseSha: string;
  headSha: string;
}) => Promise<InitiativeRecoveryCanonicalArtifact>;

async function discoverCanonicalArtifactFromProvider(args: {
  repositoryFullName: string;
  baseSha: string;
  headSha: string;
}): Promise<InitiativeRecoveryCanonicalArtifact> {
  const { discoverCanonicalDesignArtifact } = await import(
    "@/lib/backlog/initiative-readiness/canonical-artifact-discovery"
  );
  const found = await discoverCanonicalDesignArtifact(args);
  return found.resolved
    ? { resolved: true, path: found.artifact.path, providerBlobId: found.artifact.providerBlobId }
    : { resolved: false, nextAction: found.nextAction };
}

type ExactReadback = {
  capsuleId: string;
  backlogItemId: string;
  status: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  executorKind: string | null;
  executorRef: string | null;
  leaseHolderPrincipalId: string;
  leaseExpiresAt: string;
  workIntent: WorkIntent;
};

type GovernedClaimSuccess = {
  workIntent: WorkIntent;
  readiness: InitiativeReadinessDecision;
  claim: ClaimResult;
  readback: ExactReadback;
};

type GovernedClaimFailure = {
  code: "initiative_not_ready" | "capsule_identity_mismatch" | "readiness_projection_failed";
  workIntent: WorkIntent;
  readiness: InitiativeReadinessDecision;
  recovery: InitiativeReviewerRecovery;
};

type GovernedClaimSuccessResult = Exclude<ActionResult<GovernedClaimSuccess>, { error: string }>;

export type GovernedClaimResult =
  | GovernedClaimSuccessResult
  | (Extract<ActionResult<GovernedClaimSuccess>, { error: string }> & { data: GovernedClaimFailure });

function claimSuccess(data: GovernedClaimSuccess): GovernedClaimSuccessResult {
  return ok(data) as GovernedClaimSuccessResult;
}

const EMPTY_RECOVERY: InitiativeReviewerRecovery = { reviewerRoutes: [], escalations: [], unroutable: [] };

type PendingRecovery = {
  decision: InitiativeReadinessDecision;
  baselineId: string | null;
  dispatchContext: InitiativeRecoveryDispatchContext | null;
  baseSha: string | null;
};

/**
 * Binding a reviewer to the canonical design costs one repository-provider round
 * trip, so it runs after the readiness transaction commits rather than holding
 * it open (BI-9FE775F9). The decision itself is already recorded; this only
 * shapes the recovery the blocked caller is handed back.
 */
async function resolveRecoveryOutsideTransaction(args: {
  db: CapsuleDb;
  actor: WorkCapsuleActor;
  pending: PendingRecovery;
  discover: DiscoverCanonicalArtifact;
}): Promise<InitiativeReviewerRecovery> {
  const { pending } = args;
  const canonicalArtifact: InitiativeRecoveryCanonicalArtifact = pending.dispatchContext && pending.baseSha
    ? await args.discover({
      repositoryFullName: pending.dispatchContext.repositoryFullName,
      baseSha: pending.baseSha,
      headSha: pending.dispatchContext.headSha,
    })
    : {
      resolved: false,
      nextAction: "The workroom records no immutable base and head, so no reviewer binding can be issued. Re-sync the branch with adopt_worktree(headBranch, headSha), then retry.",
    };

  return resolveInitiativeReviewerRecovery({
    decision: pending.decision,
    currentAgentId: args.actor.agentId,
    db: args.db,
    dispatchContext: pending.dispatchContext,
    canonicalArtifact,
    expectedCurrentBaselineId: pending.baselineId,
  });
}

class CapsuleIdentityMismatch extends Error {
  constructor(readonly decision: InitiativeReadinessDecision) {
    super("Claimed Workroom identity did not match the requested subject, branch, worktree, executor, lease, and intent.");
  }
}

function targetForIntent(intent: WorkIntent): "design" | "plan" | "implementation" {
  if (intent === "implementation") return "implementation";
  if (intent === "plan") return "plan";
  return "design";
}

function decisionWithId(decision: InitiativeReadinessDecision): InitiativeReadinessDecision {
  return { ...decision, decisionId: `IRD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}` };
}

function decisionCodes(decision: InitiativeReadinessDecision) {
  return {
    satisfied: decision.satisfied.map((entry) => entry.code),
    unmet: decision.unmet.map((entry) => entry.code),
    blockers: decision.blockers.map((entry) => entry.code),
  };
}

async function recordDecision(args: {
  db: CapsuleDb;
  backlogItemRowId: string;
  decision: InitiativeReadinessDecision;
  workIntent: WorkIntent;
  actor: WorkCapsuleActor;
}) {
  if (!args.db.backlogItemActivity) throw new Error("Initiative readiness decision persistence is unavailable.");
  const codes = decisionCodes(args.decision);
  const factsDigest = createHash("sha256").update(JSON.stringify({
    policyVersion: args.decision.policyVersion,
    subject: args.decision.subject,
    transitionObject: args.decision.transitionObject,
    target: args.decision.target,
    profile: args.decision.profile,
    codes,
  })).digest("hex");
  await args.db.backlogItemActivity.create({ data: {
    backlogItemId: args.backlogItemRowId,
    kind: "initiative_readiness_decision",
    summary: `${args.decision.target} readiness: ${args.decision.verdict}`,
    payload: {
      schemaVersion: 1,
      ...args.decision,
      workIntent: args.workIntent,
      factsDigest,
      stableCodes: codes,
      authority: { actionKey: "claim_backlog_item_for_work", enforcementState: "enforced" },
    },
    recordedById: args.actor.userId,
    recordedByAgentId: args.actor.agentId,
  } });
}

function exactReadback(args: {
  row: Record<string, unknown> | null;
  intentPayload: unknown;
  input: ClaimInput;
  actor: WorkCapsuleActor;
  capsuleId: string;
  workIntent: WorkIntent;
  now: Date;
}): ExactReadback | null {
  const parsedIntent = parseWorkIntentDeclared(args.intentPayload);
  const row = args.row;
  const lease = row?.leaseExpiresAt instanceof Date
    ? row.leaseExpiresAt
    : typeof row?.leaseExpiresAt === "string" ? new Date(row.leaseExpiresAt) : null;
  if (!row
    || row.capsuleId !== args.capsuleId
    || row.backlogItemId !== args.input.backlogItemId
    || row.repositoryFullName !== args.input.repositoryFullName
    || row.headBranch !== args.input.headBranch
    || row.worktreePath !== args.input.worktreePath
    || row.executorKind !== (args.input.executorKind ?? null)
    || row.executorRef !== (args.input.executorRef ?? null)
    || row.archivedAt != null
    || ["abandoned", "archived", "complete", "superseded"].includes(String(row.status))
    || row.leaseHolderPrincipalId !== args.actor.principalId
    || !lease || lease.getTime() <= args.now.getTime()
    || !parsedIntent.ok
    || parsedIntent.intent !== args.workIntent
    || parsedIntent.subject.kind !== "backlog-item"
    || parsedIntent.subject.id !== args.input.backlogItemId) return null;
  return {
    capsuleId: String(row.capsuleId),
    backlogItemId: String(row.backlogItemId),
    status: String(row.status),
    repositoryFullName: String(row.repositoryFullName),
    headBranch: String(row.headBranch),
    worktreePath: String(row.worktreePath),
    executorKind: row.executorKind == null ? null : String(row.executorKind),
    executorRef: row.executorRef == null ? null : String(row.executorRef),
    leaseHolderPrincipalId: String(row.leaseHolderPrincipalId),
    leaseExpiresAt: lease.toISOString(),
    workIntent: parsedIntent.intent,
  };
}

export async function claimGovernedBacklogWorkspace(args: {
  db: CapsuleDb;
  input: ClaimInput;
  actor: WorkCapsuleActor;
  workIntent: WorkIntent | null;
  now?: Date;
  dependencies?: Dependencies;
}): Promise<GovernedClaimResult> {
  if (!args.db.backlogItem || !args.db.backlogItemActivity) {
    throw new Error("Governed Workroom claim requires backlog item and activity access.");
  }
  const now = args.now ?? new Date();
  const workIntent = args.workIntent ?? "implementation";
  const target = targetForIntent(workIntent);
  const claimWorkspace = args.dependencies?.claimWorkspace ?? claimBacklogItemWorkspace;
  const declareIntent = args.dependencies?.declareIntent ?? declareWorkCapsuleIntent;
  const transact = args.db.$transaction
    ? <T>(fn: (tx: CapsuleDb) => Promise<T>) => args.db.$transaction!(fn)
    : <T>(fn: (tx: CapsuleDb) => Promise<T>) => fn(args.db);
  let backlogItemRowId = "";
  let evaluated: InitiativeReadinessDecision | null = null;
  let pendingRecovery: PendingRecovery | null = null;

  try {
    const outcome = await transact(async (tx) => {
      if (!tx.backlogItem || !tx.backlogItemActivity) throw new Error("Readiness transaction lost backlog access.");
      const item = await tx.backlogItem.findFirst({
        where: { OR: [{ itemId: args.input.backlogItemId }, { id: args.input.backlogItemId }] },
        select: {
          id: true, itemId: true, type: true, source: true, workType: true, scopeKind: true,
          archetypeCategories: true, archetypeIds: true, activeBuild: { select: { kind: true } },
        },
      });
      if (!item) throw new Error(`BacklogItem ${args.input.backlogItemId} not found`);
      backlogItemRowId = item.id;
      const activities = await tx.backlogItemActivity.findMany({
        where: { backlogItemId: item.id, kind: { in: ["initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage"] } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
      }) as InitiativeReadinessActivity[];
      const projection = projectBacklogItemReadiness({
        item: { ...item, activeBuildKind: item.activeBuild?.kind ?? null },
        activities,
        target,
        transitionObject: {
          kind: "work-capsule",
          id: `${args.input.repositoryFullName}#${args.input.headBranch}`,
          expectedVersion: "claim.v1",
          targetState: workIntent,
        },
        authorization: "pass",
        capsuleIdentity: "pass",
        evaluatedAt: now.toISOString(),
      });
      evaluated = decisionWithId(projection.decision);
      if (projection.governed && evaluated.verdict !== "allowed") {
        // Match on the branch identity, NOT on a backlog-item binding.
        //
        // `Workroom.backlogItemId` is written by the successful-claim path below,
        // so requiring it here made recovery unreachable by construction: the
        // binding recovery needs is created by the claim, and the claim returns
        // here precisely because it refused. Recovery exists to help an initiative
        // BECOME ready, so it cannot depend on state that only exists once it
        // already is (BI-512214EA).
        //
        // Branch identity is the right key regardless. What a reviewer dispatch
        // needs is an exact branch at an immutable head — which is what the
        // escalation's own nextAction asks for — and `(repository, headBranch)`
        // is already the Workroom's durable identity. An item binding, when it
        // exists, is preferred so a room explicitly bound to this item wins over
        // one merely sharing its branch.
        const recoveryWorkrooms = await tx.workroom.findMany({
          where: {
            repositoryFullName: args.input.repositoryFullName,
            headBranch: args.input.headBranch,
            archivedAt: null,
          },
          select: {
            capsuleId: true,
            repositoryFullName: true,
            headBranch: true,
            headSha: true,
            backlogItemId: true,
            baseSha: true,
          },
        }) as Array<{
          capsuleId: string;
          repositoryFullName: string;
          headBranch: string;
          headSha: string | null;
          backlogItemId: string | null;
          baseSha: string | null;
        }>;
        // Deterministic: an explicit binding to THIS item wins; otherwise the
        // first room on this branch that carries an immutable head.
        const recoveryWorkroom =
          recoveryWorkrooms.find((room) => room.backlogItemId === item.itemId && room.headSha)
          ?? recoveryWorkrooms.find((room) => room.headSha)
          ?? null;
        // Recovery needs a repository-provider round trip to bind the canonical
        // design (BI-9FE775F9). That must not run inside this transaction, so
        // the not-ready path records its decision here and resolves recovery
        // after the commit.
        pendingRecovery = {
          decision: evaluated,
          baselineId: projection.baselineId,
          dispatchContext: recoveryWorkroom?.headSha ? {
            workroomId: recoveryWorkroom.capsuleId,
            repositoryFullName: recoveryWorkroom.repositoryFullName,
            branchName: recoveryWorkroom.headBranch,
            headSha: recoveryWorkroom.headSha,
          } : null,
          baseSha: recoveryWorkroom?.baseSha ?? null,
        };
        await recordDecision({ db: tx, backlogItemRowId: item.id, decision: evaluated, workIntent, actor: args.actor });
        return {
          ...err(`Cannot start ${workIntent}: ${[...evaluated.blockers, ...evaluated.unmet].map((entry) => entry.code).join(", ")}.`),
          data: {
            code: "initiative_not_ready" as const,
            workIntent,
            readiness: evaluated,
            recovery: EMPTY_RECOVERY,
          },
        };
      }

      const claim = await claimWorkspace({ db: tx, input: args.input, actor: args.actor, now });
      await declareIntent({
        db: tx,
        capsuleId: claim.capsuleId,
        intent: workIntent,
        policyVersion: INITIATIVE_READINESS_POLICY_VERSION,
        subject: { kind: "backlog-item", id: item.itemId },
        actor: args.actor,
      });
      const row = await tx.workroom.findUnique({ where: { capsuleId: claim.capsuleId } }) as Record<string, unknown> | null;
      const latestIntent = tx.workroomActivity.findFirst
        ? await tx.workroomActivity.findFirst({
          where: { workCapsuleId: row?.id, kind: "work-intent-declared" },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
          select: { payload: true },
        })
        : null;
      const readback = exactReadback({
        row,
        intentPayload: latestIntent?.payload,
        input: args.input,
        actor: args.actor,
        capsuleId: claim.capsuleId,
        workIntent,
        now,
      });
      if (!readback) throw new CapsuleIdentityMismatch(evaluated);
      await recordDecision({ db: tx, backlogItemRowId: item.id, decision: evaluated, workIntent, actor: args.actor });
      return claimSuccess({ workIntent, readiness: evaluated, claim, readback });
    });
    if (!pendingRecovery || outcome.ok) return outcome;
    return {
      ...outcome,
      data: {
        ...outcome.data,
        recovery: await resolveRecoveryOutsideTransaction({
          db: args.db,
          actor: args.actor,
          pending: pendingRecovery,
          discover: args.dependencies?.discoverCanonicalArtifact ?? discoverCanonicalArtifactFromProvider,
        }),
      },
    };
  } catch (error) {
    if (!(error instanceof CapsuleIdentityMismatch) || !evaluated || !backlogItemRowId) throw error;
    const priorDecision = evaluated as InitiativeReadinessDecision;
    const denied: InitiativeReadinessDecision = {
      ...priorDecision,
      verdict: "denied",
      blockers: [{ code: "CAPSULE_IDENTITY_MISMATCH", state: "fail", accountableRole: "delivery-coordinator", evidenceRefs: [] }],
    };
    await recordDecision({ db: args.db, backlogItemRowId, decision: denied, workIntent, actor: args.actor });
    return {
      ...err(error.message),
      data: {
        code: "capsule_identity_mismatch",
        workIntent,
        readiness: denied,
        recovery: EMPTY_RECOVERY,
      },
    };
  }
}
